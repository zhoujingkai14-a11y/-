import http from 'node:http';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { handleAPI, readConfig } from '../sites-mingdan/server/worker.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const security = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS node_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL);');
  try {
    for (const name of readdirSync(resolve(root, 'sites-mingdan/drizzle')).filter(name => name.endsWith('.sql')).sort()) {
      const sql = readFileSync(resolve(root, 'sites-mingdan/drizzle', name), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const prior = database.prepare('SELECT hash FROM node_migrations WHERE name=?').get(name);
      if (prior) { if (prior.hash !== hash) throw new Error(`Previously applied migration changed: ${name}`); continue; }
      database.exec('BEGIN IMMEDIATE');
      try { database.exec(sql); database.prepare('INSERT INTO node_migrations VALUES (?,?)').run(name, hash); database.exec('COMMIT'); }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    }
  } catch (error) { database.close(); throw error; }
  function prepare(sql, params = []) {
    return { sql, params, bind: (...values) => prepare(sql, values),
      async first() { return database.prepare(sql).get(...params) || null; },
      async all() { return { success: true, results: database.prepare(sql).all(...params) }; },
      async run() { const result = database.prepare(sql).run(...params); return { success: true, meta: { changes: Number(result.changes) } }; } };
  }
  return { database, prepare, async batch(statements) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(({ sql, params }) => ({ success: true, meta: { changes: Number(database.prepare(sql).run(...params).changes) } }));
      database.exec('COMMIT'); return results;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  } };
}

export function createPublicApp(environment = process.env, options = {}) {
  const env = { ...environment }, config = readConfig(env);
  const host = env.HOST || '127.0.0.1';
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (config.adminPassword.length < 12) throw new Error('An owner password of at least 12 characters is required.');
  if (!loopback && (!/^https:\/\//.test(config.publicUrl) || !env.DEEPSEEK_API_KEY)) throw new Error('Public hosting requires an HTTPS origin and a server-side AI key.');
  const publicOrigin = config.publicUrl ? new URL(config.publicUrl).origin : '';
  const database = openDatabase(env.MINGDAN_DATABASE || resolve(root, 'runtime/mingdan-public.sqlite'));
  env.DB = database;
  const assetRoot = resolve(root, 'sites-mingdan/public/prototype');
  const assets = new Set(readdirSync(assetRoot).filter(name => types[extname(name)] && statSync(resolve(assetRoot, name)).isFile()));
  const send = (response, status, text, headers = {}) => { response.writeHead(status, { ...security, 'Cache-Control': 'no-store', ...headers }); response.end(text); };
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      const localOrigin = `http://${incoming.headers.host}`;
      const origin = new URL(localOrigin);
      const allowed = new Set(['127.0.0.1', 'localhost', '[::1]', ...(publicOrigin ? [new URL(publicOrigin).hostname] : [])]);
      if (!allowed.has(origin.hostname)) return send(outgoing, 403, 'Host is not configured.');
      const url = new URL(incoming.url, publicOrigin || localOrigin);
      if (url.pathname.startsWith('/api/')) {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        const proxyIP = incoming.headers['x-mingdan-client-ip'];
        const ip = env.MINGDAN_TRUST_PROXY === '1' && typeof proxyIP === 'string' && isIP(proxyIP) ? proxyIP : incoming.socket.remoteAddress || 'unknown';
        headers.set('cf-connecting-ip', ip);
        const method = incoming.method || 'GET';
        const request = new Request(url, { method, headers, ...(!['GET', 'HEAD'].includes(method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
        const result = await handleAPI(request, env, options);
        for (const [key, value] of Object.entries(security)) outgoing.setHeader(key, value);
        outgoing.writeHead(result.status, Object.fromEntries(result.headers));
        return outgoing.end(Buffer.from(await result.arrayBuffer()));
      }
      if (!['GET', 'HEAD'].includes(incoming.method || 'GET')) return send(outgoing, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
      if (url.pathname === '/') return send(outgoing, 302, '', { Location: '/prototype/showcase.html' });
      const path = decodeURIComponent(url.pathname);
      const match = path.match(/^\/prototype\/([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?)$/);
      const name = match && (extname(match[1]) ? match[1] : `${match[1]}.html`);
      if (!name || !assets.has(name)) return send(outgoing, 404, 'Not found.');
      return send(outgoing, 200, incoming.method === 'HEAD' ? undefined : readFileSync(resolve(assetRoot, name)), { 'Content-Type': types[extname(name)] });
    } catch (error) {
      if (outgoing.headersSent) return outgoing.destroy();
      send(outgoing, 500, JSON.stringify({ code: 'INTERNAL_ERROR', message: '服务暂时无法处理，请稍后重试。' }), { 'Content-Type': 'application/json; charset=utf-8' });
      console.error(`Request failed: ${error.code || error.name}`);
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 100000;
  return { server, database, async close() { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); database.database.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createPublicApp();
  const port = Number(process.env.PORT || 8765);
  app.server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Mingdan public server ready on port ${port}.`));
  app.server.on('error', error => { console.error(`Server failed: ${error.code || error.name}`); process.exitCode = 1; });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => app.close().then(() => { process.exitCode = 0; }));
}
