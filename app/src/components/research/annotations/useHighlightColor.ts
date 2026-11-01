"use client";
import { useEffect, useState } from "react";

export const HIGHLIGHT_COLORS = [
  { value: "#f6c84c", name: "黄色" },
  { value: "#91c9a3", name: "绿色" },
  { value: "#8cbce8", name: "蓝色" },
  { value: "#e9a9bc", name: "粉色" },
] as const;
const KEY = "jiaoyan:highlight-color:v1";
export function useHighlightColor() {
  const [color, setColor] = useState<string>(HIGHLIGHT_COLORS[0].value);
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      try {
        const saved = window.localStorage.getItem(KEY);
        if (HIGHLIGHT_COLORS.some((item) => item.value === saved))
          setColor(saved!);
      } catch {
        /* Color remains usable without storage. */
      }
    });
    return () => {
      disposed = true;
    };
  }, []);
  function change(value: string) {
    if (!HIGHLIGHT_COLORS.some((item) => item.value === value)) return;
    setColor(value);
    try {
      window.localStorage.setItem(KEY, value);
    } catch {
      /* Keep current session's color. */
    }
  }
  return { color, setColor: change };
}
