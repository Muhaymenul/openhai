"use client";

import { useEffect, useRef, useState } from "react";
import type { ReviewDeck } from "@/lib/research/review/types";
import { errorText, patchJson, researchApi } from "../api";

export function useReviewMutation(
  deck: ReviewDeck,
  onUpdate: (deck: ReviewDeck) => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const current = useRef(deck);
  useEffect(() => {
    current.current = deck;
  }, [deck]);
  async function mutate(
    action: "response" | "attempt" | "session" | "question",
    input: Record<string, unknown>,
  ): Promise<ReviewDeck | null> {
    if (locked.current) return null;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await patchJson<{ deck: ReviewDeck }>(
        `/review/${deck.id}/${action}`,
        { ...input, version: current.current.version },
      );
      current.current = result.deck;
      onUpdate(result.deck);
      return result.deck;
    } catch (cause) {
      setError(errorText(cause));
      return null;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await researchApi<{ deck: ReviewDeck }>(
        `/review/${deck.id}`,
      );
      current.current = result.deck;
      onUpdate(result.deck);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { busy, error, mutate, reload };
}
