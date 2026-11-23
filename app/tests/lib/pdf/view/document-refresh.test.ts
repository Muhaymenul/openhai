import { describe, expect, it } from "vitest";
import {
  capturePdfView,
  restorePdfView,
  shouldReloadPdfVersion,
  PdfVersionRefresh,
} from "@/lib/pdf/view/document-refresh";

describe("annotation-only document refresh", () => {
  it("reloads external bytes while avoiding native-save echoes and unsafe edits", () => {
    expect(shouldReloadPdfVersion('"old"', '"new"', false)).toBe(true);
    expect(shouldReloadPdfVersion('"saved"', '"saved"', false)).toBe(false);
    expect(shouldReloadPdfVersion('"old"', '"new"', true)).toBe(false);
    expect(shouldReloadPdfVersion(null, '"new"', false)).toBe(false);
    expect(shouldReloadPdfVersion('"old"', null, false)).toBe(false);
  });

  it("ignores a stale host version while a native save notification is still being read", () => {
    const sync = new PdfVersionRefresh('"original"');
    expect(sync.take('"original"', false)).toBeNull();
    // PDF.js has already saved, while the host's detail GET is in flight.
    expect(sync.take('"native-saved"', false)).toBeNull();
    sync.observe('"native-saved"');
    expect(sync.take('"native-saved"', false)).toBeNull();
    sync.observe('"external-highlight"');
    expect(sync.take('"native-saved"', true)).toBeNull();
    expect(sync.take('"native-saved"', false)).toBe('"external-highlight"');
    expect(sync.take('"native-saved"', false)).toBeNull();
  });

  it("preserves the location within a page through an annotation refresh", () => {
    const div = {
      offsetLeft: 20,
      offsetTop: 900,
      clientWidth: 800,
      clientHeight: 1000,
    } as HTMLElement;
    const viewer = {
      currentPageNumber: 2,
      currentScale: 1.4,
      getPageView: () => ({ div }),
    };
    const oldContainer = { scrollLeft: 100, scrollTop: 1300 };
    const saved = capturePdfView(viewer, oldContainer);
    const newContainer = { scrollLeft: 0, scrollTop: 900 };
    restorePdfView(saved, viewer, newContainer);
    expect(newContainer).toEqual(oldContainer);
    expect(saved.page).toBe(2);
    expect(saved.scale).toBe(1.4);
  });

  it("falls back to normal page restoration before page geometry is available", () => {
    const viewer = {
      currentPageNumber: 3,
      currentScale: 1,
      getPageView: () => undefined,
    };
    const container = { scrollLeft: 0, scrollTop: 1200 };
    const saved = capturePdfView(viewer, container);
    restorePdfView(saved, viewer, container);
    expect(saved).toEqual({ page: 3, scale: 1 });
    expect(container.scrollTop).toBe(1200);
  });
});
