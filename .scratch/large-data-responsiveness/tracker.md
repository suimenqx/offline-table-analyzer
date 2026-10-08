# 本地 Wayfinder 跟踪器

本仓库尚未提供跟踪器配置，本轮采用 wayfinder 的 local-markdown 默认方式。后续可运行 `/setup-matt-pocock-skills` 固定跟踪器配置；无需为本地图创建远程 issue 或分支。

约定来自技能包的 `setup-matt-pocock-skills/issue-tracker-local.md`。本地文件没有原生 issue blocking，因此用 `Blocked by:` 记录依赖。

## Wayfinding operations

- 地图：[大数据完整分析流程保持响应](map.md)，标签 `wayfinder:map`。
- 子票：`issues/NN-<slug>.md`，每个问题独立文件。`Parent:` 链接地图；`Type:` 为 research/prototype/grilling/task；`Mode:` 为 AFK/HITL。
- `Labels:` 记录 `wayfinder:<type>`；`Status:` 为 open/claimed/resolved；`Assignee:` 为认领者，未认领时为空。
- 创建票后第二遍填写 `Blocked by: NN, NN`；无依赖时留空。只有所有依赖都 resolved 才算无阻塞。
- frontier 是 open、无阻塞、无 assignee 的子票，按文件编号排序。检索先执行 `rg -n '^(# |Status:|Assignee:|Blocked by:)' .scratch/large-data-responsiveness/issues`，再检查依赖状态；不要把仅 open 的票都当成 frontier。
- 工作前先设置 `Status: claimed`、`Assignee:` 并保存；charting 不提前认领后续 HITL 票。
- 解决时在票的 `## Comments` 中记录真实交流，在 `## Answer` 下追加 resolution 与资产链接，再设置 `Status: resolved`。地图 Decisions so far 只追加票标题链接和一句结论。
- 被判定超范围的票同样关闭，但只在地图 Out of scope 中索引，不计入 Decisions so far。
- 研究资产沿用 `docs/planning/`。票负责答案，研究资产负责依据，地图不重复完整答案。
- 并行会话各自只编辑认领票和约定资产；更新地图前重读最新内容。全部仍在 `main`，不使用研究分支或 PR。
