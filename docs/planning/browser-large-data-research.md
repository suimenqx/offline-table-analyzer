# 浏览器大表格处理方案调研

调研日期：2026-10-08。本文只记录方案、依据与建议，不代表已经批准或实施 Worker、IndexedDB、WASM、流式导出或新的容量上限；不改变现有架构决策、工作区 schema 与发布边界。

## 结论与适用范围

问题场景是桌面浏览器粘贴 CLI `table-data`，10 万行以上、每行 30 多字段，并且刚粘贴就失去响应。10 万行不是浏览器统一的硬上限；行数、字段长度、数据表示、临时副本、查询中间结果和 DOM 都会影响可承载规模。

结合本项目必须保持单个 `index.html`、离线、零运行时依赖、原文不变与修正覆盖层的约束，建议优先采用：**受控的大文本输入 + Worker 内的数据集与查询 + 行索引结果 + 当前页数据传输 + 有预算的缓存**。这是针对本项目的工程判断，不是跨所有产品的统一最佳方案。单独更换表格组件或增加 `worker: true` 无法覆盖当前粘贴链路的全部问题。

如果未来目标扩展到复杂 SQL、聚合、排序、大 JOIN 和 Parquet，DuckDB-Wasm + Arrow 是值得验证的业界方案；若要求处理明显超过浏览器内存预算的数据，应评估本地原生分析引擎或服务器方案。它们分别改变当前依赖/交付模型或离线隐私边界，属于后续独立决策。

## 已知项目证据与测量边界

- `SourceController` 超过约 1 MiB 暂停自动解析；普通粘贴仍允许浏览器把完整内容插入编辑器，随后更新 Store 和触发保存。25 MiB 文本检查发生在 `App.run()`；文件入口另有提前检查。见 [SourceController](../../src/ui/source-controller.js)、[App](../../src/ui/app.js)。
- 剪贴板捕获保留完整纯文本与 HTML，原文匹配会规范化文本；Store 保存先 JSON 复制整个工作区，再根据 `persistRaw` 排除原文；查询缓存包含整体状态修订，并保存加工后的全量结果。见 [SourceSnapshot](../../src/core/source-snapshot.js)、[Store](../../src/state/store.js)、[QueryService](../../src/core/query-service.js)。
- 本次会话此前的 Termux Node 临时测量：10 万行 × 32 字段的短字段样本，原文按现有 `length * 2` 口径约 23.38 MiB；解析约 3.165 秒，其中规范化约 2.247 秒；首次查询约 177 毫秒；定时回调延迟约 3.347 秒；解析与查询后堆约 215.4 MiB，新增一个缓存查询后约 313.9 MiB。这些是该样本的模块测量，不是桌面浏览器成绩或容量保证。
- `length * 2` 是项目的保守字符串大小估算，不是输入文件的 UTF-8 字节数，也不是引擎实际堆占用。此前估算的 10 万行 × 32 字段 × 平均 10 字符约 67.14 MiB，已经超过当前输入限制；提高限制必须先验证内存与失败恢复。
- 尚未通过真实桌面浏览器完整复现标签页内存崩溃，不能把模块耗时直接等同于用户机器上的崩溃根因。必须测量原生粘贴、事件处理、编辑器布局、保存和解析各阶段。

## 业界方案分别解决什么

| 方案 | 主要作用 | 不会自动解决的部分 | 对本项目的判断 |
| --- | --- | --- | --- |
| Worker + 分块解析 | 主线程可响应；降低解析临时数据峰值 | 默认文本框粘贴、同步保存、全量结果复制 | 第一优先方向，复用现有解析器 |
| 分页 / 行列虚拟化 | 限制 DOM 与绘制成本 | 剪贴板读取、全量解析、查询内存 | 当前分页继续保留；按瓶颈决定虚拟化 |
| Arrow / 紧凑列式表示 | 批处理、连续缓冲区、互操作 | CLI 语法解析、输入卡顿、所有算子的内存 | 先用行索引；再按测量引入更紧凑表示 |
| DuckDB-Wasm | 成熟浏览器内 SQL 分析与查询引擎 | 原生粘贴、CLI 格式转换、内存上限 | 复杂分析方向的对照原型，不直接替换当前版本 |
| IndexedDB / OPFS | 大数据持久化或分块存储 | 任意查询与 JOIN、所有计算加速 | 有恢复或外存需求后再引入 |
| 本地原生引擎 / 服务器分页 | 更大数据集、成熟数据库算子与外存 | 当前单 HTML / 无服务器交付约束 | 超出当前产品边界，作为更大规模选项 |

