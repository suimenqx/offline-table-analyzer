#!/usr/bin/env node
/**
 * 区域提取评估：跑样例族，报告区域召回、边界准确率、单元格精确率、
 * 静默错拆、确认率和运行预算。
 *
 * 指标定义（与 docs/planning/detection-optimization.md 对齐）：
 *   - 区域召回      期望区域中被匹配到的比例（按原文偏移贪心配对）
 *   - 边界准确率    配对区域的 |Δstart|+|Δend| 平均字符差；另有精确率
 *   - 单元格精确率  配对表格中与期望一致（含表头）的单元格 / 期望单元格
 *   - 静默错拆      未进入确认态却返回多于期望的表（错拆）或少于期望（漏并）
 *   - 确认率        expectAmbiguous 的样例占比
 *   - 运行预算      每个 case 一次 parse 的耗时（p50/p95/max）
 *
 * 当前样例全部为合成数据：通过只说明既有设计行为未回归，不构成真实
 * 准确率结论。真实脱敏样例按输入族补进 tools/region-eval-fixtures.mjs。
 */

import { performance } from 'node:perf_hooks';
// 复用测试的源模块加载器，保证评估与测试/发布用同一模块顺序和宿主环境。
import { loadModules } from '../tests/helpers/load-modules.mjs';
import { FIXTURES, resolveFixtureRanges } from './region-eval-fixtures.mjs';

const { OTA } = loadModules(['import-engine']);
const { ImportEngine } = OTA.require('import-engine');

function pairTables(found, expected) {
  const used = new Set();
  const pairs = [];
  for (const exp of expected) {
    let best = -1, bestScore = Infinity;
    found.forEach((table, index) => {
      if (used.has(index)) return;
      const range = table.meta && table.meta.sourceRange;
      if (!Number.isInteger(range?.start) || !Number.isInteger(range?.end)) return;
      const score = Math.abs(range.start - exp.range.start) + Math.abs(range.end - exp.range.end);
      if (score < bestScore) { bestScore = score; best = index; }
    });
    if (best >= 0) {
      used.add(best);
      const range = found[best].meta.sourceRange;
      pairs.push({ found: found[best], exp, boundaryError: (Math.abs(range.start - exp.range.start) + Math.abs(range.end - exp.range.end)) / 2 });
    }
  }
  return pairs;
}

