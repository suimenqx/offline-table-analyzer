# 重构架构分析与设计

## 1. 重构前的问题与当前状态

最初的产品将 CSS、HTML 和 JavaScript 直接维护在单体 `index.html` 中，测试通过字符串截取获取领域代码，当时存在以下问题：

- 解析、状态、JOIN、复制和 UI 控制器之间的边界只能靠注释表达。
- 一个小功能变更容易触发整页语法、渲染或保存回归。
- 领域代码难以复用到 Node 测试或未来的 XLSX 导入模块。
- 发布单文件的约束与开发源文件的可维护性相互冲突。

这些问题推动了源模块拆分。现在由 `src/` 维护业务代码，`tools/build-release.cjs` 将 42 个源模块内联为单文件发布产物；Node 测试通过同一构建清单加载源模块。发布产物仍可直接打开，保持零运行时依赖、v20 工作区契约、解析器与 JOIN 回归覆盖以及隐私边界。

## 2. 重构时的方案比较

| 方案 | 优点 | 代价/风险 | 结论 |
| --- | --- | --- | --- |
| 继续维护单体 HTML | 无迁移成本，发布简单 | 耦合继续扩大，测试边界脆弱，无法并行演进 | 不选 |
| 浏览器原生 ES Module | 依赖方向清晰，调试体验好 | 直接打开 `file://` 时存在模块加载/CORS 兼容问题，无法满足单文件交付 | 暂不作为发布形态 |
| 引入 Vite/Webpack/React | 工程能力强，适合大型 UI | 引入依赖、构建链和生态升级成本，偏离“单文件/零依赖”产品定位 | 暂不选 |
| **源模块 + 确定性内联构建** | 保持单 HTML、无运行时依赖；源文件可拆分；构建和回退可验证 | 需要维护轻量 registry；暂时不是标准 ESM | **当前选型** |
| 纯函数核心 + 可选 ESM | 保持领域逻辑可测试、可维护 | 需要先稳定领域契约 | 当前采用纯函数核心，后台线程不在本计划内 |

## 3. 当前决策：源模块 + 单文件发布

重构采用“开发源模块、发布时内联”的双层结构：

- `src/templates/index.html`：只保存稳定 HTML 壳和发布元数据。
- `src/styles/styles.css`：集中保存设计令牌、布局、响应式和无障碍样式。
- `src/core/`、`src/state/`、`src/parsing/`、`src/export/`、`src/transform/`、`src/ui/`：按分层职责保存业务模块；首个模块提供本地 registry，最后一个模块启动应用。
- `tools/build-release.cjs`：读取固定 manifest，将样式和模块确定性内联到根目录 `index.html`，并从 `package.json` 注入版本。
- `index.html`：生成产物，不再手工修改；用户仍然只接触这个文件。

构建器不做压缩、不执行代码转换、不下载依赖，因此发布结果透明、可审计、可复现。测试继续对生成产物进行语法和离线校验，防止“源文件通过、发布文件损坏”。

## 4. 分层和依赖规则

依赖方向从底层到上层单向流动：

```text
template / styles → OTA registry / runtime / TableUtils / SourceSnapshot / FilterEngine
      ↓
Store → dispatch
      ↓
Exporter / ClipboardFormatter
      ↓
HeaderResolver / TextLayout → parser adapters → ImportEngine
      ↓
Joiner → QueryService
      ↓
TableRegistry
      ↓
TableBuilder / Select / JoinEditor / other UI controllers
      ↓
App orchestrator → bootstrap
```

规则如下：

1. 解析器、TableUtils、HeaderResolver、Joiner、ClipboardFormatter 不读取 DOM，不访问 localStorage，不触发下载。
2. Store 只负责 workspace 状态、规范化、迁移和持久化，不负责渲染 HTML。
3. Exporter 只接受稳定表格/工作区契约；下载和 Blob 属于边缘适配器。
4. UI 控制器通过 Store 和领域模块读写状态，不直接改变另一个控制器的内部数据。
5. `App` 是组合层，负责事件绑定、刷新顺序、浏览器 API 和用户反馈；新业务逻辑不得继续堆入 `App`。
6. 每个模块只依赖 manifest 中位于它之前的模块；新增依赖必须先调整架构文档和测试。

## 5. 已落地模块地图

当前发布构建包含 42 个源模块，按目录分层：

