import fs from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { test, expect } from '@playwright/test';
import { readSheet } from 'read-excel-file/node';
import { createLargeTableData } from '../tests/helpers/large-data.mjs';
import { installLargeDataProbe } from './helpers/large-data-probe.mjs';

const origin = 'http://127.0.0.1:4173';
const cases = [
  { variant: 'short', run: 1 }, { variant: 'short', run: 2 }, { variant: 'short', run: 3 },
  { variant: 'unicode-crlf', run: 1 }, { variant: 'long', run: 1 },
  { variant: 'short', run: 1, method: 'file' },
];

for (const sample of cases) {
  test(`100k x 32 ${sample.variant} ${sample.method || 'clipboard'} run ${sample.run}`, async ({ page, context, browser }, testInfo) => {
    const fixture = createLargeTableData({ variant: sample.variant });
    // Native textarea values canonicalize CRLF to LF; record both input and received lengths.
    const receivedCharacters = fixture.text.replace(/\r\n/g, '\n').length;
    const report = {
      schemaVersion: 1,
      case: { ...sample, method: sample.method || 'clipboard', rows: fixture.rows, columns: fixture.columns,
        textCharacters: fixture.text.length, receivedTextCharacters: receivedCharacters,
        utf8Bytes: Buffer.byteLength(fixture.text), estimatedTextBytes: fixture.text.length * 2 },
      environment: {
        commit: process.env.GITHUB_SHA || null, browserVersion: browser.version(), headless: true,
        platform: process.platform, architecture: process.arch, nodeVersion: process.version,
        cpuModel: os.cpus()[0]?.model, logicalCpus: os.cpus().length,
        availableParallelism: os.availableParallelism(), hostMemoryBytes: os.totalmem(),
        viewport: { width: 1440, height: 900 },
      },
      status: 'running', phases: [], unexpectedRequests: [], pageErrors: [], observations: [],
    };
    page.on('request', request => {
      if (new URL(request.url()).origin !== origin) report.unexpectedRequests.push(request.url());
    });
    page.on('pageerror', error => report.pageErrors.push(String(error)));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () => {
      const { metrics: values } = await cdp.send('Performance.getMetrics');
      const wanted = new Set(['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'TaskDuration', 'ScriptDuration']);
      return Object.fromEntries(values.filter(value => wanted.has(value.name)).map(value => [value.name, value.value]));
    };
    const phase = async (name, action) => {
      // Let preceding debounced saves settle; the observation tail captures this action's save.
      await page.waitForTimeout(400);
      const before = await metrics();
      await page.evaluate(value => window.__otaLargeDataProbe.start(value), name);
      const started = performance.now();
      let actionWallMs;
      let failed = false;
      try {
        await action();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        actionWallMs = performance.now() - started;
        await page.waitForTimeout(400);
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        const item = { name, failed, actionWallMs: actionWallMs ?? performance.now() - started, before };
        try {
          Object.assign(item, await page.evaluate(() => window.__otaLargeDataProbe.stop()));
          item.after = await metrics();
          item.cacheEntries = await page.evaluate(() => window.OTA.require('query-service').QueryService.getCacheSize());
          if (failed) item.finalState = await rawState();
        } catch (error) {
          item.observationError = String(error);
        }
        report.phases.push(item);
      }
    };
    const rawState = () => page.evaluate(() => {
      const tables = window.OTA.require('table-registry').TableRegistry.getRaw();
      const doc = window.OTA.require('store').Store.getDocument();
      return {
        sourceLength: doc.raw.length,
        editorLength: document.getElementById('rawInput').value.length,
        sourceMatchesEditor: doc.raw === document.getElementById('rawInput').value,
        persistRaw: window.OTA.require('store').Store.getState().persistRaw,
        tables: tables.map(table => ({ name: table.name, rows: table.rows.length, columns: table.headers.length,
          firstId: table.rows[0]?.[1], lastId: table.rows.at(-1)?.[1] })),
      };
    });
    const wideCard = page.locator('#previewArea .table-container').filter({ has: page.locator('.table-title', { hasText: /^Wide$/ }) });
    const expectWideCount = count => expect(wideCard.locator('.meta-tag').filter({ hasText: /^Show:/ })).toHaveText(`Show: ${count}`);
    const exportFile = async (button, filename) => {
      const pending = page.waitForEvent('download');
      await page.locator(button).click();
      const download = await pending;
      const filenameOnDisk = testInfo.outputPath(filename);
      expect(await download.failure()).toBeNull();
      await download.saveAs(filenameOnDisk);
      report.downloads ||= [];
      report.downloads.push({ filename, bytes: (await fs.stat(filenameOnDisk)).size });
      return filenameOnDisk;
    };

    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      await page.goto('/index.html');
      await page.locator('#autoParseToggle').uncheck();
      await page.evaluate(installLargeDataProbe);
      report.environment.userAgent = await page.evaluate(() => navigator.userAgent);
      report.importLimitBytes = await page.evaluate(() => window.OTA.require('store').MAX_IMPORT_BYTES);

      if (sample.method === 'file') {
        await phase('file-import-and-parse', async () => {
          await page.locator('#sourceFileInput').setInputFiles({ name: 'wide.txt', mimeType: 'text/plain', buffer: Buffer.from(fixture.text) });
          await expectWideCount(fixture.rows);
          const state = await rawState();
          expect(state.sourceLength).toBe(receivedCharacters);
          expect(state.tables.find(table => table.name === 'Wide')).toMatchObject({ rows: fixture.rows, columns: 32, firstId: '1', lastId: '100000' });
        });
      } else {
        // Clipboard setup is excluded from paste timing. Control+V uses the native browser path.
        await page.evaluate(text => navigator.clipboard.writeText(text), fixture.text);
        await page.locator('#rawInput').click();
        await phase('paste', async () => {
          await page.locator('#rawInput').press('Control+V');
          const state = await rawState();
          expect(state.sourceLength).toBe(receivedCharacters);
          expect(state.sourceMatchesEditor).toBe(true);
        });
        expect(report.phases.at(-1).pasteEvents).toBe(1);
        await phase('save-raw', () => page.keyboard.press('Control+S'));
        await phase('temporary-mode-control', async () => {
          await page.locator('#persistRawToggle').uncheck();
          const state = await rawState();
          report.temporaryMode = { storeEnabled: state.persistRaw, controlChecked: await page.locator('#persistRawToggle').isChecked() };
          if (state.persistRaw === false) {
            expect(await page.evaluate(() => {
              const { STORE_KEY } = window.OTA.require('store');
              return JSON.parse(localStorage.getItem(STORE_KEY)).docs.every(doc => doc.raw === '');
            })).toBe(true);
          } else {
            // Observe the existing control defect instead of treating the old empty save as success.
            report.observations.push('persistRawToggle unchecked but Store.persistRaw remains enabled; later phases retain default persistence');
          }
        });

        if (receivedCharacters * 2 > report.importLimitBytes) {
          await phase('parse-rejected', async () => {
            await page.locator('#parseBtn').click();
            await expect(page.locator('#toast')).toContainText(/过大|超过/);
            const state = await rawState();
            expect(state.sourceLength).toBe(receivedCharacters);
            expect(state.tables).toHaveLength(0);
          });
          report.outcome = 'rejected-by-current-import-limit';
        } else {
          await phase('parse-and-preview', async () => {
            await page.locator('#parseBtn').click();
            await expectWideCount(fixture.rows);
            const state = await rawState();
            expect(state.tables.find(table => table.name === 'Wide')).toMatchObject({ rows: fixture.rows, columns: 32, firstId: '1', lastId: '100000' });
            expect(state.tables.find(table => table.name === 'Lookup')).toMatchObject({ rows: 20, columns: 3 });
            expect(await wideCard.locator('tbody tr').count()).toBe(100);
          });

          // Read a small sheet independently; avoid expanding 3.2 million cells in the Node reader.
          let fullPath;
          await phase('full-xlsx-export', async () => { fullPath = await exportFile('#exportFullBtn', 'full.xlsx'); });
          const lookup = await readSheet(fullPath, 'Lookup');
          expect(lookup).toHaveLength(21);
          expect(lookup[1]).toEqual([1, 'B0', 'Label0_a']);
          await fs.unlink(fullPath);

          for (let nextPage = 2; nextPage <= 4; nextPage++) {
            await phase(`page-${nextPage}`, async () => {
              await wideCard.getByRole('button', { name: '下一页', exact: true }).click();
              await expect(wideCard.locator('tbody tr').first().locator('td').nth(1)).toHaveText(String((nextPage - 1) * 100 + 1));
            });
          }
          await page.locator('#sidebarConfigTabBtn').click();
          await page.locator('.acc-item[data-acc="rules"] .acc-head').click();
          await phase('filter-bucket', async () => {
            await page.locator('#globalFilter').fill('Bucket=B1');
            await expectWideCount(10_000);
          });
          await phase('filter-100-records', async () => {
            await page.locator('#globalFilter').fill('ID<=100');
            await expectWideCount(100);
          });
          await phase('copy-page', async () => {
            await wideCard.locator('tbody td').first().click();
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Control+C');
            await expect(page.locator('#toast')).toContainText('已复制');
            const text = await page.evaluate(() => navigator.clipboard.readText());
            expect(text.split(/\r?\n/).filter(Boolean)).toHaveLength(101);
            expect(text).toContain('validflag\tID\tBucket');
          });
          let previewPath;
          await phase('filtered-xlsx-export', async () => { previewPath = await exportFile('#exportPrevBtn', 'filtered.xlsx'); });
          const filtered = await readSheet(previewPath, 'Wide');
          expect(filtered).toHaveLength(101);
          expect(filtered[0]).toEqual(fixture.headers);
          expect(filtered[1][1]).toBe(1);
          expect(filtered[100][1]).toBe(100);
          expect(filtered[1][3]).toBe(sample.variant === 'unicode-crlf' ? '值4' : 4);
          await fs.unlink(previewPath);

          await phase('join-200k-records', async () => {
            await page.locator('#globalFilter').fill('');
            await page.locator('#manageViewsBtn').click();
            await page.locator('#jeAddNew').click();
            await page.locator('#jeName').fill('BenchmarkJoin');
            await page.locator('#jeLeftTable').selectOption('Wide');
            await page.locator('#jeRightTable').selectOption('Lookup');
            await page.locator('.je-rel-l').selectOption('Bucket');
            await page.locator('.je-rel-r').selectOption('Bucket');
            await page.locator('#jeLList input[value="ID"]').check();
            await page.locator('#jeRList input[value="Label"]').check();
            await page.locator('#jeSave').click();
            await page.locator('#viewsTrigger').click();
            await page.locator('#modalOverlay .checkbox-row input[value="BenchmarkJoin"]').check();
            await page.locator('#saveMod').click();
            await page.locator('#previewTableSelect').selectOption('JOIN:BenchmarkJoin');
            const joined = page.locator('#previewArea .table-container').filter({ hasText: 'JOIN:BenchmarkJoin' });
            await expect(joined.locator('.meta-tag').filter({ hasText: /^Show:/ })).toHaveText('Show: 200000');
            await expect(joined).toContainText('Label1_a');
            expect(await joined.locator('tbody tr').count()).toBe(100);
          });
          await phase('second-document-file-import', async () => {
            await page.locator('#addTabBtn').click();
            // Store notifications load the new editor asynchronously. Await visible readiness.
            await expect(page.locator('#tabsContainer [role="tab"][aria-selected="true"]')).toContainText('Analysis 2');
            await expect(page.locator('#rawInput')).toHaveValue('');
            await page.locator('#sourceFileInput').setInputFiles({ name: 'second-wide.txt', mimeType: 'text/plain', buffer: Buffer.from(fixture.text) });
            await expectWideCount(fixture.rows);
            const state = await rawState();
            expect(state.sourceLength).toBe(receivedCharacters);
            expect(state.tables.find(table => table.name === 'Wide')).toMatchObject({ rows: fixture.rows, columns: 32 });
            expect(await page.evaluate(() => window.OTA.require('store').Store.getState().docs.length)).toBe(2);
          });
          report.outcome = 'full-workflow-completed';
        }
      }
      expect(report.unexpectedRequests).toEqual([]);
      expect(report.pageErrors).toEqual([]);
      report.status = 'passed';
    } finally {
      if (report.status !== 'passed') report.status = 'failed';
      const reportPath = testInfo.outputPath('baseline.json');
      await fs.mkdir(testInfo.outputDir, { recursive: true });
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
      await testInfo.attach('large-data-baseline', { path: reportPath, contentType: 'application/json' });
      await cdp.detach().catch(() => {});
    }
  });
}
