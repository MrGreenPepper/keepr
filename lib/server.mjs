// Dashboard server: serves dashboard/ and the JSON API, pushes changes as server-sent events.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { HERE, PORT, STATUSES, PRIORITIES, ANSWER_STATUSES, INBOX_STATUSES, LINK_TYPES } from './config.mjs';
import { dataFile, readData, mutate, readRegistry } from './storage.mjs';
import { NEXT_GROUPS, nextTasks, ops } from './ops.mjs';

// ---------------------------------------------------------------- server

function ping() {
  return new Promise(res => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/ping', timeout: 400 }, r => { r.resume(); res(r.statusCode === 200); });
    req.on('error', () => res(false));
    req.on('timeout', () => { req.destroy(); res(false); });
  });
}

export async function ensureServer() {
  if (await ping()) return;
  spawn(process.execPath, [path.join(HERE, 'keepr.mjs'), 'serve'], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 150));
    if (await ping()) return;
  }
  throw new Error('Could not start the server.');
}

// Static files of the dashboard (dashboard/index.html, style.css, js/*.js). Only these types,
// only inside dashboard/.
const DASHBOARD_DIR = path.join(HERE, 'dashboard');
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
};
function staticFile(pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(DASHBOARD_DIR, rel);
  if (!file.startsWith(DASHBOARD_DIR + path.sep) || !STATIC_TYPES[path.extname(file)]) return null;
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

export function serve(port) {
  const clients = new Set();
  const mtimes = new Map();

  // Push changes (including ones the AI makes via the CLI) as server-sent events.
  setInterval(() => {
    for (const p of readRegistry()) {
      let m;
      try { m = fs.statSync(dataFile(p.path)).mtimeMs; } catch { continue; }
      if (mtimes.has(p.path) && mtimes.get(p.path) !== m)
        for (const c of clients) c.write(`data: ${JSON.stringify({ project: p.path })}\n\n`);
      mtimes.set(p.path, m);
    }
  }, 700);

  const allowed = (p) => readRegistry().some(x => x.path === p);
  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };

  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.searchParams.get('p');
    try {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const file = staticFile(url.pathname);
        if (file) return send(res, 200, fs.readFileSync(file), STATIC_TYPES[path.extname(file)]);
        return send(res, 404, { error: 'not found' });
      }
      if (url.pathname === '/api/ping') return send(res, 200, { ok: true });
      if (url.pathname === '/api/projects') {
        const list = readRegistry().filter(x => fs.existsSync(dataFile(x.path)));
        return send(res, 200, list);
      }
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': hi\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (!p || !allowed(p)) return send(res, 404, { error: 'Unknown project' });
      if (url.pathname === '/api/data' && req.method === 'GET') {
        const data = readData(p);
        // "Next up" is computed here so the dashboard uses the same selection as keepr next.
        const next = Object.fromEntries(Object.entries(nextTasks(data.tasks)).map(([k, list]) => [k, list.map(t => t.id)]));
        return send(res, 200, { root: p, ...data, next, meta: { STATUSES, PRIORITIES, ANSWER_STATUSES, INBOX_STATUSES, LINK_TYPES, NEXT_GROUPS } });
      }
      if (url.pathname === '/api/op' && req.method === 'POST') {
        // Blocks cross-site requests from other websites.
        if (req.headers['x-keepr'] !== '1') return send(res, 403, { error: 'forbidden' });
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
          try {
            const { op, args } = JSON.parse(body);
            if (!ops[op]) throw new Error(`Unknown operation ${op}`);
            const result = mutate(p, d => ops[op](d, args || {}));
            mtimes.set(p, fs.statSync(dataFile(p)).mtimeMs);
            send(res, 200, { ok: true, result });
          } catch (e) { send(res, 400, { error: e.message }); }
        });
        return;
      }
      send(res, 404, { error: 'not found' });
    } catch (e) { send(res, 500, { error: e.message }); }
  }).listen(port, '127.0.0.1', () => console.log(`keepr dashboard: http://127.0.0.1:${port}/`));
}
