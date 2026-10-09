OTA.define('background-service', [], () => {
/* The only owner of browser Workers. The build embeds an audited OTA package;
   pasted text is a message value and never part of executable source. */
const WORKER_SOURCE = '__OTA_WORKER_SOURCE__';
const lanes=new Map();
let nextId=0;
const snapshotInput=input=>({...input,ui:JSON.parse(JSON.stringify(input.ui || {})),globalViews:JSON.parse(JSON.stringify(input.globalViews || []))});
const abortError=()=>Object.assign(new Error('操作已取消，原文仍保留'),{name:'AbortError'});
const BackgroundService = {
    THRESHOLD:128*1024,
    datasetKey:null,
    canUse() { return typeof Worker !== 'undefined' && typeof URL.createObjectURL === 'function'; },
    isLarge(text) { return text.length>this.THRESHOLD; },
    cancelQueries() {
        const lane=lanes.get('compute');if(!lane)return;
        for(const [id,job] of lane.jobs)if(job.kind==='query'){lane.jobs.delete(id);job.reject(abortError());lane.worker.postMessage({cancel:id});}
    },
    cancel() {
        for(const name of ['compute','export']) {
            const lane=lanes.get(name);
            if(lane) {lane.worker.terminate();clearTimeout(lane.timer);for(const job of lane.jobs.values())job.reject(abortError());lane.rejectReady(abortError());lanes.delete(name);}
        }
        this.datasetKey=null;
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
            const fail=error=>{worker.terminate();clearTimeout(lane.timer);lane.rejectReady(error);for(const job of lane.jobs.values())job.reject(error);lanes.delete(name);if(name==='compute')this.datasetKey=null;};
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
    async parse({text,options={},key}) {
        let result;
        await this.request('parse',{text,options,key},{
            start:value=>{result=value;result.tables.forEach(table=>table.rows=[]);},
        });
        this.datasetKey=key;
        return result;
    },
    async prepare(input) {
        if(this.datasetKey!==input.datasetKey) await this.parse({text:input.text,options:input.options,key:input.datasetKey},false);
    },
    async query(input) {
        await this.prepare(input);
        const tables=await this.request('query',{ui:input.ui,globalViews:input.globalViews,key:input.datasetKey});
        return {tables};
    },
    async export(input,mode) {
        input=snapshotInput(input);
        await this.prepare(input);
        return this.request('excel',{ui:input.ui,globalViews:input.globalViews,key:input.datasetKey,mode});
    },
    async stats(input,cfg) {input=snapshotInput(input);cfg=JSON.parse(JSON.stringify(cfg));await this.prepare(input);return this.request('stats',{ui:input.ui,globalViews:input.globalViews,key:input.datasetKey,cfg});},
    storage(kind,payload) {return this.request(kind,payload,{},'storage');}
};
return {BackgroundService};
});
