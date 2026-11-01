import type { ReactNode } from "react";
import { Highlighter, PenLine, Type } from "lucide-react";
import type { EditMode } from "../usePdfDocument";
import styles from "../PdfReader.module.css";

export function EditorButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      className={`${styles.editorButton} ${active ? styles.activeTool : ""}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export function NativeEditorTools({
  mode,
  disabled,
  onMode,
}: {
  mode: EditMode;
  disabled: boolean;
  onMode(mode: EditMode): void;
}) {
  const tools = [
    { mode: "highlight" as const, label: "高亮", icon: Highlighter },
    { mode: "text" as const, label: "文本框", icon: Type },
    { mode: "draw" as const, label: "手写", icon: PenLine },
  ];
  return (
    <>
      {tools.map((tool) => (
        <EditorButton
          key={tool.mode}
          label={tool.label}
          active={mode === tool.mode}
          disabled={disabled}
          onClick={() => onMode(tool.mode)}
        >
          <tool.icon aria-hidden="true" />
        </EditorButton>
      ))}
    </>
  );
}
