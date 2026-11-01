"use client";

/* eslint-disable @next/next/no-img-element -- These bundled, offline paintings need their real img elements for decode() and a continuous two-layer crossfade. */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { COVER_ARTWORKS } from "./cover-artworks";
import styles from "./gallery.module.css";

const HOLD_MS = 6_000;
const FADE_MS = 1_800;
const REDUCED_MOTION_RATE = 12;
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const INITIAL_INDEX = Math.max(
  0,
  COVER_ARTWORKS.findIndex((artwork) =>
    artwork.src.includes("school-of-athens"),
  ),
);

type GalleryView = { current: number; incoming: number | null };

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function subscribeToMotion(onChange: () => void) {
  const preference = window.matchMedia(MOTION_QUERY);
  preference.addEventListener("change", onChange);
  return () => preference.removeEventListener("change", onChange);
}

function subscribeToMount() {
  return () => {};
}

const readMounted = () => true;
const readNotMounted = () => false;
const readVisible = () => document.visibilityState === "visible";
const readServerVisible = () => true;
const readReducedMotion = () => window.matchMedia(MOTION_QUERY).matches;
const readServerMotion = () => false;

function artworkAt(index: number, offset = 0) {
  return COVER_ARTWORKS[
    (index + offset + COVER_ARTWORKS.length) % COVER_ARTWORKS.length
  ];
}

/** Keys keep the fully decoded incoming element alive when it becomes the base. */
function ArtworkLayers({
  current,
  incoming,
  offset = 0,
  decorative = false,
}: GalleryView & { offset?: number; decorative?: boolean }) {
  const layers = [
    { artwork: artworkAt(current, offset), entering: false },
    ...(incoming === null
      ? []
      : [{ artwork: artworkAt(incoming, offset), entering: true }]),
  ];

  return layers.map(({ artwork, entering }) => (
    <img
      key={artwork.id}
      src={artwork.src}
      alt={decorative || entering ? "" : artwork.alt}
      aria-hidden={decorative || entering ? true : undefined}
      className={`${decorative ? styles.wingImage : styles.mainImage} ${entering ? styles.incoming : styles.outgoing}`}
      data-artwork={artwork.id}
      data-gallery-incoming={entering ? "true" : undefined}
      decoding="async"
      loading="eager"
      fetchPriority={!decorative && !entering ? "high" : "auto"}
      draggable={false}
    />
  ));
}

