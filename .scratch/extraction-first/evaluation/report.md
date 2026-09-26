# 提取方向初步对照评估

运行：node .scratch/extraction-first/evaluation/evaluate.mjs。输入与期望结果见 [corpus.json](corpus.json)，原型见 [prototype.html](prototype.html)，原始输出见 [results.json](results.json)。

这是设计探针，不是用户准确率或性能基准。core 来自项目测试的改编，并用于开发原型；exploratory 是开发时使用的人工构造混合内容或反例；unresolved 是尚未决定是否属于目标范围的日志/键值。holdout 是原型逻辑冻结后选取的项目测试改编样本，仍是人工选择，不能代表随机真实输入。所有期望结果都需要用户审阅。

## 零交互结果

| 样本 | 范围 | 期望表数 | 当前整表吻合 | 原型整表吻合 | 当前正确字段名 | 原型正确字段名 | 当前正确数据格 | 原型正确数据格 | 原型值有原文依据 |
| --- | --- | ---: | :---: | :---: | ---: | ---: | ---: | ---: | ---: |
| csv-basic | core | 1 | ✓ | ✓ | 2/2 | 2/2 | 4/4 | 4/4 | 4/4 |
| csv-quoted | core | 1 | ✓ | ✓ | 2/2 | 2/2 | 4/4 | 4/4 | 4/4 |
| tsv | core | 1 | ✓ | ✓ | 3/3 | 3/3 | 6/6 | 6/6 | 6/6 |
| markdown | core | 1 | ✓ | ✓ | 2/2 | 2/2 | 4/4 | 4/4 | 4/4 |
| cli-two-tables | core | 2 | ✓ | ✓ | 6/6 | 6/6 | 9/9 | 9/9 | 9/9 |
| aligned | core | 1 | ✓ | ✓ | 3/3 | 3/3 | 6/6 | 6/6 | 6/6 |
| ascii-border | core | 1 | ✓ | ✓ | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| mixed-note | exploratory | 1 | ✗ | ✓ | 0/2 | 2/2 | 0/4 | 4/4 | 4/4 |
| mixed-two-layouts | exploratory | 2 | ✗ | ✓ | 0/4 | 4/4 | 0/8 | 8/8 | 8/8 |
| prose-negative | exploratory | 0 | ✗ | ✓ | — | — | — | — | — |
| single-key-value | unresolved | 0 | ✗ | ✓ | — | — | — | — | — |
| repeated-log | unresolved | 1 | ✗ | ✗ | 0/3 | 0/3 | 9/9 | 9/9 | 9/9 |
| holdout-csv-multiline | holdout | 1 | ✓ | ✗ | 2/2 | 2/2 | 4/4 | 1/4 | 2/2 |
| holdout-markdown-escaped | holdout | 1 | ✓ | ✓ | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| holdout-html | holdout | 1 | ✓ | ✗ | 2/2 | 0/2 | 2/2 | 0/2 | — |
| holdout-cli-multiblock | holdout | 2 | ✓ | ✗ | 5/5 | 1/5 | 5/5 | 1/5 | 3/3 |

- **core**：7 例；当前实现整表完全吻合 7，原型 7。
- **exploratory**：3 例；当前实现整表完全吻合 0，原型 3。
- **unresolved**：2 例；当前实现整表完全吻合 0，原型 1。
- **holdout**：4 例；当前实现整表完全吻合 4，原型 1。

“整表吻合”要求表数、表顺序、字段名和全部记录值均与人工期望一致。“正确字段名/数据格”按相同表/行/列位置计算；它们不是标准信息提取的 precision/recall，超出的表或格没有在这两列扣分，需结合整表吻合和逐例输出审阅。“原文依据”仅检查原型声称的 UTF-16 字符范围可还原其输出值；它不证明字段边界或用户意图正确。当前实现保留整段 raw，但没有逐值范围和显式未解释片段，因此这两项没有给它填零分。

## 上下文和失败审阅

- **mixed-note**：2/2 段指定上下文仍列在“未解释原文”。
- **mixed-two-layouts**：2/2 段指定上下文仍列在“未解释原文”。
- **prose-negative**：2/2 段指定上下文仍列在“未解释原文”。
- **single-key-value**：1/1 段指定上下文仍列在“未解释原文”。

- **mixed-note**：当前实现 csv，1 表；原型 1 表。详见 [逐例输出](results.json)。
- **mixed-two-layouts**：当前实现 excel-paste，1 表；原型 2 表。详见 [逐例输出](results.json)。
- **prose-negative**：当前实现 plain-text，1 表；原型 0 表。详见 [逐例输出](results.json)。
- **single-key-value**：当前实现 plain-text，1 表；原型 0 表。详见 [逐例输出](results.json)。
- **repeated-log**：当前实现 plain-text，1 表；原型 1 表。详见 [逐例输出](results.json)。
- **holdout-csv-multiline**：当前实现 csv，1 表；原型 1 表。详见 [逐例输出](results.json)。
- **holdout-html**：当前实现 html-table，1 表；原型 0 表。详见 [逐例输出](results.json)。
- **holdout-cli-multiblock**：当前实现 cli-multi-block，2 表；原型 1 表。详见 [逐例输出](results.json)。

## 目前能得出的结论

- 开发样本不能用于证明原型泛化能力；独立选取的 holdout 仅揭示更多失败方式。人工构造的混合样本不能推导线上发生率。
- 原型验证了“值 → 原文范围”“剩余原文可见”“表头、表范围和单元格可手动纠正”可以由一个简单的结果契约表达。多行引号 CSV、HTML 和复杂 CLI holdout 的失败说明简易通用行归纳器不足以替换现有解析能力；原型也没有经过浏览器用户试用，不能作为重构方案直接投入生产。
- 尚未收集匿名化真实粘贴样本、人工复核的标准答案、用户完成时间、误关联代价，也没有跨设备性能数据。因此目前不能作出重构的 go/no-go 决定。
- 当前建议：保留已知格式能力作为比较基线，继续验证来源可追溯的结果契约和混合输入上的净收益。不要依据本轮开发样本开始生产重构，也不要把这个简易归纳器当作未来算法定案。
- 浏览器交互尚未实测：本机是 Android/Termux，Playwright 在此平台报 Unsupported platform: android。纯逻辑在 Node 中执行，两个内联脚本通过语法检查；交互和无障碍操作仍需在受支持的浏览器由人完成。

## 下一轮必需证据

1. 收集覆盖常见与困难场景的匿名化真实输入，并让目标用户标出想要的表、字段、记录、上下文和关系；分开记录“本次输入正确”与“规则未来可复用”。
2. 同一任务让用户分别使用当前产品与原型，记录错提/漏提、未发现错误、修正次数、完成时间和放弃率；预先确定可接受门槛。
3. 若原型有可观优势，再估算来源映射、候选搜索、无障碍纠错、工作区兼容和单文件离线交付的正式工程成本。
