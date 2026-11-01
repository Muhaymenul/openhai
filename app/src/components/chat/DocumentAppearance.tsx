"use client";

import { useSyncExternalStore } from "react";
import { Palette } from "lucide-react";
import styles from "./DocumentAppearance.module.css";

type Appearance = "theme" | "light" | "dark";
const KEY = "papernook:document-appearance";
const EVENT = "papernook:document-appearance-changed";

function normalize(value: string | null | undefined): Appearance {
  return value === "light" || value === "dark" ? value : "theme";
}

function current(): Appearance {
  const value = document.documentElement.dataset.documentAppearance;
  if (value) return normalize(value);
  try {
    return normalize(localStorage.getItem(KEY));
  } catch {
    return "theme";
  }
}

function apply(value: Appearance, persist: boolean) {
  document.documentElement.dataset.documentAppearance = value;
  if (persist) {
    try {
      if (value === "theme") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, value);
    } catch {}
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(changed: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== null) return;
    try {
      if (event.storageArea !== localStorage) return;
    } catch {
      return;
    }
    apply(normalize(event.newValue), false);
  };
  window.addEventListener(EVENT, changed);
  window.addEventListener("storage", storage);
  let selected = current();
  try {
    selected = normalize(localStorage.getItem(KEY));
  } catch {}
  apply(selected, false);
  return () => {
    window.removeEventListener(EVENT, changed);
    window.removeEventListener("storage", storage);
  };
}

export function useDocumentAppearance(): Appearance {
  return useSyncExternalStore(subscribe, current, () => "theme");
}

export function DocumentAppearanceSelect({
  value,
  compact = false,
}: {
  value: Appearance;
  compact?: boolean;
}) {
  return (
    <label
      className={styles.control}
      data-compact={compact ? "true" : undefined}
      title={compact ? "文档外观" : undefined}
    >
      {compact ? (
        <Palette size={14} aria-hidden="true" />
      ) : (
        <span>Document</span>
      )}
      <select
        aria-label={compact ? "文档外观" : "Document appearance"}
        value={value}
        onChange={(event) => apply(normalize(event.target.value), true)}
      >
        <option value="theme">{compact ? "跟随" : "Follow theme"}</option>
        <option value="light">{compact ? "浅色" : "Always light"}</option>
        <option value="dark">{compact ? "深色" : "Always dark"}</option>
      </select>
    </label>
  );
}
