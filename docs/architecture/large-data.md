# ADR: 大数据后台计算与异步原文恢复

状态：已实施并验收，2026-10-08。用户在接受有限原文预览、完整分析流程、大原文自动恢复和超过旧上限的数据范围后，明确要求继续实施。本决策扩展既有单文件架构；规划阶段的“不实施”约束不再限制当前交付。

## 依据与选择

[改造前 CI 基线](../planning/ci-large-data-baseline.md)测到 10 万行 × 32 字段的粘贴长任务、分页全表副本与 localStorage 配额失败。[离线机制检查](../../e2e/offline-runtime.e2e.js)已在 [CI Chromium](https://github.com/suimenqx/offline-table-analyzer/actions/runs/37787642664)证明首次断网 file:// 的 Blob Worker、可终止/重建、转移缓冲区及 IndexedDB 大文本事务提交/浏览器重开读回可用；隐私 context 关闭后数据不保留。API 存在不作为恢复保证，失败仍需明确报告。

选择保持一个离线 HTML、OTA registry、零运行时依赖。构建器从明确的纯模块清单生成内嵌 Worker 程序；源码作为固定 Blob 执行，原文始终是消息值。没有导入网络脚本、ESM、WASM、远程数据库或新的应用框架。

## 数据与职责

- SourceController 超过 128 Ki 字符时显示最多 100 行/10,000 字符的只读预览。原生 paste 被拦截，Store 保留完整原文（包括 CRLF）；新的粘贴替换原文，导出原文提供独立文本备份。全屏、保存、页签切换与解析通过 readText 读取完整来源，预览从不成为解析或保存输入。
- BackgroundService 是唯一 Worker 生命周期/版本握手与消息传输拥有者。计算与导出可终止，持久化使用独立队列，不因取消计算而中断事务。错误不触发巨量数据的主线程自动降级。
- WorkerRuntime 管理后台会话中的完整规范化数据、过滤/关联与 XLSX。23.1 起完整表只保留在 Worker；Window 收到 rows 为空、带 rowCount/列样例的表描述信息及当前页记录。原文仍由 Store 持有；并非外存数据库，Worker 和 XLSX 的容量仍受预算限制。
- 查询仅返回当前可见页的单元格、原始记录索引、投影列及高亮，最多为选择的 50/100/250/500 行；大数据单表模式的其他表仅返回描述信息。TableRegistry 持有当前页编辑记录，跨页撤销/重做更新 Store 覆盖层。QueryService 只缓存两个完整结果，失效键包含来源、规则、关联配置与修正，页码/一般 UI revision 不失效完整查询。原始表单元格仍为字符串，修正保留覆盖层与撤销/重做。
- HTML 的 DOMParser 分支保留既有 Window 路径；本轮主要容量验收针对 table-data 与纯文本解析器，不宣称巨大 HTML 已后台化。大原文即使解析失败也保留。
- Store 继续是工作区唯一权威。schema 21 的小设置存入 ota_v21_workspace；大原文快照由 WorkspaceStorage 在 IndexedDB 原子提交，配置引用提交后的 generation。加载精确对应快照，缺失或失败时阻止自动覆盖；最新小设置保持权威，原文未变化时复用同一快照；关闭时保存仍在途会提示，完成状态才表示已提交。旧 ota_v20_workspace/v16_4_store 仅在新存储成功后删除。
- 临时模式在复制/序列化前去掉 raw，避免先 JSON 复制巨量文本。切换/清理使在途保存 generation 失效，旧异步保存不能重新写回原文引用；后台清理失败可见。清理尚未结束时关闭会提示；重新打开已提交的小存档会重试删除无引用的旧原文快照。备份格式继续包含完整原文，可迁移导入 schema 20 的备份。原文导出可在后台任务失败后独立使用。

## 初始资源预算

2026-10-09 审核修复决策：IndexedDB 原文直接保存 JavaScript 字符串，以结构化克隆保留所有 UTF-16 码元，避免 Blob 的 UTF-8 转码改变未配对代理字符。schema 21、存储键和事务提交顺序不变；兼容旧 UTF-8 Blob 快照，解码时保留 BOM。旧写入已替换的代理字符无法从已损坏快照还原。新快照只包含 schema、提交时间及每个文档的 id/sourceRevision/raw；旧完整快照的附带 UI 不参与恢复校验，最新小设置仍是修正和规则的权威。原文大小、文档身份和版本仍校验，外部工作区导入安全约束保持有效。

Store 的当前保存 generation 独占保存/清理状态，提前失败也结束已失效任务的状态。快照清理在途与失败均可见；失败后复用原文的下一次保存会重试，已经成功清理的同一快照不因一般设置或修正保存而重复清理。ImportEngine 判断明确格式、剪贴板实际表格与文本 HTML 特征是否需要 DOMParser；仅附带非表格 HTML 的大文本仍走 Worker，手动文本格式优先。Window 和 Worker 的 Excel 列投影统一使用 TableUtils.projectColumns，保留选择顺序、跳过不存在的列，并在无有效选择时回退全部列。

22.1.2 补充：所有 Excel 按钮都先由 App 准备当前原文，复用已完成或正在进行的同源解析，随后由 ExportController 生成并下载。粘贴后可直接点击“全量 Excel”，默认自动识别格式；手动格式、表头和导出选项保持有效。下载前检查页签、原文版本、原文/HTML、解析选项与取消状态，过期结果不会下载。此准备回调与待完成解析只在当前会话存在，schema 21 和离线交付方式不变。

这些是有明确失败行为的实现保护上限，不是所有浏览器都能达到的容量保证，后续通过同样的 CI 样本校准：单份原文 UTF-16 估算 128 MiB；工作区原文估算 256 MiB；解析/关联/导出 800 万单元格；JOIN 100 万行；XLSX ZIP 256 MiB。超限明确报错，不静默截断，保留原文。使用对象数组与原生字符串，没有加入 Arrow/SQL/虚拟滚动或外存查询。

## 验证

Node 回归覆盖预览不改变原文、分页缓存/修正、Worker 会话与传输、预算、异步快照提交/竞态/恢复/旧版本迁移。真实 Chromium 覆盖 file://、原生粘贴、取消/重试、切换来源、修正/筛选、JOIN、导出独立读回、保存与浏览器重开；性能工作流与改造前相同的 10 万行 × 32 字段样本对照。发布与架构校验继续拒绝网络、越过 Store 的 UI 写入、不完整 manifest；新能力只允许在指定模块拥有，Worker 包额外排除 UI/Store/递归传输模块。


## 开发主机限制

2026-10-08 Termux 本地 Node 26.4.0 验证通过；Playwright 在 Android 报 Unsupported platform，不能据此称 Chromium 通过。尝试桌面 Firefox/WebDriver 时 libxul.so 缺少系统 libc++ 的 `_ZNSt6__ndk113__hash_memoryEPKvm` 符号而退出，故本轮 Firefox 未执行成功。桌面 Chromium 正确性/性能以 CI 为准。


## 发布构建与旧修正键

真实浏览器验收发现原有构建器将源码字符串直接用作 String.replace 的替换值，$$ 被解读为替换语法，导致 Window/Worker 发布代码与源码修正键不一致。22.1.1 改为回调返回原始字符串，并以完整 Worker 字节比对防止再次改写。已发布 21.x–22.1.0 工作区的修正键迁移为 `$` 加表名，记录 `cellEditKeyEncoding: dollar-v1` 保证幂等；原文与修正值保留。


[最终结果与回归门槛](../planning/large-data-performance-results.md)：380 项 Node、8 项 Chromium 流程（含真实十万行重开恢复）和六项性能样本通过。最长主线程任务 134 ms、心跳延迟 239.2 ms；500 ms 初始 CI 回归线检测秒级退化，端到端后台完成时间另行记录。

## 23.1: 有预算的识别与 Worker 数据所有权

用户明确授权两个阶段端到端实施。保留现有 OTA、单 HTML、零运行时依赖及 schema 21；描述信息与页缓存只存在当前会话，不写入工作区。未改变 IndexedDB 原文格式、旧版本恢复或持久化字段。

ImportEngine 新增 detect 边界：手动格式、实际剪贴板 HTML、明确 JSON/CLI 标记直接选择；其他格式只对有限样本试解析，候选表立即归约为评分证据。样本逐级扩大为 16,384/65,536/262,144 UTF-16 码元及 64/256/512 条记录，识别双引号转义与嵌入换行。预算内仍歧义的大输入保留原文、展示候选并等待手动选择；兼容的记忆格式保持旧行为。FormatSniffer 忽略采样截断行，避免宽 CSV 分隔符方差被半行扰乱。最终仅选中适配器获得全量文本，失败传播，不通过其他全量试解析绕过资源预算。

CSV/TSV 通过 Delimited.records 增量生成记录，HeaderResolver.fromRecords 保留一份归一化矩阵；CLI 通过 TableUtils.iterLines 避免全量 split 行列表。完整解析和查询仍需要 Worker 内存，JOIN 和 XLSX 尚未外存化/流式输出。

QueryService 的 Worker 查询缓存不包含页码，Window 页缓存包含页码/大小/预览表/折叠状态，最多各两项。完整结果、JOIN 和 XLSX 保持后台；Window 仅持有描述信息、当前页与有限诊断。诊断完整数量可见，详情最多 200 项。列样例最多扫描首 1000 行，每列最多返回 128 码元，过长样例标记未知类型。

HTML DOMParser 仍保留 Window 路径。本次不增加网络、WASM、SQL 引擎或外存存储策略。新增 Chromium CSV 十万行读回/跨页编辑/撤销/复制/筛选流程及混合标点、引号多行 CSV 性能样本；旧 CLI 样本继续测量，完整记录首尾校验改由独立 XLSX 读回承担，同时断言 Window 完整表行数为零。500 ms 是初始退化门槛，不等于逐帧流畅保证。

[23.1 实测结果](../planning/large-data-23.1-results.md)：420 项 Node、13 项 Chromium 流程和八组十万行性能样本全部通过。主线程最长任务 132 ms，最大心跳延迟 243.6 ms；短字段样本解析后 Window V8 堆中位数从 23.0 的 102.2 MiB 降至 14.7 MiB。完整报告及比较基线已归档，Worker 内存不包含在该堆指标中。
