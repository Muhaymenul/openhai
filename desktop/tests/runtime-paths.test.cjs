'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runtimePaths, optionValue, validProjectRoot } = require('../src/runtime-paths.cjs');

test('source edition keeps its existing writable profile and parent project', () => {
  const root = path.resolve('desktop');
  const result = runtimePaths({ packaged: false, sourceRoot: root, executablePath: process.execPath });
  assert.equal(result.localRoot, path.join(root, '.local'));
  assert.equal(result.defaultProjectRoot, path.dirname(root));
});
test('installed edition writes outside the executable and asar directories', () => {
  const base = path.resolve('installation-parent');
  const result = runtimePaths({ packaged: true, sourceRoot: path.join(base, 'App/resources/app.asar'), executablePath: path.join(base, 'App/JiaoyanDesktop.exe') });
  assert.equal(result.localRoot, path.join(base, 'JiaoyanDesktopData'));
  assert.equal(result.defaultProjectRoot, null);
});
test('explicit local QA paths must be absolute and do not change source project default', () => {
  assert.throws(() => runtimePaths({ packaged: true, dataOverride: '../data' }));
  assert.equal(optionValue(['--desktop-data-dir=E:/test'], '--desktop-data-dir'), 'E:/test');
  assert.equal(optionValue(['--desktop-project-root', 'E:/project'], '--desktop-project-root'), 'E:/project');
});
test('missing files or selecting the desktop folder cannot masquerade as the full project', () => {
  assert.equal(validProjectRoot('relative'), false);
  assert.equal(validProjectRoot(path.resolve(__dirname, '..')), false);
});
