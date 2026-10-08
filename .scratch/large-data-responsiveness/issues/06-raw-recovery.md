# 大原文如何保存恢复并兼容旧工作区

Labels: wayfinder:grilling
Type: grilling
Mode: HITL
Status: open
Assignee:
Parent: [大数据完整分析流程保持响应](../map.md)
Blocked by: 02, 03, 09

## Question

如何满足用户的大原文恢复需求，同时消除 UI 小变更触发整份原文克隆、序列化和同步写入的成本？

先确认关闭页面后是否要求自动恢复。比较优化现有 schema 20 的序列化与临时模式、把大原文分离到异步存储、或用户手动备份的路线；给出各自的恢复能力、配额/文件来源边界与成本，不能把 API 异步等同于零复制或可靠永久保存。

若选择改变持久化契约，需明确 Store 的权威所有权、文档/原文索引、原文保存完成与小配置提交的顺序、旧 ota_v20_workspace 与 v16_4_store 的迁移、损坏/部分写入/配额/权限失败处理、临时模式、Ctrl+S 与工作区备份的行为。保留可恢复内存数据，迁移成功前不得删旧值。

## Comments

用户回答：需要自动恢复。尚未决定存储技术与迁移方案。当前 Store.serializeState 会先克隆 raw，再依据 persistRaw 排除，save 再次序列化并同步写 localStorage。
