# 多卡片表池的内存与 Worker 事实调研

调研日期：2026-10-18。本文只记录一手来源事实、本仓库实测与适用性判断，供「Worker 多数据集架构决策」（issue #18）与「卡片/表池/view 领域模型与迁移」（issue #15）使用；不代表已经批准多 Worker、共享会话或任何新的内存模型。不改变现有架构决策、工作区 schema 与发布边界。

## 结论与适用范围

问题场景：卡片式工作区（地图 #13）的表池 = 多张可见卡片解析出的表集合，要求 Worker 同时持有**多个**全表数据集；今天 23.x 的 Worker 只同时持有一个文档的完整表（[large-data ADR](../architecture/large-data.md)）。本调研收集「多数据集同驻 Worker」的裁决所需的平台事实。

要点：

- **跨线程传数据 = 复制，不是共享**。MDN 明确：「The data is copied rather than shared」（postMessage 消息）。
- **字符串与对象数组没有零拷贝路线**：结构化克隆全量复制；只有 ArrayBuffer 等可 transfer，且转移后发送方缓冲区被分离。本仓库数据集是 JS 字符串，不在 transferable 之列。
- **多数据集同驻一个 Worker 时数据在 Worker 内共享、无跨线程复制**；换数据集传消息才有复制成本。这是共享会话路线的核心事实优势。
- **每 Worker 的堆上限、最大消息体积没有官方文档数值**——MDN 只给语义承诺（复制、DataCloneError、buffer 分离），不给性能数字；只能靠本仓库 CI 实测（由「多卡片验收基线」承担）。
- 本仓库实测已确认：Window V8 堆测量**不含** Worker 内存，Worker 里还有一份数据和查询结果——多一份数据集就是多一份驻留，256 MiB 工作区预算是直接约束。

## 分项事实与来源

### 1. 消息数据是复制而非共享

MDN「Using Web Workers」指南，postMessage 一节原文：「The data is copied rather than shared.」来源：[Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)。

含义：每张卡片的原文/规范化数据若通过消息进入 Worker，都要承担一次与字节量成正比的序列化+反序列化成本；Worker 返回结果同理。23.x 的「只传当前页」设计正是为规避反复全量复制（[large-data ADR](../architecture/large-data.md)）。

### 2. 结构化克隆的语义与边界

MDN「The structured clone algorithm」：该算法复制复杂 JavaScript 对象，用于 `structuredClone()` 与 Worker 之间传输数据；支持对象/数组/Map/Set/String/Date/RegExp/ArrayBuffer 等类型；**Function 对象与 DOM 节点会抛 `DataCloneError`**（不可克隆）。来源：[The structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)。

含义：本仓库的规范化表（对象数组 + 字符串）可克隆，但**每次克隆都是全量复制**；不存在「把字符串当 transferable」的捷径。

### 3. Transferable 的边界

MDN「Transferable objects」：Typed arrays 如 `Int32Array`/`Uint8Array` **可序列化但不可 transfer**；它们的底层 `ArrayBuffer` 才是 transferable。转移后发送方缓冲区被**分离**（示例中 `uInt8Array.byteLength` 变 0）。来源：[Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)。

含义：若未来把表数据列化为 ArrayBuffer（二进制列式），可以零拷贝转移，但转移后发送方立即失去数据（所有权移交，不能两处同用）；且当前产品数据是字符串对象（为保留 UTF-16 码元，见 [large-data ADR](../architecture/large-data.md) 2026-10-09 修订），改表示为另一场架构变化，不在本次范围。

### 4. Worker 生命周期事实

MDN「Using Web Workers」：专用 Worker 只能被创建它的脚本访问；Worker 可在同 origin 内再生成 subworker。来源同上。

含义：多 Worker 方案的协调必须经过创建方（主线程）的消息中转，或由 Worker 内生成 subworker；「BackgroundService 是唯一 Worker 生命周期/版本握手与消息传输拥有者」（large-data ADR）是现有单会话设计的支柱，多 Worker 会重画这条边界。

### 5. 本仓库实测（一手内部来源）

- 23.1 实测记录：「CDP 只测 Window V8 堆，**Worker 中还有一份数据和查询结果**；不能把这些数值当作整个浏览器内存」——多一张可见卡片 = 多一份 Worker 驻留数据，Window 堆指标无法暴露这部分增长。来源：[large-data-23.1-results.md](large-data-23.1-results.md)。
- 既有预算：工作区原文 256 MiB、单原文 128 MiB、解析/关联/导出 800 万单元格、JOIN 100 万行——「实现保护上限，不是容量保证」（large-data ADR）。
- 单 Worker 会话、可终止/重建、Blob 内嵌在 file:// 下已验收（large-data ADR 与 [offline 机制记录](../testing/baselines/2026-10-08-offline/offline-mechanisms.json)）。

### 6. 官方无文档的事实（明确标注未知）

- 每个 Worker 的 V8 堆上限、浏览器对 postMessage 最大消息体积的限制：MDN 与 WHATWG 规范均无此文档化数值。搜索结果类二手信息不可引。**结论：无法从一手来源给出容量承诺，只能实测**（由验收基线票在 CI 样本上定门槛）。

## 对「Worker 多数据集架构决策」的事实输入

1. **共享会话（一个 Worker 持多数据集）**：数据进入后互见、无跨线程复制，同名拼接可在 Worker 内完成；符合「BackgroundService 唯一拥有者」现状；代价是单 Worker 内存增长直接吃掉 256 MiB 预算、长任务与取消粒度不变。
2. **每卡会话（每卡一个 Worker）**：独立堆、独立终止，互不拖累；代价是多份驻留总内存更高、需要新的多 Worker 协调层（与唯一拥有者原则冲突，需 ADR 重画）、每卡一份完整数据集无共享。
3. **字符串数据集无零拷贝**：任何「每卡传进传出」的会话模型都要承担全量克隆成本；减少跨线程搬运比选会话模型更根本。
4. **同名拼接的位置**：数据在 Worker 内时拼接零额外复制；若在 Window 做，需先回传全表，违背 23.x 页传输设计——拼接应属 Worker 职责（作为架构票的推荐起点，最终以 #18 的 ADR 为准）。
