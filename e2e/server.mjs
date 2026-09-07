// Minimal static server for browser E2E: serves dist/ under the
// /scratchtrack/ base path (mirrors GitHub Pages). Usage:
//   npm run build && node e2e/server.mjs [port]
// Fails fast when dist/ is missing so specs never run against stale output.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('../dist/', import.meta.url);
const PORT = Number(process.argv[2] ?? 4173);

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

try {
  await readFile(new URL('index.html', ROOT));
} catch {
  console.error('e2e server: dist/ missing — run `npm run build` first');
  process.exit(1);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (!path.startsWith('/scratchtrack/')) {
      res.writeHead(404).end('expected /scratchtrack/ base path');
      return;
    }
    path = path.slice('/scratchtrack/'.length) || 'index.html';
    const file = await readFile(join(ROOT.pathname, path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(file);
  } catch {
    // SPA fallback: unknown paths serve the app shell (like Pages 404 handling).
    try {
      const file = await readFile(new URL('index.html', ROOT));
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(file);
    } catch {
      res.writeHead(404).end('not found');
    }
  }
}).listen(PORT, () => console.log(`e2e server: dist/ at http://localhost:${PORT}/scratchtrack/`));
