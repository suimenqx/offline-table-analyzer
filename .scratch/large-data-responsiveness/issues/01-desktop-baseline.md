# 建立 CI 桌面 Chromium 基线以决定性能预算

Labels: wayfinder:task
Type: task
Mode: AFK
Status: resolved
Assignee: /root
Parent: [大数据完整分析流程保持响应](../map.md)
Blocked by:

## Question

通过仓库的 GitHub Actions 桌面 Chromium 取得哪些可重复测量，才能决定容量、响应与内存验收预算？用户使用手机编程，无法提供桌面 Chrome 基线；这是代理自动完成的决策前测量任务，不是性能改造的交付切片。

代理准备确定性合成样本和 Playwright 测量入口，在 CI 的桌面 Chromium 执行并保存 JSON 报告、浏览器版本、runner CPU/内存、原文 UTF-8 字节与现有 `length * 2` 估算。不需要用户桌面电脑或上传原文。

分开测原生粘贴/文件读取、Store 更新与保存、识别/解析/规范化、首次与重复筛选、翻页、JOIN、复制和导出。记录首次可见反馈、最长主线程任务、事件循环响应、总完成时间和可观测的内存峰值；说明测量工具的局限。至少包括 10 万行 × 32 字段的短/长/中文/CRLF 样本和多对多 JOIN 输出增长。

Node 结果只能作计算趋势；模拟 paste 不能替代真实剪贴板默认插入。CI 使用浏览器剪贴板和 Control+V，明确 headless Linux 的环境边界；Termux Firefox 与 Node 分开报告，CI 成绩不等同于某台 32 GB 电脑的保证。无法取得 CI 结果时票保持 claimed，不虚构成绩，不重新要求用户提供电脑。

## Comments

已知用户环境：Chrome、32 GB 整机内存。已有[模块测量与限制](../../../docs/planning/browser-large-data-research.md)可作为准备依据。

用户补充：使用手机编程，无法直接获取 Chrome 基线。此任务改由代理驱动的 CI 自动化执行；32 GB 仅是此前给出的环境参考，不是假定的 CI runner 容量。

代理已准备[基线运行与口径](../../../docs/testing/large-data-baseline.md)、独立 Playwright 配置和 GitHub Actions 工作流；本地 Node 365 项及发布/架构校验通过。票在实际 CI 结果取得前保持 claimed；测试发现通过不冒充 Chromium 执行通过。

实际 CI 运行已取得。首轮中文第二文档超过默认 5 秒等待；最终明确等待异步新页签就绪，并以 30 秒完成等待记录真实慢操作，6 个用例完成。基准还纠正了“旧空存档意味着临时模式成功”的误判：取消勾选后 Store 的持久化开关仍开启，作为现有问题明确报告，没有直接改 Store 或应用代码来掩盖。

## Answer

通过[自动桌面 Chromium 基线](../../../docs/testing/large-data-baseline.md)取得[实际运行与结论](../../../docs/planning/ci-large-data-baseline.md)，6 份 JSON 永久归档于仓库。手机开发者不必提供桌面基线；相关推送或手动 Actions 运行可以复测，runner/browser/原文大小、原生粘贴、文件读取、保存失败、解析/规范化、筛选、分页、JOIN、复制、XLSX、第二文档的阶段指标均可追溯。

测量说明当前粘贴、计算与重复数据副本均有成本，短字段粘贴中位数约 2.44 秒，中文一次约 7.51 秒。存储配额、未生效的持久化控件和超限样本均明确报告，不作为恢复或容量通过。墙钟/两帧等待只是可见完成代理值，采样 JS 堆不是完整浏览器峰值，3 次重复不代表 p95；尚未选定最终性能数值门槛。此票解决的是决策前事实基线，性能改造仍未实施。
