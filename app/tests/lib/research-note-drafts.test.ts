import { describe, expect, it } from "vitest";
import type { ResearchNote } from "@/lib/research/types";
import {
  editableNote,
  generatedNoteOrigin,
  hasUnsavedNote,
  listLocalNotes,
  LocalNoteConflict,
  localNoteKey,
  noteVersionConflict,
  needsNoteLeaveProtection,
  noteTabSlot,
  readLocalNote,
  removeLocalNote,
  writeLocalNote,
  type DraftStorage,
  type EditableNote,
  type LocalNoteDraft,
} from "@/components/research/learning/note-drafts";

class MemoryStorage implements DraftStorage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
function model(patch: Partial<EditableNote> = {}): EditableNote {
  return {
    paperId: "paper-a",
    title: "Reading note",
    body: "Original source and my thought",
    kind: "reading",
    sources: [
      {
        paperId: "paper-a",
        page: 2,
        quote: "Original source",
        contentRevision: "text-v1",
      },
    ],
    confirmed: false,
    origin: "manual",
    ...patch,
  };
}
function saved(patch: Partial<ResearchNote> = {}): ResearchNote {
  return {
    id: "note-a",
    version: 3,
    paperId: "paper-a",
    title: "Saved title",
    body: "Saved body",
    content: "Saved body",
    kind: "reading",
    sources: [],
    confirmed: false,
    status: "draft",
    createdAt: "2026-10-31T00:00:00Z",
    updatedAt: "2026-10-31T00:00:00Z",
    ...patch,
  };
}
function draft(value = model(), token = "writer-a"): LocalNoteDraft {
  return {
    schema: 1,
    type: "draft",
    key: localNoteKey(value),
    token,
    model: value,
    updatedAt: "2026-10-31T00:00:00Z",
  };
}

