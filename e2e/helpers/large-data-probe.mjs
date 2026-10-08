// Browser-only instrumentation installed by the benchmark, never the release.
export function installLargeDataProbe() {
  let phase = null;
  let lastBeat = performance.now();
  const sampleHeap = () => {
    if (phase && performance.memory) {
      phase.maxSampledPageHeapBytes = Math.max(phase.maxSampledPageHeapBytes || 0, performance.memory.usedJSHeapSize);
    }
  };
  const observer = PerformanceObserver.supportedEntryTypes.includes('longtask')
    ? new PerformanceObserver(list => {
      if (!phase) return;
      for (const entry of list.getEntries()) {
        if (entry.startTime < phase.startedAt) continue;
        phase.longTaskCount++;
        phase.longTaskTotalMs += entry.duration;
        phase.longestTaskMs = Math.max(phase.longestTaskMs, entry.duration);
      }
    }) : null;
  observer?.observe({ type: 'longtask' });
  const timer = setInterval(() => {
    const now = performance.now();
    if (phase) phase.maxTimerDelayMs = Math.max(phase.maxTimerDelayMs, Math.max(0, now - lastBeat - 20));
    lastBeat = now;
    sampleHeap();
  }, 20);

  document.addEventListener('paste', event => {
    if (!phase || event.target.id !== 'rawInput') return;
    phase.pasteEvents++;
    phase.pasteStartedAt = performance.now();
    phase.clipboardTypes = Array.from(event.clipboardData?.types || []);
  }, true);
  document.addEventListener('input', event => {
    if (!phase || event.target.id !== 'rawInput' || !phase.pasteStartedAt) return;
    const current = phase;
    current.pasteEventToInputMs = performance.now() - current.pasteStartedAt;
    queueMicrotask(() => {
      current.pasteEventToHandlersDoneMs = performance.now() - current.pasteStartedAt;
    });
  }, true);
  document.addEventListener('ota:storage', event => {
    if (!phase) return;
    phase.storageResults.push({ ok: event.detail.ok, bytes: event.detail.bytes, message: event.detail.message });
  });

  for (const [module, name, method] of [
    ['import-engine', 'ImportEngine', 'parse'],
    ['table-utils', 'TableUtils', 'normalizeRows'],
    ['query-service', 'QueryService', 'getPreview'],
    ['filter-engine', 'FilterEngine', 'processTable'],
    ['joiner', 'Joiner', 'run'],
    ['store', 'Store', 'save'],
    ['exporter', 'Exporter', 'toExcel'],
  ]) {
    const owner = window.OTA.require(module)[name];
    const original = owner[method];
    owner[method] = function (...args) {
      const current = phase;
      const started = performance.now();
      try { return Reflect.apply(original, this, args); }
      finally {
        if (current) {
          const entry = current.modules[`${name}.${method}`] ||= { calls: 0, totalMs: 0, maxMs: 0 };
          const duration = performance.now() - started;
          entry.calls++;
          entry.totalMs += duration;
          entry.maxMs = Math.max(entry.maxMs, duration);
        }
      }
    };
  }
  window.__otaLargeDataProbe = {
    start(name) {
      phase = {
        name, startedAt: performance.now(), modules: {}, storageResults: [], pasteEvents: 0,
        longTaskCount: 0, longTaskTotalMs: 0, longestTaskMs: 0, maxTimerDelayMs: 0,
        longTasksSupported: Boolean(observer),
      };
      lastBeat = performance.now();
      sampleHeap();
    },
    stop() {
      sampleHeap();
      const result = { ...phase, observerWindowMs: performance.now() - phase.startedAt };
      phase = null;
      return result;
    },
    dispose() { clearInterval(timer); observer?.disconnect(); },
  };
}
