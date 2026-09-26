# 无预置格式目录的结构发现：研究备忘

本票只调查技术边界，不决定产品应提取什么，也不以现有解析器或模块为前提。资料限论文原文和项目／标准官方文档；论文中的准确率与耗时均属于其原始任务和设备，不能外推到短片段粘贴。

## 首要发现

**可以不预先枚举 CSV、Markdown、CLI 等“格式”，但不能没有归纳偏好。** 仅给一段原文，记录、字段和层次的解并不唯一：Datamaran 明确给出任意文本可用单字段模板解释的反例，并用覆盖、模板限制和评分缩小搜索空间；作者也承认多种提取结果可能都有效。短片段重复少，通常更难证明哪一个结构是用户想要的——这是从论文问题定义作出的推论，论文没有报告短粘贴样本上的准确率。[Datamaran，问题定义与假设](https://arxiv.org/pdf/1708.08905)（§2–3）、[Datamaran，评价标准](https://arxiv.org/pdf/1708.08905)（§5.1）

| 路线 | 输入与发现方式 | 解释性及原文保留 | 成本、失败方式、浏览器适配 |
| --- | --- | --- | --- |
| **重复结构归纳** | Datamaran 从较长、重复的日志中寻找记录端点、字段端点、多种记录结构及嵌套；不要求预先知道记录边界。它寻找覆盖较多内容的重复模板，裁剪后评分。[论文](https://arxiv.org/pdf/1708.08905)（§1、§4） | 模板和提取字段可解释；论文的“提取成功”要求目标字段可由输出字段重建，并非保留原始字符偏移或全部非结构文本。[论文](https://arxiv.org/pdf/1708.08905)（§5.1） | 完整方案依赖覆盖阈值、分隔字符与字段字符不重叠等假设，且存在候选爆炸；论文需采样、裁剪，50 MB 以下数据的贪心搜索平均 17 秒，实验环境非浏览器。短片段、重复不足、字段含分隔字符时风险明显；可借鉴思想，不应照搬运行时间。[论文](https://arxiv.org/pdf/1708.08905)（§3、§4.2、§5.2.2） |
| **最短描述长度（MDL）** | 用“结构描述长度 + 使用结构编码数据与例外的长度”排序归纳结果；Datamaran、LearnPADS++ 都采用相应变体。[Datamaran](https://arxiv.org/pdf/1708.08905)（附录 §9.2）、[LearnPADS++](https://www.cs.princeton.edu/~dpw/papers/learnpads-padl2012.pdf)（§2.5） | 可解释为何一个重复结构优于大量特例；但 MDL 只是人的结构判断的代理指标。LearnPADS++ 特意另用人工金标准和无错误解析率评价。[LearnPADS++](https://www.cs.princeton.edu/~dpw/papers/learnpads-padl2012.pdf)（§3） | 一个评分原则，不是独立提取器；编码方案、异常代价和搜索范围均需设计。短样本中模板开销容易压过重复收益，因此必须允许“证据不足”；这是由 MDL 目标和短样本作出的推论。[LearnPADS++](https://www.cs.princeton.edu/~dpw/papers/learnpads-padl2012.pdf)（§2.5） |
| **增量语法归纳** | LearnPADS++ 从初始描述或样本记录开始，解析新批次，聚合失败片段，再学习局部描述；可表达顺序、选择、数组和可选项。[论文](https://www.cs.princeton.edu/~dpw/papers/learnpads-padl2012.pdf)（§2） | 输出数据描述可供人修正，错误位置被收集并驱动局部更新；其核心输入已按记录分块，所以未解决任意粘贴文本的记录边界。[论文](https://www.cs.princeton.edu/~dpw/papers/learnpads-padl2012.pdf)（§2） | 多种可能解析与聚合组合是论文明确指出的性能瓶颈；实验以大规模工业数据和服务器级机器为对象。移植成浏览器方案，需要限制语法、候选及推断预算。[论文](https://www.cs.princeton.edu/~dpw/papers/learnpads-padl2012.pdf)（§2.2、§3） |
| **多样本 HTML 模板归纳** | 从同一模板生成的多个页面间的共同部分与差异推断数据字段；适合重复 DOM 页面，而不是一段孤立的纯文本。[Arasu 与 Garcia-Molina](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/extract.pdf)（§1） | DOM 路径与差异可解释，但不能自动等同于用户希望保留的字段；一个粘贴片段缺少跨页面对照。[论文](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/extract.pdf)（§1） | 浏览器已有 DOM，适于处理富文本；若只有一个片段或页面模板不稳定，共同结构证据不足。后一句是由论文的多页面输入前提作出的推论。[论文](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/extract.pdf)（§1） |
| **按例子合成提取规则** | FlashExtract 让用户标出字段与记录区域，按示例合成文本、网页和电子表格的提取程序，也能表达层次。[论文](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/pldi14-flashextract.pdf)（§1、§3） | 示例直接表达“什么信息重要”；文本区域用字符位置，网页区域用 DOM 节点或节点内位置，因此天然适合给结果附来源范围。[论文](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/pldi14-flashextract.pdf)（§3） | 需要示例标注交互与受限规则语言；一两个示例对例外数据仍可能泛化错误。论文的 75 文档、每字段平均 2.36 个示例和 0.84 秒是其基准设置，不证明本产品表现。[论文](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/pldi14-flashextract.pdf)（§1、§6） |
| **本地模型辅助** | 浏览器可通过 WebLLM 或 Transformers.js/ONNX Runtime Web 在本机推理，由模型提出结构或边界。[WebLLM 官方仓库](https://github.com/mlc-ai/web-llm)、[Transformers.js 官方仓库](https://github.com/huggingface/transformers.js) | 模型输出的字段值不天然带可验证原文位置；若需要信息保留，仍须对返回值做原文范围对齐及未解释内容检查。这是产品设计推论，不是上述工具的性能声明。 | ONNX Runtime Web 部署需 JS、WASM 和模型文件；WebLLM 的一个 1B 预置配置标注约 879 MB 显存需求。模型及运行时可本地打包，但与零运行时依赖、轻量单文件交付存在显著体积和设备兼容性代价；WebGPU 还有安全上下文要求。[ONNX Runtime Web 部署](https://onnxruntime.ai/docs/tutorials/web/deploy.html)、[WebLLM 配置](https://github.com/mlc-ai/web-llm/blob/main/src/config.ts) |

## 信息保留与来源定位

FlashExtract 的“区域”概念是可借鉴的独立结果契约：文本用原文字符范围，网页用 DOM 节点或节点内字符范围；结构关系再由区域之间的包含和顺序表达。[FlashExtract](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/pldi14-flashextract.pdf)（§3）若目标是可核查提取，建议把每个输出值、记录边界与被忽略内容都映射到原文片段，允许显示有依据的“未解释内容”；这是根据该区域模型推导出的设计建议，尚非上述论文验证过的整套产品方案。

对 HTML，DOM 节点位置与**原始 HTML 字符偏移**需区分。HTML 标准的解析流程从码点流生成 DOM；DOM Range 的边界是节点及节点内偏移，不承诺回溯到原始 HTML 的确切字节位置。因此若要保留粘贴 HTML 的逐字来源，应同时留存原始剪贴板内容并另建映射；否则可明确只承诺 DOM 文本级溯源。[WHATWG HTML 解析](https://html.spec.whatwg.org/multipage/parsing.html)、[WHATWG DOM Range](https://dom.spec.whatwg.org/)

覆盖率也不是充分指标：把整段文本放入一个字段可达到 100% 字符覆盖，却几乎没有可用结构。Datamaran 同时考虑结构合理性，并在评价中要求记录边界正确、目标字段可重建。[Datamaran](https://arxiv.org/pdf/1708.08905)（§2、§5.1）因此需要分别量化信息遗漏、字段边界、记录关系和异常内容；具体权重须由目标用户任务与样本决定。

## 对决策地图的提示

1. **先确定目标信息与容错标准。** “恢复全部原文”“抽取供分析的字段”“识别表块与层次”可能对应不同正确答案；Datamaran 的评价定义也承认多个结构合理。[Datamaran](https://arxiv.org/pdf/1708.08905)（§5.1）
2. **把短样本列为单独决策。** 自动归纳的重复证据可能不足；标出一处记录或字段的交互式示例，可能比扩大无监督搜索更有效。后半句是将 FlashExtract 的示例机制用于短粘贴场景的推论，需本项目样本验证。[FlashExtract](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/pldi14-flashextract.pdf)（§1、§6）
3. **比较系统形态时分开两项开销。** 规则归纳消耗候选搜索和解释设计；本地模型消耗模型打包、首次载入、运行内存及设备支持。二者都不能单凭“能输出表格”证明数据已忠实保留。[Datamaran](https://arxiv.org/pdf/1708.08905)（§4–5）、[ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/deploy.html)
