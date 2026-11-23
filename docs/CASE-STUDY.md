# 成熟研究工具的流程借鉴

调研日期：2026-10-31。参考 Zotero 与 Google NotebookLM 的官方说明，目的是减少在阅读、批注、问答与笔记之间重复操作。应用继续使用本机数据与现有华师大接口，不接入这些产品的账户或收费服务。

| 参考流程 | 官方依据 | 本项目采用的方式 |
| --- | --- | --- |
| 从批注整理笔记，保留原文跳转 | [Zotero PDF Reader and Note Editor](https://www.zotero.org/support/pdf_reader) 支持将整篇或选中批注加入笔记，并从笔记返回对应 PDF 页。 | 批注页签支持勾选，点击“从批注生成笔记”后先编辑汇总稿；按页码保留引文、评论和来源，确认后保存为草稿，不调用模型。 |
| 按项目与标签缩小文献范围 | [Zotero Collections and Tags](https://www.zotero.org/support/collections_and_tags) 用集合组织条目，用标签描述主题、方法及工作状态；多个标签可共同筛选。 | 将主题、标签与阅读状态作为不同维度，筛选时保留条件与结果数，避免用重复导入复制同一篇 PDF。 |
| 让用户清楚知道问答依据哪些资料 | [Google 官方问答说明](https://support.google.com/gemininotebook/answer/16179559?hl=en) 提供来源选择、引用预览与回到原文，并支持将回答保留为笔记。 | 单篇阅读默认聚焦当前论文；跨论文分析应通过明确的资料选择控制范围，保存结果时继续保留页码和来源。 |
| 笔记作为资料需要可控 | [Google 官方笔记说明](https://support.google.com/gemininotebook/answer/16262519?hl=en) 通过来源勾选控制笔记是否加入问答。 | 人工确认与草稿状态保持区分，整理批注和保存回答都先产生可编辑草稿。 |

上述内容是流程取舍，不表示已经实现 Zotero 的全部集合、引用插件、同步或 Google 的云端生成能力。Google 原 NotebookLM 帮助链接当前跳转至其 Gemini Notebook 帮助站点，以上保留已核实的官方地址。
