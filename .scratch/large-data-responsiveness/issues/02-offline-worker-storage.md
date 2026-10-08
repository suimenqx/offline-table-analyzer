# 单文件后台计算与异步原文存储是否可行

Labels: wayfinder:research
Type: research
Mode: AFK
Status: resolved
Assignee: /root/offline_runtime_research
Parent: [大数据完整分析流程保持响应](../map.md)
Blocked by:

## Question

在保持直接打开 `file://`、一个 HTML、零外部请求的前提下，内嵌 Blob Worker 与异步大原文存储的可行边界是什么？哪些事实能由官方规范确认，哪些必须由目标 Chrome 和兼容性探针确认？

研究官方 API/规范以及当前 OTA 模块依赖：Worker 如何装入确定性构建的纯计算代码；哪些模块有 DOM 依赖，特别是 HTML 解析的 DOMParser 与无 DOM 分支是否等价；消息克隆与 transferable 的真实限制；取消同步计算与 Worker 失败后的可恢复边界；IndexedDB/OPFS 在文件来源、隐私模式和配额下的限制及异步接口。

答案给出事实矩阵与必须验证的最小探针，不能以浏览器支持该 API 推断任意 `file://` 工作区都保证启动或持久恢复。将依据写到项目调研文件并链接。只关闭事实调查，不替用户选择容量、存储政策、交互或架构方案。

## Comments

依照用户协议，本研究在 `main` 进行，不创建 wayfinder 建议的 throwaway research 分支。

2026-10-08，/root/offline_runtime_research：已读取 research 技能并认领后调查。检查 OTA loader、固定构建 manifest、ImportEngine、HTML 两分支、QueryService、Store、TableRegistry 与导出边界；核对 WHATWG URL/Storage/HTML、IndexedDB 规范及 MDN Worker、Transferable、OPFS、安全上下文、配额资料。只写调研资产，没有运行浏览器、原型或基准；无应用/构建/schema 修改。

## Answer

规范与官方示例支持“内嵌固定后台代码 → Blob URL → 专用 Worker”的单文件零外部资源候选；OTA loader/纯计算依赖有可行装入路径，但当前完整运行时包含 DOM/Store/下载依赖，不能整体搬入。DOMParser 仅 Window 暴露，现有无 DOM HTML 分支与浏览器分支不等价。普通消息序列化不能视为整表零复制；ArrayBuffer 转移分离发送端。协作取消需要返回事件循环，terminate 会丢失 Worker 常驻的全部内存数据。

IndexedDB/OPFS 提供异步或 Worker 侧存储机制，但 file URL 来源、storage key、权限/配额、隐私模式与文件移动后的恢复没有统一保证。API 存在、secure context、一次写入成功均不能替代真实 file:// 重开验收；容量、持久政策和架构仍未选定。

资产：[单文件离线 Worker 与异步原文存储事实调查](../../../docs/planning/offline-worker-storage-research.md)。包含事实矩阵、源码边界、10 个关键官方来源、最小兼容性探针和失败语义。票状态 resolved 仅表示事实研究完成，不表示 Chrome/离线/恢复验证通过。
