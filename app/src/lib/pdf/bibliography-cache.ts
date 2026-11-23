import type { Bibliography } from "./bibliography";

/** Small, memory-only cache keyed by the host's text/content revision. */
export class BibliographyCache {
  private readonly entries = new Map<string, Bibliography>();
  constructor(private readonly limit = 4) {}
  get(key: string): Bibliography | undefined {
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }
  set(key: string, value: Bibliography) {
    // Very large bibliographies remain usable for the active reader without
    // being retained after it closes.
    if (!key || JSON.stringify(value).length > 2_000_000) return;
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit)
      this.entries.delete(this.entries.keys().next().value!);
  }
}

export const readerBibliographies = new BibliographyCache();
