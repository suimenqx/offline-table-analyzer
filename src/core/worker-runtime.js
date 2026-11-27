OTA.define('worker-runtime', ['import-engine','query-service','joiner','exporter','workspace-storage','table-utils'], ({ImportEngine},{QueryService},{Joiner},{Exporter},{WorkspaceStorage},{TableUtils}) => {
/* Complete normalized tables stay in the Worker. Window receives descriptors
   and current-page records; full-query/export results never cross this boundary.

   多卡片工作区：会话持有 Map<cardId, 数据集>；表池由可见清单在 Worker 内派生
   （同名同结构拼接、异结构并列）；修正仅应用于单来源池内表。 */
const WorkerRuntime = {
    createSession() {
        const datasets=new Map();
        let poolCache=null;
        const sourceIds = list => (list || []).map(card => [card.id, card.name || card.id]);
        const sigOf = (visible, sources=visible) => JSON.stringify([sourceIds(visible), sourceIds(sources)]);
        const buildPool = (visible, sources=visible) => {
            const sig = sigOf(visible, sources);
            if(poolCache?.sig === sig) return poolCache;
            const entries=[];
            const participating = new Set((visible || []).map(card => card.id));
            for(const source of sources || []) {
                const ds=datasets.get(source.id);
                if(!ds) continue;
                for(const table of ds.tables) entries.push({ cardId:source.id, cardName:source.name || source.id,
                    visible:participating.has(source.id), table });
            }
            const base = QueryService.computePool(entries).map(entry => {
                const dataset = datasets.get(entry.sourceCardId);
                return {name:entry.displayName, headers:entry.columns, rows:entry.rows, isView:false,
                    editSource:entry.kind === 'concat' ? null : {docId:entry.sourceCardId, table:entry.sourceName,
                        sourceRevision:dataset.sourceRevision, ...dataset.config}};
            });
            poolCache = {sig, base, tables:base, edits:null};
            return poolCache;
        };
        const queryInput = payload => {
            const pool = buildPool(payload.visible, payload.sources);
            const overlays = pool.base.map(({editSource}) => editSource &&
                payload.cardUis?.[editSource.docId]?.cellEdits?.[`$${editSource.table}`]);
            const signature = JSON.stringify(overlays);
            if(pool.edits !== signature) {
                pool.tables = pool.base.map((table,i) => TableUtils.withCellEdits(table,overlays[i]));
                pool.edits = signature;
            }
            return {rawTables:pool.tables, globalViews:payload.globalViews || [], ui:payload.ui || {}, docId:pool.sig};
        };
        return {
            parse(payload) {
                // payload: { cardId, text, options }
                const result=payload.parsed || ImportEngine.parse(payload.text,payload.options || {});
                if(result.format==='error')throw new Error(result.diagnostics?.[0]?.message || result.label || '解析失败');
                const cells=result.tables.reduce((sum,table)=>sum+table.rows.length*table.headers.length,0);
                if(cells>QueryService.MAX_CELLS)throw new Error('解析结果超过 800 万单元格预算，请拆分数据；原文仍保留');
                let total=cells;
                for(const [cardId,ds] of datasets) {
                    if(cardId === payload.cardId) continue; // 重解析覆盖同一卡，不重复计
                    total += ds.tables.reduce((s,t)=>s+t.rows.length*t.headers.length,0);
                }
                if(total>QueryService.MAX_CELLS)throw new Error('会话内多卡片数据集合计超过 800 万单元格预算，请隐藏或删除部分卡片；原文仍保留');
                datasets.set(payload.cardId,{tables:result.tables, format:result.format,
                    sourceRevision:payload.sourceRevision, config:payload.config, version:payload.version});
                poolCache=null;
                QueryService.clearCache();
                return result;
            },
            removeCard(payload) {
                datasets.delete(payload.cardId);
                poolCache=null;
                QueryService.clearCache();
            },
            query(payload) { return QueryService.getPreview(queryInput(payload)).tables; },
            preview(payload) { return QueryService.getPagePreview(queryInput(payload)).tables; },
            checkViewBudget(payload) {
                return QueryService.checkViewBudget(queryInput(payload),payload.cfg);
            },
            stats(payload) {
                const {rawTables,globalViews} = queryInput(payload);
                return Joiner.stats(rawTables,payload.cfg,globalViews,[],{samples:payload.samples});
            },
            suggestKeys(payload) {
                const {rawTables,globalViews} = queryInput(payload);
                return Joiner.suggestKeys(rawTables,payload.cfg.left,payload.cfg.right,globalViews);
            },
            excel(payload) {
                const unresolved=[];
                for(const card of payload.visible || []) {
                    const dataset=datasets.get(card.id);
                    const name=card.name || card.id;
                    if(!dataset || (card.version !== undefined && dataset.version !== card.version)) {
                        throw new Error(`卡片“${name}”的解析版本已变化，请重试导出`);
                    }
                    if(dataset.format === 'ambiguous') unresolved.push(`“${name}”`);
                }
                if(unresolved.length) throw new Error(`请先确认卡片 ${unresolved.join('、')} 的解析格式，再导出 Excel`);
                return Exporter.createExcelBytes(QueryService.getExportTables(queryInput(payload), payload.mode));
            }
        };
    },
    start(port) {
        const session=this.createSession();
        let queue=Promise.resolve();const canceled=new Set(),pending=new Set();
        port.onmessage=event=>{
            const message=event.data;
            if(message.cancel) {if(pending.has(message.cancel))canceled.add(message.cancel);return;}
            pending.add(message.id);
            queue=queue.then(async()=>{
                const {id,kind,payload}=message;
                try {
                    if(canceled.has(id))throw new Error('操作已取消');
                    let value;
                    if(kind==='parse') {
                        const result=session.parse(payload);
                        port.postMessage({id,type:'start',value:{...result,diagnostics:result.diagnostics.slice(0,200),diagnosticCount:result.diagnostics.length,
                            tables:result.tables.map(table=>TableUtils.describeTable(table,{samples:true}))}});
                    } else if(kind==='query') {
                        value=session.preview(payload);
                    } else if(kind==='removeCard') {
                        session.removeCard(payload);
                        port.postMessage({id,value:true});return;
                    } else if(kind==='excel') {
                        const bytes=session.excel(payload);port.postMessage({id,value:new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})});return;
                    } else if(kind==='stats')value=session.stats(payload);
                    else if(kind==='suggestKeys')value=session.suggestKeys(payload);
                    else if(kind==='checkViewBudget')value=session.checkViewBudget(payload);
                    else if(kind==='saveWorkspace')await WorkspaceStorage.write(payload.key,payload.workspace);
                    else if(kind==='loadWorkspace')value=await WorkspaceStorage.read(payload.key);
                    else if(kind==='pruneWorkspace')await WorkspaceStorage.prune(payload.prefix,payload.keep);
                    else if(kind==='json') {const bytes=new TextEncoder().encode(JSON.stringify(payload,null,2));port.postMessage({id,value:bytes.buffer},[bytes.buffer]);return;}
                    else throw new Error('未知后台操作');
                    port.postMessage({id,value});
                } catch(error) {port.postMessage({id,error:error.message || String(error)});}
                finally {canceled.delete(id);pending.delete(id);}
            });
        };
        port.postMessage({ready:1});
    }
};
return {WorkerRuntime};
});
