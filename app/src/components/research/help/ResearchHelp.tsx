"use client";

import { ArrowUpRight, BookOpen, ChevronDown, Search, X } from "lucide-react";
import { useState } from "react";
import type { ResearchPaper } from "@/lib/research/types";
import styles from "./help.module.css";

export type HelpDestination =
  "library" | "notes" | "review" | "education" | "search" | "graph" | "tasks";

type HelpSection = {
  id: string;
  title: string;
  lead: string;
  steps: string[];
  tip?: string;
  destination: HelpDestination;
  action: string;
  keywords: string;
};

export const helpSections: HelpSection[] = [
  {
    id: "home",
    title: "从首页快速进入资料",
    lead: "从底部进入文献库、研究笔记或知识图谱，也可搜索论文和继续阅读。",
    steps: [
      "在项目文件夹双击“启动Demo.cmd”打开应用。安装桌面入口后，也可双击“打开教研阅记（openhai）”；关闭后台用“停止Demo.cmd”或桌面“关闭教研阅记（openhai）”，本机资料会保留，Docker Desktop 不会被关闭。",
      "点击“查找论文”或按 Ctrl + K，按题名、作者或标签搜索本机文献库；点击结果打开论文。Enter 打开首条结果，Esc 关闭搜索。",
      "点击首页底部的“文献库”“研究笔记”或“知识图谱”，直接进入相应工作区。",
      "首页画作会缓慢轮换。点击画作暂停，再点击继续播放；也可聚焦画作后按空格或 Enter。",
      "“继续阅读”返回最近阅读的论文与页码。点击工作区左上角“教研阅记”可回到首页。",
    ],
    tip: "画廊、首页搜索与功能导航均在本机完成。",
    destination: "library",
    action: "打开文献库",
    keywords:
      "首页 封面 雅典学院 画廊 画作 轮换 暂停 播放 空格 Enter Ctrl K 查找论文 最近 笔记 概念 打开 关闭 启动 停止 桌面 快捷方式",
  },
  {
    id: "library",
    title: "导入与整理文献",
    lead: "把论文集中到文献库，再按课题、标签和阅读状态整理。",
    steps: [
      "打开文献库，点击“导入论文”，选择或拖入 PDF；可一次选择多篇，系统会依次处理。",
      "文献卡自动显示 PDF 第一页封面，不使用模型；封面暂不可用时显示文件图标，仍可正常打开论文。点击卡片下方“编辑信息”，核对题名、作者、年份、主题和标签后保存。",
      "用主题下拉框和阅读状态缩小范围。“筛选标签”可以多选，结果必须同时具备全部所选标签；已选标签可逐个移除，“清除筛选”会重置全部筛选条件。",
      "文献库搜索可查题名、作者、年份、主题和标签；按“最近导入”“最近更新”或“标题 A–Z”排序。列表视图适合查看较长标题。",
    ],
    tip: "主题区分课题，标签交叉标记。同一份 PDF 重复导入会复用已有记录；若它在回收站，请先恢复。",
    destination: "library",
    action: "打开文献库",
    keywords:
      "上传 PDF 标签 作者 年份 阅读状态 列表 排序 封面 首页 collection tag",
  },
  {
    id: "trash",
    title: "删除与恢复文献",
    lead: "删除会将文献移入回收站，PDF、笔记和批注都会保留。",
    steps: [
      "在文献卡下方点击“删除”，核对论文标题后点击“移入回收站”。如有关联分析仍在运行，先到“任务与设置”停止该任务。",
      "文献库右上角点击“回收站”，找到文献后点击“恢复”，原有笔记和批注会一起回到工作区。",
      "回收站文献不参与检索、图谱、新分析与复习；引用它的笔记或题组也会暂时隐藏。恢复后保留原有学习进度。删除不释放磁盘空间，备份也会保留回收站内容。",
    ],
    destination: "library",
    action: "打开文献库",
    keywords: "删除文献 删除论文 回收站 恢复 误删 重复上传 空间 trash restore",
  },
  {
    id: "reader",
    title: "阅读原文与保存批注",
    lead: "阅读器负责在 PDF 上做标记，右侧工作区负责整理这些标记和想法。",
    steps: [
      "点击论文卡片进入阅读工作台。完整题名、作者、年份、页数和主题可点顶部标题旁的信息图标查看；顶部“PDF”按钮打开论文文件。使用翻页、缩放和全屏阅读，再次打开时会恢复本机浏览器记住的位置。",
      "桌面可拖动 PDF 与右侧工作区之间的分隔条调整宽度；窄屏上下排列时，可拖动分隔条调整 PDF 高度。点击工具栏的缩放百分比，可让原文适合当前宽度。比例会记住在当前浏览器中。",
      "用 Tab 聚焦分隔条后，可用左右键调整宽度、上下键调整高度，Home / End 移到允许边界。双击分隔条或点击“恢复默认阅读布局”图标，可还原默认布局。",
      "主工具栏保留“选择”“写评论”和“更多”。拖选文字后，可一键“高亮”、为选文“写想法”或“提问”；高亮后可继续阅读，不会强制切换右侧页签。",
      "“更多选文操作”可选黄色、绿色、蓝色或粉色，当前浏览器会记住颜色。同一处重复高亮会复用已有记录；误标时，在“高亮已保存”提示中点击“撤销”。",
      "“更多”提供原生高亮、文本框、手写和页面便签。原生修改约在停止操作 1.8 秒后自动保存；失败时点击“重试”，看到保存完成再离开。要在侧栏整理原文摘录，请使用选文下方的快捷“高亮”。",
      "点击顶部“PDF”可打开或下载当前 PDF；导出的文件保留已保存的标准 PDF 批注。",
      "Ctrl + P 打印当前阅读工作区的文字记录与论文信息。要打印论文全文，请先保存批注，再点击顶部“PDF”，在 PDF 阅读器中检查打印预览并打印。",
    ],
    tip: "扫描件仍可阅读和批注；没有文字层时无法直接选中文字，本版不会自动 OCR。",
    destination: "library",
    action: "选择一篇论文",
    keywords:
      "高亮 颜色 黄色 绿色 蓝色 粉色 撤销 重复 写想法 写评论 更多 手写 文本框 页面便签 选区 摘录 自动保存 重试 PDF 放大 缩放 OCR 分屏 分隔条 宽度 高度 拖动 恢复默认 打印 Ctrl P",
  },
  {
    id: "comments",
    title: "写评论与整理批注",
    lead: "原文摘录与个人想法分开保留，可随时回到来源页。",
    steps: [
      "点击“写评论”，输入想法后“保存评论”，也可按 Ctrl / Cmd + Enter 保存。普通评论默认当前可见页，可展开“更改页码”；从选文发起时，来源页固定。",
      "右侧“批注”区分原文和个人想法。用“搜索原文或想法…”查找内容；开启“当前页”只看正在阅读页的批注，再点击可恢复全部。点击页码返回原文，“提问”把该段原文带到阅读助手。",
      "点击 PDF 标记只打开一张卡片，可“添加想法”或“编辑想法”，也可直接“提问”。长内容在卡片内滚动；点击空白处或按 Esc 关闭。有未保存修改时，可选择继续编辑或放弃修改。",
      "删除前会在页面内确认，成功后同步从 PDF 与列表移除。对只有高亮的条目，保存空想法可保留高亮；普通独立评论需有正文。外部阅读器的批注可只读查看。",
      "点击“整理成笔记”才进入选择模式，默认选中当前列表，可减选或取消；搜索和当前页筛选会影响范围。点击“生成草稿”，在统一编辑器修改、预览，再“保存草稿”。",
    ],
    tip: "选文高亮、评论与批注整理都不调用模型。已成功暂存的笔记可直接关闭；未暂存时会在编辑器内提示。版本冲突请先保留输入，再核对。",
    destination: "library",
    action: "打开文献库",
    keywords:
      "写评论 删除评论 编辑评论 添加想法 编辑想法 提问 搜索批注 当前页 空想法 comment 批注列表 整理成笔记 全选 生成草稿 预览 版本冲突 更改页码 Ctrl Cmd Enter",
  },
  {
    id: "assistant",
    title: "自由讨论与原文核对",
    lead: "选文提供话题，参考概念帮助理解；需要核查论文证据时开启“仅依据原文”。",
    steps: [
      "在 PDF 中选中文字，点“提问”，再写下自己的问题；也可从批注卡片直接提问。输入框上方会显示选文和页码，点击叉号可移除选文范围。Enter 发送，Shift + Enter 换行；生成时可“停止”。",
      "默认“自由讨论”，可以问含义、原因、理论联系、例子或自己的研究想法，不要求固定回答格式。开启“仅依据原文”后切为原文核对；补充知识与作者结论应分别理解。论文卡、图谱提取和自测题仍以明确材料为依据。",
      "“概念”默认自动匹配相关条目；可展开手动选择，最多 4 个，也可选“不参考”。已采用的概念显示为标签，可逐个移除；点击“自动匹配”恢复自动选择。没有相关概念时仍可正常提问。",
      "同一段选文可连续追问“为什么”“换个例子”或“还有什么适用条件”。更换选文会建立新的讨论范围；重看旧回答后，需点击“沿用此次来源”再继续该段讨论。",
      "跨论文提问前，展开“提问来源”勾选其他论文，最多合计 4 篇。当前论文始终保留，“仅当前论文”可重置。其他论文提供相关页片段，需要分别回看来源核对。",
      "“更多选文操作 → 直接解释选文”可快速获得讲解；随后可“举个例子”“深入解释”或“检查我的理解”。检查理解按同一段原文反馈，不自动评分。",
      "“这次提问”保留当时的回答方式、概念、选文与来源。点击“编辑为笔记”，会一起带入原文、问题、回答和“我的思考”，编辑并核对来源后再保存。",
      "点击右侧页签末尾的“Aa”，选择“小 13px”“中 14px”或“大 16px”；默认“中”，当前浏览器会记住选择。PDF 原文大小仍用阅读器缩放调整。",
    ],
    tip: "自由讨论按问题载入少量相关原文，必要时继续查阅所选论文。长对话保留近期交流和较早讨论摘录，不代表模型有无限上下文。生成使用自己配置的模型额度；查看、编辑和保存已有结果不调用模型。",
    destination: "library",
    action: "选择论文开始提问",
    keywords:
      "AI 自由讨论 仅依据原文 原文核对 概念 自动匹配 不参考 连续追问 上下文 论文卡 方法分析 解释选文 举个例子 深入解释 我的理解 反馈 费曼 问答 模型 额度 停止 历史 来源快照 这次提问 沿用此次来源 提交的选文 字号 字体 Aa 大小 分析过程 折叠",
  },
  {
    id: "learning",
    title: "把阅读材料整理成笔记或自测题",
    lead: "在阅读页的“笔记”页签开始，先选材料范围，再生成。",
    steps: [
      "点击“整理重点”生成可编辑的阅读笔记；点击“生成自测题”进入出题设置。已有笔记也可点击“用这份笔记复习”。",
      "在“材料范围”选择整篇论文、当前选文、已有批注或已保存笔记。选批注时勾选具体条目；选笔记时核对笔记名称。没有选文或相应资料时，该选项不可用。",
      "整理重点完成后，在结果中点击“编辑为笔记”。修改标题和正文，切换“预览”检查排版，核对来源后“保存草稿”；确认内容准确后，再到“研究笔记”确认入库。",
      "生成自测题时，选择 3、5 或 8 题并点击“生成自测题”。题目就绪后，先保存手头的 PDF 批注和笔记，再点击“开始逐题复习”。题组保存后可在“学习复习”中继续。",
    ],
    tip: "材料范围限定本次学习输入，普通问答的跨论文选择不会自动加入。长材料可能截断，请留意范围提示；来源笔记或批注在生成期间改变时，请核对后重新生成。",
    destination: "library",
    action: "选择论文开始整理",
    keywords:
      "整理重点 康奈尔 材料范围 整篇 选文 批注 已保存笔记 草稿 编辑 预览 生成自测题 3题 5题 8题",
  },
  {
    id: "review",
    title: "逐题作答与持续复习",
    lead: "先回想和作答，再看参考答案，最后由自己判断掌握程度。",
    steps: [
      "打开“学习复习”，按论文或来源笔记筛选题组，点击“开始复习”或“继续复习”。题目逐一显示，参考答案默认隐藏。",
      "在“我的回答”写下理解，也可以先在心中回答，再点击“查看参考答案”。对照答案与原文来源，自评“会了”或“还不会”，再点击“下一题”或“完成本轮”。模型不替你自动评分。",
      "输入中的回答先暂存当前浏览器；查看答案、自评和跳题会保存到本机工作区。看到“回答已保存”或自评记录后再离开，刷新可继续当前进度。",
      "想集中补缺时点击“只练未掌握”或完成后的“重练未掌握”；“全部再练一遍”可重新练习整个题组。",
      "题目或答案有误时点击“编辑题目”。不适合当前复习的题目可“暂停此题”，之后在“已暂停”中恢复。修改题目或答案后，需要重新自评。",
    ],
    tip: "下次复习时间采用简单本机间隔：“还不会”约 10 分钟后，“会了”约次日。它不是 FSRS，也不会自动发送通知；请自行打开应用继续。来源更新时先核对原文再练习。",
    destination: "review",
    action: "打开学习复习",
    keywords:
      "学习复习 自测 问答 参考答案 我的回答 会了 还不会 进度 自动保存 继续 未掌握 编辑 暂停 恢复 间隔 FSRS 通知",
  },
  {
    id: "notes",
    title: "编辑草稿并确认入库",
    lead: "草稿用于保留待整理的内容，“确认入库”表示你已经审核，可以用于个人研究检索。",
    steps: [
      "在“研究笔记”选择一条笔记，或“新建笔记”。填写标题和正文，新笔记选好关联论文，再点击“保存”或按 Ctrl / Cmd + S。保存后继续更新同一条笔记。",
      "“本机草稿”暂存在当前浏览器，可直接关闭、切换或刷新，重新打开原笔记可恢复。未保存的生成稿可从“研究笔记 → 本机草稿”恢复。浏览器无法暂存时请手动保存；离开前会在编辑器内提示。",
      "正文可以直接输入普通文字；“# 标题”表示一级标题，“## 小节”表示小标题，“- 要点”表示列表。点击“预览”检查排版与自测卡片。",
      "发现笔记有新版本时，先“查看当前版本”。可“保留草稿并打开新版本”，或“将草稿另存为新笔记”；旧版本不会直接覆盖新内容。若另一窗口改变了本机草稿，可先“另存本机草稿”。",
      "点击“原文依据”中的页码回到来源。核对内容并加入自己的理解后，点击“确认入库”。",
      "需要把结果用于其他工具时，点击“导出笔记”，下载 Markdown 文件。",
    ],
    tip: "本机草稿不随工作区备份，清除浏览器数据会将其删除。保存到工作区的草稿仍需“确认入库”才参与个人检索；已确认笔记的保存会更新其已确认版本。",
    destination: "notes",
    action: "打开研究笔记",
    keywords:
      "本机草稿 恢复 暂存 刷新 Ctrl Cmd S 保存 未保存 新版本 冲突 另存 确认入库 Markdown 预览 编辑 笔记 导出",
  },
  {
    id: "search",
    title: "查找资料与回到原文",
    lead: "文献库搜索用来找论文，个人检索用来找论文正文、批注与已经确认的笔记。",
    steps: [
      "点击“个人检索”，输入关键词，例如 CiteSpace 或 harness。可在“个人研究知识库”“教育概念库”“所有资料”之间切换范围。",
      "点击结果标题或页码打开对应论文。留意结果标明的是“原文片段”“研究笔记”还是“教育概念”。",
      "在工作区按 Ctrl + K 可聚焦顶部搜索框，输入关键词并按 Enter，进入检索页；在封面首页，这个快捷键打开本机论文快速搜索。",
      "教育概念库中的条目可作为阅读提示；添加概念时填写解释与资料出处。需要模型结合概念库时，在问题中明确提出。",
    ],
    tip: "跨论文问答先在阅读助手的“提问来源”中勾选资料，再说明比较问题；未勾选的论文不会自动加入。教育概念库可在问题中明确请求参考。",
    destination: "search",
    action: "打开个人检索",
    keywords: "搜索 检索 来源 页码 教育概念 知识库 Ctrl K 跨论文",
  },
  {
    id: "graph",
    title: "阅读知识图谱与核对证据",
    lead: "在研究网络中浏览论文、概念和笔记，沿着关系回到原文证据。",
    steps: [
      "“研究网络”展示论文、概念和笔记，“论文关系”只展示论文连接。按论文筛选，或搜索节点名称、解释；搜索保留命中节点及一阶相邻节点，筛选时保留节点位置。",
      "点击画布或右侧“节点”“待核对”列表，同步选中并查看详情。节点详情中的“只看相邻”可聚焦局部，点击画布上方“返回全图”退出。",
      "点击“整理关系”更新本地候选，虚线表示候选；“候选关系”开关控制显示。点击关系查看两端节点、原文摘录和来源页码，核对后“确认关系”或“拒绝”；点击两端节点可继续浏览。",
      "拖动节点调整位置，滚轮或＋/－按钮缩放。聚焦画布后可按＋/－缩放、0 适应画布。“适应画布”调整显示范围，“重新布局”重新排列节点。",
      "打开“导出”：选择“当前图谱 PNG”保存当前筛选范围的图谱，或“完整数据 JSON”保存完整图谱数据。",
    ],
    tip: "缩小或窄屏时保留论文名；点选、悬停或放大可查看概念与笔记名称，右侧列表保留完整名称。",
    destination: "graph",
    action: "打开知识图谱",
    keywords:
      "图谱 研究网络 论文关系 搜索 节点 相邻 返回全图 待核对 候选 虚线 确认 拒绝 原文证据 页码 缩放 适应画布 重新布局 导出 PNG JSON",
  },
  {
    id: "planner",
    title: "研究待办与日历",
    lead: "为下一步阅读和写作安排一个可核对的截止时间。",
    steps: [
      "打开“任务与设置 → 研究待办”，输入“明天下午五点三十分完成精读”，点击“填写待办”。",
      "核对表单中的标题、北京时间、优先级和关联论文，再点击“保存待办”。未识别出日期时，手动填写截止时间。",
      "完成后点击圆形完成按钮；也可编辑、归档或在“已归档”中恢复。",
      "点击“导出日历”下载 ICS 文件，手动导入自己的日历软件。文件包含待完成事项提前 15 分钟的提醒。",
    ],
    tip: "网页关闭后不会自行推送提醒；日历提醒需要你把 ICS 导入日历软件，并启用该软件的通知。",
    destination: "tasks",
    action: "打开任务与设置",
    keywords: "待办 截止 日期 提醒 时间 日历 ICS 归档 优先级",
  },
  {
    id: "backup",
    title: "导出与完整备份",
    lead: "成果导出用于带走阅读成果，完整备份用于恢复整个本机工作区。",
    steps: [
      "导出笔记使用“研究笔记 → 导出笔记”；导出当前 PDF 使用阅读页顶部“PDF”；图谱可导出图片或 JSON。",
      "“任务与设置 → 工作区设置”中的工作区下载用于保存可见研究成果，不包含模型服务的内部会话。",
      "需要完整备份时，回到项目文件夹，双击“备份Demo.cmd”。脚本会暂时停止服务，备份后重新启动；ZIP 保存在 backups 文件夹。",
      "恢复时先再做一份当前备份，再双击“恢复备份.cmd”，粘贴完整备份 ZIP 的路径。恢复脚本会检查归档，并把当前数据另存后再恢复。",
    ],
    tip: "完整备份包含已保存的复习记录，不包含当前浏览器尚未写入工作区的回答草稿，也不包含私有模型配置 private/model.env。停止应用用“停止Demo.cmd”，本机资料会保留。",
    destination: "tasks",
    action: "打开任务与设置",
    keywords: "导出 备份 恢复 ZIP 数据 本机 停止 启动 配置",
  },
];