export function FloatingGallery({
  suspended = false,
}: {
  suspended?: boolean;
}) {
  const descriptionId = useId();
  const galleryRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<GalleryView>({
    current: INITIAL_INDEX,
    incoming: null,
  });
  const { current: currentIndex, incoming: incomingIndex } = view;
  const [playbackOverride, setPlaybackOverride] = useState<boolean | null>(
    null,
  );
  const [inView, setInView] = useState(true);
  const mounted = useSyncExternalStore(
    subscribeToMount,
    readMounted,
    readNotMounted,
  );
  const pageVisible = useSyncExternalStore(
    subscribeToVisibility,
    readVisible,
    readServerVisible,
  );
  const reducedMotion = useSyncExternalStore(
    subscribeToMotion,
    readReducedMotion,
    readServerMotion,
  );
  const wantsToPlay = playbackOverride ?? !reducedMotion;
  const playing = mounted && wantsToPlay && pageVisible && inView && !suspended;
  const playbackRef = useRef({ playing: false, reducedMotion: false });
  const animationsRef = useRef<Animation[]>([]);
  const nextArtworkRef = useRef((INITIAL_INDEX + 1) % COVER_ARTWORKS.length);
  const countdownRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    startedAt: number;
    remaining: number;
  }>({ timer: null, startedAt: 0, remaining: HOLD_MS });

  // Pause the animation itself, retaining the exact blend rather than restarting it.
  // The ref also applies the current preference if an image finishes decoding later.
  useLayoutEffect(() => {
    playbackRef.current = { playing, reducedMotion };
    for (const animation of animationsRef.current) {
      animation.playbackRate = reducedMotion ? REDUCED_MOTION_RATE : 1;
      if (playing) animation.play();
      else animation.pause();
    }
  }, [playing, reducedMotion]);

  useEffect(() => {
    const gallery = galleryRef.current;
    if (!gallery || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(gallery);
    return () => observer.disconnect();
  }, []);

  // A dwell is a countdown, not a repeating interval: backgrounding or pausing
  // consumes none of the remaining six seconds.
  useEffect(() => {
    if (!playing || incomingIndex !== null || COVER_ARTWORKS.length < 2) return;
    const countdown = countdownRef.current;
    countdown.startedAt = performance.now();
    const timer = setTimeout(() => {
      countdown.timer = null;
      countdown.remaining = 0;
      let next = nextArtworkRef.current;
      if (next === currentIndex) next = (next + 1) % COVER_ARTWORKS.length;
      nextArtworkRef.current = (next + 1) % COVER_ARTWORKS.length;
      setView({ current: currentIndex, incoming: next });
    }, countdown.remaining);
    countdown.timer = timer;

    return () => {
      if (countdown.timer !== timer) return;
      clearTimeout(timer);
      countdown.timer = null;
      countdown.remaining = Math.max(
        0,
        countdown.remaining - (performance.now() - countdown.startedAt),
      );
    };
  }, [playing, currentIndex, incomingIndex]);

  useEffect(() => {
    if (incomingIndex === null) return;
    const next = incomingIndex;
    const gallery = galleryRef.current;
    if (!gallery) return;
    let disposed = false;
    let animations: Animation[] = [];
    const incomingImages = Array.from(
      gallery.querySelectorAll<HTMLImageElement>("[data-gallery-incoming]"),
    );

    async function crossfade() {
      // Keep every old image opaque until all three new images are ready to paint.
      await Promise.all(incomingImages.map((image) => image.decode()));
      if (disposed) return;

      if (
        incomingImages.every((image) => typeof image.animate === "function")
      ) {
        animations = incomingImages.map((image) =>
          image.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: FADE_MS,
            easing: "ease-in-out",
            fill: "both",
          }),
        );
        animationsRef.current = animations;
        for (const animation of animations) {
          animation.playbackRate = playbackRef.current.reducedMotion
            ? REDUCED_MOTION_RATE
            : 1;
          if (!playbackRef.current.playing) animation.pause();
        }
        await Promise.all(animations.map((animation) => animation.finished));
      }

      if (disposed) return;
      countdownRef.current.remaining = HOLD_MS;
      setView({ current: next, incoming: null });
    }

    void crossfade().catch(() => {
      if (disposed) return;
      // A missing or corrupt local asset must never replace the visible painting.
      // Retry the following artwork after a full dwell instead of spinning on it.
      countdownRef.current.remaining = HOLD_MS;
      setView({ current: currentIndex, incoming: null });
    });

    return () => {
      disposed = true;
      if (animationsRef.current === animations) animationsRef.current = [];
      for (const animation of animations) animation.cancel();
    };
  }, [currentIndex, incomingIndex]);

  const currentArtwork = artworkAt(view.current);

  return (
    <div
      ref={galleryRef}
      className={`${styles.gallery}${playing ? "" : ` ${styles.paused}`}`}
      data-home-gallery
      data-playing={playing ? "true" : "false"}
      data-artwork={currentArtwork.id}
      data-transitioning={view.incoming === null ? "false" : "true"}
      data-reduced-motion={reducedMotion ? "true" : "false"}
    >
      <button
        type="button"
        className={styles.stageButton}
        onClick={() => setPlaybackOverride(!wantsToPlay)}
        aria-label={playing ? "暂停画廊播放" : "继续画廊播放"}
        aria-pressed={!playing}
        aria-describedby={descriptionId}
      >
        <span className={styles.leftWing} aria-hidden="true">
          <ArtworkLayers {...view} offset={-1} decorative />
        </span>
        <span className={styles.mainFrame}>
          <ArtworkLayers {...view} />
        </span>
        <span className={styles.rightWing} aria-hidden="true">
          <ArtworkLayers {...view} offset={1} decorative />
        </span>
      </button>
      <span id={descriptionId} className={styles.srOnly}>
        {currentArtwork.alt}
      </span>
    </div>
  );
}
