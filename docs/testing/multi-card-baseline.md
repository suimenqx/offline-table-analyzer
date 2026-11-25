# 多卡片工作区验收基线

状态：已实施。本文的验收范围记录于 2026-10-18；工程/卡片迁移、Worker 多数据集、表池和项目级 view 已落地。当前覆盖位置包括 `tests/unit/table-pool.test.js`、`tests/unit/worker-runtime.test.js`、`tests/unit/store.test.js`、`tests/integration/card-ui.test.js`、`tests/integration/card-worker-metadata.test.js`、`e2e/multi-card-flow.e2e.js` 和 `e2e/multi-card.perf.js`。当前架构结果见[多卡片工作区 ADR](../architecture/multi-card-workspace.md)。本文中的原始用例数与门槛是当时的验收计划，不代表当前 CI 汇总数。

## 测试边界

| 层 | 覆盖 |
| --- | --- |
| `tests/unit/` | 表池派生纯逻辑（拼接/异结构并列/顺序/显隐清单）、迁移 21→22 幂等、view 解析与不可用标记、会话预算报错 |
| `tests/integration/` | Store 命令流（工程/卡片创建、显隐 dispatch、`enabledViews` 合并上移）、QueryService 缓存键含显隐修订 |
| `e2e/`（Chromium CI） | 下列六条真实浏览器流程 |
| 校验器 | `validate:release` / `validate:architecture` 随新模块边界更新后保持通过 |

## e2e 场景（复用 CI 样本 tests/helpers/large-data.mjs，10 万行 × 32 字段）

1. 两卡同名同结构 10 万行 CSV 拼接 → 表池 20 万行、Excel 导出读回 20 万行；
2. 隐藏一卡 → 表池回落 10 万行；
3. 同名异结构卡并列显示；
4. view 切换 + 引用不可用标记 + 恢复自动复原；
5. 粘贴落选中卡 + 新增卡片流；
6. 浏览器重启恢复多卡工作区。

## 性能口径

- 沿用既有口径：500 ms 初始回归线（防秒级退化）+ 主线程最长任务 ≤ 50 ms 参照；
- 多卡新增记录项：显隐切换 → 表池更新耗时、拼接耗时（中位数/p95）；
- 不设新硬门槛、不承诺 SLA；实测结果与 23.x 基线对照后校准。

## 迁移 fixture

- 在现有 v20/schema-less fixture 基础上扩 **v21 → v22** 用例：`docs` → `projects`/`cards` 1:1 **保 id**、`activeId` 两级化、`enabledViews` 合并上移、`cellEditKeyEncoding` 保持；
- 备份导入（`kind: ota-workspace`）走同一迁移；重复导入幂等。

## 回归要求

- 既有 434 项 Node 测试与 13 条 Chromium 流程全部保持通过（大文本、修正、撤销、导出不回归）；
- Termux 本地 Firefox 结果作为附加覆盖单独报告（Chromium 以 CI 为准）。
