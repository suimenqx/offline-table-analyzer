# 验证 CI Chromium 的离线后台与恢复机制

Labels: wayfinder:task
Type: task
Mode: AFK
Status: resolved
Assignee: /root
Parent: [大数据完整分析流程保持响应](../map.md)
Blocked by: 02

## Question

CI 桌面 Chromium 在真实单 HTML、`file://`、首次断网打开时，能否运行候选后台包并完成可观察的大原文保存/重开恢复？先取得机制事实，才能选择架构与容量，而不是先实施整套产品改造。用户使用手机编程，无需提供桌面电脑。

代理根据[事实调查中的最小探针](../../../docs/planning/offline-worker-storage-research.md)准备独立、可清理的检测资产，通过 GitHub Actions/Playwright 的桌面 Chromium 自动执行。探针与生产工作区隔离，不读写现有 ota_v20_workspace，也不要求上传原文；记录实际 runner 与浏览器版本。

记录 Blob Worker ready/版本与失败路径、OTA 纯依赖装入、任务取消/终止/重建、消息克隆和 ArrayBuffer 转移。分别记录 IndexedDB 与 OPFS 实际打开/写入/事务提交/重开读回，以及同路径、替换升级、改名移动、普通/隐私模式的行为。API 存在与 secure context 均不能单独算通过。

该任务只收集可重复的机制结果和失败事实；不替用户选择存储，也不实施 source/schema 迁移。CI 结果只证明其浏览器和来源条件，不保证所有 Chrome/文件路径/隐私模式；不能用规范或 Node 结果冒充浏览器通过，也不因无法访问用户电脑而阻塞。

## Comments

本票由已完成的文件来源/存储规范调查明确产生：现有资料无法替代目标 Chrome 的来源与重开验证。通过或失败都应成为后续决策的输入。

用户补充：手机编程且不能直接获取 Chrome 基线，因此改为 AFK 的 CI 检查。实现与认领留给后续会话，本轮先完成性能基线任务。


## Answer — 2026-10-08

[CI 37787642664](https://github.com/suimenqx/offline-table-analyzer/actions/runs/37787642664) 的 Chromium 153.0.8010.12 实测首次断网 file:// Blob Worker 可 ready、运行 OTA table-data 解析、终止重建和转移 ArrayBuffer。IndexedDB 在事务提交后保存 22,000,003 字符，普通持久 profile 完全关闭重开、替换 HTML、改名和移动均读回相同末尾/长度；该浏览器结果不作为其他 file 来源的保证。OPFS 实际调用失败 SecurityError，不能因 secureContext 为 true 就选用。隐私 context 本次可写入读回，全部关闭后的新 context 无数据。[机制原始记录](../../../docs/testing/baselines/2026-10-08-offline/offline-mechanisms.json)已归档，探针没有访问产品工作区。

用户后续明确授权实施，生产决策记录在[大数据 ADR](../../../docs/architecture/large-data.md)，不将本机制票当成其他 HITL 问题的用户答复。
