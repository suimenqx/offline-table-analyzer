# Offline Table Analyzer v18

## 重点优化

### 1. 通用导入解析层

新增 `ImportEngine`，保留旧的 `Parser.parse()` 兼容入口，所有解析器统一输出 `{ name, headers, rows, sourceType, meta }` 表结构。

已支持：

- 原有 `cli-table-data` 多表数据
- CSV，包括引号字段、字段内逗号、双引号转义、字段内换行
- Excel / Google Sheets 复制出来的 TSV 数据
- 分号分隔数据
- Markdown pipe table
- ASCII / 终端边框表格
- 网页复制的 HTML `<table>` 剪贴板数据
- 网页复制后的多空格固定宽度文本
- 空白分隔纯文本兜底

### 2. 友好的无表头处理

- 自动判断第一行是否为表头。
- 无表头时自动生成 `Column1`, `Column2`, ...。
- 空表头会自动补齐为 `ColumnN`。
- 重复表头会自动加后缀，例如 `id`, `id_2`。
- 工具栏支持切换：自动表头、第一行作为表头、第一行作为数据。
- `cli-table-data` 不应用自动表头逻辑，固定使用 `validflag` 行作为表头。

### 3. 导入控制条

导入区保留轻量摘要，只展示：

- 当前解析格式
- 表头来源
- 表数量
- 行数 / 列数

已移除置信度和 warning 展示，避免干扰主要使用流程。新增格式下拉框，支持用户手动指定 CSV、Excel/TSV、HTML 表格、ASCII 表格、固定宽度文本等格式。

### 4. 代码重构

- 抽离 `TableUtils`, `HeaderResolver`, `Delimited`, `ImportEngine`。
- 将不同格式实现为 Parser Adapter。
- 保持旧功能调用入口不变，降低对过滤、JOIN、导出等旧功能的影响。
- 使用 `buildSingleTableResult()` 和 `createDelimitedParser()` 合并重复解析器样板代码。

## 测试

执行：

```bash
node tools/run-parser-tests.js
```

当前覆盖 14 组回归测试：

1. 旧 `cli-table-data` 多表解析
2. CSV 引号、逗号、转义双引号
3. 无表头自动生成表头
4. Excel TSV 数据
5. Markdown pipe table
6. ASCII 终端表格
7. HTML table 剪贴板数据
8. 分号分隔数据
9. 固定宽度网页复制文本
10. 空表头 / 重复表头归一化
11. 列数不一致时保持解析不中断
12. 前缀文本中的 legacy `table-data` 标记
13. 手动格式选择强制 CSV
14. 强制第一行作为数据


## v18.1 修复

- 修复 `table-data` 不在行首时无法识别的问题，兼容旧版“任意位置包含 table-data 即开始表”的行为。
- `cli-table-data` 解析恢复为等待 `validflag` 行作为表头，不再受新增自动表头逻辑影响。
- 对 `table-data table-data Inventory` 这类带前缀/重复标记的输入，会使用最后一个标记后的名称作为表名。
- 移除导入摘要中的置信度和 warning 信息。
- 在数据源工具栏增加格式下拉框，支持手动指定解析格式。
## v18.2 布局调整

- 移除数据源输入框下方的解析摘要区域，避免占用解析按钮上方空间。
- 将“格式 / 表头 / 表数量 / 行数 / 列数”解析信息移动到预览表标题行，显示在 `Row` / `Show` 后方。
- 解析信息复用现有 `meta-tag` 样式，与表格预览区风格保持一致。


## v18.3

- Removed redundant import summary counters from the table title row.
- The preview header now only shows format and header handling metadata; row/show counts remain in the existing table metadata tags.

## v18.4 字体显示优化

- 新增统一字体变量 `--font-ui`、`--font-table`、`--font-mono`。
- 表格数据区从等宽字体切换为系统 UI 无衬线字体优先，改善中文显示清晰度。
- 表格和单元格编辑器启用 `tabular-nums`，保持数字列更稳定的宽度表现。
- 原始文本输入区继续保留等宽字体，并增加中文字体兜底，兼顾 CLI/ASCII 输入对齐和中文可读性。
- 全局启用字体平滑和 `text-rendering: optimizeLegibility`。

## v18.5 页签交互优化

- 支持双击页签标题进行原地重命名。
- 重命名支持 Enter 保存、Esc 取消、失焦保存；自动清理换行/多余空白，并限制标题最长 40 字符。
- 支持拖拽页签调整顺序，激活页签不会因排序改变。
- 页签标题增加省略显示和 hover title，长名称不会撑破顶部导航。
- 新增 `tools/run-tab-tests.js` 覆盖页签重命名、标题清理、拖拽排序和异常目标回滚逻辑。

## v18.6

- Fixed sidebar navigation regression: the 配置规则 tab now uses delegated binding and remains clickable after document changes.
- Fixed Smart Parser logo double-click behavior by preventing the second click from toggling the sidebar back.
- Added a fullscreen data-source editor with live sync, format/header controls, parse shortcut, and modal close controls.
- Added UI interaction static validation for sidebar and fullscreen source editor behavior.

## v18.7

- Restored the v17-style direct sidebar tab binding for 数据源 / 配置规则.
- Sidebar navigation is now bound before the broader UI event wiring, so a later optional-control binding issue cannot block 配置规则 from opening.
- Added explicit IDs and `type="button"` to the sidebar segmented controls to prevent accidental disabled/form-button behavior.
- Kept sidebar tab state persistence through `applySidebarTab`, while the visual switch itself no longer depends on the full parse/config flow.
- Expanded UI static checks to cover the restored direct binding and init order.
