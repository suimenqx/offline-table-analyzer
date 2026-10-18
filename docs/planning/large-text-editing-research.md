# 浏览器大文本编辑平台事实调研

调研日期：2026-10-18。本文只记录一手来源事实、测量与适用性判断，供「编辑形态决策」（issue #9）使用；不代表已经批准任何内嵌编辑器、依赖变更或新的编辑架构。不改变现有架构决策、工作区 schema 与发布边界。

## 结论与适用范围

问题场景：桌面浏览器中，对 10 万行 × 30 字段量级的文本（本仓库短字段样本约 23.38 MiB，平均 10 字符/格约 67 MiB，UTF-16 `length * 2` 口径）做「正常编辑」——键入、光标、选择、IME、撤销可用且页面可响应。

一手来源事实汇总：

- 引擎层面允许这个量级：V8 的 `String::kMaxLength` 在 64 位为 2^29 − 24 ≈ 536.87M UTF-16 码元，23–67 MiB 的字符串合法。
- 但**没有任何官方文档对原生 textarea 在此量级的编辑性能做承诺**：MDN 只说明 `maxlength` 默认无限制，不涉及大文本布局/回写成本；本仓库已有测量证明该量级的粘贴与解析链路会卡顿（见 [browser-large-data-research.md](browser-large-data-research.md)）。
- 虚拟化全文编辑器是业界对该问题的标准答案：CodeMirror 官方指南明确「不渲染整个文档，只渲染可见区 + 边距」（viewport），文档用不可变树状结构存储，本地编辑便宜；Monaco 同路线但官方 FAQ 明确其 worker 在 `file://` 下不可用。
- 网格类产品走另一条路：AG Grid 官方文档声明只渲染可见行列，单元格编辑器在编辑开始时才创建——这是「结构化编辑」（分页定位 + 按需编辑器 + 数据覆盖层）的对照模型。
- **不存在公认的跨场景最佳实践**：官方材料呈现的都是按场景取舍（viewport 编辑器 vs DOM 虚拟化网格），且各有明确限制（长行、折叠、file:// worker、包体积）。

对本项目的工程判断：在「单 HTML、零运行时依赖、file:// 首次离线可用、原文不变 + 修正覆盖层」约束下，两条候选路线都有明确的一手事实支撑，取舍应发生在「编辑形态决策」票，而非本调研。

## 一、原生 textarea 的引擎边界与文档现状

### 引擎硬顶

V8 源码（main 分支 `include/v8-primitive.h`）定义：

```cpp
static constexpr int kMaxLength =
    internal::kApiSystemPointerSize == 4 ? (1 << 28) - 16 : (1 << 29) - 24;
```

