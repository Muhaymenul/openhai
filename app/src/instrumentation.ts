export async function register(): Promise<void> {
  // The loopback-only research workspace owns its indexing and has no profile,
  // sharing, CLI credential, or automatic external synchronization workers.
  if (process.env.RESEARCH_LOCAL_MODE === "1") return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      const { startErasureWorker } =
        await import("./lib/auth/platform/erasure-worker");
      startErasureWorker();
      const { startMetricRetention } =
        await import("./lib/agent/platform/metric-retention");
      startMetricRetention();
      const { startSharingWorker } = await import("./lib/sharing/worker");
      startSharingWorker();
    }
    const { startScanner } = await import("./lib/library/scanner");
    startScanner();
    const { startZoteroSync } = await import("./lib/capture/zotero");
    startZoteroSync();
  }
}
