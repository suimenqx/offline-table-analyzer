# Offline Table Analyzer

Offline Table Analyzer 是一个隐私优先、完全离线的表格整理与分析工作台。它以单个 `index.html` 交付，可直接处理从终端、网页、Excel、Markdown 和日志中复制出来的杂乱表格，不上传数据、不需要账号，也没有运行时依赖。

当前版本：**20.0.0**

## 核心能力

- 自动或手动解析 CLI table-data、CSV、TSV、分号分隔、HTML、Markdown、ASCII、固定宽度和空白文本
- 自动表头、首行表头、无表头、空/重复表头修复和解析诊断
- 本地文件选择、拖放导入、全屏数据源编辑
- 多分析页签、筛选、高亮、关注列、逐列过滤和双方向预览
- 大表分页渲染
- 可持久化的单元格修订与撤销/重做
- Inner、Left、Right、Full、Semi、Anti JOIN
- TSV、CSV、Markdown、ASCII 与 HTML 剪贴板复制
- 电子表格公式注入保护
- 原始、全量和预览 Excel 导出
- 带版本的工作区备份/恢复
- 原始数据临时模式、保存失败提示和本地存储状态

## 使用方法

1. 下载仓库并直接打开 `index.html`。
2. 在左侧粘贴数据、拖入文本文件或点击“加载示例”。
3. 必要时手动选择输入格式与表头策略。
4. 点击“解析数据”。
5. 在“分析规则”中配置过滤、高亮、显示列和 JOIN 视图。
6. 在预览表中框选复制，或导出 Excel/工作区备份。

## 隐私说明

应用没有网络请求，所有处理均在浏览器本地完成。默认情况下工作区会写入浏览器 `localStorage`。关闭“在此设备保存原始数据”后，原始文本只保留在当前页面会话中，规则和偏好仍会保存。

浏览器本地存储容量有限。保存失败时，底部状态栏会显示错误；当前页面内的数据不会因此消失，请及时导出工作区备份。完整说明见 [PRIVACY.md](PRIVACY.md)。

## 建议规模与边界

- 单个数据源或工作区文件最大 25 MB
- 每张表默认只渲染 100 行，可切换为 50/250/500 行
- 支持导出 XLSX，不支持直接读取 XLSX
- JOIN 当前使用等值条件
- 大数据建议关闭原始数据持久化，并在关闭页面前备份

## 开发与验证

```bash
npm test
npm run validate:release
```

更多资料：

- [用户指南](docs/user-guide.md)
- [需求与范围](docs/requirements.md)
- [架构说明](docs/architecture.md)
- [路线图](docs/roadmap.md)
- [贡献指南](CONTRIBUTING.md)

## 许可证

[MIT](LICENSE)

