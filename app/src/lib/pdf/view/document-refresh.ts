export interface PdfLiveView {
  page: number;
  scale: number;
  offsetX?: number;
  offsetY?: number;
}

interface ViewportContainer {
  scrollLeft: number;
  scrollTop: number;
}
interface ViewerPosition {
  currentPageNumber: number;
  currentScale: number;
  getPageView(index: number): { div: HTMLElement } | undefined;
}

/** Capture the position inside the current page, not just its page number. */
export function capturePdfView(
  viewer: ViewerPosition,
  container: ViewportContainer,
): PdfLiveView {
  const div = viewer.getPageView(viewer.currentPageNumber - 1)?.div;
  return {
    page: viewer.currentPageNumber,
    scale: viewer.currentScale,
    ...(div?.clientWidth && div?.clientHeight
      ? {
          offsetX: (container.scrollLeft - div.offsetLeft) / div.clientWidth,
          offsetY: (container.scrollTop - div.offsetTop) / div.clientHeight,
        }
      : {}),
  };
}

export function restorePdfView(
  view: PdfLiveView,
  viewer: ViewerPosition,
  container: ViewportContainer,
) {
  const div = viewer.getPageView(viewer.currentPageNumber - 1)?.div;
  if (!div) return;
  if (view.offsetX !== undefined && Number.isFinite(view.offsetX))
    container.scrollLeft = div.offsetLeft + view.offsetX * div.clientWidth;
  if (view.offsetY !== undefined && Number.isFinite(view.offsetY))
    container.scrollTop = div.offsetTop + view.offsetY * div.clientHeight;
}

/** A metadata refresh or our own native save must not reload the PDF. */
export function shouldReloadPdfVersion(
  loaded: string | null,
  incoming: string | null,
  busy: boolean,
): boolean {
  return Boolean(loaded && incoming && loaded !== incoming && !busy);
}

/** Track host changes separately from the live baseline advanced by native saves. */
export class PdfVersionRefresh {
  private observed: string | null;
  private pending: string | null;
  constructor(initial: string | null) {
    this.observed = this.pending = initial;
  }
  observe(incoming: string | null) {
    if (this.observed === incoming) return;
    this.observed = incoming;
    this.pending = incoming;
  }
  take(loaded: string | null, busy: boolean): string | null {
    if (this.pending === loaded) this.pending = null;
    if (!shouldReloadPdfVersion(loaded, this.pending, busy)) return null;
    const next = this.pending;
    this.pending = null;
    return next;
  }
}
