OTA.define('delimited', ["table-utils"], ({TableUtils}) => {
const MIN_SUPPORTING_RECORDS = 3;
const MIN_SUPPORT_RATIO = 0.75;
const DECIMAL_COMMA = /^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/;
const FRACTIONAL_TIME = /^(?:\d{4}-\d{2}-\d{2}[T ])?(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d,\d{1,9}(?:Z|[+-]\d{2}:?\d{2})?$/;

const Delimited = {
    *records(text='',delimiter=',',diagnostics=[]) {
        let row=[],cell='',inQuotes=false,cells=0,firstWidth=0;
        const finishRow=()=>{
            row.push(cell);cell='';
            const completed=row;row=[];
            if(TableUtils.isEmptyRow(completed))return null;
            if(!firstWidth)firstWidth=completed.length;
            cells+=completed.length;
            if(cells>TableUtils.MAX_CELLS+firstWidth)throw new Error('解析结果超过 800 万单元格预算，请拆分数据；原文仍保留');
            return completed;
        };
        for(let i=text.charCodeAt(0)===0xFEFF?1:0;i<text.length;i++) {
            let ch=text[i];
            if(ch==='\r'){if(text[i+1]==='\n')i++;ch='\n';}
            if(inQuotes) {
                if(ch==='"' && text[i+1]==='"'){cell+='"';i++;}
                else if(ch==='"')inQuotes=false;
                else cell+=ch;
            } else if(ch==='"')inQuotes=true;
            else if(ch===delimiter){row.push(cell);cell='';}
            else if(ch==='\n'){const completed=finishRow();if(completed)yield completed;}
            else cell+=ch;
        }
        if(inQuotes)diagnostics.push({severity:'warning',code:'UNCLOSED_QUOTE',message:'检测到未闭合的引号字段；已按当前内容继续解析'});
        const completed=finishRow();if(completed)yield completed;
    },
    parse(text='',delimiter=',') {
        const diagnostics=[];
        return {rows:Array.from(this.records(text,delimiter,diagnostics)),diagnostics};
    },
    // Compare raw records from the same bounded region, before header inference.
    // A lone decimal-like column can also be two legitimate integer columns.
    preservesCommaValues(text, delimiter) {
        if(delimiter === ',') return false;
        const intact = this.parse(text, delimiter);
        const split = this.parse(text, ',');
        const rowCount = intact.rows.length;
        if(intact.diagnostics.length || split.diagnostics.length ||
            rowCount < MIN_SUPPORTING_RECORDS || rowCount !== split.rows.length) return false;

        const decimals = Array(intact.rows[0].length).fill(0);
        const times = Array(intact.rows[0].length).fill(0);
        for(let index = 0; index < rowCount; index++) {
            const retained = new Set(split.rows[index].map(value => value.trim()));
            intact.rows[index].forEach((value, column) => {
                if(!value.includes(',')) return;
                const trimmed = value.trim();
                if(retained.has(trimmed)) return;
                if(FRACTIONAL_TIME.test(trimmed)) times[column]++;
                else if(DECIMAL_COMMA.test(trimmed)) decimals[column]++;
            });
        }
        const required = Math.max(MIN_SUPPORTING_RECORDS, Math.ceil(rowCount * MIN_SUPPORT_RATIO));
        return times.some(count => count >= required) || decimals.filter(count => count >= required).length >= 2;
    }
};

    return { Delimited };
});
