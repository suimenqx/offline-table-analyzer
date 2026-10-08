# 建立真实桌面基线以决定性能预算

Labels: wayfinder:task
Type: task
Mode: HITL
Status: open
Assignee:
Parent: [大数据完整分析流程保持响应](../map.md)
Blocked by:

## Question

在目标桌面 Chrome 上取得哪些代表性测量，才能决定容量、响应与内存验收预算？这是决策前的测量任务，不是性能改造的交付切片。

代理准备可重复的本地样本、测量入口与桌面操作清单；用户提供或运行实际 Chrome 环境的测量。需记录 CPU、浏览器版本、原文 UTF-8 字节与现有 `length * 2` 估算、字段长度分布、多文档数量；不知道原文大小时由测量计算，不要求上传敏感数据。

分开测原生粘贴/文件读取、Store 更新与保存、识别/解析/规范化、首次与重复筛选、翻页、JOIN、复制和导出。记录首次可见反馈、最长主线程任务、事件循环响应、总完成时间和可观测的内存峰值；说明测量工具的局限。至少包括 10 万行 × 32 字段的短/长/中文/CRLF 样本和多对多 JOIN 输出增长。

Node 结果只能作计算趋势；模拟 paste 不能替代真实剪贴板默认插入。Termux Firefox 不能冒充用户桌面 Chrome 或 CI Chromium。若当前会话无法访问目标电脑，保留票并提供用户可运行的本地步骤，不虚构成绩。

## Comments

已知用户环境：Chrome、32 GB 整机内存。已有[模块测量与限制](../../../docs/planning/browser-large-data-research.md)可作为准备依据。
