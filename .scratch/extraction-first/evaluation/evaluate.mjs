/**
 * Design evaluation, not a production test or benchmark.
 * Run: node .scratch/extraction-first/evaluation/evaluate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadModules } from '../../../tests/helpers/load-modules.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(fs.readFileSync(path.join(directory, 'corpus.json'), 'utf8'));
const html = fs.readFileSync(path.join(directory, 'prototype.html'), 'utf8');
const core = html.match(/<script id="draft-core">([\s\S]*?)<\/script>/)?.[1];
if (!core) throw new Error('Prototype core script is missing');
const context = vm.createContext({});
vm.runInContext(core, context, { filename: 'prototype.html#draft-core' });
const prototype = vm.runInContext('DraftPrototype', context);
const { OTA } = loadModules(['import-engine']);
const { ImportEngine } = OTA.require('import-engine');

const compact = tables => tables.map(t => ({
  headers: Array.from(t.headers || [], String),
  rows: Array.from(t.rows || [], row => Array.from(row, String))
}));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function score(actual, gold) {
  let headerCorrect = 0, headerGold = 0, cellCorrect = 0, cellGold = 0, actualCells = 0;
  gold.forEach((expected, ti) => {
    const observed = actual[ti] || { headers: [], rows: [] };
    expected.headers.forEach((value, ci) => {
      headerGold++;
      if (observed.headers[ci] === value) headerCorrect++;
    });
    expected.rows.forEach((row, ri) => row.forEach((value, ci) => {
      cellGold++;
      if (observed.rows[ri]?.[ci] === value) cellCorrect++;
    }));
  });
  actual.forEach(t => t.rows.forEach(row => { actualCells += row.length; }));
  return {
    exact: same(actual, gold),
    tables: actual.length,
    headerCorrect, headerGold, cellCorrect, cellGold, actualCells
  };
}
function sourceSupport(source, tables) {
  let valid = 0, total = 0;
  for (const table of tables) for (let ri = 0; ri < table.rows.length; ri++) {
    for (let ci = 0; ci < table.rows[ri].length; ci++) {
      const span = table.cells[ri]?.[ci];
      total++;
      if (!span || span.start < 0 || span.end > source.length || span.end < span.start) continue;
      let literal = source.slice(span.start, span.end);
      if (literal.startsWith('"') && literal.endsWith('"')) literal = literal.slice(1, -1).replace(/""/g, '"');
      literal = literal.replace(/\\\|/g, '|');
      if (literal === table.rows[ri][ci]) valid++;
    }
  }
  return { valid, total };
}
const results = corpus.map(item => {
  let baseline, baselineError = null;
  try { baseline = ImportEngine.parse(item.source); }
  catch (error) { baselineError = String(error); baseline = { tables: [], format: 'error', diagnostics: [] }; }
  const draft = prototype.extract(item.source);
  const oldTables = compact(baseline.tables);
  const newTables = compact(draft.tables);
  const residualText = draft.residuals.map(r => r.text).join('\n');
  return {
    id: item.id,
    origin: item.origin,
    scope: item.scope,
    expected: item.gold,
    retain: item.retain || [],
    baseline: {
      format: baseline.format,
      tables: oldTables,
      score: score(oldTables, item.gold),
      diagnostics: (baseline.diagnostics || []).map(d => d.code || d.message || '').filter(Boolean),
      error: baselineError
    },
    prototype: {
      tables: newTables,
      score: score(newTables, item.gold),
      provenance: sourceSupport(item.source, draft.tables),
      residuals: draft.residuals,
      retainedContext: (item.retain || []).map(text => ({ text, visible: residualText.includes(text) })),
      relationshipCandidates: draft.relationships
    }
  };
});
fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');

const ratio = (a, b) => b ? a + '/' + b : '—';
const mark = value => value ? '✓' : '✗';
const rows = results.map(r =>
  '| ' + r.id + ' | ' + r.scope + ' | ' + r.expected.length +
  ' | ' + mark(r.baseline.score.exact) + ' | ' + mark(r.prototype.score.exact) +
  ' | ' + ratio(r.baseline.score.headerCorrect, r.baseline.score.headerGold) +
  ' | ' + ratio(r.prototype.score.headerCorrect, r.prototype.score.headerGold) +
  ' | ' + ratio(r.baseline.score.cellCorrect, r.baseline.score.cellGold) +
  ' | ' + ratio(r.prototype.score.cellCorrect, r.prototype.score.cellGold) +
  ' | ' + ratio(r.prototype.provenance.valid, r.prototype.provenance.total) + ' |'
);
const groupLines = ['core', 'exploratory', 'unresolved', 'holdout'].map(scope => {
  const group = results.filter(r => r.scope === scope);
  const count = key => group.filter(r => r[key].score.exact).length;
  return '- **' + scope + '**：' + group.length + ' 例；当前实现整表完全吻合 ' + count('baseline') + '，原型 ' + count('prototype') + '。';
});
const failures = results.filter(r => !r.baseline.score.exact || !r.prototype.score.exact).map(r =>
  '- **' + r.id + '**：当前实现 ' + r.baseline.format + '，' + r.baseline.score.tables + ' 表；原型 ' + r.prototype.score.tables +
  ' 表。详见 [逐例输出](results.json)。'
);
const retained = results.filter(r => r.retain.length).map(r =>
  '- **' + r.id + '**：' + r.prototype.retainedContext.filter(x => x.visible).length + '/' + r.retain.length + ' 段指定上下文仍列在“未解释原文”。'
);
const report = [
  '# 提取方向初步对照评估',
  '',
  '运行：node .scratch/extraction-first/evaluation/evaluate.mjs。输入与期望结果见 [corpus.json](corpus.json)，原型见 [prototype.html](prototype.html)，原始输出见 [results.json](results.json)。',
  '',
  '这是设计探针，不是用户准确率或性能基准。core 来自项目测试的改编，并用于开发原型；exploratory 是开发时使用的人工构造混合内容或反例；unresolved 是尚未决定是否属于目标范围的日志/键值。holdout 是原型逻辑冻结后选取的项目测试改编样本，仍是人工选择，不能代表随机真实输入。所有期望结果都需要用户审阅。',
  '',
  '## 零交互结果',
  '',
  '| 样本 | 范围 | 期望表数 | 当前整表吻合 | 原型整表吻合 | 当前正确字段名 | 原型正确字段名 | 当前正确数据格 | 原型正确数据格 | 原型值有原文依据 |',
  '| --- | --- | ---: | :---: | :---: | ---: | ---: | ---: | ---: | ---: |',
  ...rows,
  '',
  ...groupLines,
  '',
  '“整表吻合”要求表数、表顺序、字段名和全部记录值均与人工期望一致。“正确字段名/数据格”按相同表/行/列位置计算；它们不是标准信息提取的 precision/recall，超出的表或格没有在这两列扣分，需结合整表吻合和逐例输出审阅。“原文依据”仅检查原型声称的 UTF-16 字符范围可还原其输出值；它不证明字段边界或用户意图正确。当前实现保留整段 raw，但没有逐值范围和显式未解释片段，因此这两项没有给它填零分。',
  '',
  '## 上下文和失败审阅',
  '',
  ...retained,
  '',
  ...failures,
  '',
  '## 目前能得出的结论',
  '',
  '- 开发样本不能用于证明原型泛化能力；独立选取的 holdout 仅揭示更多失败方式。人工构造的混合样本不能推导线上发生率。',
  '- 原型验证了“值 → 原文范围”“剩余原文可见”“表头、表范围和单元格可手动纠正”可以由一个简单的结果契约表达。多行引号 CSV、HTML 和复杂 CLI holdout 的失败说明简易通用行归纳器不足以替换现有解析能力；原型也没有经过浏览器用户试用，不能作为重构方案直接投入生产。',
  '- 尚未收集匿名化真实粘贴样本、人工复核的标准答案、用户完成时间、误关联代价，也没有跨设备性能数据。因此目前不能作出重构的 go/no-go 决定。',
  '- 当前建议：保留已知格式能力作为比较基线，继续验证来源可追溯的结果契约和混合输入上的净收益。不要依据本轮开发样本开始生产重构，也不要把这个简易归纳器当作未来算法定案。',
  '- 浏览器交互尚未实测：本机是 Android/Termux，Playwright 在此平台报 Unsupported platform: android。纯逻辑在 Node 中执行，两个内联脚本通过语法检查；交互和无障碍操作仍需在受支持的浏览器由人完成。',
  '',
  '## 下一轮必需证据',
  '',
  '1. 收集覆盖常见与困难场景的匿名化真实输入，并让目标用户标出想要的表、字段、记录、上下文和关系；分开记录“本次输入正确”与“规则未来可复用”。',
  '2. 同一任务让用户分别使用当前产品与原型，记录错提/漏提、未发现错误、修正次数、完成时间和放弃率；预先确定可接受门槛。',
  '3. 若原型有可观优势，再估算来源映射、候选搜索、无障碍纠错、工作区兼容和单文件离线交付的正式工程成本。',
  ''
].join('\n');
fs.writeFileSync(path.join(directory, 'report.md'), report);
process.stdout.write(report);
