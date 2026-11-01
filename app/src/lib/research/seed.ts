import type { KnowledgeEntry } from "./types";

/** Short, editable reading aids. Bibliography is supplied; publisher full text is not copied. */
export function educationSeeds(now: string): KnowledgeEntry[] {
  const seeds = [
    {
      id: "edu-formative-assessment",
      title: "形成性评价",
      aliases: ["formative assessment", "形成性评估"],
      category: "评价与反馈",
      body: "在学习过程中收集、解释学习证据，并用来调整教学与学习。阅读论文时，应检查证据如何收集、反馈给谁，以及反馈是否真正改变后续行动。频繁测验本身不等于形成性评价。",
      citation:
        "Black, P., & Wiliam, D. (1998). Assessment and Classroom Learning. Assessment in Education, 5(1), 7–74.",
      url: "https://doi.org/10.1080/0969595980050102",
    },
    {
      id: "edu-self-regulated-learning",
      title: "自我调节学习",
      aliases: ["self-regulated learning", "SRL", "自我调控学习"],
      category: "学习理论",
      body: "学习者主动设定目标、选择策略、监控学习过程并反思调整。分析研究时，可区分前摄计划、学习中的监控和事后反思，核对量表、行为证据与干预活动分别测量了什么。",
      citation:
        "Zimmerman, B. J. (2002). Becoming a Self-Regulated Learner: An Overview. Theory Into Practice, 41(2), 64–70.",
      url: "https://doi.org/10.1207/s15430421tip4102_2",
    },
    {
      id: "edu-design-based-research",
      title: "设计型研究",
      aliases: ["design-based research", "DBR", "基于设计的研究"],
      category: "研究方法",
      body: "在真实教育情境中迭代设计、实施和修订学习环境，同时发展对学习和教学的解释。阅读时应核对每轮设计依据、证据、修订理由和理论贡献；一次教学实践并不自动构成设计型研究。",
      citation:
        "The Design-Based Research Collective. (2003). Design-Based Research: An Emerging Paradigm for Educational Inquiry. Educational Researcher, 32(1), 5–8.",
      url: "https://doi.org/10.3102/0013189X032001005",
    },
    {
      id: "edu-feedback",
      title: "学习反馈",
      aliases: ["feedback", "反馈"],
      category: "评价与反馈",
      body: "反馈帮助学习者理解目标、当前表现与下一步行动。比较研究时，应区分任务层、过程层与自我调节层信息，并检查反馈时机、可操作性和学习者使用情况。反馈效果依赖具体情境，不能仅凭“提供反馈”判断有效。",
      citation:
        "Hattie, J., & Timperley, H. (2007). The Power of Feedback. Review of Educational Research, 77(1), 81–112.",
      url: "https://doi.org/10.3102/003465430298487",
    },
  ];
  return seeds.map((s) => ({
    id: s.id,
    title: s.title,
    aliases: s.aliases,
    category: s.category,
    body: s.body,
    definition: s.body,
    source: s.citation,
    sources: [{ title: s.citation, citation: s.citation, url: s.url }],
    origin: "seed",
    version: 1,
    createdAt: now,
    updatedAt: now,
  }));
}
