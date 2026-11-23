import { describe, expect, it, vi } from "vitest";
import { coalesceRequest } from "@/components/research/reader-layout/coalesce-request";
import { BibliographyCache } from "@/lib/pdf/bibliography-cache";
import type { Bibliography } from "@/lib/pdf/bibliography";

describe("reader detail refresh", () => {
  it("shares concurrent save notifications and makes a fresh read after settling", async () => {
    let finish!: (value: string) => void;
    const source = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const read = coalesceRequest(source);
    const first = read(),
      second = read();
    expect(source).toHaveBeenCalledTimes(1);
    finish("saved version");
    expect(await first).toBe("saved version");
    expect(await second).toBe("saved version");
    const later = read();
    expect(source).toHaveBeenCalledTimes(2);
    finish("next version");
    expect(await later).toBe("next version");
  });

  it("allows a fresh retry after connectivity failure", async () => {
    const source = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("recovered");
    const read = coalesceRequest(source);
    await expect(read()).rejects.toThrow("offline");
    await expect(read()).resolves.toBe("recovered");
  });
});

describe("reference index reuse", () => {
  const references: Bibliography = { style: "numbered", entries: [] };
  it("reuses unchanged text while keeping replacement PDFs separate", () => {
    const cache = new BibliographyCache(2);
    cache.set("paper-a:text-v1", references);
    expect(cache.get("paper-a:text-v1")).toBe(references);
    expect(cache.get("paper-a:text-v2")).toBeUndefined();
    expect(cache.get("paper-b:text-v1")).toBeUndefined();
  });
  it("bounds retained documents using most-recent access", () => {
    const cache = new BibliographyCache(2);
    cache.set("one", references);
    cache.set("two", references);
    cache.get("one");
    cache.set("three", references);
    expect(cache.get("two")).toBeUndefined();
    expect(cache.get("one")).toBe(references);
  });
});
