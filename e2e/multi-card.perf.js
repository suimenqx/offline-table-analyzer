import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test, expect } from '@playwright/test';
import { createLargeCsv } from '../tests/helpers/large-data.mjs';

/* 多卡片工作区性能样本（docs/testing/multi-card-baseline.md 性能口径）
   记录：两卡同名同结构 10 万行拼接的池更新耗时、显隐切换 → 表池回落耗时。
   只记录实测（中位数/p95 由归档脚本聚合），不设硬门槛、非 SLA。 */

const origin = 'http://127.0.0.1:4173';

for (const run of [1, 2, 3]) {
  test(`100k CSV 两卡拼接与显隐切换 run ${run}`, async ({ page, context, browser }, testInfo) => {
    const fixture = createLargeCsv();
    const inputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ota-multicard-perf-'));
    const inputFile = path.join(inputDir, 'wide.csv');
    await fs.writeFile(inputFile, fixture.text);
    const report = {
      schemaVersion: 1,
      case: { rows: 100000, columns: 32, run },
      environment: {
        commit: process.env.GITHUB_SHA || null, browserVersion: browser.version(), headless: true,
        platform: process.platform, architecture: process.arch, nodeVersion: process.version,
        cpuModel: os.cpus()[0]?.model, logicalCpus: os.cpus().length,
        availableParallelism: os.availableParallelism(), hostMemoryBytes: os.totalmem(),
        viewport: { width: 1440, height: 900 },
      },
      status: 'running', phases: [], unexpectedRequests: [], pageErrors: [],
    };
    page.on('request', request => {
      if (new URL(request.url()).origin !== origin) report.unexpectedRequests.push(request.url());
    });
    page.on('pageerror', error => report.pageErrors.push(String(error)));

    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await page.goto('/index.html');

    const pasteFile = async () => {
      await page.locator('#sourceFileInput').setInputFiles(inputFile);
      await expect(page.locator('.data-card.active .data-card-summary')).toContainText(/\d[\d,]* 行/, { timeout: 90000 });
    };
    const metaShow = page.locator('.table-container').filter({ has: page.locator('.table-title', { hasText: /^CSV Table 1$/ }) })
      .locator('.meta-tag').filter({ hasText: /^Show:/ });

    const measure = async (label, action, settle) => {
      const started = performance.now();
      await action();
      if (settle) await settle();
      const durationMs = Math.round(performance.now() - started);
      report.phases.push({ label, durationMs });
    };

    // 卡 A
    await measure('paste-parse-card-a', pasteFile);
    await expect(metaShow).toHaveText('Show: 100000', { timeout: 30000 });
    // 卡 B：新增 + 粘贴 + 解析（独立解析策略）
    await measure('add-card', () => page.locator('#addCardBtn').click(),
      () => expect(page.locator('.data-card')).toHaveCount(2));
    await measure('paste-parse-card-b', pasteFile);
    // 表池拼接：Show 计数 100000 → 200000 的可见更新耗时
    await measure('pool-concat-update', async () => {}, async () => {
      await expect(metaShow).toHaveText('Show: 200000', { timeout: 90000 });
    });
    // 显隐切换：隐藏卡 B → 表池回落 10 万行
    await measure('visibility-hide-pool-shrink', async () => {
      await page.locator('.data-card').nth(1).locator('[data-card-act="visible"]').click();
    }, async () => {
      await expect(metaShow).toHaveText('Show: 100000', { timeout: 90000 });
    });
    // 恢复可见 → 表池回 20 万行
    await measure('visibility-show-pool-grow', async () => {
      await page.locator('.data-card').nth(1).locator('[data-card-act="visible"]').click();
    }, async () => {
      await expect(metaShow).toHaveText('Show: 200000', { timeout: 90000 });
    });

    expect(report.unexpectedRequests).toEqual([]);
    expect(report.pageErrors).toEqual([]);
    report.status = 'complete';
    console.log(`[multi-card perf run ${run}] phases: ` +
      report.phases.map(p => `${p.label}=${p.durationMs}ms`).join(', '));
    await testInfo.attach('multi-card-perf', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  });
}
