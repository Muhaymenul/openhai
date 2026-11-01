import type { HighlightNotice } from "./useQuickHighlight";
import styles from "./selection.module.css";
export function HighlightUndoNotice({
  notice,
  busy,
  onUndo,
  onDismiss,
}: {
  notice: HighlightNotice | null;
  busy: boolean;
  onUndo(): void;
  onDismiss(): void;
}) {
  if (!notice) return null;
  return (
    <div className={styles.notice}>
      <span role="status">
        {notice.created ? "高亮已保存" : "此处已有高亮"} · 第{" "}
        {notice.annotation.page} 页
      </span>
      {notice.created && (
        <button type="button" onClick={onUndo} disabled={busy}>
          {busy ? "撤销中…" : "撤销"}
        </button>
      )}
      <button
        type="button"
        className={styles.dismiss}
        onClick={onDismiss}
        disabled={busy}
        aria-label="关闭高亮保存提示"
      >
        ×
      </button>
    </div>
  );
}