describe("recoverable local note drafts", () => {
  it("allows leaving a locally persisted draft but protects failed storage, conflicts, and in-flight saves", () => {
    expect(needsNoteLeaveProtection(true, "local")).toBe(false);
    expect(needsNoteLeaveProtection(true, "local", true)).toBe(true);
    for (const status of ["memory", "unavailable", "conflict"] as const) {
      expect(needsNoteLeaveProtection(true, status)).toBe(true);
      expect(needsNoteLeaveProtection(false, status)).toBe(false);
    }
    expect(needsNoteLeaveProtection(false, "local")).toBe(false);
    expect(needsNoteLeaveProtection(false, "memory", true)).toBe(true);
  });
  it("keeps a tab's recovery identity across refreshes and isolates separate tab sessions", () => {
    const firstTab = new MemoryStorage();
    const secondTab = new MemoryStorage();
    const firstSlot = noteTabSlot(firstTab);
    expect(noteTabSlot(firstTab)).toBe(firstSlot);
    const secondSlot = noteTabSlot(secondTab);
    expect(secondSlot).not.toBe(firstSlot);
    const note = editableNote(saved());
    expect(localNoteKey({ ...note, slot: firstSlot })).not.toBe(
      localNoteKey({ ...note, slot: secondSlot }),
    );
    const stored = draft({
      ...note,
      slot: firstSlot,
      body: "This tab's unsubmitted edits",
    });
    writeLocalNote(firstTab, stored, null);
    expect(readLocalNote(firstTab, stored.key)).toEqual(stored);
    expect(noteVersionConflict(stored.model, saved({ version: 4 }))).toBe(true);
  });
  it("isolates papers, existing note IDs, and generated materials while keeping repeated opens stable", () => {
    const seed = model();
    const origin = generatedNoteOrigin(seed);
    expect(generatedNoteOrigin({ ...seed })).toBe(origin);
    expect(
      generatedNoteOrigin({ ...seed, body: "A different selected passage" }),
    ).not.toBe(origin);
    expect(
      generatedNoteOrigin({
        ...seed,
        sources: [{ paperId: "paper-a", page: 3 }],
      }),
    ).not.toBe(origin);
    expect(generatedNoteOrigin({ ...seed, runId: "run-a" })).not.toBe(
      generatedNoteOrigin({ ...seed, runId: "run-b" }),
    );
    expect(localNoteKey({ ...seed, origin })).not.toBe(
      localNoteKey({ ...seed, origin, paperId: "paper-b" }),
    );
    expect(localNoteKey(model({ id: "note-a", version: 1 }))).not.toBe(
      localNoteKey(model({ id: "note-b", version: 1 })),
    );
    expect(localNoteKey(model({ id: "note-a", version: 1 }))).toBe(
      localNoteKey(
        model({
          ...seed,
          id: "note-a",
          version: 7,
          origin: "another-surface",
        }),
      ),
    );
  });

  it("restores exact edits and their starting version without rebasing against a newer server note", () => {
    const storage = new MemoryStorage();
    const baseline = editableNote(saved());
    const local = draft({
      ...baseline,
      title: "Local title",
      body: "Unsubmitted local changes",
    });
    writeLocalNote(storage, local, null);
    const recovered = readLocalNote(storage, local.key);
    expect(recovered).toEqual(local);
    if (recovered?.type !== "draft")
      throw new Error("Expected a recoverable draft");
    expect(recovered.model.version).toBe(3);
    expect(
      noteVersionConflict(
        recovered.model,
        saved({ version: 4, body: "Other window" }),
      ),
    ).toBe(true);
    expect(noteVersionConflict(recovered.model, saved())).toBe(false);
    expect(hasUnsavedNote(recovered.model, baseline)).toBe(true);
    expect(hasUnsavedNote(baseline, baseline)).toBe(false);
    expect(hasUnsavedNote(model(), model())).toBe(true);
    expect(
      hasUnsavedNote(
        model({ title: "", body: "" }),
        model({ title: "", body: "" }),
      ),
    ).toBe(false);
    expect(readLocalNote(storage, local.key)).toEqual(local);
  });

  it("refuses a stale local writer and never deletes another window's newer draft", () => {
    const storage = new MemoryStorage();
    const first = draft();
    writeLocalNote(storage, first, null);
    const second = draft(
      { ...first.model, body: "The other window's new text" },
      "writer-b",
    );
    writeLocalNote(storage, second, first.token);
    expect(() =>
      writeLocalNote(
        storage,
        draft({ ...first.model, body: "Old window" }, "writer-c"),
        first.token,
      ),
    ).toThrow(LocalNoteConflict);
    expect(removeLocalNote(storage, first.key, first.token)).toBe(false);
    expect(readLocalNote(storage, first.key)).toEqual(second);
    expect(removeLocalNote(storage, second.key, second.token)).toBe(true);
    expect(readLocalNote(storage, second.key)).toBeNull();
  });

  it("retains the original create request and action ID so a lost response can be retried without another note", () => {
    const storage = new MemoryStorage();
    const initial = model();
    const local = {
      ...draft({ ...initial, body: "Edits made after the first save attempt" }),
      pendingCreate: {
        actionId: "create-one-note",
        model: initial,
        confirmed: false,
      },
    };
    writeLocalNote(storage, local, null);
    const recovered = readLocalNote(storage, local.key);
    expect(recovered?.type).toBe("draft");
    if (recovered?.type !== "draft")
      throw new Error("Missing local request snapshot");
    expect(recovered.pendingCreate?.actionId).toBe("create-one-note");
    expect(recovered.pendingCreate?.model.body).toBe(initial.body);
    expect(recovered.model.body).not.toBe(initial.body);
  });

  it("rejects corrupted or mismatched identities and lists unfinished drafts rather than saved bindings", () => {
    const storage = new MemoryStorage();
    const local = draft();
    writeLocalNote(storage, local, null);
    const bindingKey = localNoteKey(model({ origin: "run-another" }));
    storage.setItem(
      bindingKey,
      JSON.stringify({
        schema: 1,
        type: "binding",
        key: bindingKey,
        paperId: "paper-a",
        noteId: "saved-note",
      }),
    );
    expect(readLocalNote(storage, bindingKey)).toMatchObject({
      type: "binding",
      noteId: "saved-note",
    });
    const wrongKey = localNoteKey(model({ paperId: "paper-b" }));
    storage.setItem(wrongKey, JSON.stringify({ ...local, key: wrongKey }));
    expect(readLocalNote(storage, wrongKey)).toBeNull();
    storage.setItem(local.key + "broken", "{not-json");
    expect(listLocalNotes(storage)).toEqual([local]);
    storage.setItem(
      local.key,
      JSON.stringify({ ...local, model: { ...local.model, id: "saved-note" } }),
    );
    expect(readLocalNote(storage, local.key)).toBeNull();
  });

  it("allows an unassigned manual draft and surfaces blocked or full storage instead of claiming it was saved", () => {
    const storage = new MemoryStorage();
    const local = draft(model({ paperId: "", sources: [] }));
    writeLocalNote(storage, local, null);
    expect(readLocalNote(storage, local.key)).toEqual(local);
    const blocked = {
      ...storage,
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error("Storage disabled");
      },
      setItem: () => {
        throw new Error("Quota exceeded");
      },
      removeItem: () => {},
    };
    expect(() => readLocalNote(blocked, local.key)).toThrow("Storage disabled");
    expect(() =>
      writeLocalNote({ ...blocked, getItem: () => null }, local, null),
    ).toThrow("Quota exceeded");
    expect(() =>
      writeLocalNote(storage, draft(model({ body: "x".repeat(200001) })), null),
    ).toThrow();
  });
});
