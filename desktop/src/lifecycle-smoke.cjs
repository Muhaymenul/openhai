'use strict';

// Explicit local QA only. It creates no notes, uploads, or model requests.
module.exports = async ({ window, app, dialog, probeWorkspace, result }) => {
  if (process.argv.includes('--desktop-lifecycle-smoke=quit')) {
    result.menuQuitPath = true;
    app.quit(); return;
  }
  if (process.argv.includes('--desktop-lifecycle-smoke=single')) {
    const { spawn } = require('node:child_process');
    const path = require('node:path');
    const child = spawn(process.execPath, [path.resolve(__dirname, '..'), '--desktop-second-instance-probe'], { windowsHide: true, stdio: 'ignore' });
    result.secondExitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    await new Promise(resolve => setTimeout(resolve, 300));
    result.primaryWindowKept = !window.isDestroyed();
    result.primaryBackendKept = await probeWorkspace();
    window.close(); return;
  }
  const original = dialog.showMessageBoxSync;
  try {
    let confirmations = 0;
    dialog.showMessageBoxSync = () => { confirmations += 1; return 0; };
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Shift' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Shift' });
    await window.webContents.executeJavaScript(`window.__testHoldClose = event => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', window.__testHoldClose);`, true);
    window.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    result.unsavedPromptObserved = confirmations === 1;
    result.cancelKeptWindow = !window.isDestroyed();
    result.cancelKeptBackend = await probeWorkspace();
    if (!window.isDestroyed()) await window.webContents.executeJavaScript(`window.removeEventListener('beforeunload', window.__testHoldClose); delete window.__testHoldClose;`);
  } catch (error) { result.error = error.message; }
  finally { dialog.showMessageBoxSync = original; }
  if (!window.isDestroyed()) window.close();
};
