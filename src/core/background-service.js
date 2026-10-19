OTA.define('background-service', [], () => {
/* The only owner of browser Workers. The build embeds an audited OTA package;
   pasted text is a message value and never part of executable source. */
const WORKER_SOURCE = '__OTA_WORKER_SOURCE__';
const lanes=new Map();
let nextId=0;
const snapshotInput=input=>({...input,ui:JSON.parse(JSON.stringify(input.ui || {})),globalViews:JSON.parse(JSON.stringify(input.globalViews || []))});
const abortError=()=>Object.assign(new Error('操作已取消，原文仍保留'),{name:'AbortError'});
const cardVersion=card=>JSON.stringify([card.sourceRevision, (card.config || card.options)?.format || 'auto', (card.config || card.options)?.headerMode || 'auto']);
const BackgroundService = {
    THRESHOLD:128*1024,
    datasetKeys:new Set(),
    _datasetVersions:new Map(),
    canUse() { return typeof Worker !== 'undefined' && typeof URL.createObjectURL === 'function'; },
    isLarge(text) { return text.length>this.THRESHOLD; },
    hasDataset(cardId) { return this.datasetKeys.has(cardId); },
    /** 统一的多卡会话消息载荷（sources/visible/cardUis/ui/globalViews 只在这里组装） */
    workerPayload(input) {
        return { sources:input.sources || input.visible || [], visible:input.visible || [], cardUis:input.cardUis || {}, ui:input.ui || {}, globalViews:input.globalViews || [] };
    },
    /** 作业级取消：只拒绝指定类型的在途/排队作业，不终止 Worker、不丢其他卡的数据集 */
    cancelJobs(kinds) {
        const lane=lanes.get('compute');if(!lane)return;
        for(const [id,job] of lane.jobs)if(kinds.has(job.kind)){lane.jobs.delete(id);job.reject(abortError());lane.worker.postMessage({cancel:id});}
    },
    cancelQueries() { this.cancelJobs(new Set(['query'])); },
    cancelParses() { this.cancelJobs(new Set(['parse'])); },
    cancel() {
        for(const name of ['compute','export']) {
            const lane=lanes.get(name);
            if(lane) {lane.worker.terminate();clearTimeout(lane.timer);for(const job of lane.jobs.values())job.reject(abortError());lane.rejectReady(abortError());lanes.delete(name);}
        }
        this.datasetKeys.clear();this._datasetVersions.clear();
    },
    request(kind,payload={},handlers={},name='compute') {
        if(!this.canUse()) return Promise.reject(new Error('浏览器无法启动后台计算；请使用桌面 Chrome 或 Firefox，原文仍保留'));
        let lane=lanes.get(name);
        if(!lane) {
            const url=URL.createObjectURL(new Blob([WORKER_SOURCE],{type:'text/javascript'}));
            let worker;
            try {worker=new Worker(url);} catch(error) {URL.revokeObjectURL(url);return Promise.reject(error);}
            URL.revokeObjectURL(url);
            lane={worker,jobs:new Map()};
            lane.ready=new Promise((resolve,reject)=>{lane.resolveReady=resolve;lane.rejectReady=reject;});
            const fail=error=>{worker.terminate();clearTimeout(lane.timer);lane.rejectReady(error);for(const job of lane.jobs.values())job.reject(error);lanes.delete(name);if(name==='compute'){this.datasetKeys.clear();this._datasetVersions.clear();}};
            lane.timer=setTimeout(()=>fail(new Error('后台启动超时，原文仍保留')),10000);
            worker.onerror=event=>fail(new Error(event.message || '后台计算失败，原文仍保留'));
            worker.onmessageerror=()=>fail(new Error('后台消息无法读取，原文仍保留'));
            worker.onmessage=event=>{
                const message=event.data;
                if(message.ready===1) {clearTimeout(lane.timer);lane.resolveReady();return;}
                const job=lane.jobs.get(message.id);if(!job){if(message.type==='chunk')worker.postMessage({ack:message.id});return;}
                try {
                    if(message.type==='start') job.handlers.start?.(message.value);
                    else if(message.type==='chunk') {job.handlers.chunk?.(message.value);worker.postMessage({ack:message.id});}
                    else {lane.jobs.delete(message.id);if(message.error)job.reject(new Error(message.error));else job.resolve(message.value);}
                } catch(error) {lane.jobs.delete(message.id);job.reject(error);worker.postMessage({ack:message.id});}
            };
            lanes.set(name,lane);
        }
        return lane.ready.then(()=>new Promise((resolve,reject)=>{
            const id=++nextId;lane.jobs.set(id,{resolve,reject,handlers,kind});
            try {lane.worker.postMessage({id,kind,payload});} catch(error) {lane.jobs.delete(id);reject(error);}
        }));
    },
    async parse({text,options={},key,sourceRevision,config}) {
        let result;
        await this.request('parse',{text,options,cardId:key},{
            start:value=>{result=value;result.tables.forEach(table=>table.rows=[]);},
        });
        this.datasetKeys.add(key);
        this._datasetVersions.set(key,cardVersion({sourceRevision,options,config}));
        return result;
    },
    async prepare(input) {
        // Return bounded descriptors for cards parsed lazily, so their UI status is accurate too.
        const parsed=[];
        for(const card of input.cards || []) {
            if(this.datasetKeys.has(card.id) && this._datasetVersions.get(card.id) === cardVersion(card)) continue;
            const result=await this.parse({text:card.raw || '', options:card.options || {}, key:card.id,
                sourceRevision:card.sourceRevision, config:card.config});
            parsed.push({context:{docId:card.id, sourceRevision:card.sourceRevision, options:card.options, config:card.config}, result});
        }
        return parsed;
    },
    async prepareMany(cards) { await this.prepare({cards}); },
    removeCard(cardId) {
        this.datasetKeys.delete(cardId);this._datasetVersions.delete(cardId);
        const lane=lanes.get('compute');
        if(!lane) return Promise.resolve();
        return lane.ready.then(()=>this.request('removeCard',{cardId}));
    },
    async query(input) {
        const parsed=await this.prepare(input);
        const tables=await this.request('query',this.workerPayload(input));
        return {tables, parsed};
    },
    async export(input,mode) {
        input=snapshotInput(input);
        await this.prepare(input);
        return this.request('excel',Object.assign(this.workerPayload(input),{mode}));
    },
    async stats(input,cfg) {input=snapshotInput(input);cfg=JSON.parse(JSON.stringify(cfg));await this.prepare(input);return this.request('stats',Object.assign(this.workerPayload(input),{cfg}));},
    storage(kind,payload) {return this.request(kind,payload,{},'storage');}
};
return {BackgroundService};
});