export const helpQuestions = [
  {
    question: "“本机草稿”和“已保存”有什么区别？",
    answer:
      "本机草稿只在当前浏览器暂存，清除浏览器数据会删除，也不进入工作区备份；“保存”或 Ctrl / Cmd + S 才写入本机项目。未保存的生成稿可在“研究笔记 → 本机草稿”恢复。保存和恢复都不调用 AI。",
  },
  {
    question: "解释选文、整理重点和自测题有什么区别？",
    answer:
      "选文“提问”支持自由讨论，“更多选文操作 → 直接解释选文”可快速讲解；整理重点把明确材料变成可编辑笔记；自测题用于主动回想和复习。解释与提问可补充知识，整理笔记、出题和检查理解仍核对指定材料。",
  },
  {
    question: "复习进度如何保存？会自动评分或提醒吗？",
    answer:
      "回答输入先暂存当前浏览器；查看答案、自评与跳题后保存到本机工作区，刷新可继续。掌握程度由你选择“会了”或“还不会”，模型不自动打分。下次时间是简单本机间隔，不采用 FSRS，也不会在网页关闭后推送提醒。",
  },
  {
    question: "如何调整 PDF 和笔记区域的大小？",
    answer:
      "拖动两区之间的分隔条：桌面调整左右宽度，窄屏调整上方 PDF 的高度。也可用 Tab 聚焦分隔条后按方向键，Shift 加方向键可加快调整。双击分隔条或点击“恢复默认阅读布局”图标可还原；当前浏览器会记住比例。",
  },
  {
    question: "阅读助手的文字太大或太小怎么办？",
    answer:
      "点击右侧页签末尾的“Aa”，选择“小 13px”“中 14px”或“大 16px”。默认使用“中”，当前浏览器会记住选择。调整 PDF 原文大小请用阅读器的缩放工具。",
  },
  {
    question: "为什么 Ctrl + P 没有打印论文全文？",
    answer:
      "工作区打印的是当前阅读区的文字记录与论文信息。打印全文请先保存 PDF 批注，点击顶部“PDF”，再使用 PDF 阅读器的打印功能并检查预览。已保存的批注保留在打开的 PDF 中。",
  },
  {
    question: "下滑后又看到 Timeline 或闪记的空白怎么办？",
    answer:
      "刷新工作区以加载新版。这些已识别的浏览器附加面板会在本工作区收起，避免产生额外空白；不需要更改论文和笔记数据。",
  },
  {
    question: "哪些操作会使用模型额度？",
    answer:
      "发送问题、解释选文、举例、深入解释、检查理解、生成笔记或自测题会使用自己配置的模型额度。首页搜索与观画、阅读、上传、检索、编辑批注、保存笔记、从批注生成笔记、练习已有题组、自评和管理待办不调用模型。",
  },
  {
    question: "为什么刚保存的笔记在个人检索里找不到？",
    answer:
      "先查看笔记状态。新笔记通常是草稿，审核后点击“确认入库”，才会进入个人研究检索。确认后仍找不到时，试试正文中更具体的关键词。",
  },
  {
    question: "为什么“更多”中的原生高亮没有出现在批注列表？",
    answer:
      "原生工具主要编辑 PDF 内的标记。需要在右侧列表中查看、添加想法和整理摘录时，先选中文字，再点选文下方的“高亮”；它会保存到 PDF 并打开列表。",
  },
  {
    question: "评论删除后为什么还在旧窗口显示？",
    answer:
      "另一个已打开的窗口可能保留了旧画面。点击“批注”中的刷新按钮或重新打开论文，再核对实际内容。出现版本冲突时先保留输入文字，刷新后再操作，避免覆盖新内容。",
  },
  {
    question: "为什么有些 PDF 不能选字或分析？",
    answer:
      "扫描件可能只有图片，没有文字层。它仍可阅读与批注，但本版不自动 OCR。换用有文字层的 PDF，或在问题中提供需要解释的文字。",
  },
  {
    question: "自由讨论是否没有上下文限制？",
    answer:
      "仍受模型自身窗口上限影响。自由讨论使用选文、相关概念与少量相关段落，必要时查阅所选论文；长对话保留近期交流和较早讨论摘录。论文卡和整篇精读分析仍有长材料范围限制，不能把回答视为已完整阅读全文。",
  },
  {
    question: "如何知道答案说的是哪篇论文的哪一页？",
    answer:
      "查看结果附带的原文页按钮与跨论文链接。点击后核对实际打开的论文和页码。页码跳转帮助定位来源，结论是否准确还需要阅读原文。",
  },
  {
    question: "关闭网页后，研究待办还会提醒吗？",
    answer:
      "应用不会在网页关闭后自行发系统通知。你可以导出 ICS 并导入日历软件，由日历软件负责提醒。",
  },
  {
    question: "网页下载的工作区 ZIP 可以直接完整恢复吗？",
    answer:
      "完整恢复需要“备份Demo.cmd”生成的归档，它同时包含文献数据和模型服务历史。网页 ZIP 用于导出研究成果，不能代替完整服务备份。",
  },
];

