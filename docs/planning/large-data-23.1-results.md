# 23.1.0：有预算的识别与 Worker 分页验收

两个阶段已于 2026-10-09 完成。自动识别只试解析有限样本，选中格式后执行一次全量解析；完整文本表、查询结果与 JOIN 留在 Worker，Window 接收描述信息和当前页。CSV/TSV 按记录迭代、CLI 按行迭代，避免完整分行列表和候选全表副本。实现边界及保护预算见[大数据 ADR](../architecture/large-data.md)。

## 验证依据

- 实现提交 `33d2f68ce7da8b50d66610a722ffb1f4f8a7e4e7`，应用 23.1.0，持久化 schema 21 不变。
- [完整 CI](https://github.com/suimenqx/offline-table-analyzer/actions/runs/37886136225)：Node 20/22/24 各 420 项测试通过，覆盖率、发布和架构校验通过；Chromium 13 项流程首次执行全部通过。
- [性能 CI](https://github.com/suimenqx/offline-table-analyzer/actions/runs/37886136234)：八组 100,000 × 32 样本全部通过，包括三个短字段 CLI 粘贴、中文 CRLF、37 MiB 长字段、真实本地文件、混合标点 CSV 和引号内换行 CSV。
- Linux x64 headless Chromium 153.0.8010.12，Node 22，4 个逻辑 CPU，15,989.7 MiB 整机内存，1440 × 900 viewport。无需用户提供桌面原文或手动基线。
- [本轮八份原始报告](../testing/baselines/2026-10-09-worker-pages/short-clipboard-1/baseline.json)和[23.0 六份比较报告](../testing/baselines/2026-10-09-23.0/short-clipboard-1/baseline.json)已归档；旧版对应 [CI](https://github.com/suimenqx/offline-table-analyzer/actions/runs/37881772028)。可运行 `node tools/summarize-large-data-baseline.mjs docs/testing/baselines/2026-10-09-worker-pages` 汇总。

## 实测结果

短字段 CLI 的三次中位数如下。完成耗时包含自动化及两帧等待；主线程响应另外测量。两次 CI 使用同类共享 runner，不能据此推算任意电脑的固定速度或 p95。

| 阶段或指标 | 23.0 | 23.1 |
| --- | ---: | ---: |
| 解析并显示第一页 | 1890.5 ms | 1420.9 ms |
| 全量 XLSX 下载 | 2307.5 ms | 2474.2 ms |
| 第 2 页 | 179.9 ms | 190.3 ms |
| 第 3 页 | 156.7 ms | 167.2 ms |
| 20 万行 JOIN | 1874.7 ms | 1425.8 ms |
| 解析后 Window V8 堆 | 102.2 MiB | 14.7 MiB |
| JOIN 后 Window V8 堆 | 179.4 MiB | 18.0 MiB |

Window 不再持有完整解析行或 JOIN 结果，解析后的页面 JS 堆中位数下降约 86%。该指标不包含 Worker、DOM/native 内存，也不是整个浏览器的内存峰值；GC 时点会影响观测值。分页仍需 DOM 构建与布局，分页和全量导出的完成时间没有同步下降。

混合标点 CSV 和多行 CSV 分别在 1423.3/1407.9 ms 完成解析预览，2570.2/2656.9 ms 完成全量 XLSX 下载。两个样本均保留 100,000 行、32 列；默认 DOM 仅 100 行，Window 原始表描述信息的 rows 长度为零。

八组样本所有阶段的最长主线程任务为 132 ms，最大心跳延迟为 243.6 ms，均通过既有 500 ms 退化门槛。主线程任务为 0 表示观察窗口内没有至少 50 ms 的 Long Task；Worker 仍在计算。该门槛不表示 60 FPS、解析瞬间完成或所有数据规模均可承载。

## 端到端正确性

Node 适配器调用计数证明混合标点宽 CSV 只交给一个适配器全量解析，其余候选受 262,144 UTF-16 码元和 512 条记录预算限制；引号内换行、转义引号及单行 Data-Block 受回归保护。预算内仍歧义的大输入保留原文并等待手动选择，手动格式和兼容记忆格式保持有效。

真实 Chromium 覆盖原生十万行粘贴后直接点击全量 Excel、跨页编辑/撤销/重做、复制当前页、筛选结果跨全部分页导出、取消与来源替换、离线原文和修正关闭浏览器重开恢复。CSV 全量导出由独立读取器核对 100,001 行（含表头）、32 列、前导零标识符、修正值和最后一行；筛选 125 条导出 126 行。六组原 CLI 性能流程继续覆盖 20 万行 JOIN，完整宽表 Excel 首尾及全量行数由独立读取器验证。

## 适用边界

保持单个离线 HTML、零运行时依赖、零外部请求。单份原文 UTF-16 估算 128 MiB、工作区 256 MiB、解析/合计查询/导出 800 万单元格、JOIN 100 万行、XLSX ZIP 256 MiB；超限可见报错并保留原文。完整查询与 XLSX 仍依赖 Worker 内存，尚未外存化或流式输出；巨大 HTML 的 DOMParser 路径仍在 Window。

本地 Termux 的 Node 测试和校验通过；Android Playwright 报 Unsupported platform，桌面浏览器验收来自上述 CI。共享 Linux runner、合成数据和 headless 剪贴板测量不能替代所有桌面系统的实测。