| 目录 | 文件 | 职责 | 主要公开对象 |
| --- | --- | --- | --- |
| `core/` | `module-loader.js` | 无依赖的本地模块 registry | `OTA.define`, `OTA.require`, `OTA.start` |
| | `runtime.js` | DOM 查询、Tooltip、Toast | `$`, `createEl`, `Tooltip`, `Toast` |
| | `table-utils.js` | 文本、单元格、行宽、表头工具 | `TableUtils` |
| | `source-snapshot.js` | 临时剪贴板/文件来源元数据、诊断预览限长、页签与文本匹配 | `SourceSnapshot` |
| | `filter-engine.js` | 纯过滤/高亮/列投影逻辑（token 解析、操作符匹配、正则），零 DOM 依赖 | `FilterEngine` |
| | `query-service.js` | 统一 JOIN、过滤、Focus、分页和预览结果缓存 | `QueryService` |
| | `dispatch.js` | UI 到 Store 的命令入口 | `dispatch` |
| | `table-registry.js` | 解析结果及表/列元数据访问 | `TableRegistry` |
| `state/` | `store.js` | schema、迁移、页签、持久化 | `Store`, 常量 |
| `export/` | `exporter.js` | 下载、无依赖 XLSX ZIP/XML | `Exporter` |
| | `clipboard.js` | 剪贴板序列化 | `ClipboardFormatter` |
| `parsing/` | `header-resolver.js` | 自动/强制表头推断 | `HeaderResolver` |
| | `text-layout.js` | 定宽文本的显示宽度、稳定列起点 | `TextLayout` |
| | `format-sniffer.js` | 统计指纹格式检测 | `FormatSniffer` |
| | `delimited-utils.js` | 引号感知 CSV/TSV 解析 | `Delimited` |
| | `parser-helpers.js` | 解析器共享工具 | 各类 helper |
| | `import-engine.js` | 格式选择、候选和诊断 | `ImportEngine` |
| | `legacy-facade.js` | 历史兼容入口 | `Parser` |
| `parsing/parsers/` | `html-parser.js` | HTML 表格及跨度展开 | `HtmlTableParser` |
| | `delimited-parsers.js` | CSV、分号 CSV、TSV | `CsvParser`, `SemicolonCsvParser`, `ExcelPasteParser` |
| | `data-block-parser.js` | data-block 多表块解析 | `DataBlockParser` |
| | `json-parser.js` | JSON 对象记录、二维数组及命名多表解析 | `JsonTableParser` |
| | `pipe-table-parser.js` | Markdown/竖线表格 | `PipeTableParser` |
| | `ascii-table-parser.js` | ASCII/终端表格 | `AsciiTableParser` |
| | `fixed-width-parser.js` | 固定宽度表格 | `FixedWidthParser` |
| | `cli-multi-block-parser.js` | CLI 多块定宽表 | `CliMultiBlockParser` |
| | `aligned-table-parser.js` | 定宽对齐表格 | `AlignedTableParser` |
| | `plain-text-parser.js` | 空白分隔文本 | `PlainTextTableParser` |
| | `cli-table-data-parser.js` | CLI table-data 历史格式 | `CliTableDataParser` |
| `transform/` | `joiner.js` | JOIN 执行和依赖安全 | `Joiner` |
| `ui/` | `selection.js` | 预览区域范围选择 | `Select` |
| | `table-builder.js` | 预览表格 DOM 构建（列表头/行表头模式），消费 FilterEngine 输出 | `TableBuilder` |
| | `modal-controller.js` | 通用模态框、焦点与诊断展示 | `ModalController` |
| | `view-manager.js` | JOIN 视图管理 | `ViewManager` |
| | `join-editor.js` | JOIN 编辑器 UI | `JoinEditor` |
| | `source-controller.js` | 源文本、文件/剪贴板浏览器适配、全屏编辑器和输入尺寸控制 | `SourceController` |
| | `cell-edit-controller.js` | 原始表单元格修正、撤销/重做和多行内联编辑 | `CellEditController` |
| | `filter-controller.js` | 列筛选弹窗和交互 | `FilterController` |
| | `tab-controller.js` | 页签创建、激活、排序与重命名 | `TabController` |
| | `keyboard-controller.js` | 全局快捷键 | `KeyboardController` |
| | `export-controller.js` | 导出、工作区备份与配置导入导出 | `ExportController` |
| | `app.js` | 应用编排和 UI，委托过滤给 FilterEngine、表格构建给 TableBuilder | `App` |
| （根） | `bootstrap.js` | 应用启动 | — |

结构性拆分和运行时模块隔离已落地：业务代码通过 `OTA.define()` 声明依赖，`OTA.require()` 按需解析并缓存；`TableRegistry` 为 App 与 JoinEditor 提供共享的解析表访问边界，避免彼此直接依赖。

## 6. 状态与事件设计

Store 是唯一的可持久化状态拥有者。已落地的命令与渲染方向为：

```text
DOM event
  → UI controller / App
  → dispatch(action, payload)
  → Store.transition(action, payload)
  → revision / event / persistence status
  → App.requestRender() / targeted refresh
```

关键命令与边界：

