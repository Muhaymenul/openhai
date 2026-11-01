import { describe, expect, it } from "vitest";
import { selectionBoundaryMessage } from "../../src/components/research/selection-boundary";

describe("PDF selected-text boundaries without a browser", () => {
  it("requires both endpoints to belong to the same page and text layer identities", () => {
    const page = { pageNumber: 2 };
    const textLayer = {};
    const selection = {
      startPage: page,
      endPage: page,
      startTextLayer: textLayer,
      endTextLayer: textLayer,
      text: "A selected passage on the second page.",
    };
    expect(selectionBoundaryMessage(selection)).toBeNull();
    for (const change of [
      { endPage: { pageNumber: 3 } },
      // Matching page numbers alone do not make two different rendered pages identical.
      { endPage: { pageNumber: 2 } },
      { endTextLayer: {} },
      { startTextLayer: null },
      { endTextLayer: null },
      { startPage: null },
      { endPage: null },
    ]) {
      expect(selectionBoundaryMessage({ ...selection, ...change })).toBe(
        "请在同一页内选取文字",
      );
    }
  });

  it("accepts the full 6000-character boundary and reports longer text rather than silently shortening it", () => {
    const page = {},
      textLayer = {};
    const selection = {
      startPage: page,
      endPage: page,
      startTextLayer: textLayer,
      endTextLayer: textLayer,
      text: "文".repeat(6000),
    };
    expect(selectionBoundaryMessage(selection)).toBeNull();
    const longer = { ...selection, text: selection.text + "末" };
    expect(selectionBoundaryMessage(longer)).toBe("选文最多6000字，请缩小范围");
    expect(longer.text).toHaveLength(6001);
    expect(longer.text.endsWith("末")).toBe(true);
  });

  it("allows explanation without highlight geometry but rejects more than 300 highlight areas", () => {
    const page = {},
      textLayer = {};
    const selection = {
      startPage: page,
      endPage: page,
      startTextLayer: textLayer,
      endTextLayer: textLayer,
      text: "A valid passage.",
    };
    expect(selectionBoundaryMessage({ ...selection, rectCount: 0 })).toBeNull();
    expect(
      selectionBoundaryMessage({ ...selection, rectCount: 300 }),
    ).toBeNull();
    expect(selectionBoundaryMessage({ ...selection, rectCount: 301 })).toBe(
      "选文位置最多300处，请缩小范围",
    );
  });
});
