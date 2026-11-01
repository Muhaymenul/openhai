import type { KnowledgeEntry } from "../types";

const generic = new Set([
  "feedback",
  "learning",
  "model",
  "models",
  "method",
  "research",
  "system",
  "framework",
  "data",
  "result",
  "theory",
  "knowledge",
  "network",
  "agent",
  "analysis",
  "evidence",
  "context",
  "please",
  "explain",
  "paper",
  "this",
  "that",
  "with",
  "from",
  "what",
  "does",
  "have",
  "into",
  "their",
  "only",
  "based",
  "compare",
  "study",
  "为什么",
  "这段话",
  "这段",
  "如何",
  "什么",
  "可以",
  "进行",
  "需要",
  "研究",
  "方法",
  "论文",
  "原文",
  "分析",
  "理论",
  "概念",
  "知识",
  "反馈",
  "学习",
  "模型",
  "系统",
  "框架",
  "数据",
  "结果",
  "证据",
  "结合",
  "解释",
  "比较",
  "以及",
  "中的",
  "我们",
  "一个",
  "本次",
  "使用",
  "提供",
  "参考",
  "当前",
  "文章",
  "背景",
]);
const normalize = (text: string) => text.normalize("NFKC").toLowerCase();

/** Small lexical retrieval, shared by the browser preview and the server. */
export function discussionSearchTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const match of normalize(query.slice(0, 1800)).matchAll(
    /[a-z][a-z0-9-]{2,}|[\u3400-\u9fff]{2,}/g,
  )) {
    const token = match[0];
    if (generic.has(token)) continue;
    if (/^[a-z]/.test(token)) terms.add(token);
    else if (token.length <= 5) terms.add(token);
    else
      for (
        let index = 0;
        index < token.length - 2 && terms.size < 64;
        index++
      ) {
        const gram = token.slice(index, index + 3);
        if (
          ![...generic].some((word) => word.length >= 2 && gram.includes(word))
        )
          terms.add(gram);
      }
    if (terms.size >= 64) break;
  }
  return [...terms].slice(0, 64);
}

export function pickReferenceConcepts(
  knowledge: KnowledgeEntry[],
  query: string,
  referenceConceptIds?: string[],
): KnowledgeEntry[] {
  if (referenceConceptIds !== undefined)
    return [...new Set(referenceConceptIds)].slice(0, 4).flatMap((id) => {
      const item = knowledge.find((entry) => entry.id === id);
      return item ? [item] : [];
    });
  if (
    /(?:不要|不用|不使用|无需|不结合).{0,8}(?:概念库|知识库)|\b(?:without|do not use)\b.{0,15}\b(?:concept|knowledge)\b/i.test(
      query,
    )
  )
    return [];
  const text = normalize(query);
  const terms = discussionSearchTerms(query);
  return knowledge
    .map((entry) => {
      const names = [entry.title, ...entry.aliases].map(normalize);
      let score = 0;
      for (const name of names) {
        if (name.length < 3 || generic.has(name)) continue;
        const matches = /^[a-z0-9 -]+$/.test(name)
          ? new RegExp(
              `(?:^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`,
            ).test(text)
          : text.includes(name);
        if (matches) score += 30 + Math.min(name.length, 20);
      }
      const body = normalize(
        entry.definition + "\n" + entry.body.slice(0, 3000),
      );
      const shared = terms.filter((term) => body.includes(term));
      // Broad words such as "feedback" cannot by themselves import education theory.
      if (shared.length >= 4 && shared.length >= terms.length * 0.3)
        score += shared.length;
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, 4)
    .map((item) => item.entry);
}
