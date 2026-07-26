#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist-renderer');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    args.set(arg.slice(2), process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true');
  }
}

const host = args.get('host') || '0.0.0.0';
const port = Number(args.get('port') || 54337);

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
]);

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function safeStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = path.normalize(decoded).replace(/^\/+/, '');
  const candidate = path.join(distRoot, normalized || 'index.html');
  if (!candidate.startsWith(distRoot)) return undefined;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return path.join(distRoot, 'index.html');
}

async function proxyNetloggerApi(req, res) {
  const incoming = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const endpoint = incoming.pathname.replace(/^\/netlogger-api\//, '');
  if (!endpoint || endpoint.includes('/') || !endpoint.endsWith('.php')) {
    send(res, 400, 'Invalid NetLogger API endpoint', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  const upstream = new URL(`https://www.netlogger.org/api/${endpoint}`);
  incoming.searchParams.forEach((value, key) => upstream.searchParams.set(key, value));

  try {
    const response = await fetch(upstream, {
      method: 'GET',
      headers: {
        Accept: 'application/xml, text/xml, */*',
        'User-Agent': 'Log2Go-Desktop-Preview/0.1 (Amateur Radio Logger)',
      },
    });
    const text = await response.text();
    send(res, response.status, text, {
      'Content-Type': response.headers.get('content-type') || 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
  } catch (error) {
    send(res, 502, `NetLogger proxy failed: ${error instanceof Error ? error.message : String(error)}`, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  }
}

const server = createServer(async (req, res) => {
  if (!existsSync(distRoot)) {
    send(res, 500, 'dist-renderer is missing. Run npm run build first.', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  if (req.url?.startsWith('/netlogger-api/')) {
    await proxyNetloggerApi(req, res);
    return;
  }

  const filePath = safeStaticPath(req.url || '/');
  if (!filePath) {
    send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  const ext = path.extname(filePath);
  const type = contentTypes.get(ext) || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60' });
  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  const local = `http://localhost:${port}/`;
  const lan = `http://192.168.30.131:${port}/`;
  console.log(`Log2Go Desktop preview with NetLogger proxy ready`);
  console.log(`  ➜  Local:   ${local}`);
  console.log(`  ➜  Network: ${lan}`);
});
