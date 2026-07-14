# 重构架构分析与设计

## 1. 当前架构诊断

当前产品功能已经比较完整，但发布源只有一个 `index.html`：约 28 万字节的 CSS、HTML 和 JavaScript 共存于同一文件。逻辑顺序靠声明先后维持，测试通过字符串截取获取领域代码，导致以下问题：

- 解析、状态、JOIN、复制和 UI 控制器之间的边界只能靠注释表达。
- 一个小功能变更容易触发整页语法、渲染或保存回归。
- 领域代码难以复用到 Worker、Node 测试或未来的 XLSX 导入模块。
- 发布单文件的约束与开发源文件的可维护性相互冲突。

已有代码的优点也必须保留：零运行时依赖、成熟的 v20 数据契约、完整的解析器和 JOIN 回归用例、明确的隐私边界，以及可以直接双击打开的发布体验。

## 2. 方案比较

| 方案 | 优点 | 代价/风险 | 结论 |
| --- | --- | --- | --- |
| 继续维护单体 HTML | 无迁移成本，发布简单 | 耦合继续扩大，测试边界脆弱，无法并行演进 | 不选 |
| 浏览器原生 ES Module | 依赖方向清晰，调试体验好 | 直接打开 `file://` 时存在模块加载/CORS 兼容问题，无法满足单文件交付 | 暂不作为发布形态 |
| 引入 Vite/Webpack/React | 工程能力强，适合大型 UI | 引入依赖、构建链和生态升级成本，偏离“单文件/零依赖”产品定位 | 暂不选 |
| **源模块 + 确定性内联构建** | 保持单 HTML、无运行时依赖；源文件可拆分；构建和回退可验证 | 需要维护轻量 registry；暂时不是标准 ESM | **当前选型** |
| 纯函数核心 + 可选 ESM/Worker | 长期可扩展到大数据和后台线程 | 需要先稳定领域契约和消息协议 | 作为下一阶段演进目标 |

## 3. 当前决策：源模块 + 单文件发布

重构采用“开发源模块、发布时内联”的双层结构：

- `src/index.template.html`：只保存稳定 HTML 壳和发布元数据。
- `src/styles.css`：集中保存设计令牌、布局、响应式和无障碍样式。
- `src/modules/*.js`：按职责和依赖顺序保存业务模块；首个模块提供本地 registry，最后一个模块启动应用。
- `tools/build-release.js`：读取固定 manifest，将样式和模块确定性内联到根目录 `index.html`。
- `index.html`：生成产物，不再手工修改；用户仍然只接触这个文件。

构建器不做压缩、不执行代码转换、不下载依赖，因此发布结果透明、可审计、可复现。测试继续对生成产物进行语法和离线校验，防止“源文件通过、发布文件损坏”。

## 4. 分层和依赖规则

依赖方向从底层到上层单向流动：

```text
HTML/CSS shell
      ↓
runtime utilities / feedback
      ↓
table normalization → header inference → parser adapters → ImportEngine
      ↓                                      ↓
Store / persistence                         Joiner
      ↓                                      ↓
Clipboard / Exporter / Selection → UI controllers → App bootstrap
```

规则如下：

1. 解析器、TableUtils、HeaderResolver、Joiner、ClipboardFormatter 不读取 DOM，不访问 localStorage，不触发下载。
2. Store 只负责 workspace 状态、规范化、迁移和持久化，不负责渲染 HTML。
3. Exporter 只接受稳定表格/工作区契约；下载和 Blob 属于边缘适配器。
4. UI 控制器通过 Store 和领域模块读写状态，不直接改变另一个控制器的内部数据。
5. `App` 是组合层，负责事件绑定、刷新顺序、浏览器 API 和用户反馈；新业务逻辑不得继续堆入 `App`。
6. 每个模块只依赖 manifest 中位于它之前的模块；新增依赖必须先调整架构文档和测试。

## 5. 已落地模块地图

当前发布构建包含 18 个源模块：

| 源文件 | 职责 | 主要公开对象 |
| --- | --- | --- |
| `00-module-loader.js` | 无依赖的本地模块 registry | `OTA.define`, `OTA.require`, `OTA.start` |
| `00-runtime.js` | DOM 查询、Tooltip、Toast | `$`, `createEl`, `Tooltip`, `Toast` |
| `01-exporter.js` | 下载、无依赖 XLSX ZIP/XML | `Exporter` |
| `02-store.js` | schema、迁移、页签、持久化 | `Store`, 常量 |
| `03-table-utils.js` | 文本、单元格、行宽、表头工具 | `TableUtils` |
| `04-header-resolver.js` | 自动/强制表头推断 | `HeaderResolver` |
| `05-delimited.js` | 引号感知 CSV/TSV 解析 | `Delimited` |
| `06-html-parser.js` | HTML 表格及跨度展开 | `HtmlTableParser` |
| `07-delimited-parsers.js` | CSV、分号 CSV、TSV 适配器 | `CsvParser`, `SemicolonCsvParser`, `ExcelPasteParser` |
| `08-text-parsers.js` | pipe、ASCII、固定宽度、对齐文本、CLI | 其余解析器 |
| `09-import-engine.js` | 格式选择、候选和诊断 | `ImportEngine` |
| `10-parser-facade.js` | 历史兼容入口 | `Parser` |
| `11-joiner.js` | JOIN、复合键、依赖检测 | `Joiner` |
| `12-join-editor.js` | JOIN 设计交互 | `JoinEditor` |
| `13-clipboard.js` | TSV/CSV/Markdown/ASCII/HTML | `ClipboardFormatter` |
| `14-selection.js` | 预览矩形选区和复制 | `Select` |
| `15-app.js` | 页面组合、事件、渲染 | `App` |
| `16-bootstrap.js` | 生产启动入口 | `OTA.start('app')` |

