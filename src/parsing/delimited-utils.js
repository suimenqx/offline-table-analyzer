OTA.define('delimited', ["table-utils"], ({TableUtils}) => {
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
    }
};

    return { Delimited };
});
