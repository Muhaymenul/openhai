import { z } from "zod";
import {
  activeWorkspace,
  paperById,
  readWorkspace,
  ResearchError,
} from "../store";
import {
  applyPaperComparison,
  startPaperComparison,
  visibleComparisons,
} from "./core";
import { suggestReferenceRelations } from "./citations";
import { comparisonCsv, comparisonMarkdown } from "./export";
import { mergeConcepts, undoMerge } from "./merge";
import { relationActionSchema } from "./schemas";

const json = (value: unknown) =>
  Response.json(value, { headers: { "cache-control": "no-store" } });
const selectedIds = z
  .array(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/))
  .max(200);

export async function handleRelationsRequest(
  request: Request,
  segments: string[],
): Promise<Response | null> {
  if (segments.length) return null;
  if (request.method === "GET") {
    const url = new URL(request.url);
    const ids = selectedIds.parse(
      url.searchParams.get("paperIds")?.split(",").filter(Boolean) || [],
    );
    const state = await readWorkspace(),
      active = activeWorkspace(state);
    ids.forEach((id) => paperById(id, active));
    const comparisons = visibleComparisons(state, ids);
    const format = z
      .enum(["json", "markdown", "csv"])
      .parse(url.searchParams.get("format") || "json");
    if (format !== "json") {
      const content =
        format === "csv"
          ? comparisonCsv(comparisons, active.papers)
          : comparisonMarkdown(comparisons, active.papers);
      return new Response(content, {
        headers: {
          "cache-control": "no-store",
          "content-type":
            format === "csv"
              ? "text/csv; charset=utf-8"
              : "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="paper-comparison.${format === "csv" ? "csv" : "md"}"`,
        },
      });
    }
    return json({
      comparisons,
      papers: active.papers.map(({ id, title, year, topic }) => ({
        id,
        title,
        year,
        topic,
      })),
      graph: active.graph,
      merges: (state.conceptMerges || [])
        .filter((entry) => !entry.undoneAt)
        .map((entry) => ({
          id: entry.id,
          sourceLabel: entry.sourceLabel,
          targetLabel: entry.targetLabel,
          createdAt: entry.createdAt,
        })),
    });
  }
  if (request.method !== "POST") return null;
  if (Number(request.headers.get("content-length") || 0) > 500_000)
    throw new ResearchError("请求正文过大", 413);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ResearchError("请提交有效的请求内容");
  }
  const input = relationActionSchema.parse(raw);
  if (input.action === "compare")
    return json({
      run: await startPaperComparison(input.paperIds, input.question),
    });
  if (input.action === "apply")
    return json(await applyPaperComparison(input.runId));
  if (input.action === "citations")
    return json(await suggestReferenceRelations(input.paperIds));
  if (input.action === "merge")
    return json(
      await mergeConcepts(
        input.sourceNodeId,
        input.targetNodeId,
        input.graphVersion,
      ),
    );
  return json(await undoMerge(input.mergeId, input.graphVersion));
}
