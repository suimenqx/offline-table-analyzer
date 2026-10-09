// Deterministic synthetic inputs: no user data or committed large fixture files.
export function createLargeTableData({ rows = 100_000, columns = 32, variant = 'short' } = {}) {
  if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(columns) || columns < 3) {
    throw new Error('Expected positive rows and at least three columns');
  }
  if (!['short', 'unicode-crlf', 'long'].includes(variant)) throw new Error('Unknown fixture variant');
  const headers = ['validflag', 'ID', 'Bucket', ...Array.from({ length: columns - 3 }, (_, i) => `F${i + 3}`)];
  const lines = ['table-data Wide', headers.join(' ')];
  for (let row = 1; row <= rows; row++) {
    const cells = ['1', String(row), `B${row % 10}`];
    for (let column = 3; column < columns; column++) {
      cells.push(variant === 'unicode-crlf'
        ? `值${(row + column) % 10}`
        : variant === 'long'
          ? String((row + column) % 1000).padStart(12, 'x')
          : String((row + column) % 1000));
    }
    lines.push(cells.join(' '));
  }
  lines.push('', 'table-data Lookup', 'validflag Bucket Label');
  for (let bucket = 0; bucket < 10; bucket++) {
    lines.push(`1 B${bucket} Label${bucket}_a`, `1 B${bucket} Label${bucket}_b`);
  }
  return {
    text: lines.join(variant === 'unicode-crlf' ? '\r\n' : '\n'),
    rows,
    columns,
    variant,
    headers,
    lookupRows: 20,
    expectedJoinRows: rows * 2,
  };
}

export function createLargeCsv({rows=100000,columns=32,multiline=false}={}) {
  const headers=['ID','Name',...Array.from({length:columns-2},(_,i)=>`F${i+2}`)];
  const lines=[headers.join(',')];
  const note=multiline?'first line\nsecond;part|tag,"quoted"':'alpha;beta|gamma';
  const encode=value=>/[",\r\n]/.test(value)?'"'+value.replaceAll('"','""')+'"':value;
  for(let row=1;row<=rows;row++) {
    const cells=[String(row).padStart(6,'0'),`Item${row}`,...Array.from({length:columns-2},(_,i)=>i===columns-3?note:String(i+2))];
    lines.push(cells.map(encode).join(','));
  }
  return {text:lines.join('\r\n'),rows,columns,headers,note};
}
