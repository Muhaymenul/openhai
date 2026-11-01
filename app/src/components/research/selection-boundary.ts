interface SelectionBoundary {
  startPage: object | null;
  endPage: object | null;
  startTextLayer: object | null;
  endTextLayer: object | null;
  text: string;
  rectCount?: number;
}

/** Compare endpoint identities without depending on browser globals. */
export function selectionBoundaryMessage(
  boundary: SelectionBoundary,
): string | null {
  if (
    !boundary.startPage ||
    boundary.startPage !== boundary.endPage ||
    !boundary.startTextLayer ||
    boundary.startTextLayer !== boundary.endTextLayer
  )
    return "请在同一页内选取文字";
  if (boundary.text.length > 6000) return "选文最多6000字，请缩小范围";
  if ((boundary.rectCount ?? 0) > 300) return "选文位置最多300处，请缩小范围";
  return null;
}
