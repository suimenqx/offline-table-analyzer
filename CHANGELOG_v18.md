# Offline Table Analyzer v18

## 重点优化

### 1. 通用导入解析层

新增 `ImportEngine`，保留旧的 `Parser.parse()` 兼容入口，所有解析器统一输出 `{ name, headers, rows, sourceType, meta, diagnostics }` 表结构。

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
- 导入摘要条支持切换：自动表头、第一行作为表头、第一行作为数据。

### 3. 解析诊断

新增导入摘要条，展示：

- 检测到的格式
- 置信度
- 表数量
- 行数 / 列数
- 表头状态
- 解析 warning 数量

解析过程中遇到列数不一致不会中断，而是生成 warning，可在摘要条中查看。

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

当前覆盖 12 组回归测试：

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
11. 列数不一致 warning
12. 强制第一行作为数据
