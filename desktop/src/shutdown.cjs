'use strict';

// Run only after the reader window really closes, so beforeunload can veto exit.
class ShutdownCoordinator {
  constructor(stop) { this.stop = stop; this.starts = new Set(); this.pending = null; this.done = false; }
  trackStart(promise) {
    const settled = Promise.resolve(promise).catch(() => {});
    this.starts.add(settled);
    settled.finally(() => this.starts.delete(settled));
    return promise;
  }
  finish() {
    if (this.done) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = (async () => {
      // Startup may have been canceled or failed after starting some services.
      await Promise.all([...this.starts]);
      await this.stop();
      this.done = true;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
}
module.exports = { ShutdownCoordinator };
