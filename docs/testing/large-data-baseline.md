# 大数据基线：手机开发，桌面 CI 验证

开发主机可以只有 Termux 手机。基线由 GitHub Actions 的桌面 Chromium 自动运行，不要求开发者提供电脑或上传敏感原文；手机浏览器不是产品的主要验收对象。

[2026-10-08 实测结果与归档](../planning/ci-large-data-baseline.md)已取得，6 个用例完成；这是改造前的基线，仍观察到秒级主线程阻塞。

## 执行入口

[Large-data Chromium baseline 工作流](../../.github/workflows/large-data-baseline.yml) 在相关源代码、基准或构建文件推送到 main 后运行，也支持 GitHub Actions 的手动运行按钮。CLI 可用 `gh workflow run large-data-baseline.yml --ref main`。

受支持的桌面主机上可执行：

```sh
npm ci
node node_modules/playwright/cli.js install --with-deps chromium --only-shell
npm run build:release
node node_modules/@playwright/test/cli.js test --config playwright.performance.config.js
node tools/summarize-large-data-baseline.mjs test-results/large-data
```

Termux 运行 `npm test` 与 release/architecture 校验；[本地 Firefox 检查](termux.md)可作为补充。Playwright 在 Android 上不能直接启动这套桌面 Chromium；`--list` 的测试发现也不等于浏览器通过。

## 样本与正确性检查

[生成器](../../tests/helpers/large-data.mjs)每次生成 10 万行 × 32 字段的 CLI table-data，加一张含重复关联键的 20 行 lookup 表。所有数据都是合成数据，巨大原文不提交仓库。

- 短字段剪贴板输入重复三次，每次新浏览器 context。
- 中文短字段 + CRLF 剪贴板输入一次。
- 长字段、超过旧 25 MiB 上限的剪贴板输入一次：22.1 纳入完整流程；旧版本的明确拒绝记录保留为历史基线。
- 短字段文件导入一次，覆盖真实 FileReader → Store → 自动解析 → 渲染链路。
- 成功解析的剪贴板案例覆盖原生 Control+V、默认保存、临时模式开关操作、解析/分页预览、全量 XLSX、连续翻页、筛选、选区复制、筛选 XLSX、20 万行 JOIN、第二份文档文件导入。

临时模式同时记录控件与 Store 的真实开关；改造前缺少写入绑定的问题保留在历史报告。22.1 验证实际控件与原文空存档，不通过直接改 Store 掩盖错误，也不把旧存档当作新保存成功。新页签导入前等待选中页签和空编辑器就绪，避免异步页签加载与文件读入抢跑。

检查已接收原文长度和未被预览替换、首末 ID、字段数、完整记录数、重复键 JOIN 结果数、当前页 DOM 规模及零外部请求。22.1 有限预览保留大原文 CRLF，断言原文长度等于生成输入，textarea 不承载完整原文；旧版本的 LF 规范化记录仅作历史对照。全量 XLSX 独立读回小 lookup sheet，避免 Node 读者展开 320 万单元格而影响浏览器测量；完整筛选的 100 行 Wide sheet 则独立读回全部记录。普通 XLSX 完整语义仍由既有单元、集成和浏览器回归保护。

## 报告与口径

运行页有 Markdown 汇总；`large-data-baseline` artifact 保存每个案例的 `baseline.json`、Playwright 结果及失败截图，保留 14 天。开发者无需手抄桌面成绩，代理可以通过 gh 获取报告。

报告记录 commit、Chromium/Node 版本、runner CPU/可用并行度/整机内存、1440 × 900 viewport、UTF-8 原文字节和项目 `length * 2` 估算。32 GB 的历史环境参考不当作 CI runner 内存或标签页预算。

每个阶段分别记录：

- 动作墙钟时间：包含 Playwright 驱动、正确性检查和两帧等待；排除固定的 400 ms 观察尾段。不是精确真实用户 INP。
- Long Tasks 数量/总时长/最长任务，以及 20 ms 心跳的最大延迟；固定观察尾段用于捕捉 320 ms 防抖保存。
- ImportEngine、normalizeRows、QueryService、FilterEngine、JOIN、保存、XLSX 的嵌套方法计时。它们可能互相包含，不能相加当作总耗时。该 instrumentation 位于 Window，22.1 的 Worker CPU 不包含在这些方法计时中；主线程长任务、心跳和墙钟流程仍按相同方式测量。
- CDP 页面 JS 堆前后、DOM 节点计数和采样最大堆。采样可能错过同步任务内部峰值；它不含所有 DOM/native/Worker/WASM 内存，不能称作整个浏览器的峰值。
- 剪贴板事件数、可用 MIME、paste 到 input/处理器结束的间隔。剪贴板准备时间排除；Linux headless 路径不复现所有操作系统、Excel HTML 剪贴板或系统初始取数成本。
- 保存成功/失败和实际下载大小。存储成功/失败是可观察结果；另由常规 E2E 的持久 profile 重开验证真实恢复，不能用 API 存在或保存通知代替恢复断言。

短字段三次运行提供中位数，不用三个样本宣称 p95。共享 CI 的绝对毫秒可能波动，当前只对正确性、流程完成和零网络设断言，先保存事实基线；交互和容量数值门槛在后续决策票中校准。

界面完成断言最多等待 30 秒，以便测量慢操作的实际耗时；这不是允许阻塞 30 秒的性能验收标准。超时、浏览器异常与失败阶段的原文长度/记录摘要会进入报告，正确性断言保持完整。

## 边界

该工具同时测量改造前基线与 22.1 的[大数据实现](../architecture/large-data.md)，保持合成数据、操作路径和指标口径。直接 `file://` 首次离线、后台启动、存储重开/隐私机制由 `e2e/offline-runtime.e2e.js` 验证；产品恢复/修正/取消/竞态由 `e2e/large-data-flow.e2e.js` 验证。

不能将手机 Node、Termux Firefox、Linux headless Chromium 或单次成功推广成所有用户电脑不卡死的保证。它们为改造前后在同样数据和自动化路径上的比较提供依据。
