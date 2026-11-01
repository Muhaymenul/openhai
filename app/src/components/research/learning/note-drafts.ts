import { z } from "zod";
import { idSchema, sourceSchema } from "@/lib/research/schemas";
import type { ResearchNote, SourceRef } from "@/lib/research/types";

export interface EditableNote {
  id?: string;
  version?: number;
  paperId: string;
  title: string;
  body: string;
  kind: ResearchNote["kind"];
  sources: SourceRef[];
  runId?: string;
  confirmed: boolean;
  origin: string;
  slot?: string;
}

const editableSchema = z
  .object({
    id: idSchema.optional(),
    version: z.number().int().positive().optional(),
    paperId: z.union([idSchema, z.literal("")]),
    title: z.string().max(500),
    body: z.string().max(200000),
    kind: z.enum(["reading", "card", "concept", "reflection", "analysis"]),
    sources: z.array(sourceSchema).max(200),
    runId: idSchema.optional(),
    confirmed: z.boolean(),
    origin: z.string().min(1).max(200),
    slot: idSchema.optional(),
  })
  .refine(
    (model) => !!model.id === (model.version !== undefined),
    "已有笔记需要编辑开始时的版本",
  );
const pendingSchema = z.object({
  actionId: idSchema,
  model: editableSchema,
  confirmed: z.boolean(),
});
export type PendingNoteCreate = z.infer<typeof pendingSchema>;
const draftSchema = z.object({
  schema: z.literal(1),
  type: z.literal("draft"),
  key: z.string().max(700),
  token: z.string().min(1).max(100),
  model: editableSchema,
  pendingCreate: pendingSchema.optional(),
  updatedAt: z.string().datetime(),
});
const bindingSchema = z.object({
  schema: z.literal(1),
  type: z.literal("binding"),
  key: z.string().max(700),
  paperId: idSchema,
  noteId: idSchema,
});
export type LocalNoteDraft = z.infer<typeof draftSchema>;
export type NoteDraftBinding = z.infer<typeof bindingSchema>;
export type NoteDraftEntry = LocalNoteDraft | NoteDraftBinding;
export type DraftStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
export const NOTE_DRAFT_PREFIX = "jiaoyan:note-draft:v1:";
export function needsNoteLeaveProtection(
  unsaved: boolean,
  status: "local" | "memory" | "unavailable" | "conflict",
  busy = false,
): boolean {
  return busy || (unsaved && status !== "local");
}

// This is a local UI identity, never a security token. The stored model and paper
// are checked again when reading a key, so identities cannot cross papers/notes.
function fingerprint(content: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < content.length; index++) {
    first = Math.imul(first ^ content.charCodeAt(index), 16777619);
    second = Math.imul(second ^ content.charCodeAt(index), 3266489917);
  }
  return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}-${content.length}`;
}
export function generatedNoteOrigin(
  note: Pick<EditableNote, "title" | "body" | "sources" | "runId">,
  explicitOrigin?: string,
): string {
  if (explicitOrigin) return explicitOrigin;
  return note.runId
    ? `run-${note.runId}`
    : `source-${fingerprint(JSON.stringify([note.title, note.body, note.sources]))}`;
}
/** Keep excerpts separate from the full-answer binding, while reopening the same excerpt reliably. */
export function excerptNoteOrigin(runId: string, excerpt: string): string {
  return `run-${runId.slice(0, 100)}-excerpt-${fingerprint(JSON.stringify([runId, excerpt]))}`;
}
export function localNoteKey(
  model: Pick<EditableNote, "paperId" | "id" | "origin" | "slot">,
): string {
  return (
    NOTE_DRAFT_PREFIX +
    encodeURIComponent(model.paperId) +
    ":" +
    encodeURIComponent(model.id ? `note-${model.id}` : `new-${model.origin}`) +
    (model.slot ? ":slot-" + model.slot : "")
  );
}
export function noteTabSlot(
  storage: Pick<Storage, "getItem" | "setItem">,
): string {
  const key = "jiaoyan:note-editor-tab:v1";
  const previous = storage.getItem(key);
  if (previous && idSchema.safeParse(previous).success) return previous;
  const slot = crypto.randomUUID();
  storage.setItem(key, slot);
  return slot;
}
export function editableNote(note: ResearchNote): EditableNote {
  return {
    id: note.id,
    version: note.version,
    paperId: note.paperId,
    title: note.title,
    body: note.body,
    kind: note.kind,
    sources: note.sources,
    runId: note.runId,
    confirmed: note.confirmed,
    origin: `note-${note.id}`,
  };
}
export function sameNoteContent(
  first: EditableNote,
  second: EditableNote,
): boolean {
  return (
    first.paperId === second.paperId &&
    first.title === second.title &&
    first.body === second.body &&
    first.kind === second.kind &&
    JSON.stringify(first.sources) === JSON.stringify(second.sources)
  );
}
export function hasUnsavedNote(
  model: EditableNote,
  baseline: EditableNote,
): boolean {
  return (
    !sameNoteContent(model, baseline) ||
    (!model.id && !!(model.title.trim() || model.body.trim()))
  );
}
export function noteVersionConflict(
  model: EditableNote,
  note: Pick<ResearchNote, "id" | "paperId" | "version">,
): boolean {
  return (
    model.id === note.id &&
    (model.paperId !== note.paperId || model.version !== note.version)
  );
}
export function readLocalNote(
  storage: DraftStorage,
  key: string,
): NoteDraftEntry | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const entry = z.union([draftSchema, bindingSchema]).parse(JSON.parse(raw));
    if (entry.key !== key || !key.startsWith(NOTE_DRAFT_PREFIX)) return null;
    if (entry.type === "draft" && localNoteKey(entry.model) !== key)
      return null;
    if (
      entry.type === "binding" &&
      !key.startsWith(
        NOTE_DRAFT_PREFIX + encodeURIComponent(entry.paperId) + ":new-",
      )
    )
      return null;
    if (
      entry.type === "draft" &&
      entry.pendingCreate &&
      (entry.model.id ||
        entry.pendingCreate.model.paperId !== entry.model.paperId)
    )
      return null;
    return entry;
  } catch {
    return null;
  }
}
export function listLocalNotes(storage: DraftStorage): LocalNoteDraft[] {
  const drafts: LocalNoteDraft[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(NOTE_DRAFT_PREFIX)) continue;
    const entry = readLocalNote(storage, key);
    if (
      entry?.type === "draft" &&
      (entry.model.title.trim() ||
        entry.model.body.trim() ||
        entry.pendingCreate)
    )
      drafts.push(entry);
  }
  return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export class LocalNoteConflict extends Error {}
export function writeLocalNote(
  storage: DraftStorage,
  entry: LocalNoteDraft,
  expectedToken: string | null,
): void {
  draftSchema.parse(entry);
  const current = readLocalNote(storage, entry.key);
  if ((current?.type === "draft" ? current.token : null) !== expectedToken)
    throw new LocalNoteConflict(
      "另一个窗口已有本机草稿，当前文字仍保留在编辑器。",
    );
  storage.setItem(entry.key, JSON.stringify(entry));
}
export function removeLocalNote(
  storage: DraftStorage,
  key: string,
  expectedToken: string | null,
): boolean {
  const current = readLocalNote(storage, key);
  if (current?.type !== "draft" || current.token !== expectedToken)
    return false;
  storage.removeItem(key);
  return true;
}
