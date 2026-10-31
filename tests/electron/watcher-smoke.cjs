'use strict';
// Explicit Windows-only integration smoke; npm test never opens Explorer windows.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (process.platform !== 'win32') { console.log('SKIP Windows Explorer integration requires Windows.'); process.exit(0); }
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'VioletFolders-electron-smoke-'));
const folder = path.join(root, 'folder 中文 空格 %');
fs.mkdirSync(folder);
const worker = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', '..', 'electron', 'watcher.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
const messages = [];
let lastSnapshot = [];
let stderr = '';
let ended = false;
let exitCode;
worker.stderr.on('data', data => { stderr += data.toString('utf8'); });
worker.on('exit', code => { ended = true; exitCode = code; });
const lines = readline.createInterface({ input: worker.stdout, crlfDelay: Infinity });
lines.on('line', line => { try { const value = JSON.parse(line); messages.push(value); if (value.type === 'snapshot') lastSnapshot = value.folders; } catch { } });
worker.stdin.on('error', () => {});
const equal = (a, b) => a.toLowerCase().replace(/\\+$/, '') === b.toLowerCase().replace(/\\+$/, '');
const wait = async (predicate, description) => {
  const end = Date.now() + 15000;
  while (!predicate()) {
    if (ended) throw new Error(`Monitor exited ${exitCode}: ${stderr}`);
    if (Date.now() > end) throw new Error(`Timed out: ${description}. ${stderr}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
async function command(folderPath) {
  const id = randomUUID(); worker.stdin.write(JSON.stringify({ type: 'open', id, path: folderPath }) + '\n');
  await wait(() => messages.some(message => message.type === 'response' && message.id === id), 'open response');
  return messages.find(message => message.type === 'response' && message.id === id);
}
async function closeOwned() {
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'close-owned-folder.ps1'), '-Path', folder], { windowsHide: true, stdio: 'pipe', shell: false });
  let errors = ''; child.stderr.on('data', data => { errors += data; });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(errors))); });
}

(async () => {
  try {
    await wait(() => messages.some(message => message.type === 'snapshot'), 'initial snapshot before any stdin command');
    console.log('PASS PowerShell monitor streams snapshots without waiting for commands.');
    const unavailable = await command(path.join(root, 'missing'));
    assert.equal(unavailable.ok, false); assert.equal(unavailable.error, 'folder-unavailable');
    console.log('PASS Missing folder reports a recoverable error without launching Explorer.');
    assert.equal((await command(folder)).ok, true);
    await wait(() => lastSnapshot.some(item => equal(item.path, folder)), 'Unicode test folder detection');
    console.log('PASS JSON/BSTR launch and COM monitoring preserve Unicode, spaces, and percent.');
    assert.equal((await command(folder)).ok, true);
    console.log('PASS Reopening an already monitored folder activates or safely explores it.');
    await closeOwned();
    await wait(() => !lastSnapshot.some(item => equal(item.path, folder)), 'owned folder removal');
    console.log('PASS Closing only the owned Explorer folder removes it from snapshots.');
    worker.stdin.end(JSON.stringify({ type: 'quit' }) + '\n');
    await new Promise((resolve, reject) => { if (ended) return resolve(); const timer = setTimeout(() => reject(new Error('Monitor did not shut down.')), 5000); worker.once('exit', () => { clearTimeout(timer); resolve(); }); });
    assert.equal(exitCode, 0);
    console.log('PASS Monitor exits cleanly after quit.\n6/6 Windows integration checks passed.');
  } finally {
    if (!ended) worker.kill();
    await closeOwned();
    lines.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
