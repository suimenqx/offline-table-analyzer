import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig(base, {
  testMatch: '**/*.perf.js',
  timeout: 180_000,
  // Await completion while measuring its real duration; this is not a performance SLA.
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  outputDir: 'test-results/large-data',
  reporter: [['list'], ['json', { outputFile: 'test-results/large-data-run.json' }]],
  use: {
    ...base.use,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 60_000,
    // Tracing megabytes of clipboard arguments changes the workload itself.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
});
