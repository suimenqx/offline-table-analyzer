# Excel 导出派生统一验收基线

来源：2026-10-25 架构评审，用户选择先实施 Window / Worker 的表池 Excel 导出规则统一。

## 归属与行为

- 既有 QueryService 的 `getExportTables(input, mode)` 是唯一表派生 interface；不访问 DOM、Store 或下载，不执行分页。
- Window 从当前查询表与工程/卡片设置构造输入；Worker 先在原有会话内应用来源修正、构造表池，再调用同一 implementation。完整表和后台 XLSX 不发送回 Window。
- raw 导出所有可见来源表，不含 JOIN，不应用显示表选择、行过滤或列投影。
- full 根据 `exportOnlyChecked` 决定是否限制原始表，同时包含启用的 view；保留全量记录，根据 `exportCols` 决定列投影。列顺序、缺失列跳过和无有效列时回退全部列继续由 TableUtils 保证。
- preview 导出完整筛选与列投影结果，不受页码、折叠或 full 的列选项影响。
- 所选原始表与 JOIN 按既有单元格合计预算检查，JOIN 扩张前计入已经选择的表，不能用后续列投影绕过分配预算。原始表、表头和 Store 原文不被派生修改；超限无下载，错误可见，数据保留。
- 原文准备、同源解析复用、取消和下载前时效校验，以及导出锁、文件名、进度和下载继续走既有流程。
- 删除 ExportController 的派生私有 helper 及 App 中无运行时调用者的导出转发。无新增模块、运行时依赖、持久化字段或迁移。

## 回归矩阵

| 位置 | 保留的可观察结果 |
| --- | --- |
| `tests/unit/export-tables.test.js` | 三种模式、显式原始表选择/空选择、JOIN、列顺序、缺失/空 focus、完整过滤记录、分页/折叠独立性、预算边缘、输入不变。 |
| `tests/integration/export-source.test.js` | Window 真实导出与 WorkerRuntime 会话用同一组 fixture，独立 XLSX reader 读回全部工作表和记录；核对模式文件名、错误无下载与原文保留。原有在途复用、取消和过期结果检查继续适用。 |
| `e2e/export-parity.e2e.js` | 生成的 index.html 分别实际走 Window / Worker，点击三种导出按钮下载并读回；包含表选择、JOIN、列投影、过滤、隐藏预览、原文不变与零外部请求。 |
| 既有发布校验 | 单 HTML、46 个模块、schema 22、无运行时网络依赖、声明依赖顺序和确定性构建。 |

原有 `tests/unit/export-controller.test.js` 中依赖已删除私有 helper 的断言由共享 interface 测试及更完整的下载读回取代；不降低既有导出行为的验收标准。

## 本地验证

- `npm test`：525 项通过，零失败；发布、架构和 `git diff --check` 校验通过。
- 桌面 Firefox / WebDriver 从 `file://` 实际点击三种导出按钮，分别走 Window 与 Worker；六份下载工作簿由独立 XLSX reader 逐表、逐记录核对通过。预览的折叠、页码、筛选与 full 的全量范围正确；后台完整表未发布到 Window。
- Firefox 验证 Window 合计预算不足时反馈可见、无新下载且原文保留；未捕获页面错误。
- 本机 `npm run test:e2e` 仍因 Playwright 不支持 Android 而无法启动，Chromium 由推送后的 Ubuntu CI 单独验证。