### Papa Parse：参考其管线，不直接替换 CLI 解析器

Papa Parse 官方提供 CSV 文件流式解析、Worker 和逐行/逐块回调。官方明确提醒：Worker 能保持页面响应，但可能稍慢；`chunk` 针对本地或远程文件；内置 Worker 模式支持中止，不支持 `pause()` / `resume()`。因此不能仅根据存在 `worker`、`chunk` 参数就推断已有可控制的背压。它也不是本项目 CLI `table-data` 的语法适配器。[Papa Parse 配置文档](https://www.papaparse.com/docs)

官方 FAQ 说明，在 Worker 中解析字符串仍需先把字符串送入 Worker，发送结果也有成本。Worker 和流式处理解决的是不同问题：前者隔离计算，后者避免一次读入/处理中间数据；如果回调把所有行不断积累成数组，最终数据仍全部占用内存。建议借鉴批量解析和批次消费，而不是逐行向主线程发送 10 万条消息。[Papa Parse FAQ](https://www.papaparse.com/faq)

### AG Grid：DOM 虚拟化与数据查询是两个边界

AG Grid 的行列虚拟化只创建可见区域附近的 DOM，并随滚动移除不可见节点。它优化渲染，不代表数据已经从内存移除，也不负责修复输入与解析路径。项目已经只构建当前页 DOM，因此在“刚粘贴就卡”的场景中替换 Grid 不是优先项。[AG Grid DOM Virtualisation](https://www.ag-grid.com/javascript-data-grid/dom-virtualisation/)

AG Grid 的 Infinite Row Model 通过 datasource 按块请求行；当它没有全量数据时，排序和筛选由数据源负责。可以借鉴这个接口，让本地 Worker 承担数据源角色，界面只请求当前页或视口；无需引入该组件。此处“把 Worker 当数据源”是本项目设计推论。[AG Grid Infinite Row Model](https://www.ag-grid.com/javascript-data-grid/infinite-scrolling/)

### DuckDB-Wasm + Arrow：分析能力强，但有真实部署成本

DuckDB-Wasm 将 SQL 分析引擎运行在浏览器中。官方当前文档说明它默认单线程，多线程仍为实验能力；当前客户端可用 WASM 内存最高 4 GB，浏览器可能限制得更低。这里的 4 GB 是当前 DuckDB-Wasm 客户端约束，不是所有浏览器标签页的统一上限。[DuckDB-Wasm Overview](https://duckdb.org/docs/current/clients/wasm/overview)

其导入接口覆盖 Arrow、CSV、JSON 和 Parquet。对本项目 `table-data`，仍需要已有解析器先处理表名、字段、`validflag` 与诊断，再适配引擎；不能假设数据库直接识别该 CLI 格式。迁移也要保留字符串 ID、空白、缺失值、源行定位与修正语义。[DuckDB-Wasm Import Data](https://duckdb.org/docs/current/clients/wasm/data_ingestion)

官方查询接口的 `query()` 会物化完整结果，`send()` 按 Arrow record batch 获取结果。页面应按需获取列与页面，导出按批消费；把整张 Arrow 表转换成 JavaScript 对象数组，会重新引入全量对象分配。流式返回不保证排序、JOIN、聚合等所有算子的内部工作内存有界，这是应测量的工程限制。[DuckDB-Wasm Run Queries](https://duckdb.org/docs/current/clients/wasm/query)

部署需要 JavaScript 主库、Worker、WASM 与所用扩展；常规示例会加载这些资源。多线程 `coi` 包依赖 SharedArrayBuffer 与 COOP/COEP HTTP 响应头，普通直接打开 `file://` HTML 不能照搬这种部署。可以研究单线程离线打包，但需专门处理资源封装、初始化、体积、扩展加载和零网络验证；即便全部内嵌，仍是引入运行时引擎依赖。[DuckDB-Wasm Deploy](https://duckdb.org/docs/current/clients/wasm/deploying_duckdb_wasm)

官方仓库还指出，WASM 的外存运算和文件系统支持不能直接等同原生 DuckDB；部分扩展会在运行时自动获取。不能因原生 DuckDB 支持大于内存的数据，就承诺浏览器版本具备相同能力，也不能将在线演示的缓存后离线使用等同单文件首次离线可用。[DuckDB-Wasm 官方仓库](https://github.com/duckdb/duckdb-wasm)

Arrow 的列式布局适合连续扫描与批处理，并能用值缓冲区、偏移、有效位图和字典等表示数据。它是数据表示与交换规范，不是独立查询引擎；对任意字符串表格，转换本身也有成本。是否采用整套 Arrow，应以过滤/JOIN收益和发布成本比较决定。[Apache Arrow Columnar Format](https://arrow.apache.org/docs/format/Columnar.html)

## 推荐管线与最佳实践

### 1. 先修粘贴入口，区分粘贴与文件流

在大文本粘贴入口接管默认插入，每种必要 MIME 只读取一次，复用同一份捕获结果；大文本保留完整原文，但编辑器先显示有界预览，完整编辑需独立设计。大小检查在写入编辑器/Store 与安排保存前进行，拒绝时保留旧数据并解释原因。小文本继续保留正常编辑、光标和插入行为。[MDN paste event](https://developer.mozilla.org/en-US/docs/Web/API/Element/paste_event)

`clipboardData.getData('text/plain')` 返回的是完整字符串，不是可逐段读取的流。因此接管默认插入仍无法消除浏览器/系统提供剪贴板内容的初始成本，也不能把先拿到整串、再分块解析描述成流式剪贴板读取。[MDN DataTransfer.getData](https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/getData)

本地文件则可以把 File 交给 Worker，在其中通过 `Blob.stream()` 分块读字节；结合增量解码和保留跨块记录状态，避免先 `readAsText()` 整文件再 `split()`。这能降低输入处理峰值，但最终保留所有解析结果时仍需要全量数据内存。[MDN Blob.stream](https://developer.mozilla.org/en-US/docs/Web/API/Blob/stream)

若数据来源允许，应优先导出 CSV/TSV 文件，再导入；它比终端为人阅读的定宽 `table-data` 更容易流式解析。CSV 多行引号记录必须使用有状态解析器，不能把每个物理换行都当成记录；这也是保留现有引用感知语义的要求。

### 2. 一个数据集所有者，数据计算与 UI 分离

建议由 Worker 持有解析数据、查询索引与可重建缓存，主线程只管理 UI 和 Store 命令。Store 继续拥有持久化工作区、原文策略与修正覆盖层；不要因此引入 UI 写 Store 私有状态。消息包含文档 ID、来源修订、数据集版本、查询 ID，旧结果不能覆盖新数据。后台计算不直接访问 DOM。[MDN Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)

不得每次查询都跨线程来回发送全表；常规预览只返回当前页与统计。已有二进制数据可通过 transferable ArrayBuffer 转移所有权，转移后发送方缓冲区被分离。普通字符串/对象数组不能据此宣称零复制；先将巨型字符串在主线程编码成字节也有计算与额外缓冲区成本。[MDN Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)

第一版适合单个数据 Worker，避免多 Worker 各保留整表；增加并行度需先证实收益高于分区、合并和内存成本。内嵌 Blob Worker 可以作为零外部资源方向验证，但必须覆盖 `file://`、桌面 Chrome/Firefox/Safari、启动失败与回退；更新构建/加载边界需 ADR 和现有架构校验。

### 3. 分块要配合背压与有界结果

读入、解析、查询、序列化采用批次；消费完成后再读下一批，设置待处理批次数/字节上限。背压是生产速度超过消费速度时限制生产的机制；只有“每隔若干行回调一次”没有这种保证。[MDN Streams API concepts](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Concepts)

解析期间不要反复全表复制、重复清理每个单元格；诊断样本和预览有上限，但保留完整错误数量。跨块正确处理换行、引号、转义、多表边界与定宽列证据。先提供可用预览，再完成扫描；未知总行数时先报告已处理字节/行，不伪造完成百分比。

Worker 若在一个同步循环内处理数秒，也不能及时接收取消消息。每批让出 Worker 事件循环，并检查任务版本与取消状态；必要时终止 Worker，丢弃该任务并恢复仍有效的数据。进度按固定节奏合并更新，避免每行消息淹没主线程。

### 4. 查询存索引，不存重复全表

保留一个稳定数据集，筛选结果主要保存原行号；列投影、亮显定位与修正合并在当前页生成。10 万个 Uint32 行号约 0.38 MiB（100,000 × 4 字节），仅是行号数组的理论大小，不包括统计、亮显、JOIN 和其他对象。

这仍然是内存内数据集：保留全部 N 行、C 列字符串时，总驻留数据随 N × C 增长。Worker、分页和批次背压限制的是 UI、消息或中间队列，不能把完整驻留数据变成常量内存。若超过内存预算，需要分块外存或按需解码的另一套数据表示；排序、聚合和 JOIN 的工作集还要独立预算。

过滤表达式、正则和列索引先编译，再扫描；显示页码、折叠、预览方向变化不应让相同过滤结果失效。缓存同时限制条目数与估算字节数，并在数据替换、页签关闭和任务结束时释放不再需要的原文副本、行数组、缓冲区与 Object URL。

表格渲染仍取当前页；若未来产品需要连续滚动再加行/列虚拟化。无筛选翻页不应重复扫描全部行。JOIN 结果可能因重复键形成巨大笛卡尔式展开，要预算结果量、提供可取消执行，并可采用行对索引/按页投影；不能把 10 万源行限制当作 JOIN 结果限制。

### 5. 大原文与小设置分开保存

Web Storage 的读写是同步的，适合小设置；对大文本即使延迟 320 毫秒也只是推迟阻塞，不会把保存变成异步。关闭原文持久化时，应该在序列化前排除它；翻页等 UI 小变更不应重新复制并保存巨型原文。[MDN Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)

需要恢复大原文时，IndexedDB 提供异步事务，并可在 Worker 使用；仍需控制写入批次与克隆成本。它提供持久化和索引访问，不会自动获得任意 contains/正则/JOIN 的高效分析引擎。[MDN IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

引入 IndexedDB/OPFS 需先验证桌面浏览器、直接 `file://` 打开、隐私模式与存储失败的行为，设计 schema 迁移和旧工作区回读，并保留内存可用及手动备份。它们不是首轮必须依赖；先控制内存与同步原文保存。

### 6. 导出也必须有资源预算

在 Worker 分批生成导出内容，避免先创建完整 JOIN/筛选副本、再创建全量 XML、再创建 ZIP；保留 raw/full/preview 与字符串精度语义。分批构建只降低中间峰值，若最终全部合并成一个下载 Blob，仍需要容纳输出。流式写磁盘是另一个交付能力，需浏览器兼容和单文件回退设计，不能用“后台导出”承诺无限规模。

## 验证指标与实施顺序建议

性能验收必须分别测 **响应性、吞吐量、内存/存储**。长任务阈值为超过 50 毫秒；良好 INP 参考值为不超过 200 毫秒，网站总体判定通常看真实访问的第 75 百分位（p75）。它们用于衡量交互，不意味着 320 万单元格必须在 200 毫秒内解析完，也不能把完整粘贴处理时长直接叫作 INP。[web.dev Long Tasks](https://web.dev/articles/optimize-long-tasks)、[web.dev INP](https://web.dev/articles/inp)

本项目不引入线上遥测；在本地实验中另行报告粘贴到反馈、翻页、取消的中位数与 p95，以及最长主线程任务、总解析耗时和峰值内存。p95 是建议的实验汇总口径，并不是 Core Web Vitals 的 p75 门槛。具体毫秒和内存验收预算应在指定硬件、浏览器与代表样本的基线后确定，本文不承诺未经测量的“秒开”或某个提升倍数。

建议在固定桌面 Chrome/Firefox/Safari 与硬件配置上，使用 10 万行 × 32 字段的短文本、长字符串、中文/emoji、CRLF、混合空值、多表和异常宽度样本，分别检查：

- 原文完整、计数正确、筛选与 JOIN 一致、修正和导出可回读。
- 粘贴处理、编辑器更新、自动保存、识别、解析、规范化、查询、DOM、导出各阶段耗时。
- 页码切换无全表副本；连续筛选/反复导入/关闭页签后内存不持续累积。
- 进度可感知、取消与页签切换有效；旧任务结果不能污染新任务。
- 超限、Worker 启动失败、存储满和导出失败均有可理解反馈，并保留可恢复数据。
- 首次打开且完全断网，运行期间没有任何外部请求；单文件产物和架构校验仍通过。

建议顺序：**先建立真实粘贴基线并修输入/保存重复开销 → Worker 数据集 + 行索引查询 → 按结果评估紧凑存储/流式导出 → 对复杂分析用相同样本对照 DuckDB-Wasm**。每一步比较正确性、端到端总耗时、最长阻塞、峰值内存和发布复杂度；不根据不同硬件、数据和预热状态的宣传吞吐量直接承诺速度。

Worker、IndexedDB、虚拟滚动和流式导出当前被 [Roadmap](roadmap.md) 列为延后架构。落实任何相关提议前，需要把经过验证的决定与兼容性边界记录到 [Architecture](../architecture/architecture.md) / [Refactor architecture](../architecture/refactor.md)，并继续遵守 [Refactor requirements](refactor-requirements.md) 的离线、单文件与数据完整性要求。
