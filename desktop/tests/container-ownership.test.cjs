'use strict';

// No Docker process is launched: every helper call targets the mock function.
// Run with: node --test desktop/tests/container-ownership.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const helperPath = process.env.CONTAINER_OWNERSHIP_HELPER
  || path.resolve(__dirname, '../../scripts/container-ownership.ps1');
const projectRoot = 'G:\\教研阅记';
const owned = (id) => ({ id, workingDir: projectRoot, mounts: [
  { Type: 'bind', Source: '/run/desktop/mnt/host/g/教研阅记/data' },
] });
const foreign = { id: 'foreign-web', workingDir: 'E:\\other-project', mounts: [] };
const options = { skip: process.platform !== 'win32' };

function runHelper(action, containers, failure = {}) {
  const source = fs.readFileSync(helperPath, 'utf8').replace(/^\uFEFF/, '');
  const scenario = Buffer.from(JSON.stringify({ action, containers, ...failure }), 'utf8').toString('base64');
  const root = Buffer.from(projectRoot, 'utf8').toString('base64');
  const script = `
$ErrorActionPreference='Stop'
$script:scenario=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${scenario}')) | ConvertFrom-Json
$projectRoot=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${root}'))
$script:calls=New-Object Collections.ArrayList
function Mock-Docker {
  # Native executables flatten array arguments; emulate that binding here.
  $commandArgs=@($args | ForEach-Object { foreach($part in @($_)) { [string]$part } })
  [void]$script:calls.Add([pscustomobject]@{Arguments=$commandArgs})
  $global:LASTEXITCODE=0
  if(($commandArgs -join ' ') -eq 'compose ps --all --quiet') {
    foreach($container in $script:scenario.containers) { $container.id }
    return
  }
  if($commandArgs.Count -eq 4 -and $commandArgs[0] -eq 'inspect' -and $commandArgs[1] -eq '--format') {
    $container=@($script:scenario.containers | Where-Object { $_.id -eq $commandArgs[3] })
    if($container.Count -ne 1) { throw 'Unexpected mock container ID.' }
    $phase=if($commandArgs[2] -eq '{{json .Config.Labels}}') { 'labels' } elseif($commandArgs[2] -eq '{{json .Mounts}}') { 'mounts' } else { throw 'Unexpected inspect format.' }
    if($script:scenario.failId -eq $container[0].id -and $script:scenario.failPhase -eq $phase) {
      $global:LASTEXITCODE=1
      return
    }
    if($phase -eq 'labels') {
      $labels=@{}
      if($container[0].workingDir) { $labels['com.docker.compose.project.working_dir']=$container[0].workingDir }
      return ($labels | ConvertTo-Json -Compress)
    }
    return (ConvertTo-Json -InputObject @($container[0].mounts) -Compress -Depth 5)
  }
  if($commandArgs.Count -gt 1 -and $commandArgs[0] -eq 'stop') { return }
  throw ('Unexpected mock Docker command: '+($commandArgs -join ' '))
}
${source}
$rejected=$false
$reason=$null
try {
  if($script:scenario.action -eq 'assert') { Assert-ProjectContainers -Docker 'Mock-Docker' -ProjectRoot $projectRoot }
  elseif($script:scenario.action -eq 'stop') { Stop-ProjectContainers -Docker 'Mock-Docker' -ProjectRoot $projectRoot }
  else { throw 'Unexpected test action.' }
} catch { $rejected=$true; $reason=$_.Exception.Message }
$report=[pscustomobject]@{Rejected=$rejected;Reason=$reason;Calls=@($script:calls);PowerShellMajor=$PSVersionTable.PSVersion.Major}
[Console]::WriteLine('__OWNERSHIP_RESULT__'+($report | ConvertTo-Json -Depth 8 -Compress))
`;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], {
    encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 512 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith('__OWNERSHIP_RESULT__'));
  assert.ok(line, `PowerShell did not return a report: ${result.stderr || result.stdout}`);
  const report = JSON.parse(line.slice('__OWNERSHIP_RESULT__'.length));
  assert.equal(report.PowerShellMajor, 5, 'Exercise the Windows PowerShell 5 launcher runtime.');
  return report;
}

const stopCalls = (report) => report.Calls.filter((call) => call.Arguments[0] === 'stop')
  .map((call) => call.Arguments);

test('startup accepts its own project and rejects mixed ownership', options, () => {
  assert.equal(runHelper('assert', [owned('own-web')]).Rejected, false);
  const report = runHelper('assert', [owned('own-web'), foreign]);
  assert.equal(report.Rejected, true);
  assert.match(report.Reason, /another project folder/i);
  assert.deepEqual(stopCalls(report), []);
});

test('shutdown stops exact owned IDs and leaves foreign or out-of-root mounts alone', options, () => {
  const outside = { ...owned('outside-bind'), mounts: [
    { Type: 'bind', Source: '/run/desktop/mnt/host/g/教研阅记-other/data' },
  ] };
  const report = runHelper('stop', [owned('own-web'), foreign, owned('own-paperflow'), outside]);
  assert.equal(report.Rejected, false, report.Reason);
  assert.deepEqual(stopCalls(report), [['stop', 'own-web', 'own-paperflow']]);
});

test('a missing ownership label never authorizes stopping a container', options, () => {
  const report = runHelper('stop', [{ id: 'unlabeled', mounts: [] }]);
  assert.equal(report.Rejected, false, report.Reason);
  assert.deepEqual(stopCalls(report), []);
});

test('any failed inspect prevents all stops, including already verified IDs', options, () => {
  for (const phase of ['labels', 'mounts']) {
    const report = runHelper('stop', [owned('own-web'), owned('uninspectable')], {
      failId: 'uninspectable', failPhase: phase,
    });
    assert.equal(report.Rejected, true, phase);
    assert.match(report.Reason, /could not be (confirmed|checked)/i);
    assert.deepEqual(stopCalls(report), [], phase);
  }
});
