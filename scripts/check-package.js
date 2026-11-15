import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import info from '../package.json' with { type: 'json' };

const archive = resolve(process.argv[2] ?? `4onv-scrollport-audit-${info.version}.tgz`);
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run through npm run check:package.');
const directory = await mkdtemp(join(tmpdir(), 'scrollport-package-'));
try {
  const result = spawnSync(process.execPath, [npm, 'install', '--offline', '--ignore-scripts',
    '--no-audit', '--no-fund', '--package-lock=false', archive], {
    cwd: directory, encoding: 'utf8', timeout: 45000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error ?? ''));
  const root = join(directory, 'node_modules', '@4onv', 'scrollport-audit');
  const installed = await import(pathToFileURL(join(root, 'src/audit.js')).href);
  assert.equal(typeof installed.auditScrollport, 'function');
  const standalone = await readFile(join(root, 'dist/scrollport-audit.js'), 'utf8');
  const sandbox = {};
  runInNewContext(standalone, sandbox, { timeout: 1000 });
  assert.equal(typeof sandbox.ScrollportAudit.audit, 'function');
  const html = await readFile(join(root, 'dist/scrollport-audit.html'), 'utf8');
  assert.match(html, /Synthetic layout/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /__CSP__|__CSS__|__JS__/);
  console.log('Installed the archive offline and verified the module, DevTools snippet, and HTML demo.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
