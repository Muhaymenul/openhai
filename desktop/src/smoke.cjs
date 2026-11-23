'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { WORKSPACE, ORIGIN } = require('./policy.cjs');

module.exports = async function verifyDesktop(window, app, qaDir) {
  const checks = {};
  const evaluate = (code) => window.webContents.executeJavaScript(code);
  const waitFor = async (code, label, timeout = 45000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(code)) { checks[label] = true; return; }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    throw new Error(`页面检查未通过：${label}`);
  };
  const screenshot = async (name) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    fs.writeFileSync(path.join(qaDir, name), (await window.webContents.capturePage()).toPNG());
  };
  const checkDownload = (label, start, validate) => new Promise((resolve, reject) => {
    const handler = (event, item) => {
      event.preventDefault();
      clearTimeout(timer);
      checks[label] = validate(item);
      if (checks[label]) resolve(); else reject(new Error(`下载检查未通过：${label}`));
    };
    const timer = setTimeout(() => {
      window.webContents.session.removeListener('will-download', handler);
      reject(new Error(`下载检查超时：${label}`));
    }, 15000);
    window.webContents.session.once('will-download', handler);
    Promise.resolve().then(start).catch((error) => {
      clearTimeout(timer);
      window.webContents.session.removeListener('will-download', handler);
      reject(error);
    });
  });
  await waitFor("document.body.innerText.includes('教研阅记') && Boolean(document.querySelector('button'))", 'home');
  await screenshot('workspace.png');
  const before = await evaluate(`fetch('/api/research').then(r=>r.json()).then(s=>({paperId:s.papers[0]?.id,counts:{papers:s.papers.length,notes:s.notes.length,annotations:s.annotations.length,nodes:s.graph.nodes.length,edges:s.graph.edges.length}}))`);

  // A real reader can autosave reading position. QA blocks writes and model calls.
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !['GET', 'HEAD', 'OPTIONS'].includes(details.method) });
  });
  try {
    await window.loadURL(`${WORKSPACE}?view=library`);
    await waitFor("document.body.innerText.includes('文献库') && Boolean(document.querySelector('input[type=file]') || document.querySelector('button'))", 'library');
    await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='导入论文').click()");
    await waitFor("Boolean(document.querySelector('input[type=file][multiple][accept*=pdf]'))", 'fileInputAvailable');

    if (before.paperId) {
      const id = encodeURIComponent(before.paperId);
      await window.loadURL(`${WORKSPACE}?paperId=${id}`);
      await waitFor(`Boolean(document.querySelector('.page[data-page-number] canvas') && document.querySelector('.textLayer span'))`, 'pdfCanvasAndSelectableText', 60000);
      await waitFor(`Boolean(document.querySelector('[aria-label="批注工具"]'))`, 'annotationTools');
      await screenshot('reader.png');
      await checkDownload('pdfDownload', () => window.webContents.downloadURL(`${ORIGIN}/api/research/papers/${id}/pdf`),
        (item) => item.getMimeType().includes('pdf') && item.getTotalBytes() > 0);
    }
    await window.loadURL(`${WORKSPACE}?view=notes`);
    await waitFor(`Boolean(document.querySelector('[aria-label="搜索笔记"]'))`, 'notes');
    await window.loadURL(`${WORKSPACE}?view=memory`);
    await waitFor(`document.body.innerText.includes('研究记忆') && Boolean(document.querySelector('main'))`, 'memory');
    await window.loadURL(`${WORKSPACE}?view=review`);
    await waitFor(`document.body.innerText.includes('学习复习') && Boolean(document.querySelector('main'))`, 'review');
    await window.loadURL(`${WORKSPACE}?view=graph`);
    await waitFor(`Boolean(document.querySelector('[aria-label="知识图谱工作区"]') && document.querySelector('canvas'))`, 'graph');
    await screenshot('graph.png');
    await checkDownload('graphBlobExport', () => evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='完整数据 JSON').click()"),
      (item) => item.getFilename().endsWith('.json'));
    const after = await evaluate(`fetch('/api/research').then(r=>r.json()).then(s=>({papers:s.papers.length,notes:s.notes.length,annotations:s.annotations.length,nodes:s.graph.nodes.length,edges:s.graph.edges.length}))`);
    checks.dataCountsUnchanged = JSON.stringify(before.counts) === JSON.stringify(after);
    if (!checks.dataCountsUnchanged) throw new Error('验证前后的资料数量不一致。');
    return { checks, counts: after };
  } finally {
    window.webContents.session.webRequest.onBeforeRequest(null);
  }
};
