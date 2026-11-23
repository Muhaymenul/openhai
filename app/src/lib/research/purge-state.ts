import type { WorkspaceState } from "./store";
import type { ResearchNote, SourceRef } from "./types";
import { purgeMemoryPaper } from "./memory/core";

/** Keep another paper's authored text, while removing references that can no longer be checked. */
export function removePurgedPaperState(
  state: WorkspaceState,
  paperId: string,
  runIds: Set<string>,
): void {
  const removedNotes = new Set(
    state.notes
      .filter((note) => note.paperId === paperId)
      .map((note) => note.id),
  );
  const removedAnnotations = new Set(
    state.annotations
      .filter((item) => item.paperId === paperId)
      .map((item) => item.id),
  );
  const affected = (source: SourceRef) =>
    source.paperId === paperId ||
    Boolean(source.noteId && removedNotes.has(source.noteId)) ||
    Boolean(source.annotationId && removedAnnotations.has(source.annotationId));
  const now = new Date().toISOString();
  purgeMemoryPaper(state, paperId);
  state.paperComparisons = state.paperComparisons?.filter(
    (comparison) => !comparison.paperIds.includes(paperId),
  );
  // Merge undo snapshots must never reintroduce permanently deleted evidence.
  if (state.conceptMerges) state.conceptMerges = [];
  const cleanNote = (note: ResearchNote): ResearchNote => {
    if (!note.sources.some(affected) && !(note.runId && runIds.has(note.runId)))
      return note;
    return {
      ...note,
      sources: note.sources.filter((source) => !affected(source)),
      runId: undefined,
      confirmed: false,
      status: "draft",
      version: note.version + 1,
      updatedAt: now,
    };
  };
  state.papers = state.papers.filter((paper) => paper.id !== paperId);
  state.notes = state.notes
    .filter((note) => !removedNotes.has(note.id))
    .map(cleanNote);
  for (const [id, history] of Object.entries(state.noteHistory)) {
    if (removedNotes.has(id)) delete state.noteHistory[id];
    else state.noteHistory[id] = history.map(cleanNote);
  }
  state.annotations = state.annotations.filter(
    (item) => item.paperId !== paperId,
  );
  state.pendingAnnotations = state.pendingAnnotations.filter(
    (item) => item.annotation.paperId !== paperId,
  );
  state.knowledge = state.knowledge.map((entry) =>
    entry.sources.some(affected)
      ? {
          ...entry,
          sources: entry.sources.filter((source) => !affected(source)),
          source: "部分来源论文已永久删除",
          version: entry.version + 1,
          updatedAt: now,
        }
      : entry,
  );
  const removedTasks = new Set(
    state.plannerTasks
      ?.filter((task) => task.paperId === paperId)
      .map((task) => task.id),
  );
  state.plannerTasks = state.plannerTasks?.filter(
    (task) => !removedTasks.has(task.id),
  );
  const removedDecks = new Set<string>();
  state.reviewDecks = state.reviewDecks?.flatMap((deck) => {
    if (
      deck.paperId === paperId ||
      (deck.noteId && removedNotes.has(deck.noteId))
    ) {
      removedDecks.add(deck.id);
      return [];
    }
    const questions = deck.questions.filter(
      (question) => !question.sources.some(affected),
    );
    if (
      questions.length === deck.questions.length &&
      !(deck.runId && runIds.has(deck.runId))
    )
      return [deck];
    if (!questions.length) {
      removedDecks.add(deck.id);
      return [];
    }
    return [
      {
        ...deck,
        questions,
        runId: undefined,
        version: deck.version + 1,
        updatedAt: now,
        session: {
          ...deck.session,
          currentQuestionId: questions.some(
            (question) => question.id === deck.session.currentQuestionId,
          )
            ? deck.session.currentQuestionId
            : questions[0].id,
        },
      },
    ];
  });
  const removedNodes = new Set(
    state.graph.nodes
      .filter(
        (node) =>
          node.paperId === paperId ||
          Boolean(node.noteId && removedNotes.has(node.noteId)),
      )
      .map((node) => node.id),
  );
  state.graph.edges = state.graph.edges.filter(
    (edge) =>
      !removedNodes.has(edge.source) &&
      !removedNodes.has(edge.target) &&
      !edge.evidence.some(affected),
  );
  const connected = new Set(
    state.graph.edges.flatMap((edge) => [edge.source, edge.target]),
  );
  state.graph.nodes = state.graph.nodes.filter(
    (node) =>
      !removedNodes.has(node.id) &&
      (node.kind !== "concept" || node.knowledgeId || connected.has(node.id)),
  );
  state.graph.version++;
  const removedIds = new Set([
    ...removedNotes,
    ...removedAnnotations,
    ...removedTasks,
    ...removedDecks,
    ...runIds,
  ]);
  for (const action of Object.values(state.actions)) {
    if (removedIds.has(action.id)) {
      action.kind = "deleted";
      action.digest = "";
    }
  }
}
