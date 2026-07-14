/* Exporter */
const Exporter = {
    escapeXml(str="") {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },
    getTimestamp() {
        const now = new Date(); const pad = n => String(n).padStart(2,'0');
        return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    },
    sanitizeFilePrefix(prefix='export') {
        const safe = String(prefix || 'export')
            .replace(/[\\/:*?"<>|]+/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 80);
        return safe || 'export';
    },
    download(filename, content, type='text/plain') {
        const blob = content instanceof Blob ? content : new Blob([content], {type});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    },
    sanitizeSheetName(name, used) {
        const maxLen = 31;
        let safe = (name || 'Sheet').replace(/[\\\/:?*\[\]]/g, '_').trim();
        if(!safe) safe = 'Sheet';
        safe = safe.substring(0, maxLen);
        let final = safe, i = 1;
        while(used.has(final)) {
            const suffix = `_${++i}`;
            final = safe.substring(0, maxLen - suffix.length) + suffix;
        }
        used.add(final);
        return final;
    },
    normalizeTables(tables) {
        const used = new Set();
        return (tables || []).map((t, idx) => {
            const name = this.sanitizeSheetName(t.name || `Sheet${idx+1}`, used);
            const headers = Array.isArray(t.headers) ? t.headers : [];
            const rows = (t.rows || []).map(r => Array.isArray(r) ? r : (r.data || r.d || []));
            return { name, headers, rows };
        });
    },
    buildSheetXml({headers=[], rows=[]}) {
        const cell = (v) => {
            if(v === null || v === undefined) v = '';
            const trimmed = String(v).trim();
            const numericLike = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed);
            const hasLeadingZeros = /^-?0\d+/.test(trimmed) && !/^-?0\./.test(trimmed);
            const significantDigits = trimmed
                .replace(/^[+-]/, '')
                .split(/[eE]/)[0]
                .replace('.', '')
                .replace(/^0+/, '').length;
            const safeNumericText = numericLike && !hasLeadingZeros && significantDigits <= 15 && Number.isFinite(Number(trimmed));
            const isNum = (typeof v === 'number' && Number.isFinite(v)) || safeNumericText;
            if(isNum) return `<c t="n"><v>${trimmed}</v></c>`;
            const text = this.escapeXml(String(v));
            return `<c t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
        };
        const rowsXml = [];
        let rowNo = 1;
        if(headers.length) rowsXml.push(`<row r="${rowNo++}">${headers.map(cell).join('')}</row>`);
        rows.forEach((r) => rowsXml.push(`<row r="${rowNo++}">${(r || []).map(cell).join('')}</row>`));
        return `<?xml version="1.0" encoding="UTF-8"?>` +
            `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
            `<sheetData>${rowsXml.join('')}</sheetData>` +
            `</worksheet>`;
    },
    buildWorkbookXml(sheets) {
        const sheetXml = sheets.map((s, i) => `<sheet name="${this.escapeXml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('');
        return `<?xml version="1.0" encoding="UTF-8"?>` +
            `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
            `<sheets>${sheetXml}</sheets></workbook>`;
    },
    buildWorkbookRels(count) {
        const rels = Array.from({length: count}, (_, i) => `<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('');
        return `<?xml version="1.0" encoding="UTF-8"?>` +
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
    },
    buildContentTypes(count) {
        const sheets = Array.from({length: count}, (_, i) => `<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
        return `<?xml version="1.0" encoding="UTF-8"?>` +
            `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
            `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
            `<Default Extension="xml" ContentType="application/xml"/>` +
            `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
            `${sheets}</Types>`;
    },
    buildRootRels() {
        return `<?xml version="1.0" encoding="UTF-8"?>` +
            `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
            `</Relationships>`;
    },
    makeZip(files) {
        const encoder = new TextEncoder();
        const toBytes = v => v instanceof Uint8Array ? v : encoder.encode(v);
        const crcTable = (() => {
            const t = new Uint32Array(256);
            for(let n=0; n<256; n++) {
                let c = n;
                for(let k=0; k<8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
                t[n] = c >>> 0;
            }
            return t;
        })();
        const crc32 = bytes => {
            let c = 0xffffffff;
            for(let i=0; i<bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
            return (c ^ 0xffffffff) >>> 0;
        };
        const dosDateTime = () => {
            const d = new Date();
            const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
            const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
            return { time, date };
        };
        const { time, date } = dosDateTime();
        const fileParts = [], centralParts = [];
        let offset = 0;
        files.forEach(f => {
            const nameBytes = encoder.encode(f.name);
            const data = toBytes(f.data);
            const crc = crc32(data);
            const size = data.length;
            const local = new Uint8Array(30 + nameBytes.length);
            const lv = new DataView(local.buffer);
            lv.setUint32(0, 0x04034b50, true);
            lv.setUint16(4, 20, true); // version needed
            lv.setUint16(6, 0x0800, true); // UTF-8
            lv.setUint16(8, 0, true); // store
            lv.setUint16(10, time, true);
            lv.setUint16(12, date, true);
            lv.setUint32(14, crc, true);
            lv.setUint32(18, size, true);
            lv.setUint32(22, size, true);
            lv.setUint16(26, nameBytes.length, true);
            lv.setUint16(28, 0, true);
            local.set(nameBytes, 30);
            fileParts.push(local, data);

            const central = new Uint8Array(46 + nameBytes.length);
            const cv = new DataView(central.buffer);
            cv.setUint32(0, 0x02014b50, true);
            cv.setUint16(4, 20, true); // version made
            cv.setUint16(6, 20, true); // version needed
            cv.setUint16(8, 0x0800, true);
            cv.setUint16(10, 0, true);
            cv.setUint16(12, time, true);
            cv.setUint16(14, date, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, size, true);
            cv.setUint32(24, size, true);
            cv.setUint16(28, nameBytes.length, true);
            cv.setUint16(30, 0, true); // extra
            cv.setUint16(32, 0, true); // comment
            cv.setUint16(34, 0, true); // disk start
            cv.setUint16(36, 0, true); // internal attr
            cv.setUint32(38, 0, true); // external attr
            cv.setUint32(42, offset, true); // offset of local header
            central.set(nameBytes, 46);
            centralParts.push(central);
            offset += local.length + size;
        });
        const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
        const end = new Uint8Array(22);
        const ev = new DataView(end.buffer);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(4, 0, true); // disk number
        ev.setUint16(6, 0, true); // start disk
        ev.setUint16(8, files.length, true);
        ev.setUint16(10, files.length, true);
        ev.setUint32(12, centralSize, true);
        ev.setUint32(16, offset, true);
        ev.setUint16(20, 0, true); // comment length

        const totalLen = fileParts.reduce((s, p) => s + p.length, 0) + centralSize + end.length;
        const out = new Uint8Array(totalLen);
        let pos = 0;
        [...fileParts, ...centralParts, end].forEach(part => { out.set(part, pos); pos += part.length; });
        return out;
    },
    toExcel(tables, prefix='export') {
        if(!tables || !tables.length) return Toast.show('\u65e0\u6570\u636e\u53ef\u5bfc\u51fa', true);
        try {
            prefix = this.sanitizeFilePrefix(prefix);
            const sheets = this.normalizeTables(tables);
            const files = [
                { name: '[Content_Types].xml', data: this.buildContentTypes(sheets.length) },
                { name: '_rels/.rels', data: this.buildRootRels() },
                { name: 'xl/workbook.xml', data: this.buildWorkbookXml(sheets) },
                { name: 'xl/_rels/workbook.xml.rels', data: this.buildWorkbookRels(sheets.length) }
            ];
            sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i+1}.xml`, data: this.buildSheetXml(s) }));
            const zip = this.makeZip(files);
            const blob = new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            this.download(`${prefix}_${this.getTimestamp()}.xlsx`, blob, blob.type);
        } catch(e) {
            console.error(e);
            Toast.show('Excel \u5bfc\u51fa\u5931\u8d25', true);
        }
    },
    toJson(data, prefix='backup') { this.download(`${this.sanitizeFilePrefix(prefix)}_${this.getTimestamp()}.json`, JSON.stringify(data, null, 2), 'application/json'); }
};
