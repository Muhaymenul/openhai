"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResearchNote } from "@/lib/research/types";
import { errorText, patchJson, postJson, researchApi } from "../api";
import {
  editableNote,
  hasUnsavedNote,
  listLocalNotes,
  LocalNoteConflict,
  localNoteKey,
  noteVersionConflict,
  needsNoteLeaveProtection,
  noteTabSlot,
  readLocalNote,
  removeLocalNote,
  sameNoteContent,
  writeLocalNote,
  NOTE_DRAFT_PREFIX,
  type EditableNote,
  type LocalNoteDraft,
  type NoteDraftEntry,
  type PendingNoteCreate,
} from "./note-drafts";

type SaveOptions = {
  confirmed?: boolean;
  asNew?: boolean;
  beforeSave?(): Promise<boolean>;
  onSaved(note: ResearchNote): Promise<void>;
  notify(message: string, error?: boolean): void;
};
export function useNoteEditor(
  initial: EditableNote,
  latestNotes?: ResearchNote[],
) {
  const initialRef = useRef(initial);
  const seedRef = useRef(initial);
  const modelRef = useRef(initial);
  const baselineRef = useRef(initial);
  const keyRef = useRef(localNoteKey(initial));
  const tokenRef = useRef<string | null>(null);
  const pendingRef = useRef<PendingNoteCreate | undefined>(undefined);
  const lock = useRef(false);
  const epoch = useRef(0);
  const tabSlot = useRef<string | null>(null);
  const [model, setModel] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<
    "local" | "memory" | "unavailable" | "conflict"
  >("memory");
  const [error, setError] = useState("");
  const [server, setServer] = useState<EditableNote | null>(null);
  const [restored, setRestored] = useState(false);
  const [drafts, setDrafts] = useState<LocalNoteDraft[]>([]);
  const unsaved = hasUnsavedNote(model, baseline);
  const protectLeave = needsNoteLeaveProtection(unsaved, status, busy);

  const refreshDrafts = useCallback(() => {
    try {
      setDrafts(listLocalNotes(window.localStorage));
    } catch {
      setStatus("unavailable");
    }
  }, []);
  const persist = useCallback(
    (next: EditableNote, pending = pendingRef.current) => {
      const key = localNoteKey(next);
      const entry: LocalNoteDraft = {
        schema: 1,
        type: "draft",
        key,
        model: next,
        pendingCreate: pending,
        token: crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
      };
      try {
        writeLocalNote(
          window.localStorage,
          entry,
          key === keyRef.current ? tokenRef.current : null,
        );
        const previousKey = keyRef.current;
        const previousToken = tokenRef.current;
        keyRef.current = key;
        tokenRef.current = entry.token;
        if (key !== previousKey) {
          const removed = removeLocalNote(
            window.localStorage,
            previousKey,
            previousToken,
          );
          if (removed && next.id && previousKey.includes(":new-"))
            window.localStorage.setItem(
              previousKey,
              JSON.stringify({
                schema: 1,
                type: "binding",
                key: previousKey,
                paperId: next.paperId,
                noteId: next.id,
              }),
            );
        }
        setStatus("local");
      } catch (cause) {
        setStatus(
          cause instanceof LocalNoteConflict ? "conflict" : "unavailable",
        );
      }
    },
    [],
  );
  const open = useCallback(
    async (seed: EditableNote, recovered?: LocalNoteDraft) => {
      if (lock.current) return;
      if (!tabSlot.current) {
        try {
          tabSlot.current = noteTabSlot(window.sessionStorage);
        } catch {
          tabSlot.current = crypto.randomUUID();
        }
      }
      seed = { ...seed, slot: seed.slot ?? tabSlot.current };
      const currentEpoch = ++epoch.current;
      seedRef.current = seed;
      setReady(false);
      setBlocked(false);
      setError("");
      setServer(null);
      setRestored(false);
      let nextSeed = seed;
      let key = localNoteKey(seed);
      let entry: NoteDraftEntry | null | undefined;
      try {
        entry = recovered ?? readLocalNote(window.localStorage, key);
        if (entry?.type === "binding") {
          // A generated draft already saved once must reopen that ID, never POST again.
          const result = await researchApi<{ note: ResearchNote }>(
            "/notes/" + entry.noteId,
          );
          if (currentEpoch !== epoch.current) return;
          if (result.note.paperId !== seed.paperId)
            throw new Error("本机草稿与已保存笔记的论文不匹配。");
          nextSeed = { ...editableNote(result.note), slot: seed.slot };
          key = localNoteKey(nextSeed);
          entry = readLocalNote(window.localStorage, key);
        }
        setStatus("memory");
      } catch (cause) {
        if (currentEpoch !== epoch.current) return;
        if (entry?.type === "binding") {
          setError(
            "已保存笔记暂时无法读取，请重试；不会另建重复笔记。 " +
              errorText(cause),
          );
          setBlocked(true);
        } else setStatus("unavailable");
      }
      if (currentEpoch !== epoch.current) return;
      const local = entry?.type === "draft" ? entry : undefined;
      if (local) key = local.key;
      const next = local?.model ?? nextSeed;
      keyRef.current = key;
      tokenRef.current = local?.token ?? null;
      pendingRef.current = local?.pendingCreate;
      modelRef.current = next;
      baselineRef.current = nextSeed;
      setModel(next);
      setBaseline(nextSeed);
      setRestored(!!local);
      if (
        local &&
        nextSeed.id &&
        nextSeed.version &&
        noteVersionConflict(next, {
          id: nextSeed.id,
          paperId: nextSeed.paperId,
          version: nextSeed.version,
        })
      )
        setServer(nextSeed);
      setReady(true);
      if (local) setStatus("local");
      else if (hasUnsavedNote(next, nextSeed) && entry?.type !== "binding")
        persist(next);
      refreshDrafts();
    },
    [persist, refreshDrafts],
  );
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) void open(initialRef.current);
    });
    return () => {
      disposed = true;
      epoch.current = -1;
    };
  }, [open]);
  useEffect(() => {
    const latestNote = latestNotes?.find((note) => note.id === model.id);
    if (!latestNote) return;
    if (noteVersionConflict(modelRef.current, latestNote))
      queueMicrotask(() => {
        if (noteVersionConflict(modelRef.current, latestNote))
          setServer(editableNote(latestNote));
      });
  }, [latestNotes, model.id]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key && !event.key.startsWith(NOTE_DRAFT_PREFIX)) return;
      refreshDrafts();
      if (
        (!event.key || event.key === keyRef.current) &&
        hasUnsavedNote(modelRef.current, baselineRef.current)
      )
        setStatus("conflict");
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [refreshDrafts]);
  useEffect(() => {
    if (!protectLeave) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [protectLeave]);

  function change(
    patch: Partial<Pick<EditableNote, "title" | "body" | "kind" | "paperId">>,
  ) {
    if (!ready || blocked || lock.current) return;
    if (
      patch.paperId &&
      patch.paperId !== modelRef.current.paperId &&
      pendingRef.current
    ) {
      setError("请先重试保存这份草稿，再更改关联论文。");
      return;
    }
    const next = { ...modelRef.current, ...patch };
    if (next.paperId !== modelRef.current.paperId && !next.id)
      next.origin = "manual-" + crypto.randomUUID();
    modelRef.current = next;
    setModel(next);
    setRestored(false);
    if (hasUnsavedNote(next, baselineRef.current) || pendingRef.current)
      persist(next);
    else {
      try {
        removeLocalNote(window.localStorage, keyRef.current, tokenRef.current);
        tokenRef.current = null;
        setStatus("memory");
      } catch {
        setStatus("unavailable");
      }
    }
  }
  function localCopy(asNew = false) {
    if (lock.current) return;
    const next = {
      ...modelRef.current,
      slot: crypto.randomUUID(),
      ...(asNew
        ? {
            id: undefined,
            version: undefined,
            confirmed: false,
            origin: "copy-" + crypto.randomUUID(),
          }
        : {}),
    };
    keyRef.current = localNoteKey(next);
    tokenRef.current = null;
    if (asNew) pendingRef.current = undefined;
    modelRef.current = next;
    if (asNew) baselineRef.current = next;
    setModel(next);
    if (asNew) {
      setBaseline(next);
      setServer(null);
    }
    setError("");
    persist(next);
    refreshDrafts();
  }
  function complete(note: ResearchNote) {
    const previousKey = keyRef.current;
    const next = {
      ...editableNote(note),
      slot: modelRef.current.slot ?? tabSlot.current ?? undefined,
    };
    try {
      const removed = removeLocalNote(
        window.localStorage,
        previousKey,
        tokenRef.current,
      );
      if (removed && previousKey.includes(":new-"))
        window.localStorage.setItem(
          previousKey,
          JSON.stringify({
            schema: 1,
            type: "binding",
            key: previousKey,
            paperId: note.paperId,
            noteId: note.id,
          }),
        );
    } catch {
      setStatus("unavailable");
    }
    modelRef.current = next;
    baselineRef.current = next;
    keyRef.current = localNoteKey(next);
    tokenRef.current = null;
    pendingRef.current = undefined;
    setModel(next);
    setBaseline(next);
    setServer(null);
    setError("");
    setRestored(false);
    refreshDrafts();
  }
  async function useCurrentVersion() {
    if (!server || lock.current) return;
    const copy = {
      ...modelRef.current,
      slot: crypto.randomUUID(),
    };
    const entry: LocalNoteDraft = {
      schema: 1,
      type: "draft",
      key: localNoteKey(copy),
      model: copy,
      token: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    try {
      writeLocalNote(window.localStorage, entry, null);
      removeLocalNote(window.localStorage, keyRef.current, tokenRef.current);
      await open(server);
    } catch {
      setError("无法保留本机草稿，请先复制文字或另存为新笔记。");
    }
  }
  async function save(options: SaveOptions): Promise<ResearchNote | null> {
    if (lock.current || !ready || blocked) return null;
    if (server && !options.asNew) {
      setError("笔记已有新版本。当前草稿已保留，请先核对或另存为新笔记。");
      return null;
    }
    if (options.asNew) localCopy(true);
    const snapshot = modelRef.current;
    if (!snapshot.title.trim() || !snapshot.body.trim() || !snapshot.paperId) {
      setError("请填写标题、正文，并关联一篇论文。");
      return null;
    }
    if (
      !hasUnsavedNote(snapshot, baselineRef.current) &&
      (!options.confirmed || snapshot.confirmed)
    )
      return null;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (options.beforeSave && !(await options.beforeSave())) return null;
      const confirmed = options.confirmed || snapshot.confirmed;
      const fields = (value: EditableNote, isConfirmed: boolean) => ({
        paperId: value.paperId,
        title: value.title.trim(),
        body: value.body,
        kind: value.kind,
        sources: value.sources,
        runId: value.runId,
        confirmed: isConfirmed,
        status: isConfirmed ? "confirmed" : "draft",
      });
      let note: ResearchNote;
      if (snapshot.id) {
        const latest = await researchApi<{ note: ResearchNote }>(
          "/notes/" + snapshot.id,
        );
        if (noteVersionConflict(snapshot, latest.note)) {
          setServer(editableNote(latest.note));
          throw new Error("笔记已有新版本，当前草稿已保留；未覆盖服务器内容。");
        }
        note = (
          await patchJson<{ note: ResearchNote }>("/notes/" + snapshot.id, {
            ...fields(snapshot, confirmed),
            version: snapshot.version,
          })
        ).note;
      } else {
        // Keep an exact POST snapshot across lost responses, edits, and reloads.
        // Replaying it obtains the same note ID before applying any later edits.
        const pending = pendingRef.current ?? {
          model: snapshot,
          actionId: crypto.randomUUID(),
          confirmed,
        };
        pendingRef.current = pending;
        persist(snapshot, pending);
        note = (
          await postJson<{ note: ResearchNote }>("/notes", {
            ...fields(pending.model, pending.confirmed),
            actionId: pending.actionId,
          })
        ).note;
        if (
          note.version !== 1 &&
          !sameNoteContent(editableNote(note), {
            ...pending.model,
            title: pending.model.title.trim(),
          })
        ) {
          const old = { ...snapshot, id: note.id, version: 1 };
          modelRef.current = old;
          setModel(old);
          pendingRef.current = undefined;
          persist(old);
          setServer(editableNote(note));
          throw new Error(
            "这份已创建的笔记又有更新；草稿已保留，请核对后另存。",
          );
        }
        if (
          !sameNoteContent(snapshot, pending.model) ||
          confirmed !== pending.confirmed
        ) {
          if (note.version !== 1) {
            const old = { ...snapshot, id: note.id, version: 1 };
            modelRef.current = old;
            setModel(old);
            pendingRef.current = undefined;
            persist(old);
            setServer(editableNote(note));
            throw new Error(
              "这份已创建的笔记又有更新；草稿已保留，请核对后另存。",
            );
          }
          note = (
            await patchJson<{ note: ResearchNote }>("/notes/" + note.id, {
              ...fields(snapshot, confirmed),
              version: note.version,
            })
          ).note;
        }
      }
      complete(note);
      try {
        await options.onSaved(note);
      } catch {
        options.notify("笔记已保存，列表暂未刷新，请稍后重新载入。", true);
        return note;
      }
      options.notify(
        options.confirmed
          ? "笔记已确认，已加入个人研究知识库。"
          : "笔记已保存。",
      );
      return note;
    } catch (cause) {
      setError(errorText(cause));
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function discard(entry: LocalNoteDraft) {
    try {
      removeLocalNote(window.localStorage, entry.key, entry.token);
      refreshDrafts();
    } catch {
      setStatus("unavailable");
    }
  }
  return {
    model,
    ready,
    blocked,
    busy,
    unsaved,
    protectLeave,
    status,
    error,
    server,
    restored,
    drafts,
    change,
    open,
    save,
    localCopy,
    useCurrentVersion,
    discard,
    retry: () => void open(seedRef.current),
  };
}
export type NoteEditorController = ReturnType<typeof useNoteEditor>;
