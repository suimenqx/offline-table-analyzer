/**
 * 共享 Storage Mock 工厂
 * 生成可配置的 localStorage 模拟，支持 QuotaExceededError。
 */
export function createStorageMock(options = {}) {
  const store = new Map();
  let quotaFail = false;

  const storage = {
    _store: store,
    _quotaFail: quotaFail,

    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (quotaFail) {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      }
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key(n) {
      return [...store.keys()][n] || null;
    },

    // 测试辅助方法
    enableQuotaFailure() {
      quotaFail = true;
    },
    disableQuotaFailure() {
      quotaFail = false;
    },
    reset() {
      store.clear();
      quotaFail = false;
    },
    snapshot() {
      return JSON.parse(JSON.stringify([...store]));
    },
  };

  return storage;
}
