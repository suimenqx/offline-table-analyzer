/**
 * 区域提取评估样例族（合成样例，不含真实脱敏数据）。
 *
 * 每个 case：
 *   - text            原始输入
 *   - options         parse 选项（自动识别时省略）
 *   - expectAmbiguous 预期自动解析停在确认态（确认率统计用）
 *   - expectDiagnostic 预期正常结果伴随的诊断代码（可省略）
 *   - confirm(text,result) 确认后重解析的选项；有 expect 但自动解析歧义时必须提供
 *   - expect.tables[] 预期表格：headers、rows、range
 *
 * range 使用标记而非手写偏移，由 resolveFixtureRanges 换算成原文坐标：
 *   { startFrom: '表头行文本', endBefore: '\n后续说明行' }  → [表头行起点, 说明行前的换行)
 *   { startFrom: '表头行文本', endAtEnd: true }            → [表头行起点, 原文末尾)
 *   { start: 0, endAtEnd: true }                          → [0, 原文末尾)
 *   { startFrom: '表头行文本', endOffset: -1 }             → [表头行起点, 原文末尾 - 1)（末尾换行不计入）
 *
 * 按输入族补齐真实脱敏样例后，指标才有准确率意义；合成样例通过只验证
 * 既有设计行为没有回归，不构成真实准确率结论。
 */

const at = (text, needle) => {
  const index = text.indexOf(needle);
  if (index < 0) throw new Error(`fixture needle not found: ${JSON.stringify(needle)}`);
  return index;
};

export function resolveFixtureRanges(fixture) {
  for (const table of fixture.expect.tables) {
    const range = table.range;
    if (Number.isInteger(range.start) && Number.isInteger(range.end)) continue;
    range.start = range.startFrom ? at(fixture.text, range.startFrom) : (range.start ?? 0);
    range.end = range.endAtEnd ? fixture.text.length : range.endOffset !== undefined ? fixture.text.length + range.endOffset : at(fixture.text, range.endBefore);
    if (!(range.start >= 0 && range.end > range.start && range.end <= fixture.text.length)) {
      throw new Error(`${fixture.id}: resolved range [${range.start}, ${range.end}) out of bounds`);
    }
    delete range.startFrom; delete range.endBefore; delete range.endAtEnd; delete range.endOffset;
  }
}

