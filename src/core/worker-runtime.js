OTA.define('worker-runtime', ['import-engine','query-service','joiner','exporter','workspace-storage','table-utils'], ({ImportEngine},{QueryService},{Joiner},{Exporter},{WorkspaceStorage},{TableUtils}) => {
/* Complete normalized tables stay in the Worker. Window receives descriptors
   and current-page records; full-query/export results never cross this boundary. */
const WorkerRuntime = {
    createSession() {
        let rawTables=[],key=null,previousEdits=[];
        const applyEdits=ui=>{
            for(const [row,col,value] of previousEdits)row[col]=value;
            previousEdits=[];
            for(const table of rawTables) {
                const edits=ui.cellEdits?.[`$${table.name}`] || {};
                for(const [rowIndex,cols] of Object.entries(edits)) {
                    const row=table.rows[Number(rowIndex)];if(!row)continue;
                    for(const [colIndex,value] of Object.entries(cols)) {
                        const col=Number(colIndex);if(!Number.isInteger(col)||col<0||col>=table.headers.length)continue;
                        previousEdits.push([row,col,row[col]]);row[col]=String(value ?? '');
                    }
                }
            }
        };
        const assertCurrent=payload=>{if(payload.key && payload.key!==key)throw new Error('数据源已变化，请重新解析');};
        const query=payload=>{
            assertCurrent(payload);
            applyEdits(payload.ui || {});
            return QueryService.getPreview({rawTables,globalViews:payload.globalViews || [],ui:payload.ui || {},docId:key,sourceRevision:1}).tables;
        };
        return {
            parse(payload) {
                const result=ImportEngine.parse(payload.text,payload.options || {});
                if(result.format==='error')throw new Error(result.diagnostics?.[0]?.message || result.label || '解析失败');
                const cells=result.tables.reduce((sum,table)=>sum+table.rows.length*table.headers.length,0);
                if(cells>8000000)throw new Error('解析结果超过 800 万单元格预算，请拆分数据；原文仍保留');
                rawTables=result.tables;key=payload.key;previousEdits=[];QueryService.clearCache();return result;
            },
            query,
            preview(payload) {
                assertCurrent(payload);applyEdits(payload.ui || {});
                return QueryService.getPagePreview({rawTables,globalViews:payload.globalViews || [],ui:payload.ui || {},docId:key,sourceRevision:1}).tables;
            },
            stats(payload) {assertCurrent(payload);applyEdits(payload.ui || {});return Joiner.stats(rawTables,payload.cfg,payload.globalViews || []);},
            excel(payload) {
                assertCurrent(payload);
                const ui=payload.ui || {};applyEdits(ui);
                let tables;
                if(payload.mode==='preview')tables=query(payload).map(({table,res})=>({name:table.name,headers:res.headers,rows:res.rows.map(row=>row.d)}));
                else {
                    tables=rawTables;
                    if(payload.mode!=='raw') {
                        tables=QueryService.collectTables(rawTables,payload.globalViews || [],ui,!!ui.exportOnlyChecked);
                        if(ui.exportCols==='shown')tables=tables.map(table=>TableUtils.projectColumns(table,ui.rules?.[table.name]?.focus));
                    }
                }
                return Exporter.createExcelBytes(tables);
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
