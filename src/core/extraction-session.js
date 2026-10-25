OTA.define('extraction-session', ["store", "dispatch", "parser-facade", "import-engine", "background-service", "query-service", "table-registry"], ({Store, MAX_IMPORT_BYTES}, {dispatch}, {Parser}, {ImportEngine}, {BackgroundService}, {QueryService}, {TableRegistry}) => {
/* One active source extraction, shared by parse, diagnostics and export callers.
   Browser adaptation supplies the source snapshot and presentation callbacks.
   Worker transport and resident datasets remain owned by BackgroundService. */
const matches = (a,b) => !!a && !!b && a.docId===b.docId && a.sourceRevision===b.sourceRevision && a.text===b.text
    && ['format','headerMode','html'].every(key=>a.options[key]===b.options[key])
    && JSON.stringify(a.options.regionSelection || null)===JSON.stringify(b.options.regionSelection || null)
    && a.config.format===b.config.format && a.config.headerMode===b.config.headerMode;
const snapshot = context => context && {...context,
    options:{...context.options,regionSelection:context.options.regionSelection?JSON.parse(JSON.stringify(context.options.regionSelection)):null},
    config:{...context.config}};
const aborted = () => Object.assign(new Error('操作已取消'),{name:'AbortError'});

const ExtractionSession = {
    create({readContext, onStart=()=>{}, onResult=()=>{}}) {
        let current=null;
        let cancelledContext=null;
        const validate = job => {
            if(!matches(job.context,readContext())) throw Object.assign(new Error('数据源或解析设置已变化，请重试'),{name:'SourceChangedError'});
            if(current!==job) throw aborted();
        };
        const receipt = (job,ok=false,failed=false) => Object.freeze({ok,failed,validate:()=>validate(job)});
        const release = job => {
            const cleanup=job.cleanup;
            job.cleanup=null;
            cleanup?.();
        };
        const cancelCurrent = () => {
            const job=current;
            current=null;
            if(!job) return;
            release(job);
            job.cancel?.(receipt(job));
            job.cancel=null;
            job.promise=null;
        };
        const settle = (job,result,error) => {
            // A cancelled transport may still resolve. It cannot publish or clean up a newer job.
            if(current!==job || !matches(job.context,readContext()) || error?.name==='AbortError') {
                if(current===job) cancelCurrent();
                return receipt(job);
            }
            if(result?.format==='error') error=new Error(result.diagnostics?.find(item=>item.severity==='error')?.message || result.label || '解析失败');
            const {context,background}=job;
            const dataset={datasetKey:`${context.docId}:${context.sourceRevision}:${JSON.stringify(context.options)}`,
                parseOptions:context.options,sourceRevision:context.sourceRevision};
            const ok=!error;
            const published=error?{tables:[],format:'error',label:'解析失败',
                ...(background?{...dataset,background:Store.getDocument()?.visible===false}:{}),
                diagnostics:[{severity:'error',code:'PARSE_ERROR',message:error.message || String(error)}],candidates:[]}
                : background?{...result,...dataset,background:true}:result;
            job.receipt=receipt(job,ok,!ok);
            try {
                TableRegistry.setResult(published);
                TableRegistry.recordParse(context,published);
                const elapsed=Math.round(performance.now()-job.started);
                onResult({context,background,ok,error,render:job.render,elapsed});
                dispatch('parse:completed',{docId:context.docId,sourceRevision:context.sourceRevision,
                    format:published.format,tables:published.tables,elapsed});
                return job.receipt;
            } finally {
                release(job);
                job.cancel=null;
                job.promise=null;
            }
        };
        const session = {
            /** Window returns a receipt synchronously; Worker resolves one asynchronously.
             * reuse shares pending/successful work; diagnostics may also reuse a reported failure.
             * Every receipt validates both the source snapshot and this exact extraction lifetime. */
            run({reuse=false,retryFailed=true,render=true}={}) {
                const context=snapshot(readContext());
                if(!context) return null;
                if(reuse && current && matches(current.context,context)
                    && (current.promise || current.receipt?.ok || (!retryFailed && current.receipt?.failed))) {
                    current.render ||= render;
                    return current.promise || current.receipt;
                }
                session.invalidate();
                const background=(BackgroundService.isLarge(context.text) || (Store.getActiveProject()?.cardIds.length || 0)>1)
                    && !ImportEngine.requiresDOMParser(context.text,context.options);
                if(!background) BackgroundService.cancel();
                const job={context,background,render,started:performance.now()};
                current=job;
                job.cleanup=onStart({context,background});
                if(context.text.length*2>MAX_IMPORT_BYTES) return settle(job,null,new Error('数据源超过 128 MiB 安全限制，请拆分后再分析'));
                if(!background) {
                    let result;
                    try {result=Parser.parse(context.text,context.options);}
                    catch(error) {return settle(job,null,error);}
                    return settle(job,result);
                }
                TableRegistry.setResult(null);
                // Resolve our waiters on cancellation without depending on transport cooperation.
                const cancellation=new Promise(resolve=>{job.cancel=resolve;});
                let work;
                try {
                    work=BackgroundService.parse({text:context.text,options:context.options,
                        key:context.docId,sourceRevision:context.sourceRevision,config:context.config});
                } catch(error) {work=Promise.reject(error);}
                job.promise=Promise.race([cancellation,Promise.resolve(work)
                    .then(result=>settle(job,result),error=>settle(job,null,error))]);
                return job.promise;
            },
            /** Source events can arrive after a new parse; only invalidate a mismatching snapshot. */
            invalidate({ifChanged=false}={}) {
                const knownContext=current?.context || cancelledContext;
                if(ifChanged && (!knownContext || matches(knownContext,readContext()))) return false;
                cancelCurrent();
                cancelledContext=null;
                BackgroundService.cancelQueries();
                BackgroundService.cancelParses();
                QueryService.clearCache();
                return true;
            },
            /** User cancellation also terminates serialization; durable storage is independent. */
            cancel() {
                const context=current?.context || cancelledContext;
                session.invalidate();
                // Keep only source identity so a later edit can invalidate the retained preview.
                cancelledContext=context;
                BackgroundService.cancel();
            },
        };
        return session;
    },
};
return {ExtractionSession};
});
