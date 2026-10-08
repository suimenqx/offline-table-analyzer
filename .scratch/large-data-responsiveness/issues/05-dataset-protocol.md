# 确定数据所有权与异步分析契约

Labels: wayfinder:grilling
Type: grilling
Mode: HITL
Status: open
Assignee:
Parent: [大数据完整分析流程保持响应](../map.md)
Blocked by: 02, 03, 04

## Question

如何用一个稳定的数据访问边界支持后台解析、索引筛选、当前页取数、修正与任务生命周期，同时继续由 Store 管理原文和修正记录？

讨论主线程与后台分别持有什么；metadata/page/query/edit/export 接口的输入输出；哪些旧纯函数继续同步而 UI 经异步边界取数；筛选结果和 JOIN 结果是否用源行或行对索引；页码/布局是否独立于查询失效，缓存条目与字节预算如何控制。

必须明确 docId/sourceRevision/parseOptionsRevision/datasetVersion/jobId/queryRevision 的必要性与验证位置：迟到结果在写 Registry 或 UI 前被拒绝。讨论切换/关闭文档、新输入、解析选项变化、编辑/撤销、Worker 崩溃与强制取消的状态一致性、完整原文恢复和资源释放。不要把无版本的 getRaw() 全量同步访问搬成跨线程全表复制。

单元格修正仍可映射回正确源行列；字符串单元格、原文、诊断、CLI validflag、多表、13 种解析格式的现有语义与 raw/full/preview 导出范围继续受保护。后台循环要能接收取消；单个不可中断算子和 Worker 失败不能默认回退到大数据同步阻塞。

## Comments

已追踪当前 Registry、CellEditController、JoinEditor、ExportController 的同步全表依赖。现有 App 先写 Registry 后通知 Store.parse:completed，直接异步化不足以防止旧结果污染。