const normalize = (value: string) => value.normalize("NFKC").toLowerCase();

export function ResearchHelp({
  onNavigate,
  papers = [],
  onOpenPaper,
}: {
  onNavigate(view: HelpDestination): void;
  papers?: Pick<ResearchPaper, "id" | "title">[];
  onOpenPaper?(paperId: string): void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string[]>(["reader"]);
  const needle = normalize(query.trim());
  const sections = helpSections.filter(
    (section) =>
      !needle ||
      normalize(
        [
          section.title,
          section.lead,
          ...section.steps,
          section.tip,
          section.keywords,
        ].join(" "),
      ).includes(needle),
  );
  const questions = helpQuestions.filter(
    (item) =>
      !needle || normalize(item.question + item.answer).includes(needle),
  );
  const example = papers[0];
  function toggle(id: string, open: boolean) {
    setExpanded((current) =>
      open
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((value) => value !== id),
    );
  }
  return (
    <div className={styles.helpPage}>
      <header className={styles.heading}>
        <div>
          <h1>使用说明</h1>
          <p>阅读、整理与复习。</p>
        </div>
        <button onClick={() => onNavigate("library")}>
          打开文献库
          <ArrowUpRight size={15} aria-hidden="true" />
        </button>
      </header>
      {!needle && (
        <section
          className={styles.quickStart}
          aria-labelledby="help-start-title"
        >
          <div className={styles.quickTitle}>
            <BookOpen size={18} aria-hidden="true" />
            <h2 id="help-start-title">第一次使用</h2>
          </div>
          <ol>
            <li>
              <strong>打开论文</strong>
              <span>在文献库选择已导入的论文。</span>
            </li>
            <li>
              <strong>读懂一段原文</strong>
              <span>选中文字提问，或直接解释并复述理解。</span>
            </li>
            <li>
              <strong>整理为笔记</strong>
              <span>选择材料范围，编辑、核对并保存草稿。</span>
            </li>
            <li>
              <strong>自测与复习</strong>
              <span>先回答再看答案，自评后继续下一题。</span>
            </li>
          </ol>
          <div className={styles.examples}>
            {onOpenPaper && example && (
              <button onClick={() => onOpenPaper(example.id)}>
                打开已导入论文
                <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            )}
            <button onClick={() => onNavigate("notes")}>
              查看已有笔记
              <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          </div>
        </section>
      )}
      <div className={styles.search}>
        <Search size={17} aria-hidden="true" />
        <input
          aria-label="搜索使用说明"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="查找功能或问题，例如：删除评论、草稿、备份"
        />
        {query && (
          <button aria-label="清空说明搜索" onClick={() => setQuery("")}>
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </div>
      {needle && (
        <p className={styles.resultCount}>
          找到 {sections.length} 个功能主题、{questions.length} 个常见问题
        </p>
      )}
      <div className={styles.contentLayout}>
        <nav className={styles.contents} aria-label="使用说明目录">
          {sections.map((section) => (
            <a
              key={section.id}
              href={"#help-" + section.id}
              onClick={() => toggle(section.id, true)}
            >
              {section.title}
            </a>
          ))}
          {questions.length > 0 && <a href="#help-faq">常见问题</a>}
        </nav>
        <div className={styles.sections}>
          {sections.map((section) => (
            <details
              className={styles.section}
              id={"help-" + section.id}
              key={section.id}
              open={!!needle || expanded.includes(section.id)}
              onToggle={(event) => {
                if (!needle) toggle(section.id, event.currentTarget.open);
              }}
            >
              <summary>
                <span>{section.title}</span>
                <ChevronDown size={17} aria-hidden="true" />
              </summary>
              <div className={styles.sectionBody}>
                <p>{section.lead}</p>
                <ol>
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {section.tip && <p className={styles.tip}>{section.tip}</p>}
                <button
                  className={styles.sectionAction}
                  onClick={() => onNavigate(section.destination)}
                >
                  {section.action}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              </div>
            </details>
          ))}
          {questions.length > 0 && (
            <section className={styles.faq} id="help-faq">
              <h2>常见问题</h2>
              {questions.map((item) => (
                <details key={item.question} open={needle ? true : undefined}>
                  <summary>
                    {item.question}
                    <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </section>
          )}
          {!sections.length && !questions.length && (
            <p className={styles.empty}>
              没有找到相关说明。试试“评论”“笔记”或“备份”。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
