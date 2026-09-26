# 示例驱动与交互式信息提取：研究备忘

研究问题：用户标注一两个字段、记录或边界后，系统能否推广提取规则？主动澄清和可视化纠错有何收益及成本？本文只依据原论文、作者机构页面、产品官方资料和 Web 标准。结论服务于“从粘贴内容得到可信结构化信息”，不以当前解析器、模块或表格模型为前提。

## 主要结论

**示例能表达提取意图，尤其适合格式名称无法表达的目标。** FlashExtract 让用户在原始文本、网页或电子表格上圈选所需字段及记录边界，合成可重复执行的提取程序；字段可组成记录和层级，用户也能用反例纠正误提取。它处理的是“哪些内容属于哪个字段、哪些字段属于同一记录”，超出先识别 CSV/Markdown 等格式再整体解析的目标。PowerShell 的 `ConvertFrom-String` 曾把这种做法做成模板式产品，官方例子用两个带字段标注的记录推广到整份文本。[FlashExtract 原论文](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/pldi14-flashextract.pdf)、[PowerShell 官方示例](https://devblogs.microsoft.com/powershell/convertfrom-string-example-based-text-parsing/)

**一两个示例不是“已证明正确”的依据。** 同样的标注可能与大量不同规则一致，规则会在未标注位置产生不同结果。FlashProg 因此保留候选规则，在实际输入中寻找它们输出不一致的位置，问用户“选 A、选 B、还是都不要”；用户的回答变成正例或反例，再重新合成。论文明确指出，若表达规则的语言无法覆盖目标任务，增加示例也不能解决。[FlashProg 原论文](https://www.microsoft.com/en-us/research/uploads/prod/2018/01/uist2015-disambiguation.pdf)

**最有潜力的形态是预测草稿加按需标注。** 另一项原论文用输入自身的重复关系、分隔符上下文和字段对齐来推断提取程序，先生成结果，再让用户拆分或合并字段。论文指出，每字段两三个示例在十几个甚至约五十个字段的任务中会累积成很大负担；但纯预测在字段缺失、对齐有多个解释时会失败，此时用户示例有价值。这里的“先草稿、再澄清”是由两项研究推导的产品建议，**尚不能宣称已有论文验证了该组合在本项目的效果**。[预测式程序合成原论文](https://ojs.aaai.org/index.php/AAAI/article/view/10668/10527)

## 证据与适用边界

| 路线 | 实际机制与证据 | 对短样本、新布局的意义 | 主要成本或限制 |
| --- | --- | --- | --- |
| 用户示例合成 | FlashExtract 用标注的文本位置、网页节点或单元格区域学习重复字段、记录边界及父子关系；可用正例、反例和外层边界修正。它在作者选取的 75 份文档上报告每字段约两到三个示例和亚秒级平均学习时间。论文摘要写 **2.36 个、0.84 秒**，正文评估写 **2.86 个、0.82 秒**，数值存在内部差异；评估使用 C#、旧桌面硬件及模拟用户逐步选择错误位置，不能外推为浏览器保证值。[原论文](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/pldi14-flashextract.pdf) | 在没有已知格式名时，用户可直接指出目标字段；若样本只有一条记录、没有变化实例，同一标注仍能对应多种规则，必须保留不确定性。后半句是由示例歧义推导。 | 需要为每个字段或边界提供示例；必须设计有限且适当的提取语言。语言越丰富，搜索和解释成本越高。[FlashExtract 原论文](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/pldi14-flashextract.pdf)、[FlashProg 原论文](https://www.microsoft.com/en-us/research/uploads/prod/2018/01/uist2015-disambiguation.pdf) |
| 主动澄清 | FlashProg 比较多个符合现有示例的候选在当前数据上的输出，只询问分歧位置。29 名完成用户的三项提取任务中，澄清界面的错误数低于基础界面，报告 `p=0.01`，完成时间无统计显著差异；规则导航的比较为 `p=0.06`，不宜按常用 `0.05` 阈值称为显著。研究还有 50 多名中途退出者及有限任务范围。[原论文](https://www.microsoft.com/en-us/research/uploads/prod/2018/01/uist2015-disambiguation.pdf) | 对含糊布局比再问一个随意样例更有效；若候选在当前短输入上的输出完全相同，系统找不到有区分力的问题，需更多输入、明确用户意图或停在待确认状态。这是由算法提问条件推导。 | 要维护多个候选及其输出差异、选择问题和反例语义；界面必须提供“都不要”和手动标注退路。论文说明其前几名候选限制会令建议不完整。[原论文](https://www.microsoft.com/en-us/research/uploads/prod/2018/01/uist2015-disambiguation.pdf) |
| 可视化纠错 | FlashExtract 直接在原文上高亮推断出的所有同类位置，并允许排除错误命中；FlashProg 研究发现 27/29 名用户使用澄清面板，而只有 13/29 使用规则查看器。Wrangler 则通过直接选择数据、建议操作和变换预览支持迭代审阅。[FlashExtract](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/pldi14-flashextract.pdf)、[FlashProg](https://www.microsoft.com/en-us/research/uploads/prod/2018/01/uist2015-disambiguation.pdf)、[Wrangler 原作者项目页](https://idl.uw.edu/papers/wrangler) | 将“当前内容提取成什么”直接显示在原文和结果中，比先让用户理解抽象规则更容易校对；这是交互设计推断，不是本项目实测。 | 需要原文位置映射、高亮与结果联动、撤销、遗漏提示，以及键盘和单指可用的标注途径。拖动操作的替代方式受 WCAG 2.2 约束。[W3C WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/) |
| 纯输入预测 | 预测式合成从多个输入中的稳定分隔与字段对应关系生成结构，无须用户逐字段标注；作者在 20 个文本任务上报告平均 13.95 个字段，其中首次得到 10.3 个，进一步拆分得到 3.45 个，0.2 个未得出；平均 4.2 秒。这些数据来自 Excel 插件及其作者选取的语料，不代表本产品性能。[原论文](https://ojs.aaai.org/index.php/AAAI/article/view/10668/10527) | 可降低常见清晰数据的交互负担；对缺失字段导致的行列对齐歧义，原论文也建议让用户提供输出示例。[原论文](https://ojs.aaai.org/index.php/AAAI/article/view/10668/10527) | 搜索、候选去重与排序并不简单；原论文移除专门的提速方法后，文本任务平均时间由 4.2 秒增至 210.73 秒。[原论文](https://ojs.aaai.org/index.php/AAAI/article/view/10668/10527) |

## 对目标产品的设计含义（研究推导）

1. **把用户意图作为结果契约的一部分。** 可让用户选出一个字段或一条记录，并给出目标结构；系统返回字段值、所属记录、原文范围、未分配片段和待决歧义。这样用户能校验“信息去了哪里”，而不是只看到格式名称或最终矩形表。FlashExtract 以原文区域和层级输出为核心；Wrangler 强调变换的可审阅性。[FlashExtract](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/pldi14-flashextract.pdf)、[Wrangler](https://idl.uw.edu/papers/wrangler)
2. **从零示例草稿开始，只在必要处分歧提问。** 用户可以直接接受草稿、点选漏掉的字段、排除误提取，或标一条记录边界。后台候选可由有限组合规则生成：局部文本上下文、字符类别、重复块、缩进、列对齐、DOM 邻接等；规则是内部提取工具，不要求给整段输入套唯一格式标签。有关预测与示例合成互补性的依据见上述两篇原论文；组合效果须在本项目语料验证。[预测式合成](https://ojs.aaai.org/index.php/AAAI/article/view/10668/10527)、[FlashExtract](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/pldi14-flashextract.pdf)
3. **把“无法从现有样本确定”作为正常结果。** 若短输入中多个候选给出同一结果，可以接受当前数据的提取预览，但不要声称规则可用于未来同类输入；若多个候选当前输出不同，展示差异并请用户选择。FlashProg 的实测只证明特定任务中澄清有帮助，未证明任何系统能凭无区分信息恢复唯一意图。[FlashProg](https://www.microsoft.com/en-us/research/uploads/prod/2018/01/uist2015-disambiguation.pdf)
4. **谨慎评估离线单文件实施。** 有界的文本规则合成和差异提问原则上可以在浏览器内用本地 JavaScript 实现，算法本身无网络依赖；这是工程推断。计算应有样本、候选数、时间与内存预算。Web Workers 标准提供与界面脚本独立运行的机制，但单文件 `file://` 交付时如何打包并启动 Worker 仍需实际验证，且并行化不能消除规则搜索的复杂度。[WHATWG Workers 标准](https://html.spec.whatwg.org/multipage/workers.html)、[预测式合成原论文](https://ojs.aaai.org/index.php/AAAI/article/view/10668/10527)

## 建议下一步要做的决策

- 用户最终想要的是“整份内容尽可能完整地转成表格”，还是“圈出感兴趣的信息，并允许其它原文不进入结果”？前者要求覆盖率，后者要求意图和遗漏提示；示例驱动路线的价值取决于此。
- 典型一次粘贴涉及多少字段、多少记录、是否经常重复处理同源数据？这决定逐字段示例的交互负担能否接受。
- 可信结果是否必须保留每个字段的原文位置、规则可复用性说明，以及用户未确认的候选分歧？
- 可接受的响应预算与待确认次数是多少？应拿本产品真实粘贴样本比较：无示例草稿、一次标注、主动澄清三种流程的字段召回、错配、遗漏及用户耗时。
