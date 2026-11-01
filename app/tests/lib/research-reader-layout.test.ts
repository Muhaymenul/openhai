import { describe, expect, it } from "vitest";
import {
  clampReaderPercent,
  DEFAULT_READER_LAYOUT,
  dragReaderPercent,
  keyReaderPercent,
  parseReaderLayout,
  readReaderLayout,
  readerPercentBounds,
  READER_LAYOUT_KEY,
  saveReaderLayout,
} from "../../src/components/research/reader-layout/layout-preferences";

describe("persistent resizable research reader", () => {
  it("keeps useful room for both panes and restores a preference after a narrow window grows again", () => {
    const narrow = readerPercentBounds("columns", 750);
    const constrained = clampReaderPercent(80, narrow);
    expect(constrained).toBe(59);
    expect((750 * constrained) / 100).toBeGreaterThanOrEqual(320);
    expect(750 - 24 - (750 * constrained) / 100).toBeGreaterThanOrEqual(280);
    expect(clampReaderPercent(80, readerPercentBounds("columns", 1600))).toBe(
      80,
    );
    const stacked = readerPercentBounds("rows", 640);
    expect((640 * stacked.min) / 100).toBeGreaterThanOrEqual(240);
    expect(640 - 28 - (640 * stacked.max) / 100).toBeGreaterThanOrEqual(220);
    for (const size of [100, 400, 750, 1000, 1600]) {
      const bounds = readerPercentBounds("columns", size);
      expect(bounds.min).toBeLessThanOrEqual(bounds.max);
      expect(bounds.min).toBeGreaterThanOrEqual(25);
      expect(bounds.max).toBeLessThanOrEqual(80);
    }
  });

  it("supports pointer travel and keyboard adjustments while clamping extreme gestures", () => {
    const bounds = readerPercentBounds("columns", 1000);
    expect(dragReaderPercent(64, 40, 1000, bounds)).toBe(68);
    expect(dragReaderPercent(64, 99999, 1000, bounds)).toBe(bounds.max);
    expect(dragReaderPercent(64, -99999, 1000, bounds)).toBe(bounds.min);
    expect(dragReaderPercent(64, 100, 0, bounds)).toBe(64);
    expect(keyReaderPercent("columns", "ArrowLeft", 64, bounds)).toBe(63);
    expect(keyReaderPercent("columns", "ArrowRight", 64, bounds, true)).toBe(
      69,
    );
    expect(
      keyReaderPercent("rows", "ArrowUp", 50, readerPercentBounds("rows", 640)),
    ).toBe(49);
    expect(keyReaderPercent("rows", "ArrowLeft", 50, bounds)).toBeNull();
    expect(keyReaderPercent("columns", "Home", 64, bounds)).toBe(bounds.min);
    expect(keyReaderPercent("columns", "End", 64, bounds)).toBe(bounds.max);
    expect(keyReaderPercent("columns", "Tab", 64, bounds)).toBeNull();
  });

  it("accepts valid versioned preferences and falls back safely for corrupt or unsupported records", () => {
    expect(
      parseReaderLayout('{"version":1,"widthPercent":73,"heightPercent":55}'),
    ).toEqual({ widthPercent: 73, heightPercent: 55 });
    for (const raw of [
      null,
      "bad-json",
      "null",
      '{"version":2,"widthPercent":70,"heightPercent":55}',
    ])
      expect(parseReaderLayout(raw)).toEqual(DEFAULT_READER_LAYOUT);
    expect(
      parseReaderLayout(
        '{"version":1,"widthPercent":99999,"heightPercent":"50"}',
      ),
    ).toEqual(DEFAULT_READER_LAYOUT);
    expect(parseReaderLayout('{"version":1,"widthPercent":68.4}')).toEqual({
      widthPercent: 68,
      heightPercent: 50,
    });
  });

  it("continues to work when browser storage is denied and writes a reusable local record when available", () => {
    expect(
      readReaderLayout({
        getItem() {
          throw new Error("denied");
        },
      }),
    ).toEqual(DEFAULT_READER_LAYOUT);
    expect(
      saveReaderLayout(
        {
          setItem() {
            throw new Error("quota");
          },
        },
        { widthPercent: 70, heightPercent: 45 },
      ),
    ).toBe(false);
    const values = new Map<string, string>();
    expect(
      saveReaderLayout(
        {
          setItem(key, value) {
            values.set(key, value);
          },
        },
        { widthPercent: 70, heightPercent: 45 },
      ),
    ).toBe(true);
    expect(values.has(READER_LAYOUT_KEY)).toBe(true);
    expect(
      readReaderLayout({
        getItem(key) {
          return values.get(key) ?? null;
        },
      }),
    ).toEqual({ widthPercent: 70, heightPercent: 45 });
  });
});