- `source:replace` 更新原文与来源修订号，并清理不再有效的单元格修正；`SourceController` 管理临时粘贴来源快照。
- `App.setImportFormat()` 和 `App.setHeaderMode()` 先清理旧行索引修正，再通过 `import:setFormat`、`import:setHeaderMode` 更新解析选项。
- `App.run()` 调用 `ImportEngine` 获取表、候选和诊断；`parse:completed` 拒绝来源修订号已过期的结果。
- `tab:activate` 切换当前文档；相关 UI 控制器同步输入并清理短生命周期状态。
- `view:upsert`、`view:replaceAll` 等命令更新 JOIN 视图；`workspace:save` 报告存储失败，同时保留内存工作区。

`Store.transition`、`dispatch`、事件通知和修订号已落地，并由 Store、控制器及集成测试保护。后续仅在出现具体跨模块问题时调整命令边界。

## 7. 迁移路线

### 阶段 A：可复现边界 ✅（已完成）

- 在 `main` 分支直接演进。
- 提取 template、styles 和按依赖排序的源模块。
- 增加 `build:release`，使根 `index.html` 可从源完全生成。
- 保持现有测试全部通过。

### 阶段 B：领域模块纯化（所列工作已完成）

- ✅ 将 `FilterEngine` 提取为纯函数模块，无 DOM/storage 依赖，可独立在 Node 中测试。
- ✅ `App.proc()` 从 ~100 行缩减为 7 行委托调用。
- ✅ `TableBuilder` 提取为独立 DOM 构建模块，预览表格渲染逻辑复用。
- ✅ `SourceSnapshot` 接管临时来源元数据和页签/文本匹配；`ImportEngine` 接收显式格式偏好。
- ✅ 剪贴板成对序列化，App 直接调用 `QueryService` 获取预览结果。

### 阶段 C：状态与 UI 控制器拆分（所列工作已完成）

- ✅ 将 `buildColumnHeaderTable` / `buildRowHeaderTable` 从 App 提取到 `TableBuilder`（~130 行 → ~12 行）。
- ✅ 将过滤 token 引擎从 `App.proc()` 提取到 `FilterEngine.processTable()`。
- ✅ `Store.transition` 与 `dispatch` 成为 UI 写入工作区状态的命令边界。
- ✅ 来源、单元格编辑、筛选、页签、键盘、模态框、视图管理和导出行为由对应 UI 控制器负责。

### 阶段 D：浏览器回归和用户流程验证（Chromium 基础流程已落地）

- `e2e/browser-flow.e2e.js` 已覆盖 Chromium 中的粘贴 → 解析 → 筛选 → JOIN → 复制 → XLSX 导出及读回；CI 已配置运行。
- Safari 等跨浏览器剪贴板与下载行为仍需单独验证。
- 保持 25 MB 输入上限、分页和单文件离线边界；不引入 Worker、IndexedDB、虚拟滚动或流式导出。

## 8. 分支与发布策略

当前所有开发直接在 `main` 分支完成。

后续规则：

- 每个阶段以可验证提交直接落到 `main`，由 GitHub Pages 工作流构建并发布。
- 同一人连续演进：直接在 `main` 上提交，每个阶段保持独立可回退。
- 不创建主题分支或 PR；生成的 `index.html` 只由构建脚本更新。
- 回退优先使用 `git revert`；不要用 destructive reset 覆盖已发布变更。
- 发布前运行 `npm run build:release` + `npm test` + `npm run validate:release` + `npm run validate:architecture`。

## 9. 架构风险与决策门槛

- **模块使用轻量 registry 而非 ESM**：保留它以支持 `file://` 单文件发布和零运行时依赖；开发期由架构校验检查模块清单、依赖存在性和加载顺序。只有出现明确且反复的作者体验问题，证明轻量工具不足以支撑已排定能力时，才重新评估 ESM 或更重的构建链。
- **App 仍偏大**：先用测试保护行为，再按用户流程拆 controller；不进行没有回归保护的机械搬迁。
- **主线程计算**：输入有 25 MB 保护和分页；性能 fixture 未证明前不提前引入复杂并发模型。
- **浏览器兼容**：发布脚本保持标准语法；浏览器相关改动运行 Node/静态校验，并在受支持的平台或 CI 运行 Chromium 回归。Safari 等浏览器仍需补充验证。
- **schema 演进**：任何 schema 变化必须增加迁移函数、旧 payload fixture、失败恢复测试和版本说明。

## 10. 当前验收标准

- `src/` 成为唯一业务源目录，`index.html` 可由 `npm run build:release` 重建。
- 构建产物仍只有一个 inline script、一个 inline style，且无网络 API/外链资源。
- 原有解析、复制、Store、JOIN 和 UI 回归全部通过。
- 文档能说明需求、架构选择、模块依赖、分支策略和后续迁移边界。