function cellPrecision(found, exp) {
  const expectedRows = [exp.headers, ...exp.rows];
  const foundRows = [found.headers || [], ...found.rows];
  let equal = 0, total = 0;
  for (let r = 0; r < expectedRows.length; r++) {
    for (let c = 0; c < expectedRows[r].length; c++) {
      total++;
      if (String(foundRows[r]?.[c] ?? '') === String(expectedRows[r][c] ?? '')) equal++;
    }
  }
  return { equal, total, precision: total ? equal / total : 1 };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

const rows = [];
const timings = [];
let ambiguousCount = 0, misSplitCount = 0, silentMergeCount = 0;
let boundarySum = 0, boundaryPairs = 0, boundaryExact = 0;
let cellEqual = 0, cellTotal = 0;
let regionExpectedTotal = 0, regionMatchedTotal = 0;
let mismatchCount = 0; // 合成样例与设计行为不符 = 回归，最终以非零退出

for (const fixture of FIXTURES) {
  resolveFixtureRanges(fixture);
  const start = performance.now();
  const result = ImportEngine.parse(fixture.text, fixture.options || {});
  const autoMs = performance.now() - start;
  timings.push(autoMs);

  const expectedCount = fixture.expect.tables.length;
  regionExpectedTotal += expectedCount;

  let confirmed = null, confirmMs = 0, pairs = [], cells = { equal: 0, total: 0 };
  const notes = [];

  if (result.format === 'ambiguous') {
    ambiguousCount++;
    if (fixture.expectAmbiguous !== true) { notes.push('MISMATCH: unexpected ambiguity'); mismatchCount++; }
    if (fixture.confirm) {
      const confirmStart = performance.now();
      confirmed = ImportEngine.parse(fixture.text, { ...(fixture.options || {}), ...fixture.confirm(fixture.text, result) });
      confirmMs = performance.now() - confirmStart;
    }
  } else if (fixture.expectAmbiguous) {
    notes.push('MISMATCH: expected ambiguity'); mismatchCount++;
  }

  const effective = confirmed || result;
  const effectiveTables = effective.tables || [];
  if (!confirmed && effective.format === 'ambiguous') {
    // 预期歧义且未提供确认：只计确认率
  } else {
    pairs = pairTables(effectiveTables, fixture.expect.tables);
    regionMatchedTotal += pairs.length;
    for (const pair of pairs) {
      boundarySum += pair.boundaryError;
      boundaryPairs++;
      if (pair.boundaryError === 0) boundaryExact++;
      const pairCells = cellPrecision(pair.found, pair.exp);
      cells.equal += pairCells.equal;
      cells.total += pairCells.total;
      cellEqual += pairCells.equal;
      cellTotal += pairCells.total;
    }
    if (effective.format !== fixture.expect.format) { notes.push(`MISMATCH: format ${effective.format} != ${fixture.expect.format}`); mismatchCount++; }
    if (!fixture.expectAmbiguous && !confirmed) {
      if (effectiveTables.length > expectedCount) { misSplitCount++; notes.push(`SILENT SPLIT: ${effectiveTables.length} > ${expectedCount}`); mismatchCount++; }
      if (effectiveTables.length < expectedCount) { silentMergeCount++; notes.push(`SILENT MERGE: ${effectiveTables.length} < ${expectedCount}`); mismatchCount++; }
    }
    if (pairs.length < expectedCount) { notes.push(`recall ${pairs.length}/${expectedCount}`); mismatchCount++; }
    if (cells.total && cells.equal < cells.total) { notes.push(`cells ${cells.equal}/${cells.total}`); mismatchCount++; }
  }

  const boundary = pairs.length ? (pairs.reduce((sum, pair) => sum + pair.boundaryError, 0) / pairs.length).toFixed(1) : '-';
  rows.push({
    family: fixture.family,
    id: fixture.id,
    auto: fixture.expectAmbiguous ? 'ambiguous' : result.format,
    ms: autoMs.toFixed(1),
    recall: expectedCount ? `${pairs.length}/${expectedCount}` : '-',
    boundary,
    cells: cells.total ? `${cells.equal}/${cells.total}` : '-',
    confirm: confirmed ? 'yes' : '-',
    confirmMs: confirmed ? confirmMs.toFixed(1) : '-',
    notes: notes.join('; ') || ''
  });
}

// ── 报告 ──────────────────────────────────────────────────────────
const lines = [];
lines.push('# Region extraction evaluation (synthetic fixtures)');
lines.push('');
lines.push('Synthetic data only. Passing fixtures verify that designed behavior has not');
lines.push('regressed; they are not an accuracy conclusion for real-world inputs.');
lines.push('');
lines.push('| case | family | auto | ms | recall | Δboundary | cells | confirmed | confirm ms | notes |');
lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
for (const row of rows) {
  lines.push(`| ${row.id} | ${row.family} | ${row.auto} | ${row.ms} | ${row.recall} | ${row.boundary} | ${row.cells} | ${row.confirm} | ${row.confirmMs} | ${row.notes} |`);
}
const sorted = [...timings].sort((a, b) => a - b);
const totalCases = FIXTURES.length;
lines.push('');
lines.push('## Totals');
lines.push('');
lines.push(`- Cases: ${totalCases}`);
lines.push(`- Confirmation rate: ${ambiguousCount}/${totalCases}`);
lines.push(`- Region recall: ${regionMatchedTotal}/${regionExpectedTotal}`);
lines.push(`- Boundary: mean Δchars ${boundaryPairs ? (boundarySum / boundaryPairs).toFixed(2) : '-'} · exact ${boundaryExact}/${boundaryPairs}`);
lines.push(`- Cell precision: ${cellTotal ? `${cellEqual}/${cellTotal} (${((cellEqual / cellTotal) * 100).toFixed(1)}%)` : '-'}`);
lines.push(`- Silent mis-splits: ${misSplitCount} · silent merges: ${silentMergeCount}`);
lines.push(`- Runtime budget ms: p50 ${percentile(sorted, 0.5).toFixed(1)} · p95 ${percentile(sorted, 0.95).toFixed(1)} · max ${sorted.length ? sorted[sorted.length - 1].toFixed(1) : '-'}`);
lines.push(`- Mismatches (regressions against designed behavior): ${mismatchCount}`);
lines.push('');
console.log(lines.join('\n'));
process.exitCode = mismatchCount ? 1 : 0;
