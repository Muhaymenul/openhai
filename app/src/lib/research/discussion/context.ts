import type {
  AnswerStyle,
  ResearchPage,
  StartResearchRunInput,
} from "../types";
import { discussionSearchTerms } from "./concepts";

export function effectiveAnswerStyle(
  input: Pick<
    StartResearchRunInput,
    "answerStyle" | "mode" | "question" | "learning"
  >,
): AnswerStyle {
  if (
    input.mode !== "ask" ||
    /^\s*\[学习笔记:/.test(input.question) ||
    (input.learning && input.learning.task !== "explain")
  )
    return "grounded";
  return input.answerStyle ?? "discussion";
}

export function passageWindow(
  text: string,
  query: string,
  maximum: number,
): string {
  if (text.length <= maximum) return text;
  const terms = discussionSearchTerms(query);
  const lower = text.normalize("NFKC").toLowerCase();
  const hit =
    terms.map((term) => lower.indexOf(term)).find((index) => index >= 0) ?? 0;
  const start = Math.max(
    0,
    Math.min(hit - Math.floor(maximum / 3), text.length - maximum),
  );
  return text.slice(start, start + maximum);
}

/** Keep the exact selection plus small real-page excerpts, never a fabricated page. */
export function compactDiscussionPages(
  input: StartResearchRunInput,
): ResearchPage[] {
  const { pages } = input.context;
  const selected = input.selection;
  const question = input.question.replace(/^\[[^\]]+\]\s*/, "");
  const terms = discussionSearchTerms(
    question + "\n" + (selected?.text ?? selected?.quote ?? "").slice(0, 700),
  );
  const ranked = pages
    .map((page) => {
      const lower = page.text.normalize("NFKC").toLowerCase();
      return {
        page,
        score: terms.reduce(
          (sum, term) =>
            sum + (lower.includes(term) ? Math.min(10, term.length) : 0),
          0,
        ),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.page.page - b.page.page);
  const picked = new Map<number, ResearchPage>();
  if (selected) {
    const original = pages.find((page) => page.page === selected.page);
    if (original)
      picked.set(original.page, {
        ...original,
        text: passageWindow(
          original.text,
          selected.text ?? selected.quote ?? "",
          1800,
        ),
      });
  }
  for (const entry of ranked) {
    if (picked.size >= (selected ? 3 : 4)) break;
    if (!picked.has(entry.page.page))
      picked.set(entry.page.page, {
        ...entry.page,
        text: passageWindow(entry.page.text, question, selected ? 900 : 1800),
      });
  }
  if (!picked.size && pages[0])
    picked.set(pages[0].page, {
      ...pages[0],
      text: pages[0].text.slice(0, 1800),
    });
  return [...picked.values()];
}
