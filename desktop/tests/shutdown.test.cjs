'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ShutdownCoordinator } = require('../src/shutdown.cjs');
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('repeated exit requests stop services once and wait for startup to finish', async () => {
  const start = deferred(); const events = [];
  const c = new ShutdownCoordinator(async () => { events.push('stop'); });
  c.trackStart(start.promise);
  const first = c.finish(); const second = c.finish();
  assert.equal(first, second);
  await Promise.resolve(); assert.deepEqual(events, []);
  events.push('started'); start.resolve(); await first;
  assert.deepEqual(events, ['started', 'stop']);
  await c.finish(); assert.deepEqual(events, ['started', 'stop']);
});
test('failed startup still cleans up services it may have already started', async () => {
  const start = deferred(); let stopped = false;
  const c = new ShutdownCoordinator(async () => { stopped = true; });
  c.trackStart(start.promise); const ending = c.finish();
  start.reject(new Error('partial startup failed')); await ending;
  assert.equal(stopped, true);
});
test('a failed stop remains retryable and cannot be mistaken for a safe exit', async () => {
  let attempts = 0;
  const c = new ShutdownCoordinator(async () => { if (++attempts === 1) throw new Error('temporary failure'); });
  await assert.rejects(c.finish()); assert.equal(c.done, false);
  await c.finish(); assert.equal(c.done, true); assert.equal(attempts, 2);
});
