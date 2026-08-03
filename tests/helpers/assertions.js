/**
 * 测试断言辅助 — 处理跨 vm realm 对象
 *
 * Node 的 assert.deepStrictEqual 对 vm 沙箱创建的对象会失败
 * （prototype 不同）。此模块提供 realm-safe 的断言函数。
 */
import { strict as assert } from 'node:assert/strict';

/**
 * 递归转换跨 realm 值为本地普通对象/数组
 */
export function toLocal(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(toLocal);
  if (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null) {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = toLocal(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * Realm-safe 深度相等断言
 */
export function deepEqual(actual, expected, message) {
  assert.deepEqual(toLocal(actual), toLocal(expected), message);
}

/**
 * Realm-safe 相等断言（处理跨 realm 字符串）
 */
export function isEqual(actual, expected, message) {
  assert.equal(toLocal(actual), toLocal(expected), message);
}

/**
 * Realm-safe ok 断言
 */
export function ok(value, message) {
  assert.ok(toLocal(value), message);
}
