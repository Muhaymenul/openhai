export const studyFrameworks = {
  cornell: {
    label: "康奈尔笔记",
    title: "整理重点",
    scenario: "初读或回顾时，把论文要点整理成可查阅的笔记。",
    output: "问题线索、主要笔记、总结",
    action: "整理重点笔记",
    example:
      "| 线索 / 问题 | 主要笔记 |\n| --- | --- |\n| 研究解决什么问题？ | …… [p.页码] |\n\n## 总结\n核心论点与局限：……",
    instruction:
      "先给出标题，然后用 Markdown 两列表格整理‘线索 / 问题’与‘主要笔记’，最后用‘## 总结’概括核心论点与局限。表格中的每条可核实主张附原文页码。",
  },
  feynman: {
    label: "费曼解释",
    title: "通俗讲解",
    scenario: "概念难懂时，用日常语言和类比建立理解。",
    output: "一句话解释、类比、论文依据、待解问题",
    action: "生成通俗讲解",
    example:
      "## 一句话理解\n……\n## 用一个类比解释\n理解类比（非论文证据）：……\n## 回到论文\n术语、依据与边界：…… [p.页码]\n## 我还需要弄懂什么\n……",
    instruction:
      "使用‘## 一句话理解’‘## 用一个类比解释’‘## 回到论文’‘## 我还需要弄懂什么’四部分。类比明确标为帮助理解的类比，不可作为论文证据。保留关键英文术语，解释其含义与适用边界。",
  },
  recall: {
    label: "自测问答",
    title: "自测复习",
    scenario: "读后复习时，先回答问题，再核对参考答案。",
    output: "5 道递进问题、可展开答案、原文页码",
    action: "生成自测题",
    example:
      "### 问题1：研究的关键证据是什么？\n答案：…… [p.页码]\n\n### 问题2：结论适用于哪些条件？\n答案：…… [p.页码]\n\n……共 5 题",
    instruction:
      "生成 5 个由理解到批判的问题。必须严格采用 Markdown 格式：每题以‘### 问题1：问题内容’为标题，下一行起以‘答案：’开头给出参考答案并附原文页码；依次编号。答案应包含论证依据，不能只列术语。不要在问题标题内泄露答案。",
  },
} as const;

export type StudyFramework = keyof typeof studyFrameworks;

export function studyPrompt(framework: StudyFramework): string {
  return (
    "[学习笔记:" +
    framework +
    "]\n" +
    "请基于当前论文可用原文生成中文" +
    studyFrameworks[framework].label +
    "。" +
    "如有选区，优先围绕选区；请区分作者结论、你的解释和未获支持的推断。" +
    "关键陈述标注 [p.页码]，只引用本次实际可见的原文；资料不完整时说明覆盖范围。" +
    "不要调用写入工具，直接返回可编辑的 Markdown 草稿。\n" +
    studyFrameworks[framework].instruction
  );
}

export function studyLabel(prompt: string): string | null {
  const framework = prompt.match(/^\[学习笔记:(cornell|feynman|recall)\]/)?.[1];
  return framework && framework in studyFrameworks
    ? studyFrameworks[framework as StudyFramework].label
    : null;
}

/** Plain-language purpose for compact run history; historic labels remain stable. */
export function studyPurpose(prompt: string): string | null {
  const framework = prompt.match(/^\[学习笔记:(cornell|feynman|recall)\]/)?.[1];
  return framework && framework in studyFrameworks
    ? studyFrameworks[framework as StudyFramework].title
    : null;
}

export type StudyPart =
  | { type: "markdown"; content: string }
  | { type: "question"; question: string; answer: string };

/** Only the explicit question-heading format becomes a closed answer card. */
export function studyParts(content: string): StudyPart[] {
  const lines = content.split(/\r?\n/);
  const parts: StudyPart[] = [];
  let prose: string[] = [];
  let question = "";
  let answer: string[] = [];
  let fence = "";
  function flush() {
    if (question) {
      const body = answer.join("\n").trim();
      if (body) {
        parts.push({
          type: "question",
          question,
          answer: body.replace(/^答案\s*[：:]\s*/, ""),
        });
      } else prose.push("### " + question);
      question = "";
      answer = [];
    }
    if (prose.join("\n").trim())
      parts.push({ type: "markdown", content: prose.join("\n") });
    prose = [];
  }
  for (const line of lines) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = "";
    }
    const match = !fence && line.match(/^###\s+问题\s*\d+\s*[：:]\s*(.+)$/);
    if (match) {
      flush();
      question = match[1].trim();
    } else if (question && !fence && /^#{1,3}\s+/.test(line)) {
      flush();
      prose.push(line);
    } else if (question) answer.push(line);
    else prose.push(line);
  }
  flush();
  return parts;
}
