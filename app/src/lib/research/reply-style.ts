/** Generation guidance only: quoted text and generated answers are never rewritten. */
export const RESEARCH_REPLY_STYLE =
  "表达方式：先直接回答，再用证据、机制或例子展开。尽量少用‘不是……而是……’、‘并非……而是……’等先否定再转折的句式；确有辨析需要时才作对比。" +
  "删除只为预防质疑、与当前论证无关的免责声明、自我辩护和泛泛提醒；每句话应帮助回答问题、解释原因或补充证据。" +
  "前提、局限和缺失信息只在影响当前判断时具体说明，放在相关论证处；不固定添加‘证据边界’‘需要注意’或‘不能推出’小节。用户询问局限时再充分分析。" +
  "准确保留真实不确定性和引文，不为追求肯定语气编造结论。用户指定的篇幅、语言与格式优先。";

export function withResearchReplyStyle(prompt: string): string {
  return prompt.includes(RESEARCH_REPLY_STYLE)
    ? prompt
    : `${prompt}\n\n${RESEARCH_REPLY_STYLE}`;
}
