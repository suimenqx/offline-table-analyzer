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
