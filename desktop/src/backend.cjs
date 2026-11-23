'use strict';

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ORIGIN, isWorkspacePayload } = require('./policy.cjs');

// The endpoint is fixed to loopback; no model configuration is read here.
function probeWorkspace({ timeout = 3500 } = {}) {
  return new Promise((resolve, reject) => {
    let completed = false;
    const finish = (result) => { if (!completed) { completed = true; resolve(result); } };
    const req = http.get(`${ORIGIN}/api/research`, { timeout }, (res) => {
      if (res.statusCode !== 200) { res.resume(); finish(false); return; }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 32 * 1024 * 1024) { res.destroy(); finish(false); }
        else chunks.push(chunk);
      });
      res.on('end', () => {
        if (completed) return;
        try {
          if (isWorkspacePayload(JSON.parse(Buffer.concat(chunks).toString('utf8')))) { finish(true); return; }
        } catch { /* A different application may be responding on this port. */ }
        completed = true;
        reject(new Error('3000 端口正在响应其他内容。请先运行原项目“检查Demo.cmd”，确认工作区端口。'));
      });
      res.on('error', () => finish(false));
    });
    req.on('timeout', () => { req.destroy(); finish(false); });
    req.on('error', () => finish(false));
  });
}

function runBackendAction(projectRoot, action, env = process.env) {
  if (!['start', 'stop'].includes(action)) throw new Error('Unsupported local service action.');
  const engine = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = path.join(projectRoot, 'scripts', 'desktop-launch.ps1');
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Action', action, '-NoBrowser', '-NonInteractive',
  ];
  args.push('-WaitForManager');
  const child = spawn(engine, args, { cwd: projectRoot, windowsHide: true, stdio: 'ignore', env });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`后台${action === 'start' ? '启动' : '停止'}未完成（退出码 ${code}）。请查看项目 runtime/launcher 中的日志。`));
    });
  });
  // Register immediately, including if the window closes while startup continues.
  completion.catch(() => {});
  return { child, completion };
}

function startBackend(projectRoot, env = process.env) { return runBackendAction(projectRoot, 'start', env); }
function stopBackend(projectRoot, env = process.env) { return runBackendAction(projectRoot, 'stop', env); }

module.exports = { probeWorkspace, startBackend, stopBackend };
