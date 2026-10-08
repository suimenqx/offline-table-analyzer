# 单文件离线 Worker 与异步原文存储事实调查

调查日期：2026-10-08。范围：Wayfinder《单文件后台计算与异步原文存储是否可行》。本文关闭事实调查，不批准架构、存储技术、容量、交互或持久化合同变更；未运行浏览器探针、原型或耗时基准。

已确认用户条件：桌面 Chrome、整机 32 GB 内存；大原文接受有限预览；覆盖导入、解析、筛选、翻页、JOIN、导出；需要自动恢复；超过当前约 25 MiB 的输入纳入规划，具体预算等待实测。整机内存不等于标签页可用堆或磁盘存储配额。

## 核心结论

一个 HTML 可以携带后台脚本，通过页面创建的 Blob URL 启动专用 Worker，无需外部脚本或网络；这是有官方示例和规范依据的候选路径。它仍需在目标 Chrome 的真实 `file://`、首次断网打开及失败场景下验证，不能把调查结论标为浏览器验收通过。[MDN 内嵌 Worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#embedded_workers)、[HTML Worker 创建规则](https://html.spec.whatwg.org/multipage/workers.html#dom-worker)

异步存储 API 的存在不保证本地文件下可用或长期恢复。文件 URL 的来源没有统一跨浏览器定义；Storage 标准在不透明来源或禁用存储时无法取得 storage key。若目标环境不提供稳定可用存储，自动恢复需求与直接打开单 HTML 的约束之间仍有产品决策待解决。[URL 来源规则](https://url.spec.whatwg.org/#origin)、[Storage key](https://storage.spec.whatwg.org/#storage-keys)

## 事实矩阵

| 边界 | 官方能确认 | 当前项目事实或仍需验证 |
| --- | --- | --- |
| Worker 启动 | 同来源 Blob URL 可作为 Worker 脚本；MDN 给出内嵌数据转 Blob 示例 | 首次 `file://` 打开、CSP/浏览器策略、启动错误与超时处理要实测；不依赖曾联网或预热缓存 |
| 脚本环境 | Worker 有独立全局环境和事件循环，不能直接操作页面 DOM | OTA 纯计算依赖可以构成候选包；不能把 App/Store/UI 的整个运行时搬进去 |
| HTML 分支 | DOMParser 的规范暴露范围只有 Window | 现有 HTML 适配器会改走无 DOM 分支，两分支并非等价；需要明确保真边界 |
| 消息 | 常规数据经结构化序列化；ArrayBuffer 可转移所有权 | 巨型字符串/对象行数组没有通用零复制承诺；编码、接收和页面对象仍有成本 |
| 取消 | message 是事件循环任务；terminate 会丢弃任务并中止当前脚本 | 同步解析不能及时接收取消；终止常驻数据 Worker 会丢失其所有内存表，而非只取消本次筛选 |
| IndexedDB | Window/Worker 可用，事务/请求异步；取得 storage key 失败时 open 抛 SecurityError | API 存在和一次 put 成功不等于重开恢复、原文版本一致或断电耐久性 |
| OPFS | 按来源私有存储、受配额约束；主线程异步，Worker 有同步文件访问接口 | 不是旁边的用户文件，也不是任意 file URL 都可用；需要真实 getDirectory 与重开验证 |
| 持久性 | 默认 best-effort；可请求 persistent；隐私模式通常结束后删除数据 | persist 可能不获准；estimate 是估算；移动/改名 HTML 后能否恢复要单独验证 |

表中 API 事实详见下列对应官方链接；“项目事实”来自源码检查；“需验证”均未执行。

## 确定性内嵌 OTA 代码的候选路径

[构建脚本](../../tools/build-release.cjs) 当前按固定顺序内联模块，读取时统一 BOM/CRLF；[OTA loader](../../src/core/module-loader.js) 使用局部 Map 注册工厂并递归解析显式依赖，只在存在 window 时挂到 window。把 loader 与所选模块放进同一个经典 Worker 脚本，词法作用域中的 OTA 可继续使用；不需要共享页面 registry 或传送函数。这是源码推导，尚未实际启动该包。

纯计算依赖候选包括 `table-utils`、`filter-engine`、`joiner`、`query-service`、解析基础模块及非 DOM 格式适配器。ImportEngine 显式依赖全部适配器，所以应由构建检查其完整传递依赖与顺序，而非手写一份会漂移的算法副本。现有同步实现可以在 Worker 内执行，但仅迁移线程不会自动获得分块、取消或有界内存。[ImportEngine](../../src/parsing/import-engine.js)、[QueryService](../../src/core/query-service.js)

后续构建候选应在生成时从源文件形成固定后台 manifest，安全编码为内联脚本数据或字符串，在运行时构造 Blob/对象 URL；不使用网络加载或从 UI 工厂 `toString()` 抽取代码。需要验证 HTML 脚本上下文转义，尤其 `</script>`，以及启动确认、版本匹配、对象 URL 生命周期和重建后相同产物。此处给出可行路径，封装形式和模块边界由后续决策确定。

不能原样迁移的边界：`runtime`/UI 构造 DOM；Store 使用 localStorage、页面事件与主题；TableRegistry 依赖 Store 并向调用者同步提供整表；Exporter 依赖 runtime，下载使用 document；ClipboardFormatter 依赖 Store。完整流程后台化仍需改变这些接口或提取真正的计算所有者，不能靠新增 Worker 开关完成。[Store](../../src/state/store.js)、[TableRegistry](../../src/core/table-registry.js)、[Exporter](../../src/export/exporter.js)、[ClipboardFormatter](../../src/export/clipboard.js)

当前 [架构文档](../architecture/architecture.md) 将 Worker/IndexedDB 延后，[架构校验器](../../tools/validate-architecture.cjs) 明确拒绝新增 Worker/IndexedDB。若后续选择该路线，必须先记录 ADR 并针对批准边界加强校验；本调查未改变这些约束。

## HTML 解析一致性是独立问题

规范将 DOMParser 标注为 `[Exposed=Window]`，不能假定专用 Worker 有这个 API。[HTML DOMParser](https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#the-domparser-interface)

[现有 HTML 解析器](../../src/parsing/parsers/html-parser.js) 在 Window 中先 DOMParser 生成文档，再枚举 table 并读取 outerHTML；无 DOM 时直接以 `<table…</table>`、显式闭合的 tr/td/th 匹配原始输入。前者经过浏览器 HTML 树构造/修复与序列化，后者未经过这些步骤。

例如省略合法可省的 `</td>`/`</tr>`，浏览器树构造可生成完整单元格，而当前无 DOM 分支要求闭合标签；嵌套表格、畸形结构、实体规范化和带引号属性也需对照。此处是规范和源码支持的差异分析，示例没有在桌面 Chrome 实跑。Node 的无 DOM 测试通过不能证明浏览器迁移等价。

后续必须决定如何保持 HTML 输入合同：保留受控 Window 分支、建立行为一致的纯解析边界，或明确能力范围；选择尚未作出。仍应按既有安全边界将导入内容保持为惰性文本，不插入活动 DOM、不执行脚本，并验证输入包含资源 URL 时不会产生外部请求。

## 消息、取消与故障恢复

常规 postMessage 传值而非共享实例；Worker 不自动降低数据总量。只传当前页、统计与版本信息可以避免反复克隆整表，但具体消息接口由后续架构票决定。[MDN Worker 消息](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#transferring_data_to_and_from_workers_further_details)

ArrayBuffer 转移会让发送端缓冲区分离；TypedArray 本身可序列化，transfer list 放的是其 buffer。普通字符串、对象数组不是这种零复制转移对象；先把巨型原文编码成字节也需要时间和新缓冲区，转移唯一副本会影响 Worker 失败后的恢复来源。[MDN Transferable](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)

Worker 的 message 回调等待事件循环；长同步循环不能响应排队取消消息。协作取消需要处理批次之间返回事件循环，再检查任务状态；只增加 Promise 微任务不代表取消消息已经执行。terminate 可中止当前脚本并丢弃排队任务，因此终止一个持有全部数据的 Worker 后，需要从仍有效的原文/持久副本重建全部数据。[HTML Worker 事件循环与终止](https://html.spec.whatwg.org/multipage/workers.html#the-worker's-event-loop)

必须区分启动失败、任务可恢复错误、消息反序列化失败和无响应/终止。并非每次浏览器进程退出或内存故障都会可靠交付 error 事件；不能把“主线程能收到报错”当作所有崩溃的保证。错误、取消或重启不能让旧任务结果覆盖新的源修订；重建期间仍需明确当前页快照是否可继续操作。这些是故障模型要求，不是本次选定的运行策略。

## file:// 存储与自动恢复边界

URL 标准对 `file` 来源留给实现处理，并建议无法确定时使用新不透明来源；页面创建且仍有有效条目的 Blob URL 继承创建环境来源。地址栏/`location.origin` 的字符串值本身不是存储可用性探针。[URL 标准](https://url.spec.whatwg.org/#origin)

安全上下文是另一条轴：MDN 将顶层 file URL 列为可信示例，Worker 跟随创建者的安全上下文；即使 `isSecureContext` 为 true，也不代表得到稳定 storage key、配额或授权。[MDN Secure Contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)

IndexedDB 在 Window/Worker 暴露；open 在 storage key 取得失败时同步抛 SecurityError。记录按值克隆，put 调用本身仍包含序列化工作，异步请求不是零 CPU/零复制保证；请求 success 与整个事务提交不同，确认保存应检查 transaction complete/abort。提交完成也不能不加条件地宣称每个环境都已强制落盘；事务 durability 和浏览器实现仍需验证。[IndexedDB 规范](https://w3c.github.io/IndexedDB/)

OPFS 的 getDirectory/普通读写为异步接口；同步访问句柄适用于专用 Worker，创建句柄本身异步。它是来源私有存储，清除该来源存储会删除数据，并受到浏览器配额限制，不能当作用户显式选择的备份文件。[MDN OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)

Storage 标准对不透明来源/禁用存储返回失败；persistent 获准后可避免存储压力下的默认驱逐，但仍允许用户清除。配额根据磁盘、浏览器和策略变化；estimate 只是估计，隐私窗口配额可能不同且数据通常在模式结束后删除。因此不能由 32 GB RAM 或普通网页下的配额宣传推算本地文件可保存量。[Storage 标准](https://storage.spec.whatwg.org/)、[MDN 配额与驱逐](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

自动恢复仍待决定：采用何种存储、绑定何种本地工作区身份、原文与小设置如何一致提交、何时报告已保存、旧 localStorage 如何迁移，以及不可持久化时如何满足需求。需覆盖文件路径不变的重开、改名/搬移、覆盖升级、多窗口、隐私窗口和用户清理；本调查不保证任意 file URL 的这些行为相同。

## 后续最小兼容性探针（未执行）

在用户桌面 Chrome 中记录完整版本、OS、打开路径、普通/隐私模式；用新配置目录且系统断网首次打开真实生成 HTML。Firefox/Safari 若继续列为支持对象，应重复同一探针，不用 Termux 移动浏览器替代。

| 探针 | 必须记录的结果 |
| --- | --- |
| 内嵌 Blob Worker | 构造是否成功、ready/版本握手是否收到；构造异常、异步 error、无 ready 各自可见；零外部请求 |
| OTA 包与产物 | 从批准 manifest 重建两次相同；解析/查询入口在 Worker 可 require；无 Window/DOM/存储私有依赖误入纯包 |
| 两端数据消息 | 字符串/嵌套对象往返正确；ArrayBuffer 转移后发送端 byteLength 为 0；非法 transfer 和不可克隆对象失败不改当前数据 |
| 取消与重启 | 连续批次能收到取消；同步任务取消的边界被记录；强制 terminate 后数据确实须重建；旧 job/sourceRevision 的消息被拒绝 |
| HTML 差异 | 既有 fixtures 加省略结束标签、嵌套/畸形表格、实体和资源 URL；比较表名、表头、行、诊断与零请求，而非仅检查未抛异常 |
| IndexedDB | 页面和 Blob Worker 分别 open/put/get；等事务 complete 后关闭再打开校验全原文/版本；记录 blocked、abort、SecurityError 和迁移结果 |
| OPFS | 实际 getDirectory、创建/写入/关闭/读取；若测试同步句柄须释放；重开读回、来源数据清除行为；API 存在不算通过 |
| 恢复范围与失败 | 同路径重开、升级替换、改名/移动、多窗口、隐私模式结束；存储拒绝、写中断、配额耗尽、persist 拒绝均有明确结果 |

探针先验证机制，容量票再用代表性 10 万行 × 30 多字段样本量化内存、主线程阻塞、恢复耗时和可承受上限；不依据本调查填写性能成绩。

## 必须保留的失败语义

这些来自项目现有原文、Store 与故障可见性合同，不是新的存储选择：

- Worker 启动失败/超时不丢原文和当前可恢复工作区；不能静默在主线程执行同等巨量同步任务后宣称达成流畅目标。是否分块降级或停止大任务待定。
- Worker 被终止后，把其数据集/查询句柄视为失效；有可信原文才可重建，不声称后台数据仍完整可用。
- 存储不可用、写失败或事务未提交，保留内存数据并明确显示未完成保存；不能在随后关闭页面时承诺自动恢复。需提供既有备份路径。
- 读回缺失、损坏或版本不匹配，不能默认为空源并覆盖旧存储；保存失败不得先删除旧的可读恢复版本。
- 原文与设置分开保存若被选用，必须定义提交边界和来源修订一致性；浏览器 API 不能替应用保证两个独立存储写入原子一致。

本票已能回答“规范支持哪些机制、项目哪里有语义障碍、还需验证什么”。后台包封装、HTML 保真政策、Worker 生命周期、存储选择及预算仍属于后续决策；本次没有实现或批准它们。
