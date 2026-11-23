import {
  activeWorkspace,
  digest,
  mutateWorkspace,
  paperPages,
  ResearchError,
  type WorkspaceState,
} from "../store";
import type { ResearchPage, SourceRef } from "../types";

const heading =
  /^\s*(?:\d+[.\s]*)?(?:references|bibliography|参考文献)\s*[:：]?\s*$/im;
const appendix = /^\s*(?:appendix(?:\s+[A-Z])?|附录)\s*[:：]?\s*$/im;

function indexedText(text: string): {
  text: string;
  starts: number[];
  ends: number[];
} {
  const parts: string[] = [],
    starts: number[] = [],
    ends: number[] = [];
  let offset = 0;
  for (const character of text) {
    for (const value of character.normalize("NFKC").toLowerCase()) {
      if (!/[\p{L}\p{N}]/u.test(value)) continue;
      for (let unit = 0; unit < value.length; unit++) {
        starts.push(offset);
        ends.push(offset + character.length);
      }
      parts.push(value);
    }
    offset += character.length;
  }
  return { text: parts.join(""), starts, ends };
}

/** Restrict matches to a detected reference section and preserve the real quote. */
export function referenceTitleEvidence(
  pages: ResearchPage[],
  title: string,
): { page: number; quote: string } | undefined {
  const needle = indexedText(title).text;
  if (needle.length < 18) return undefined;
  let inReferences = false;
  for (const page of pages) {
    let text = page.text;
    const start = heading.exec(text);
    if (start) {
      inReferences = true;
      text = text.slice(start.index + start[0].length);
    }
    if (!inReferences) continue;
    const end = appendix.exec(text);
    if (end) text = text.slice(0, end.index);
    const indexed = indexedText(text),
      hit = indexed.text.indexOf(needle);
    if (hit >= 0)
      return {
        page: page.page,
        quote: text
          .slice(
            Math.max(0, indexed.starts[hit] - 60),
            Math.min(text.length, indexed.ends[hit + needle.length - 1] + 120),
          )
          .trim(),
      };
    if (end) inReferences = false;
  }
  return undefined;
}

export function addReferenceRelations(
  state: WorkspaceState,
  sourceIds?: string[],
): number {
  const papers = activeWorkspace(state).papers;
  const selected = new Set(sourceIds || papers.map((paper) => paper.id));
  let added = 0;
  for (const sourcePaper of papers.filter((paper) => selected.has(paper.id))) {
    const pages = paperPages(sourcePaper);
    for (const targetPaper of papers) {
      if (sourcePaper.id === targetPaper.id) continue;
      const match = referenceTitleEvidence(pages, targetPaper.title);
      if (!match) continue;
      const source = `paper-${sourcePaper.id}`,
        target = `paper-${targetPaper.id}`;
      const id = `edge-${digest([source, target, "cites"]).slice(0, 32)}`;
      const existing = state.graph.edges.find((edge) => edge.id === id);
      if (existing?.status === "rejected") continue;
      for (const paper of [sourcePaper, targetPaper]) {
        if (!state.graph.nodes.some((node) => node.id === `paper-${paper.id}`))
          state.graph.nodes.push({
            id: `paper-${paper.id}`,
            kind: "paper",
            paperId: paper.id,
            title: paper.title,
            label: paper.title,
            topic: paper.topic,
          });
      }
      const evidence: SourceRef = {
        paperId: sourcePaper.id,
        title: sourcePaper.title,
        page: match.page,
        quote: match.quote,
        contentRevision: sourcePaper.contentRevision,
      };
      const now = new Date().toISOString();
      const sources = [
        evidence,
        {
          paperId: targetPaper.id,
          title: targetPaper.title,
          contentRevision: targetPaper.contentRevision,
        },
      ];
      if (existing) {
        if (digest(existing.evidence) !== digest(sources)) {
          existing.evidence = sources;
          existing.status = "candidate";
          existing.stale = false;
          existing.updatedAt = now;
          existing.version++;
          added++;
        }
        continue;
      }
      state.graph.edges.push({
        id,
        source,
        target,
        kind: "cites",
        label: "引用",
        status: "candidate",
        origin: "source",
        evidence: sources,
        rationale: `参考文献条目与《${targetPaper.title}》的完整题名匹配。`,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      added++;
    }
  }
  if (added) state.graph.version++;
  return added;
}

export async function suggestReferenceRelations(paperIds?: string[]) {
  return mutateWorkspace((state) => {
    const active = activeWorkspace(state);
    if (paperIds?.some((id) => !active.papers.some((paper) => paper.id === id)))
      throw new ResearchError("部分论文已移入回收站或已删除", 410);
    return {
      added: addReferenceRelations(state, paperIds),
      graph: activeWorkspace(state).graph,
    };
  });
}
