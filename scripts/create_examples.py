"""Generate original, clearly labelled synthetic papers for product verification."""
from pathlib import Path
import sys
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "examples"
FONT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("C:/Windows/Fonts/simhei.ttf")
pdfmetrics.registerFont(TTFont("DemoChinese", str(FONT)))
styles = {
    "title": ParagraphStyle("title", fontName="DemoChinese", fontSize=23, leading=32, textColor=colors.HexColor("#203b58"), spaceAfter=18),
    "heading": ParagraphStyle("heading", fontName="DemoChinese", fontSize=14, leading=21, textColor=colors.HexColor("#17837f"), spaceBefore=17, spaceAfter=8),
    "body": ParagraphStyle("body", fontName="DemoChinese", fontSize=11, leading=20, wordWrap="CJK", spaceAfter=10),
    "small": ParagraphStyle("small", fontName="DemoChinese", fontSize=9, leading=15, textColor=colors.HexColor("#637286"), wordWrap="CJK", spaceAfter=8),
}
papers = [
    ("01-formative-feedback.pdf", "形成性评价与课堂反馈", "教学改进的合成示例研究", [
        ("研究问题", "本示例讨论形成性评价如何帮助教师发现学习困难，并将学习证据转化为课堂反馈。核心问题是：教师收集到学生回答后，如何调整下一次教学？"),
        ("研究设计", "演示设定为两个班共60名学习者，持续四周。教师每周使用课堂提问、退出卡和同伴讨论收集学习证据。所有人数、活动和结果均为软件测试而构造，不代表真实实验。"),
        ("概念与过程", "形成性评价通过收集和解释学习证据来调整教学与学习。课堂反馈需要指出当前表现与目标之间的差距，并提供可执行的下一步行动。频繁测验不必然等于形成性评价。"),
        ("示例发现", "本材料构造的观察记录表明，教师依据退出卡调整教学内容，学生依据课堂反馈修改自己的解题说明。该示例用于展示证据与行动之间的联系，不提供真实效果量。"),
    ], [
        ("适用条件", "反馈必须被学习者理解并用于后续行动。教师还需要有时间分析学习证据，以及调整教学活动的自主空间。"),
        ("研究局限", "这是合成测试材料，不存在真实招募、随机分组或统计推断。不能用文中的设定证明形成性评价对成绩具有因果作用。"),
        ("与其他主题的联系", "当学生依据反馈设定新的学习目标并监控进展时，形成性评价与自我调节学习发生联系。这种联系是一个待进一步阅读和验证的理论线索。"),
    ]),
    ("02-self-regulated-learning.pdf", "自我调节学习与学习日志", "目标监控的合成示例研究", [
        ("研究问题", "本示例关注学习者如何通过学习日志设定目标、监控进展并进行反思。研究问题是：日志中的反馈是否帮助学习者形成下一步学习计划？"),
        ("研究设计", "演示设定为48名学习者在六周内记录学习日志，并参与两次访谈。研究者使用主题分析整理目标设定、策略监控和反思的记录。该设计与全部数据均为合成示例。"),
        ("概念与过程", "自我调节学习强调学习者主动设定目标、选择策略、监控过程和反思调整。学习日志可以保存这些过程的痕迹，但日志字数不能直接代表自我调节水平。"),
        ("示例发现", "合成记录中的学习者通过课堂反馈识别任务要求，并在下一次日志中修改学习目标。部分日志只记录完成情况，没有明确的策略调整，因此需要区分记录活动与实际调节。"),
    ], [
        ("证据边界", "访谈与日志可能受到回忆偏差和社会赞许影响。研究者应将自我报告与行为记录结合，避免把学生的陈述直接当作学习效果。"),
        ("研究局限", "本材料不是发表论文，没有真实参与者、实验数据或显著性检验。文中的数量仅用于检验软件是否能正确提取研究设计并注明合成性质。"),
        ("与其他主题的联系", "形成性评价提供可用于调整学习的证据，而自我调节学习关注学习者如何使用这些证据。两者可以通过课堂反馈建立跨论文概念关联。"),
    ]),
    ("03-design-based-research.pdf", "设计型研究与数字化学习", "两轮迭代的合成示例研究", [
        ("研究问题", "本示例探讨如何迭代设计数字化课堂中的反馈工具。关注的问题是：哪些设计修改能够帮助学习者理解和使用反馈？"),
        ("研究设计", "演示设定为24名学习者参与两轮教学设计。第一轮试用反馈面板，第二轮根据访谈和学习日志增加目标提示。所有过程和参与人数均为合成资料。"),
        ("概念与过程", "设计型研究在真实教育情境中迭代设计、实施和修订学习环境，同时发展对学习和教学的解释。每轮修订需要说明设计依据、证据和预期机制。"),
        ("示例发现", "合成材料中的第一轮面板只展示任务完成比例，第二轮增加形成性评价提示与学习目标。示例用这一变化说明设计证据如何支持修改，不据此声称取得了真实教学效果。"),
    ], [
        ("分析与理论线索", "设计者将自我调节学习作为解释框架，关注学习者是否能根据课堂反馈调整策略。理论线索应与具体活动及原始证据对应，不能只在标题中加入理论名词。"),
        ("研究局限", "本材料是软件演示用合成论文，没有真实课堂或可推广结果。两轮设计的设定不能替代长期观察，也不能证明某项技术优于其他方案。"),
        ("跨材料阅读提示", "可以把三份材料中的形成性评价、课堂反馈和自我调节学习连接起来，比较各材料讨论的是教师行动、学习者过程还是设计迭代。"),
    ]),
]

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#dce5ec"))
    canvas.line(22 * mm, 18 * mm, A4[0] - 22 * mm, 18 * mm)
    canvas.setFont("DemoChinese", 8)
    canvas.setFillColor(colors.HexColor("#788697"))
    canvas.drawString(22 * mm, 12 * mm, "教研阅记 · 合成功能测试材料 · 非真实发表论文")
    canvas.drawRightString(A4[0] - 22 * mm, 12 * mm, f"{doc.page}")
    canvas.restoreState()

OUT.mkdir(parents=True, exist_ok=True)
for filename, title, subtitle, first, second in papers:
    doc = SimpleDocTemplate(str(OUT / filename), pagesize=A4, rightMargin=22*mm, leftMargin=22*mm, topMargin=21*mm, bottomMargin=25*mm, title=title + "（合成示例）", author="教研阅记演示资料")
    story = [Paragraph("教研阅记 / 阅读实验室", styles["small"]), Paragraph(title, styles["title"]), Paragraph(subtitle + " · 原创演示材料", styles["small"]), Paragraph("本材料由项目开发过程编写，仅用于测试阅读、分析、笔记和知识图谱功能。它不是公开发表的实证研究，文中设定不可当作科研证据引用。", styles["body"])]
    for heading, text in first:
        story.extend([Paragraph(heading, styles["heading"]), Paragraph(text, styles["body"])])
    story.extend([PageBreak(), Paragraph("证据边界与阅读提示", styles["title"])])
    for heading, text in second:
        story.extend([Paragraph(heading, styles["heading"]), Paragraph(text, styles["body"])])
    story.extend([Spacer(1, 10*mm), Paragraph("使用许可", styles["heading"]), Paragraph("这份原创合成示例以 CC0 方式提供，可用于软件演示和功能测试。教育学概念释义仅为阅读提示，正式研究应回到原始文献核对。", styles["small"])])
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(filename)
