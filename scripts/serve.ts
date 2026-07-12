// Zero-dependency static file server for the live web app (`npm run web`):
// serves the repository root on localhost so webapp/index.html can load the
// tsc-compiled ES modules straight out of dist/ — no bundler. `/` serves
// webapp/index.html; everything else maps to a file under the repo root.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

// Minimal ambient declarations for the Node surface this server touches,
// matching scripts/demo.ts's precedent (no devDependency on @types/node).
// 'node:http' itself is declared in scripts/node-http-shims.d.ts; the
// readFileSync overload used here is src/node-shims.d.ts's.
declare const process: { argv: string[]; env: Record<string, string | undefined> };
declare const console: { log(...args: unknown[]): void };

const PORT = Number.parseInt(process.env['PORT'] ?? '', 10) || 8787;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  const relative = path === '/' ? 'webapp/index.html' : path.replace(/^\/+/, '');
  const ext = relative.slice(relative.lastIndexOf('.'));
  const mime = MIME[ext];
  // Reject traversal and anything without a whitelisted extension; the app
  // only ever needs .html, .js, and .json (dropped-in dumps).
  if (relative.split('/').includes('..') || !mime) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found\n');
    return;
  }
  let body: string;
  try {
    body = readFileSync(relative, 'utf8');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found\n');
    return;
  }
  res.writeHead(200, { 'content-type': mime });
  res.end(body);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Etymon Live: http://127.0.0.1:${PORT}/`);
});
