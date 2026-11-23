'use strict';

const ORIGIN = 'http://127.0.0.1:3000';
const WORKSPACE = `${ORIGIN}/workspace`;

function isWorkspaceUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === ORIGIN && !url.username && !url.password;
  } catch { return false; }
}

function isExternalUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password &&
      !['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname);
  } catch { return false; }
}

function isWorkspacePayload(payload) {
  return payload !== null && typeof payload === 'object' &&
    ['papers', 'notes', 'annotations', 'knowledge', 'history'].every((key) => Array.isArray(payload[key])) &&
    payload.settings !== null && typeof payload.settings === 'object' &&
    typeof payload.indexReady === 'boolean' &&
    payload.graph !== null && typeof payload.graph === 'object' &&
    Array.isArray(payload.graph.nodes) && Array.isArray(payload.graph.edges);
}

module.exports = { ORIGIN, WORKSPACE, isWorkspaceUrl, isExternalUrl, isWorkspacePayload };
