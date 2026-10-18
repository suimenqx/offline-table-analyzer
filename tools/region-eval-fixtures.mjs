/**
 * 区域提取评估样例族（合成样例，不含真实脱敏数据）。
 *
 * 每个 case：
 *   - text            原始输入
 *   - options         parse 选项（自动识别时省略）
 *   - expectAmbiguous 预期自动解析停在确认态（确认率统计用）
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
  // ── 确认态：不规则行宽 ────────────────────────────────────────────
  {
    family: 'irregular-confirmation',
    id: 'csv-irregular-widths',
    label: '行宽不一致先确认，确认后保留溢出值',
    text: '报告\nid,name\n1,Alice\nbad,too,many,fields\n2,Bob\n结束',
    expectAmbiguous: true,
    confirm: (text, result) => ({ regionSelection: result.candidates.find(c => c.kind === 'region-set')?.regionSelection }),
    expect: {
      format: 'csv',
      tables: [{
        headers: ['id', 'name'],
        rows: [['1', 'Alice'], ['bad', 'too', 'many', 'fields'], ['2', 'Bob']],
        range: { startFrom: 'id,name', endBefore: '\n结束' }
      }]
    }
  },
  // ── 确认态：表头歧义 ──────────────────────────────────────────────
  {
    family: 'header-confirmation',
    id: 'csv-ambiguous-header',
    label: '表头证据不足先确认，选首行作为表头',
    text: 'alpha,beta\none,two\nthree,four',
    expectAmbiguous: true,
    confirm: () => ({ headerMode: 'first-row' }),
    expect: {
      format: 'csv',
      tables: [{
        headers: ['alpha', 'beta'],
        rows: [['one', 'two'], ['three', 'four']],
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
  }
];
