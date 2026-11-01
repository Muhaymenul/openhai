import { describe, expect, it } from "vitest";
import {
  placeCommentCard,
  projectedComment,
} from "@/lib/pdf/reader/comment-card";

describe("controlled PDF comment card", () => {
  it("keeps a long card inside the reader pane instead of covering the neighboring notes pane", () => {
    const card = placeCommentCard(
      { x: 870, y: 470 },
      { x: 240, y: 180, width: 660, height: 600 },
      { x: 0, y: 0, width: 1600, height: 900 },
    );
    expect(card).not.toBeNull();
    expect(card!.x).toBeGreaterThanOrEqual(248);
    expect(card!.x + card!.width).toBeLessThanOrEqual(892);
    expect(card!.y).toBeGreaterThanOrEqual(188);
    expect(card!.y + card!.height).toBeLessThanOrEqual(772);
  });

  it("shrinks to a narrow, keyboard-reduced visual viewport while preserving readable scrolling space", () => {
    const card = placeCommentCard(
      { x: 370, y: 680 },
      { x: 0, y: 120, width: 390, height: 700 },
      { x: 0, y: 160, width: 280, height: 210 },
    );
    expect(card).toEqual({ x: 8, y: 168, width: 264, height: 194 });
    expect(
      placeCommentCard(
        { x: 1, y: 1 },
        { x: 500, y: 0, width: 300, height: 400 },
        { x: 0, y: 0, width: 390, height: 500 },
      ),
    ).toBeNull();
  });

  it("uses the same projected card for a highlight and its Text companion without granting edit access to a foreign note", () => {
    const local = {
      ids: ["11R", "12R", "13R"],
      page: 2,
      text: "同一条评论",
      author: "教研阅记",
      editable: true,
      kind: "highlight" as const,
    };
    const foreign = {
      ids: ["20R"],
      page: 2,
      text: "外部作者的评论",
      author: "教研阅记",
      editable: false,
      kind: "comment" as const,
    };
    expect(projectedComment([local, foreign], "11R")).toBe(
      projectedComment([local, foreign], "13R"),
    );
    expect(projectedComment([local, foreign], "20R")?.editable).toBe(false);
    expect(projectedComment([local, foreign], "unknown")).toBeUndefined();
  });
});
