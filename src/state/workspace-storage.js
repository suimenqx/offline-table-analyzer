OTA.define('workspace-storage', [], () => {
/* IndexedDB adapter. A transaction stores one immutable, complete snapshot;
   local settings refer to its generation only after durable commit. */
const WorkspaceStorage = {
    open() {
        return new Promise((resolve,reject) => {
            if(typeof indexedDB === 'undefined') return reject(new Error('此浏览器无法保存大原文，请导出备份'));
            const request=indexedDB.open('ota-workspaces',1);
            request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');
            request.onerror=()=>reject(request.error);
            request.onblocked=()=>reject(new Error('存储被其他页面占用，请关闭其他页面后重试'));
            request.onsuccess=()=>resolve(request.result);
        });
    },
    async write(key,payload) {
        const db=await this.open();
        try {
            // IndexedDB's structured clone preserves strings as UTF-16 code
            // units. Blob's UTF-8 conversion would replace lone surrogates.
            const snapshot={...payload,docs:payload.docs.map(doc=>({...doc,raw:doc.raw || ''}))};
            await new Promise((resolve,reject)=>{
                const tx=db.transaction('snapshots','readwrite');
                tx.objectStore('snapshots').put(snapshot,key);
                tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error || new Error('保存事务已取消'));tx.onerror=()=>{};
            });
        } finally { db.close(); }
    },
    async read(key) {
        const db=await this.open();
        let snapshot;
        try {
            snapshot=await new Promise((resolve,reject)=>{
                const request=db.transaction('snapshots').objectStore('snapshots').get(key);
                request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
            });
        } finally { db.close(); }
        if(!snapshot) throw new Error('保存的原文快照不存在，请恢复工作区备份');
        for(const doc of snapshot.docs) {
            // Released snapshots used UTF-8 Blobs. Decode without consuming
            // an original BOM; new string snapshots need no transcoding.
            if(doc.raw instanceof Blob)doc.raw=new TextDecoder('utf-8',{ignoreBOM:true}).decode(await doc.raw.arrayBuffer());
        }
        return snapshot;
    },
    async prune(prefix,keep) {
        const db=await this.open();
        try {
            await new Promise((resolve,reject)=>{
                const tx=db.transaction('snapshots','readwrite');
                const request=tx.objectStore('snapshots').openCursor();
                request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;if(String(cursor.key).startsWith(prefix) && cursor.key!==keep)cursor.delete();cursor.continue();};
                tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};
            });
        } finally { db.close(); }
    }
};
return {WorkspaceStorage};
});