这一步先完成结构性拆分，再完成运行时模块隔离：业务代码通过 `OTA.define()` 声明依赖，`OTA.require()` 按需解析并缓存；App 与 JoinEditor 的天然循环依赖通过延迟代理打断。它避免一次性重写导致解析和数据安全行为同时漂移。

## 6. 状态与事件设计

Store 是唯一的可持久化状态拥有者。UI 使用以下方向更新：

```text
DOM event
  → App command
  → Store/domain transition
  → scheduleSave / invalidate derived state
  → render or targeted refresh
```

关键状态转换：

- `sourceChanged`：清理 cell edits、undo/redo 和 HTML clipboard 关联，保留用户原始输入。
- `parseRequested`：读取当前 source/options，得到 normalized tables、candidates 和 diagnostics。
- `tabActivated`：保存前页签输入，切换 Store.activeId，清理短生命周期 UI 状态，再加载新页签。
- `viewChanged`：校验依赖图和输出列，成功后写入 globalViews，失败时不改变已保存配置。
- `storageFailed`：保留内存状态，更新状态栏，不把失败误报为已保存。

后续阶段应将这些命令/事件提取为小型应用服务，并对每个 transition 添加状态性质测试；当前阶段先用既有 Store 和 UI 合同测试保护行为。

## 7. 迁移路线

### 阶段 A：可复现边界（当前）

- 建立新分支。
- 提取 template、styles 和 18 个按依赖排序的源模块。
- 增加 `build:release`，使根 `index.html` 可从源完全生成。
- 保持现有测试全部通过。

### 阶段 B：领域模块纯化

- 将 `TableUtils`、`HeaderResolver`、`Delimited`、各 parser、`Joiner`、`ClipboardFormatter` 改为显式依赖和明确返回值。
- 提取浏览器 API（DOMParser、Blob、localStorage、download）为 adapter。
- 允许 Node 测试直接 `require`/加载领域模块，而不再从 HTML 字符串截取。

### 阶段 C：状态与 UI 控制器拆分

- 将 Store 的 schema/defaults/migration/persistence 分成独立模块。
- 将 App 拆为 source、tabs、preview、filters、export、modal 等 controllers。
- 统一 command/event 刷新协议，避免控制器互相调用私有细节。

### 阶段 D：浏览器回归和性能基线

- 加入真实浏览器 headless 流程：粘贴 → 解析 → 筛选 → JOIN → 复制 → 导出。
- 建立 1 MB、5 MB、20 MB 和 10 万行 fixture 的耗时/内存基线。
- 只有基线证明主线程成为瓶颈时，才启用 Worker、IndexedDB 或虚拟滚动。

### 阶段 E：可选大数据架构

- 把纯领域模块编译为 Worker 可用代码。
- 设计可取消、带进度的解析/规则消息协议。
- 以迁移版本和事务方式引入 IndexedDB，保留 localStorage/单文件 fallback。

## 8. 分支、worktree 和回退策略

本次基于干净的 `codex/docs-sync-v20-1` 创建 `codex/refactor-modular-architecture` 分支，在当前工作区完成。原因是当前只有一个执行者，没有并行改动需求；新 worktree 会增加工作目录同步、生成产物和验收路径的管理成本。

后续规则：

- 同一人连续演进：继续使用该分支，每个阶段一个可验证提交。
- 需要并行 UI/领域开发：从该分支创建独立 `git worktree`，禁止两个工作区同时编辑生成的 `index.html`。
- 回退优先使用 `git revert` 回退阶段提交；不要用 destructive reset 覆盖用户变更。
- 发布前运行构建、完整测试和发布校验；只有生成产物与源一致时才允许合并。

## 9. 架构风险与决策门槛

- **模块是轻量 registry 而非 ESM**：这是为 `file://` 单文件发布保留的过渡形态；领域契约稳定后再评估开发时 ESM/构建转换。
- **App 仍偏大**：先用测试保护行为，再按用户流程拆 controller；不进行没有回归保护的机械搬迁。
- **主线程计算**：输入有 25 MB 保护和分页；性能 fixture 未证明前不提前引入复杂并发模型。
- **浏览器兼容**：发布脚本保持标准语法；每次改动同时跑 Node 语法、静态 UI 合同和真实浏览器回归（若已配置）。
- **schema 演进**：任何 schema 变化必须增加迁移函数、旧 payload fixture、失败恢复测试和版本说明。

## 10. 当前验收标准

- `src/` 成为唯一业务源目录，`index.html` 可由 `npm run build:release` 重建。
- 构建产物仍只有一个 inline script、一个 inline style，且无网络 API/外链资源。
- 原有解析、复制、Store、JOIN 和 UI 回归全部通过。
- 文档能说明需求、架构选择、模块依赖、分支策略和后续迁移边界。
