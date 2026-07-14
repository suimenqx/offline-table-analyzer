OTA.define('parser-facade', ["import-engine","runtime"], ({ImportEngine}, {Toast}) => {
/* Parser */
const Parser = {
    lastResult: { tables:[], format:'empty', label:'空输入' },
    parse(txt, options={}) {
        try {
            const result = ImportEngine.parse({ text: txt || '', html: options.html || '' }, options);
            this.lastResult = result;
            return result.tables;
        } catch(e) {
            console.error(e);
            Toast.show('解析出错: ' + e.message, true);
            this.lastResult = { tables:[], format:'error', label:'解析错误', diagnostics:[{ level:'error', code:'PARSE_ERROR', message:e.message || String(e) }], candidates:[] };
            return [];
        }
    }
};

    return { Parser };
});
