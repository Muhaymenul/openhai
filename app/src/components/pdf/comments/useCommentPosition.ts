"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import type { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import {
  placeCommentCard,
  type CommentCardBox,
} from "@/lib/pdf/reader/comment-card";

export function useCommentPosition(
  anchor: { page: number; x: number; y: number } | null,
  stage: RefObject<HTMLDivElement | null>,
  viewer: RefObject<PDFViewer | null>,
): CommentCardBox | null {
  const [position, setPosition] = useState<CommentCardBox | null>(null);
  const page = anchor?.page;
  const x = anchor?.x;
  const y = anchor?.y;
  useLayoutEffect(() => {
    if (page === undefined || x === undefined || y === undefined) return;
    const stageElement = stage.current;
    const visual = window.visualViewport;
    const pageElement = stageElement?.querySelector<HTMLElement>(
      `.page[data-page-number="${page}"]`,
    );
    if (!stageElement || !pageElement) return;
    const place = () => {
      const pageView = viewer.current?.getPageView(page - 1);
      if (!pageView) return;
      const [pageX, pageY] = pageView.viewport.convertToViewportPoint(x, y);
      const rect = pageElement.getBoundingClientRect();
      const bounds = stageElement.getBoundingClientRect();
      setPosition(
        placeCommentCard(
          { x: rect.left + pageX, y: rect.top + pageY },
          {
            x: bounds.left,
            y: bounds.top,
            width: bounds.width,
            height: bounds.height,
          },
          {
            x: visual?.offsetLeft ?? 0,
            y: visual?.offsetTop ?? 0,
            width: visual?.width ?? window.innerWidth,
            height: visual?.height ?? window.innerHeight,
          },
        ),
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(pageElement);
    observer.observe(stageElement);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    visual?.addEventListener("resize", place);
    visual?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      visual?.removeEventListener("resize", place);
      visual?.removeEventListener("scroll", place);
    };
  }, [page, x, y, stage, viewer]);
  return position;
}
