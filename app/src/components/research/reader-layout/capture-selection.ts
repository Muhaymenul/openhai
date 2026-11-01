import type { ResearchPaper, ResearchSelection } from "@/lib/research/types";
import type { PaperDetail } from "../api";
import { readPdfSelection } from "../reader-context";

/** Capture before a quick focus change, then allow the browser to finish selection. */
export function captureReaderSelection(
  root: HTMLDivElement,
  detail: PaperDetail | null,
  paper: ResearchPaper,
  onSelection: (selection: ResearchSelection | null) => void,
  onInvalid: (message: string) => void,
) {
  const selecting = () =>
    root
      .querySelector("[data-pdf-edit-mode]")
      ?.getAttribute("data-pdf-edit-mode") === "select";
  if (!selecting()) {
    onSelection(null);
    return;
  }
  let invalid = "";
  const immediate = readPdfSelection(root, detail, paper, (message) => {
    invalid = message;
  });
  if (invalid) {
    onInvalid(invalid);
    onSelection(null);
    return;
  }
  if (immediate) onSelection(immediate);
  setTimeout(() => {
    if (!root.isConnected || !selecting()) return;
    const active = document.activeElement;
    // Clicking the question field must not erase the passage just captured.
    if (
      active instanceof HTMLElement &&
      !root.contains(active) &&
      active.matches('input,textarea,[contenteditable="true"]')
    )
      return;
    onSelection(readPdfSelection(root, detail, paper, onInvalid));
  }, 0);
}
