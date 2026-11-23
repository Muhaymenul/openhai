'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isWorkspaceUrl, isExternalUrl, isWorkspacePayload } = require('../src/policy.cjs');

test('workspace navigation stays at the exact configured local origin', () => {
  assert.equal(isWorkspaceUrl('http://127.0.0.1:3000/workspace?paper=abc#notes'), true);
  for (const url of ['http://127.0.0.1:3001/workspace', 'http://127.0.0.1.evil.test:3000/', 'https://example.org', 'file:///E:/private/model.env', 'javascript:alert(1)', 'http://user:pass@127.0.0.1:3000/']) {
    assert.equal(isWorkspaceUrl(url), false, url);
  }
});

test('only ordinary public web links can leave the application', () => {
  assert.equal(isExternalUrl('https://doi.org/10.1234/example'), true);
  for (const url of ['file:///E:/private/model.env', 'javascript:alert(1)', 'ms-settings:privacy', 'http://localhost:3000/', 'http://127.0.0.1:3000/', 'http://[::1]/', 'https://user:pass@example.org/']) {
    assert.equal(isExternalUrl(url), false, url);
  }
});

test('readiness rejects unrelated web servers and validates the workspace shape', () => {
  const payload = { papers: [], notes: [], annotations: [], knowledge: [], history: [], settings: {}, indexReady: true, graph: { nodes: [], edges: [] } };
  assert.equal(isWorkspacePayload(payload), true);
  for (const value of [null, '<html>ok</html>', {}, { papers: [], notes: [], graph: {} }]) {
    assert.equal(isWorkspacePayload(value), false);
  }
});
