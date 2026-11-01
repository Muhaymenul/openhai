import { describe, expect, it } from "vitest";
import type { NoteDraft } from "@/components/research/learning/NoteEditor";
import {
  excerptNoteOrigin,
  generatedNoteOrigin,
  localNoteKey,
  readLocalNote,
  writeLocalNote,
  type DraftStorage,
  type EditableNote,
  type LocalNoteDraft,
} from "@/components/research/learning/note-drafts";

function storage(): DraftStorage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}
function seed(excerpt?: string, runId = "run-one"): EditableNote {
  const draft: NoteDraft = {
    title: "阅读讨论",
    body: excerpt ?? "The complete answer has several paragraphs.",
    runId,
    sources: [{ paperId: "paper-a", page: 2 }],
    ...(excerpt === undefined
      ? {}
      : { origin: excerptNoteOrigin(runId, excerpt) }),
  };
  return {
    ...draft,
    paperId: "paper-a",
    kind: "reading",
    confirmed: false,
    origin: generatedNoteOrigin(draft, draft.origin),
    slot: "tab-one",
  };
}
function bind(store: DraftStorage, model: EditableNote, noteId: string) {
  const key = localNoteKey(model);
  store.setItem(
    key,
    JSON.stringify({
      schema: 1,
      type: "binding",
      key,
      paperId: model.paperId,
      noteId,
    }),
  );
}
describe("independent local identities for answer excerpts", () => {
  it("does not restore a saved complete answer when preparing an excerpt from the same run", () => {
    const store = storage();
    const full = seed();
    bind(store, full, "saved-complete-note");
    const partial = seed("Only the selected paragraph.");
    expect(full.origin).toBe("run-run-one");
    expect(localNoteKey(partial)).not.toBe(localNoteKey(full));
    expect(readLocalNote(store, localNoteKey(partial))).toBeNull();
    const draft: LocalNoteDraft = {
      schema: 1,
      type: "draft",
      key: localNoteKey(partial),
      model: partial,
      token: "excerpt-editor",
      updatedAt: "2026-10-31T10:00:00Z",
    };
    writeLocalNote(store, draft, null);
    const restored = readLocalNote(store, draft.key);
    expect(restored).toMatchObject({
      type: "draft",
      model: { body: "Only the selected paragraph.", runId: "run-one" },
    });
    expect(readLocalNote(store, localNoteKey(full))).toMatchObject({
      type: "binding",
      noteId: "saved-complete-note",
    });
  });
  it("reopens the same saved excerpt reliably while keeping different excerpts and runs separate", () => {
    const store = storage();
    const first = seed("The selected paragraph.");
    bind(store, first, "saved-excerpt-note");
    const reopened = seed("The selected paragraph.");
    expect(readLocalNote(store, localNoteKey(reopened))).toMatchObject({
      type: "binding",
      noteId: "saved-excerpt-note",
    });
    expect(
      readLocalNote(store, localNoteKey(seed("A different paragraph."))),
    ).toBeNull();
    expect(
      readLocalNote(
        store,
        localNoteKey(seed("The selected paragraph.", "run-two")),
      ),
    ).toBeNull();
    expect(seed(undefined, "run-one").origin).toBe("run-run-one");
  });
  it("fits persisted origin limits and keeps maximum-length valid run IDs distinct", () => {
    const runId = "r".repeat(99);
    const first = seed("An excerpt.", runId + "a");
    const second = seed("An excerpt.", runId + "b");
    expect(first.origin.length).toBeLessThanOrEqual(200);
    expect(first.origin).not.toBe(second.origin);
    const store = storage();
    const draft: LocalNoteDraft = {
      schema: 1,
      type: "draft",
      key: localNoteKey(first),
      model: first,
      token: "long-run-editor",
      updatedAt: "2026-10-31T10:00:00Z",
    };
    expect(() => writeLocalNote(store, draft, null)).not.toThrow();
    expect(readLocalNote(store, draft.key)).toMatchObject({
      model: { runId: runId + "a" },
    });
  });
});