export const FIXTURES = [
  // ── 混杂说明文字的 CSV 区域 ──────────────────────────────────────
  {
    family: 'csv-in-prose',
    id: 'csv-quoted-multiline',
    label: '说明文字中的 CSV，含引号内换行',
    text: [
      '库存报告 · 导出时间 10:30',
      '筛选条件：状态=正常',
      'id,name,note',
      '001,Alice,"含逗号,和换行',
      '第二行"',
      '002,Bob,ok',
      '共 2 条记录'
    ].join('\n'),
    expect: {
      format: 'csv',
      tables: [{
        headers: ['id', 'name', 'note'],
        rows: [['001', 'Alice', '含逗号,和换行\n第二行'], ['002', 'Bob', 'ok']],
        range: { startFrom: 'id,name,note', endBefore: '\n共 2 条记录' }
      }]
    }
  },
  {
    family: 'csv-in-prose',
    id: 'csv-two-regions',
    label: '两段 CSV 区域被说明文字隔开，分别返回',
    text: '导出一\nid,name\n001,Alice\n第一段结束\n导出二\ncode,status\nX1,ok\nX2,hold\n',
    expect: {
      format: 'csv',
      tables: [
        {
          headers: ['id', 'name'],
          rows: [['001', 'Alice']],
          range: { startFrom: 'id,name', endBefore: '\n第一段结束' }
        },
        {
          headers: ['code', 'status'],
          rows: [['X1', 'ok'], ['X2', 'hold']],
          range: { startFrom: 'code,status', endOffset: -1 }
        }
      ]
    }
  },
  {
    family: 'csv-in-prose',
    id: 'csv-long-prose-prefix',
    label: '长说明前缀后的 CSV（跨采样轮次）',
    text: Array.from({ length: 70 }, (_, i) => 'no delimiters in this padding line ' + i).join('\n')
      + '\nid,name\n'
      + Array.from({ length: 20 }, (_, i) => '0' + (i + 1) + ',Row' + (i + 1)).join('\n')
      + '\n共 20 条记录',
    expect: {
      format: 'csv',
      tables: [{
        headers: ['id', 'name'],
        rows: Array.from({ length: 20 }, (_, i) => ['0' + (i + 1), 'Row' + (i + 1)]),
        range: { startFrom: 'id,name', endBefore: '\n共 20 条记录' }
      }]
    }
  },
  // ── 保留数据并提示检查 ────────────────────────────────────────────
  {
    family: 'irregular-width',
    id: 'csv-irregular-widths',
    label: '行宽不一致时直接保留溢出值并显示诊断',
    text: '报告\nid,name\n1,Alice\nbad,too,many,fields\n2,Bob\n结束',
    expectDiagnostic: 'ROW_WIDTH_MISMATCH',
    expect: {
      format: 'csv',
      tables: [{
        headers: ['id', 'name'],
        rows: [['1', 'Alice'], ['bad', 'too', 'many', 'fields'], ['2', 'Bob']],
        range: { startFrom: 'id,name', endBefore: '\n结束' }
      }]
    }
  },
  {
    family: 'header-review',
    id: 'csv-ambiguous-header',
    label: '表头证据不足时先显示自动结果',
    text: 'alpha,beta\none,two\nthree,four',
    expectDiagnostic: 'HEADER_AMBIGUOUS',
    expect: {
      format: 'csv',
      tables: [{
        headers: ['Column1', 'Column2'],
        rows: [['alpha', 'beta'], ['one', 'two'], ['three', 'four']],
        range: { start: 0, endAtEnd: true }
      }]
    }
  },
  // ── 定宽 / 对齐区域（显式选择格式） ───────────────────────────────
  {
    family: 'fixed-width-explicit',
    id: 'fixed-width-in-prose',
    label: '说明文字中的定宽区域（显式 fixed-width）',
    text: '设备巡检报告\n设备范围：机房 A\nid    name    status\n001   Alice   ok\n002   Bob     hold\n共 2 台设备',
    options: { format: 'fixed-width' },
    expect: {
      format: 'fixed-width',
      tables: [{
        headers: ['id', 'name', 'status'],
        rows: [['001', 'Alice', 'ok'], ['002', 'Bob', 'hold']],
        range: { startFrom: 'id    name', endBefore: '\n共 2 台设备' }
      }]
    }
  },
  {
    family: 'aligned-explicit',
    id: 'aligned-in-prose',
    label: '说明文字中的对齐区域（显式 aligned-table）',
    text: '运行摘要\nID    Name     Status\n001   Alice    ok\n002   Bob      hold\n共 2 项',
    options: { format: 'aligned-table' },
    expect: {
      format: 'aligned-table',
      tables: [{
        headers: ['ID', 'Name', 'Status'],
        rows: [['001', 'Alice', 'ok'], ['002', 'Bob', 'hold']],
        range: { startFrom: 'ID    Name', endBefore: '\n共 2 项' }
      }]
    }
  },
  // ── 原文偏移保真 ──────────────────────────────────────────────────
  {
    family: 'source-offsets',
    id: 'bom-crlf-offsets',
    label: 'BOM + CRLF 原文的偏移回映',
    text: '\uFEFF报告\r\nid,name\r\n001,Alice\r\n002,Bob',
    expect: {
      format: 'csv',
      tables: [{
        headers: ['id', 'name'],
        rows: [['001', 'Alice'], ['002', 'Bob']],
        range: { startFrom: 'id,name', endAtEnd: true }
      }]
    }
  },
  // ── 其他分隔符区域 ────────────────────────────────────────────────
  {
    family: 'tsv-in-prose',
    id: 'tsv-in-prose',
    label: '说明文字中的 TSV 区域（自动识别）',
    text: '说明文字\nid\tname\n001\tAlice\n002\tBob\n结束',
    expect: {
      format: 'excel-paste',
      tables: [{
        headers: ['id', 'name'],
        rows: [['001', 'Alice'], ['002', 'Bob']],
        range: { startFrom: 'id\tname', endBefore: '\n结束' }
      }]
    }
  },
  {
    family: 'pipe-in-prose',
    id: 'pipe-in-prose',
    label: '说明文字中的 Markdown 表格区域',
    text: '表格说明\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n结束行',
    expect: {
      format: 'pipe-table',
      tables: [{
        headers: ['a', 'b'],
        rows: [['1', '2'], ['3', '4']],
        range: { startFrom: '| a | b |', endBefore: '\n结束行' }
      }]
    }
  },
  // ── 格式平局确认 ──────────────────────────────────────────────────
  {
    family: 'format-tie',
    id: 'csv-semicolon-tie',
    label: '逗号/分号证据接近，确认格式后解析',
    text: 'id,name;state\n1,Alice;ok',
    expectAmbiguous: true,
    confirm: () => ({ format: 'csv' }),
    expect: {
      format: 'csv',
      tables: [{
        headers: ['id', 'name;state'],
        rows: [['1', 'Alice;ok']],
        range: { start: 0, endAtEnd: true }
      }]
    }
  },
  {
    family: 'delimiter-evidence',
    id: 'decimal-comma-semicolon',
    label: '两种切法列数相同，分号保留多列小数',
    text: 'sku;price (EUR, incl. tax);tax (EUR, incl. fee)\n'
      + 'S-001;12,50;1,20\nS-002;9,90;0,99\nS-003;10,50;1,05',
    options: { headerMode: 'first-row' },
    expect: {
      format: 'semicolon-csv',
      tables: [{
        headers: ['sku', 'price (EUR, incl. tax)', 'tax (EUR, incl. fee)'],
        rows: [['S-001', '12,50', '1,20'], ['S-002', '9,90', '0,99'], ['S-003', '10,50', '1,05']],
        range: { start: 0, endAtEnd: true }
      }]
    }
  },
  {
    family: 'delimiter-evidence',
    id: 'decimal-comma-tsv-multiline',
    label: 'Tab 保留多列小数和引号内的换行',
    text: 'id\tprice (EUR, incl. tax)\ttax (EUR, incl. fee)\tnote\n'
      + '1\t12,50\t1,20\t"a\nb"\n2\t9,90\t0,99\t"c\nd"\n3\t10,50\t1,05\t"e\nf"',
    options: { headerMode: 'first-row' },
    expect: {
      format: 'excel-paste',
      tables: [{
        headers: ['id', 'price (EUR, incl. tax)', 'tax (EUR, incl. fee)', 'note'],
        rows: [['1', '12,50', '1,20', 'a\nb'], ['2', '9,90', '0,99', 'c\nd'], ['3', '10,50', '1,05', 'e\nf']],
        range: { start: 0, endAtEnd: true }
      }]
    }
  },
  {
    family: 'delimiter-evidence',
    id: 'fractional-timestamp',
    label: '分号保留带小数逗号的时间',
    text: 'device;time (local, ms);status (old, new)\n'
      + 'A;14:02:30,123;UP,OK\nB;16:45:11,200;UP,OK\nC;09:10:53,011;DOWN,ERR',
    options: { headerMode: 'first-row' },
    expect: {
      format: 'semicolon-csv',
      tables: [{
        headers: ['device', 'time (local, ms)', 'status (old, new)'],
        rows: [['A', '14:02:30,123', 'UP,OK'], ['B', '16:45:11,200', 'UP,OK'], ['C', '09:10:53,011', 'DOWN,ERR']],
        range: { start: 0, endAtEnd: true }
      }]
    }
  },
  {
    family: 'delimiter-control',
    id: 'comma-separated-integers',
    label: '整数之间的逗号仍用来分列',
    text: 'left,right\n12,50\n9,90\n10,50',
    options: { headerMode: 'first-row' },
    expect: {
      format: 'csv',
      tables: [{
        headers: ['left', 'right'],
        rows: [['12', '50'], ['9', '90'], ['10', '50']],
        range: { start: 0, endAtEnd: true }
      }]
    }
  },
  {
    family: 'delimiter-control',
    id: 'one-decimal-column-tie',
    label: '单列小数和整数拆分都成立，仍要求确认',
    text: 'count,rate;note\n12,50;3\n9,90;4\n10,50;5',
    options: { headerMode: 'first-row' },
    expectAmbiguous: true,
    confirm: () => ({ format: 'csv' }),
    expect: {
      format: 'csv',
      tables: [{
        headers: ['count', 'rate;note'],
        rows: [['12', '50;3'], ['9', '90;4'], ['10', '50;5']],
        range: { start: 0, endAtEnd: true }
      }]
    }
  }
];
