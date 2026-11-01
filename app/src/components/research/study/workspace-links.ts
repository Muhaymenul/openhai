export interface WorkspaceCitationTarget {
  paperId: string;
  page: number;
}

/** Recognize only our local source route and the model's exact workspace-host typo. */
export function workspaceCitationTarget(
  href: string,
): WorkspaceCitationTarget | null {
  const value = href.replaceAll("&amp;", "&");
  const local = value.startsWith("/workspace?");
  const mistyped = /^https?:\/\/workspace\/?\?/i.test(value);
  if (!local && !mistyped) return null;
  let url: URL;
  try {
    url = new URL(value, "http://local.invalid");
  } catch {
    return null;
  }
  if (url.username || url.password || url.hash || url.port) return null;
  if (
    local &&
    (url.origin !== "http://local.invalid" || url.pathname !== "/workspace")
  )
    return null;
  if (mistyped && (url.hostname !== "workspace" || url.pathname !== "/"))
    return null;
  if (
    [...url.searchParams.keys()].some(
      (key) => !["paperId", "paper", "page"].includes(key),
    )
  )
    return null;
  const paperIds = [
    ...url.searchParams.getAll("paperId"),
    ...url.searchParams.getAll("paper"),
  ];
  const pages = url.searchParams.getAll("page");
  if (
    paperIds.length !== 1 ||
    pages.length !== 1 ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(paperIds[0]) ||
    !/^\d+$/.test(pages[0])
  )
    return null;
  const page = Number(pages[0]);
  if (!Number.isSafeInteger(page) || page < 1) return null;
  return { paperId: paperIds[0], page };
}

/** Repair a source citation, never an arbitrary external URL or example text. */
export function normalizeWorkspaceCitationHref(href: string): string {
  if (!/^https?:\/\/workspace\/?\?/i.test(href)) return href;
  const target = workspaceCitationTarget(href);
  return target
    ? `/workspace?paperId=${encodeURIComponent(target.paperId)}&page=${target.page}`
    : href;
}
