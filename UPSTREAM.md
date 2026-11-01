# 上游来源与本地整合

Papernook 主应用来自 https://github.com/affromero/papernook ，固定提交为 `4f36454eb73f85450882d35519aa41701aca5b39`。其原许可证保存在 `app/LICENSE`。原论文库、PDF 阅读器、Unicode Text 评论、PDF 文件锁与保存、SQLite FTS5 和 Cytoscape 组件被复用，新增中文研究工作区和 PaperFlow provider。

PaperFlow 核心来自 https://github.com/weijian-ai/PaperFlow ，固定提交为 `500baf5a404f6f00133a3280b2cf40d178c63cf7`，连同此前本机的数据目录与密钥日志修正。原许可证保存在 `services/paperflow/LICENSE`。研究服务复用其 AgentRunner、模型 provider、权限和会话存储。

本机专用模式仅绑定回环网页端口，研究接口检查 Host 和写入来源。该模式跳过上游多用户、共享、CLI 登录同步与 Zotero 后台任务。原上游页面仍保留其原有账号逻辑；当前交付入口是 `/workspace`。

第三方依赖保留各自许可证。可选 tldraw Canvas 不在本地产品入口启用。Node 与 Python 基础镜像从公开 ECR 镜像源按摘要固定，用于避开本机 Docker Hub 网络故障；构建和运行均发生在本机。

`examples/` 的三份教育研究 PDF 是原创合成功能测试材料，按 CC0 提供，已在正文和页脚明确说明。它们不代表真实发表论文或实验结果。生成示例 PDF 使用的系统字体只作为文档嵌入子集提供。

中文 Web 字体来自 Adobe 官方 [Source Han Serif](https://github.com/adobe-fonts/source-han-serif)，采用发布分支的 `Variable/WOFF2/OTF/Subset/SourceHanSerifCN-VF.otf.woff2` 原始文件，按 SIL Open Font License 1.1 随项目提供，许可保存在 `app/public/vendor/research-fonts/LICENSE.txt`。浏览器只从本机应用加载字体。Times New Roman 使用访问者系统已安装字体，未复制或分发该字体文件。
