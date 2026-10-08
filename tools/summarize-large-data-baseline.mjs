import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function readBaselineReports(directory) {
  const reports = [];
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return reports; throw error; }
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) reports.push(...await readBaselineReports(filename));
    else if (entry.name === 'baseline.json') reports.push(JSON.parse(await fs.readFile(filename, 'utf8')));
  }
  return reports;
}

export function summarizeBaseline(reports) {
  if (!reports.length) return 'No completed large-data reports were produced. Inspect the workflow failure log.\n';
  const number = value => Number.isFinite(value) ? value.toFixed(1) : 'n/a';
  const mib = value => number(value / 1024 / 1024);
  const lines = ['# Desktop Chromium large-data baseline', '',
    'Synthetic data only. Times are measurements, not a responsiveness pass or a capacity guarantee.', '',
    'Action wall time includes automation and two animation frames; a separate 400 ms observation tail captures debounced saves. Module timers are nested and must not be summed.', '',
    'Heap values sample the page V8 heap; they are not a complete renderer/process peak and do not include all DOM/native/Worker memory.', ''];
  const environment = reports[0].environment;
  lines.push(`Commit: ${environment.commit || 'local'}. Browser: ${environment.browserVersion}.`,
    `Runner: ${environment.platform}/${environment.architecture}, ${environment.logicalCpus} logical CPUs, ${mib(environment.hostMemoryBytes)} MiB host RAM. Headless viewport: 1440 × 900.`, '',
    '| Case | State | Raw UTF-8 MiB | Text estimate MiB |', '| --- | --- | ---: | ---: |');
  for (const report of reports) {
    const sample = report.case;
    lines.push(`| ${sample.variant}/${sample.method}/${sample.run} | ${report.status}, ${report.outcome || 'import'} | ${mib(sample.utf8Bytes)} | ${mib(sample.estimatedTextBytes)} |`);
  }
  const observations = [...new Set(reports.flatMap(report => report.observations || []))];
  if (observations.length) lines.push('', '## Observed application issues', '', ...observations.map(value => `- ${value}`));
  lines.push('', '| Case | Phase | Action ms | Longest task ms | Timer delay ms | Page heap after MiB |',
    '| --- | --- | ---: | ---: | ---: | ---: |');
  for (const report of reports) {
    for (const phase of report.phases) {
      lines.push(`| ${report.case.variant}/${report.case.method}/${report.case.run} | ${phase.name}${phase.failed ? ' (failed)' : ''} | ${number(phase.actionWallMs)} | ${number(phase.longestTaskMs)} | ${number(phase.maxTimerDelayMs)} | ${mib(phase.after?.JSHeapUsedSize)} |`);
    }
  }
  const repeats = reports.filter(report => report.case.variant === 'short' && report.case.method === 'clipboard' && report.status === 'passed');
  if (repeats.length >= 3) {
    lines.push('', '## Short-input medians', '', '| Phase | Samples | Median action ms |', '| --- | ---: | ---: |');
    for (const phase of repeats[0].phases) {
      const values = repeats.flatMap(report => report.phases.filter(item => item.name === phase.name).map(item => item.actionWallMs)).sort((a, b) => a - b);
      const mid = Math.floor(values.length / 2);
      const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
      lines.push(`| ${phase.name} | ${values.length} | ${number(median)} |`);
    }
    lines.push('', 'Three repeats do not establish a reliable p95 or a real-user INP score.');
  }
  lines.push('', 'Default raw persistence may hit the browser quota; see storageResults in baseline.json. The oversized sample measures paste and visible rejection, not successful parsing.',
    'file:// Worker/storage compatibility is a separate task. Linux headless clipboard and shared CI runner timings do not reproduce every desktop OS or a particular 32 GB machine.', '');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.stdout.write(summarizeBaseline(await readBaselineReports(process.argv[2] || 'test-results/large-data')));
}
