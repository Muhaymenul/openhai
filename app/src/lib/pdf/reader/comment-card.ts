export interface CommentCardBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfCommentProjection {
  ids: string[];
  page: number;
  text: string;
  author: string;
  editable: boolean;
  kind: "comment" | "highlight" | "other";
  annotationId?: string;
  quote?: string;
}

/** The card stays inside both the visible reader pane and the visual viewport. */
export function placeCommentCard(
  anchor: { x: number; y: number },
  stage: CommentCardBox,
  viewport: CommentCardBox,
): CommentCardBox | null {
  const padding = 8;
  const gap = 12;
  const left = Math.max(stage.x, viewport.x) + padding;
  const top = Math.max(stage.y, viewport.y) + padding;
  const right =
    Math.min(stage.x + stage.width, viewport.x + viewport.width) - padding;
  const bottom =
    Math.min(stage.y + stage.height, viewport.y + viewport.height) - padding;
  if (right <= left || bottom <= top) return null;
  const width = Math.min(336, right - left);
  const height = Math.min(320, bottom - top);
  const preferredX =
    anchor.x + gap + width <= right ? anchor.x + gap : anchor.x - width - gap;
  const preferredY =
    anchor.y + gap + height <= bottom
      ? anchor.y + gap
      : anchor.y - height - gap;
  return {
    x: Math.max(left, Math.min(preferredX, right - width)),
    y: Math.max(top, Math.min(preferredY, bottom - height)),
    width,
    height,
  };
}

/** Group membership comes from the server's PDF ownership projection. */
export function projectedComment(
  comments: PdfCommentProjection[],
  id: string,
): PdfCommentProjection | undefined {
  return comments.find((comment) => comment.ids.includes(id));
}