即 64 位下单个字符串最长 2^29 − 24 = 536,870,888 个 UTF-16 码元（约 1 GiB UTF-16 字节口径）；32 位下 2^28 − 16 = 268,435,440；`V8_LOWER_LIMITS_MODE` 编译配置下仅 1 MiB。来源：[v8-primitive.h](https://chromium.googlesource.com/v8/v8/+/refs/heads/main/include/v8-primitive.h)（kMaxLength 定义）；`src/objects/string.h` 中 `String::kMaxLength = v8::String::kMaxLength` 沿用同一常量（[string.h](https://chromium.googlesource.com/v8/v8/+/refs/heads/main/src/objects/string.h)）。

结论：23–67 MiB 的文档在引擎层面**合法且远低于硬顶**，textarea 的 `value` 赋值/读取不因长度本身被引擎拒绝。

### 标准与文档承诺

MDN `<textarea>` 文档：`maxlength` 为「用户可输入的最大字符串长度（按 UTF-16 码元计）」，未指定时**无限制**；文档不含大文本编辑的性能承诺、建议上限或降级说明。来源：[MDN textarea](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/textarea)。

也就是说：**没有文档级的「textarea 编辑上限」**；已知的悬崖（逐键布局、value 回写、选区/IME 在大文本上的主线程成本）在官方材料中没有定量描述。本仓库的既有测量只覆盖了粘贴与解析链路（见 [browser-large-data-research.md](browser-large-data-research.md) 的「已知项目证据与测量边界」），**未覆盖键入/光标/IME 编辑本身**——这一点留给「编辑验收基线」票在 CI 样本上实测。

## 二、虚拟化全文编辑器：CodeMirror 6 与 Monaco

### CodeMirror 6：viewport 与不可变文档树

官方 System Guide 的核心陈述（[CodeMirror System Guide](https://codemirror.net/docs/guide/)，「The Viewport」一节）：

> CodeMirror doesn't render the entire document, when that document is big. To keep the editor responsive and resource use low, it will, when updating, detect which part of the content is currently visible (not scrolled out of view), and only render that plus a margin around it. This is called the viewport.

同节明确其边界：编辑器为**整个文档**追踪高度信息（先估算、绘制后实测），「长行（不换行时）或大块折叠代码仍可能让 viewport 巨大」；视口外坐标查询不可用。这直接提示：**表格原文的极长行（每行 30 字段的单行 CSV 可达数百 KB）正是 CodeMirror 明确点名的风险形态**。

数据结构（[Reference Manual](https://codemirror.net/docs/ref/)，`Text` 类）：文档是**不可变**的树状结构（`children` 属性持有分支节点组成的子树），`replace`/`slice`/`append` 返回新 `Text`；System Guide「Functional Core, Imperative Shell」一节声明状态严格函数式。这使大文档上的局部编辑（单格替换）无需复制全文档。

更新机制（System Guide「Update Cycle」）：事务派发时只写 DOM 不读布局；读布局（viewport 校验、光标滚动）在独立 measure 阶段经 `requestAnimationFrame` 调度。这是其交互响应性的结构保证，与 50 ms 长任务预算的验证方式兼容。

### CodeMirror 的引入成本（实测）

npm registry 一手数据（2026-10-18 实测 `dist.tarball` 下载字节；unpacked 为解包字节）：

| 包 | 版本 | tarball | unpacked |
| --- | --- | --- | --- |
| @codemirror/state | 6.7.6 | 108,828 | 440,367 |
| @codemirror/view | 6.43.14 | 314,705 | 1,261,210 |
| @codemirror/language | 6.13.1 | 77,933 | 291,304 |
| @codemirror/commands | 6.11.1 | 50,461 | 246,640 |
| 合计（4 核心包） | — | ≈ 552 KB | ≈ 2.25 MB |

来源：[npm registry](https://registry.npmjs.org/@codemirror/state/latest) 等四个包的 `latest` 元数据。tarball 含 README/CHANGELOG，最小化后 JS 更小，但作为「内嵌进单 HTML 的体量」量级参考：**核心四包 tarball 约 550 KB**，尚未计入 basic-setup、语法扩展、样式与主题。

Reference Manual 明确其分发形态：「You'll have to use some kind of bundler or loader to run them in the browser」——即内嵌需要构建期打包步骤（本仓库已有 build-release.cjs 管线，但打包第三方 ESM 仍是新的构建边界决策）。

### Monaco：同路线，但 file:// 有明确限制

Monaco 官方 README 声明其 worker 限制（[monaco-editor 仓库](https://github.com/microsoft/monaco-editor)，FAQ）：

> HTML5 does not allow pages loaded on `file://` to create web workers. Please load the editor with a web server on `http://` or `https://` schemes.

本产品以 file:// 首次离线可用为验收条件（[offline-runtime E2E](../../e2e/offline-runtime.e2e.js)）。本仓库的内嵌 Blob Worker 已证明 file:// 下 Worker 可用，但 Monaco 的 worker 加载模式默认不兼容 file://，需要专门适配（且其编辑器本体由 VS Code 源码生成，体积与构建复杂度高于 CodeMirror）。README 同时确认语言服务通过 web worker 承担重计算（[README](https://github.com/microsoft/monaco-editor)）。

## 三、结构化编辑的对照模型：AG Grid 与本仓库现状

AG Grid 官方文档（[DOM Virtualisation](https://www.ag-grid.com/javascript-data-grid/dom-virtualisation/)）声明其只渲染可见行列，滚动时回收不可见 DOM——即「数据在内存、DOM 只有视口」。其 [Cell Editing](https://www.ag-grid.com/javascript-data-grid/cell-editing/) 文档的模型是：单元格编辑器仅在编辑开始时创建、结束后销毁，一次只有一个活动编辑器。

这正是本仓库「结构化编辑」候选形态的对照：**全量数据留在 Worker，DOM 只有当前页；编辑按需挂载单一编辑器，结果写入覆盖层**。本仓库 23.1 起已具备该骨架：Window 只持有当前页记录（`TableRegistry`），单元格修正走覆盖层（`cell-edit-controller`），Worker 拥有完整规范化数据（[large-data ADR](../architecture/large-data.md)）。缺的是「全表范围定位与批量编辑」而非渲染模型。

## 四、是否存在「最佳实践」

一手材料给出的不是单一最佳实践，而是按场景取舍的三条路线：

1. **虚拟化全文编辑器**（CodeMirror/Monaco）：适合代码/文本的自由光标编辑；代价是内嵌体积与构建边界、极长行风险（CodeMirror 官方点名）、file:// worker 适配（Monaco 官方点名）。
2. **DOM 虚拟化网格 + 按需编辑器**（AG Grid）：适合表格式数据；代价是放弃「一个文本区装下全部」的自由编辑语义。
3. **受控输入 + Worker 数据集 + 当前页传输**（本仓库 [browser-large-data-research.md](browser-large-data-research.md) 结论）：输入侧有界预览、计算后台化、编辑走覆盖层。

官方材料均未承诺「任意大文档的流畅编辑」：CodeMirror 指南明确长行/折叠可使 viewport 巨大；MDN 无任何 textarea 性能承诺；Monaco 限定 web worker 的部署形态。**「10 万行 × 30 字段的原文能否在一个编辑器里流畅编辑」没有一手来源给出肯定答复**——这是「编辑形态决策」票必须以本仓库 CI 样本实测为前提做取舍的原因。

## 对「编辑形态决策」的事实输入（逐条可溯源）

1. 23–67 MiB 文档在 V8 层面合法，硬顶为 2^29 − 24 码元（64 位）。[v8-primitive.h](https://chromium.googlesource.com/v8/v8/+/refs/heads/main/include/v8-primitive.h)
2. textarea 无文档化编辑上限，也无文档化性能保证；大文本编辑性能必须自测。[MDN textarea](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/textarea)
3. CodeMirror 6 用 viewport 只渲染可见区，但官方点名「长行」是其风险形态——表格原文的整行即超长行。[CodeMirror System Guide](https://codemirror.net/docs/guide/)
4. CodeMirror 文档为不可变树，局部编辑便宜；内嵌需 bundler 步骤，核心四包 tarball 实测约 552 KB。[Reference Manual](https://codemirror.net/docs/ref/)、[npm registry](https://registry.npmjs.org/)
5. Monaco 官方 FAQ：file:// 下其 web worker 不可用，与本产品首次离线 file:// 验收冲突。[monaco-editor README](https://github.com/microsoft/monaco-editor)
6. AG Grid 只渲染可见行列、编辑器按需创建/销毁——结构化编辑的对照模型。[AG Grid DOM Virtualisation](https://www.ag-grid.com/javascript-data-grid/dom-virtualisation/)、[Cell Editing](https://www.ag-grid.com/javascript-data-grid/cell-editing/)
7. 本仓库已具备结构化编辑骨架（Worker 全表 + 当前页 + 修正覆盖层），缺全表定位与批量编辑。[large-data ADR](../architecture/large-data.md)
