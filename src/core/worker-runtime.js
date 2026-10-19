OTA.define('worker-runtime', ['import-engine','query-service','joiner','exporter','workspace-storage','table-utils'], ({ImportEngine},{QueryService},{Joiner},{Exporter},{WorkspaceStorage},{TableUtils}) => {
/* Complete normalized tables stay in the Worker. Window receives descriptors
   and current-page records; full-query/export results never cross this boundary.

   多卡片工作区：会话持有 Map<cardId, 数据集>；表池由可见清单在 Worker 内派生
   （同名同结构拼接、异结构并列）；修正仅应用于单来源池内表。 */
const WorkerRuntime = {
    createSession() {
        let datasets=new Map(); // cardId -> { tables, previousEdits }
        let poolCache={ sig:null, pool:null, tables:null };
        let previousEditSignature = null;
        const sourceIds = list => (list || []).map(card => [card.id, card.name || card.id]);
        const sigOf = (visible, sources=visible) => JSON.stringify([sourceIds(visible), sourceIds(sources)]);
        const poolToTables = pool => pool.map(entry => ({ name:entry.displayName, headers:entry.columns.slice(), rows:entry.rows, isView:false }));
        const buildPool = (visible, sources=visible) => {
            const sig = sigOf(visible, sources);
            if(poolCache.sig === sig) return poolCache;
            const entries=[];
            const participating = new Set((visible || []).map(card => card.id));
            for(const source of sources || []) {
                const ds=datasets.get(source.id);
                if(!ds) continue;
                for(const table of ds.tables) entries.push({ cardId:source.id, cardName:source.name || source.id,
                    visible:participating.has(source.id), table });
            }
            const pool = QueryService.computePool(entries);
            poolCache = { sig, pool, tables:poolToTables(pool) };
            return poolCache;
        };
        const applyEdits = payload => {
            const editSignature = JSON.stringify((payload.visible || []).map(card =>
                [card.id, payload.cardUis?.[card.id]?.cellEdits || {}]));
            if(editSignature !== previousEditSignature) {
                QueryService.clearCache();
                previousEditSignature = editSignature;
            }
            for(const ds of datasets.values()) {
                for(const [row,col,value] of ds.previousEdits) row[col]=value;
                ds.previousEdits=[];
            }
            const { pool } = buildPool(payload.visible, payload.sources);
            for(const entry of pool) {
                if(entry.kind !== 'single') continue;
                const ui = payload.cardUis && payload.cardUis[entry.sourceCardId];
                const edits = (ui && ui.cellEdits && ui.cellEdits[`$${entry.displayName}`]) || {};
                const ds = datasets.get(entry.sourceCardId);
                if(!ds) continue;
                for(const [rowIndex,cols] of Object.entries(edits)) {
                    const row=entry.rows[Number(rowIndex)];if(!row)continue;
                    for(const [colIndex,value] of Object.entries(cols)) {
                        const col=Number(colIndex);if(!Number.isInteger(col)||col<0||col>=entry.columns.length)continue;
                        ds.previousEdits.push([row,col,row[col]]);row[col]=String(value ?? '');
                    }
                }
            }
        };
        const queryInput = payload => {
            const { tables } = buildPool(payload.visible, payload.sources);
            return { rawTables:tables, globalViews:payload.globalViews || [], ui:payload.ui || {}, docId:sigOf(payload.visible,payload.sources), sourceRevision:1 };
        };
        const query = payload => {
            applyEdits(payload);
            return QueryService.getPreview(queryInput(payload)).tables;
        };
        const preview = payload => {
            applyEdits(payload);
            return QueryService.getPagePreview(queryInput(payload)).tables;
        };
        return {
            parse(payload) {
                // payload: { cardId, text, options }
                const result=ImportEngine.parse(payload.text,payload.options || {});
                if(result.format==='error')throw new Error(result.diagnostics?.[0]?.message || result.label || '解析失败');
                const cells=result.tables.reduce((sum,table)=>sum+table.rows.length*table.headers.length,0);
                if(cells>QueryService.MAX_CELLS)throw new Error('解析结果超过 800 万单元格预算，请拆分数据；原文仍保留');
                let total=cells;
                for(const [cardId,ds] of datasets) {
                    if(cardId === payload.cardId) continue; // 重解析覆盖同一卡，不重复计
                    total += ds.tables.reduce((s,t)=>s+t.rows.length*t.headers.length,0);
                }
                if(total>QueryService.MAX_CELLS)throw new Error('会话内多卡片数据集合计超过 800 万单元格预算，请隐藏或删除部分卡片；原文仍保留');
                datasets.set(payload.cardId,{ tables:result.tables, previousEdits:[] });
                poolCache={ sig:null, pool:null, tables:null };
                QueryService.clearCache();
                return result;
            },
            removeCard(payload) {
                datasets.delete(payload.cardId);
                poolCache={ sig:null, pool:null, tables:null };
                QueryService.clearCache();
            },
            query,
            preview,
            stats(payload) {
                applyEdits(payload);
                const { tables } = buildPool(payload.visible, payload.sources);
                return Joiner.stats(tables,payload.cfg,payload.globalViews || []);
            },
            excel(payload) {
                applyEdits(payload);
                const ui=payload.ui || {};
                const { tables } = buildPool(payload.visible, payload.sources);
                let out;
                if(payload.mode==='preview')out=query(payload).map(({table,res})=>({name:table.name,headers:res.headers,rows:res.rows.map(row=>row.d)}));
                else {
                    out=tables;
                    if(payload.mode!=='raw') {
                        out=QueryService.collectTables(tables,payload.globalViews || [],ui,!!ui.exportOnlyChecked);
                        if(ui.exportCols==='shown')out=out.map(table=>TableUtils.projectColumns(table,ui.rules?.[table.name]?.focus));
                    }
                }
                return Exporter.createExcelBytes(out);
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
