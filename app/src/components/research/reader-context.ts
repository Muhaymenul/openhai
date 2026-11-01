import type {
  ResearchPaper,
  ResearchRun,
  ResearchSelection,
  SourceRef,
} from "@/lib/research/types";
import type { PaperDetail } from "./api";
import { workspaceCitationTarget } from "./study/workspace-links";
import { selectionBoundaryMessage } from "./selection-boundary";

export interface ResearchProposal {
  id: string;
  kind: "note" | "annotation";
  title: string;
  body: string;
  quote: string;
  page?: number;
  document_id: string;
  run_id: string;
  requires_confirmation: true;
}

/** Tool output is untrusted: accept only drafts bound to this paper and run. */
export function readerProposals(
  run: ResearchRun,
  paper: ResearchPaper,
): ResearchProposal[] {
  const seen = new Set<string>();
  return (run.proposals ?? []).flatMap((value): ResearchProposal[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(item.id) ||
      seen.has(item.id) ||
      (item.kind !== "note" && item.kind !== "annotation") ||
      typeof item.title !== "string" ||
      !item.title.trim() ||
      item.title.length > 500 ||
      typeof item.body !== "string" ||
      !item.body.trim() ||
      item.body.length > 60000 ||
      typeof item.quote !== "string" ||
      item.quote.length > 20000 ||
      item.document_id !== paper.id ||
      item.run_id !== run.id ||
      item.requires_confirmation !== true
    )
      return [];
    if (
      item.page != null &&
      (typeof item.page !== "number" ||
        !Number.isInteger(item.page) ||
        item.page < 1 ||
        item.page > paper.pageCount)
    )
      return [];
    seen.add(item.id);
    return [
      {
        id: item.id,
        kind: item.kind,
        title: item.title,
        body: item.body,
        quote: item.quote,
        page: typeof item.page === "number" ? item.page : undefined,
        document_id: paper.id,
        run_id: run.id,
        requires_confirmation: true,
      },
    ];
  });
}

/** Keep current-paper page markers alongside explicit cross-paper citations. */
export function responseSources(
  answer: string,
  paper: ResearchPaper,
): SourceRef[] {
  const sources: SourceRef[] = [];
  const prose = answer.replace(
    /\[([^\]]+)\]\(([^\s()]+)\)/g,
    (_link, title: string, target: string) => {
      const citation = workspaceCitationTarget(target);
      const paperId = citation?.paperId;
      const page = citation?.page;
      if (
        paperId &&
        page !== undefined &&
        Number.isInteger(page) &&
        page > 0 &&
        (paperId !== paper.id || page <= paper.pageCount)
      )
        sources.push({
          paperId,
          page,
          title,
          contentRevision:
            paperId === paper.id ? paper.contentRevision : undefined,
        });
      // A link label such as [p.2] belongs to its target, never implicitly to
      // the current paper. Remove it before collecting unlinked page markers.
      return "";
    },
  );
  for (const match of prose.matchAll(
    /第\s*(\d+)\s*页|\[p\.?\s*(\d+)\]|\(p\.?\s*(\d+)\)/gi,
  )) {
    const page = Number(match[1] || match[2] || match[3]);
    if (page >= 1 && page <= paper.pageCount)
      sources.push({
        paperId: paper.id,
        page,
        contentRevision: paper.contentRevision,
        title: paper.title,
      });
  }
  const seen = new Set<string>();
  return sources
    .filter((source) => {
      const key = source.paperId + ":" + source.page;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 16);
}

/** Map the PDF.js text layer back to PDF coordinates, including rotated pages. */
export function readPdfSelection(
  root: HTMLElement,
  detail: PaperDetail | null,
  paper: ResearchPaper,
  onInvalid?: (message: string) => void,
): ResearchSelection | null {
  const selected = window.getSelection();
  if (!selected || selected.isCollapsed || !selected.rangeCount) return null;
  const range = selected.getRangeAt(0);
  const startInside = root.contains(range.startContainer);
  const endInside = root.contains(range.endContainer);
  if (!startInside && !endInside) return null;
  if (!startInside || !endInside || selected.rangeCount !== 1) {
    onInvalid?.("请在同一页内选取文字");
    return null;
  }
  const startElement =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const endElement =
    range.endContainer instanceof Element
      ? range.endContainer
      : range.endContainer.parentElement;
  const pageElement =
    startElement?.closest<HTMLElement>(".page[data-page-number]") ?? null;
  const endPage =
    endElement?.closest<HTMLElement>(".page[data-page-number]") ?? null;
  const text = selected.toString().trim();
  if (!text) return null;
  const boundary = {
    startPage: pageElement,
    endPage,
    startTextLayer: startElement?.closest(".textLayer") ?? null,
    endTextLayer: endElement?.closest(".textLayer") ?? null,
    text,
  };
  const invalid = selectionBoundaryMessage(boundary);
  if (invalid) {
    onInvalid?.(invalid);
    return null;
  }
  if (!pageElement) return null;
  const page = Number(pageElement.dataset.pageNumber);
  if (!Number.isInteger(page) || page < 1 || page > paper.pageCount)
    return null;
  const box = pageElement.getBoundingClientRect();
  const metadata = detail?.pages.find((item) => item.page === page);
  const width = metadata?.width ?? 595.28,
    height = metadata?.height ?? 841.89;
  const rotation = Number(pageElement.dataset.mainRotation ?? 0);
  const point = (x: number, y: number): [number, number] => {
    const u = Math.max(0, Math.min(1, (x - box.left) / box.width));
    const v = Math.max(0, Math.min(1, (y - box.top) / box.height));
    if (rotation === 90) return [v * width, u * height];
    if (rotation === 180) return [(1 - u) * width, v * height];
    if (rotation === 270) return [(1 - v) * width, (1 - u) * height];
    return [u * width, (1 - v) * height];
  };
  const rects = [...range.getClientRects()]
    .filter(
      (rect) =>
        rect.width > 1 &&
        rect.height > 1 &&
        rect.top >= box.top - 1 &&
        rect.bottom <= box.bottom + 1,
    )
    .map((rect) => {
      const a = point(rect.left, rect.top),
        b = point(rect.right, rect.bottom);
      return [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1]),
      ];
    });
  const invalidRects = selectionBoundaryMessage({
    ...boundary,
    rectCount: rects.length,
  });
  if (invalidRects) {
    onInvalid?.(invalidRects);
    return null;
  }
  return {
    page,
    text,
    quote: text,
    rects,
    pdfEtag: detail?.paper.pdfEtag ?? paper.pdfEtag,
    contentRevision: detail?.paper.contentRevision ?? paper.contentRevision,
  };
}
