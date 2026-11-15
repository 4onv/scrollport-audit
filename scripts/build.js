import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8').then(text => text.replaceAll('\r\n', '\n'));
const [core, page, css, app] = await Promise.all([
  read('../src/audit.js'), read('../src/demo.html'), read('../src/demo.css'), read('../src/demo.js'),
]);
const body = core.replace(/^export /gm, '');
const snippet = `(() => {\n'use strict';\n${body}\nglobalThis.ScrollportAudit = Object.freeze({ audit: auditScrollport });\n})();\n`;
const script = `(() => {\n'use strict';\n${body}\n${app}\n})();`;
const hash = source => createHash('sha256').update(source).digest('base64');
const csp = `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(css)}'; base-uri 'none'; form-action 'none'`;
const html = page.replace('__CSP__', () => csp).replace('__CSS__', () => css).replace('__JS__', () => script);
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await Promise.all([
  writeFile(new URL('../dist/scrollport-audit.js', import.meta.url), snippet),
  writeFile(new URL('../dist/scrollport-audit.html', import.meta.url), html),
]);
