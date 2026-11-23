'use strict';
const path = require('node:path');
const fs = require('node:fs');

function optionValue(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function runtimePaths({ packaged, sourceRoot, executablePath, dataOverride }) {
  if (dataOverride && !path.isAbsolute(dataOverride)) throw new Error('桌面资料目录必须是绝对路径。');
  return {
    desktopRoot: sourceRoot,
    // Store outside the installation folder so upgrades/uninstall retain drafts.
    localRoot: dataOverride || (packaged
      ? path.join(path.dirname(path.dirname(executablePath)), 'JiaoyanDesktopData')
      : path.join(sourceRoot, '.local')),
    defaultProjectRoot: packaged ? null : path.resolve(sourceRoot, '..'),
  };
}

function validProjectRoot(root) {
  if (!root || !path.isAbsolute(root)) return false;
  return ['docker-compose.yml', 'scripts/desktop-launch.ps1', 'scripts/manage.ps1', 'app/package.json'].every((file) => {
    try { return fs.statSync(path.join(root, file)).isFile(); } catch { return false; }
  });
}

module.exports = { optionValue, runtimePaths, validProjectRoot };
