import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createPublicApp } from './public-node.mjs';
import { workspace } from '../sites-mingdan/tests/support.mjs';

const password = 'public-hosting-test-password';
test('portable public HTTP server preserves isolation, customer confirmation, recovery and restart data', async () => {
  const directory = resolve('sites-mingdan/.sites-runtime', `public-node-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(directory, { recursive: true });
  const filename = resolve(directory, 'mingdan-public.sqlite');
  const env = { HOST: '127.0.0.1', MINGDAN_DATABASE: filename, MINGDAN_ADMIN_PASSWORD: password, DEEPSEEK_API_KEY: 'fixture' };
  let app = createPublicApp(env);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  let base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(path, method = 'GET', data, account, extra = {}) {
    const response = await fetch(base + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json',
      ...(account ? { cookie: account.cookie, 'X-Mingdan-Account': account.id } : {}), ...extra }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, data: response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text(), headers: response.headers };
  }
  try {
    assert.equal((await request('/api/auth-options')).data.registrationMode, 'public');
    assert.equal((await request('/api/workspace')).status, 401);
    const members = [];
    for (const label of ['a', 'b']) {
      const result = await request('/api/register', 'POST', { email: `${label}@portable.example.test`, name: label, password, aiConsent: true });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      members.push({ id: result.data.user.id, cookie: result.headers.get('set-cookie').split(';')[0], recoveryKey: result.data.recoveryKey });
    }
    const [a, b] = members;
    assert.equal((await request('/api/workspace', 'PUT', { revision: 0, workspace: workspace() }, a)).status, 200);
    assert.equal((await request('/api/workspace', 'GET', undefined, b)).data.workspace, null);
    assert.equal((await request('/api/admin/overview', 'GET', undefined, a)).status, 403);
    const share = await request('/api/shares', 'POST', { orderId: 'order-1', versionId: 'version-1' }, a);
    assert.equal(share.status, 201);
    const path = `/api/customer/${share.data.url.split('#')[1]}`, quote = await request(path);
    assert.equal(JSON.stringify(quote.data).includes('Private'), false);
    assert.equal((await request(path, 'POST', { action: 'confirm', name: 'Portable test client', comment: '', reviewed: true, digest: quote.data.digest })).status, 200);
    assert.equal((await request('/api/workspace', 'GET', undefined, a)).data.workspace.orders[0].versions[0].status, 'client-confirmed');
    const recovered = await request('/api/recover', 'POST', { email: 'b@portable.example.test', recoveryKey: b.recoveryKey, password: 'new-portable-test-password' });
    assert.equal(recovered.status, 200); assert.notEqual(recovered.data.recoveryKey, b.recoveryKey);
    assert.equal((await request('/api/me', 'GET', undefined, b)).status, 401);
    assert.equal((await request('/api/workspace', 'PUT', { revision: 0, workspace: workspace() }, a, { origin: 'https://other.example.test' })).status, 403);
    const name = app.database.database.prepare("SELECT name FROM users WHERE id='owner'").get().name;
    await assert.rejects(app.database.batch([app.database.prepare("UPDATE users SET name='Wrong' WHERE id='owner'"), app.database.prepare('INSERT INTO missing_table VALUES (1)')]));
    assert.equal(app.database.database.prepare("SELECT name FROM users WHERE id='owner'").get().name, name);
    await app.close(); app = createPublicApp(env);
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    base = `http://127.0.0.1:${app.server.address().port}`;
    assert.equal((await request('/api/workspace', 'GET', undefined, a)).data.workspace.orders[0].versions[0].status, 'client-confirmed');
    assert.equal(app.database.database.prepare('SELECT COUNT(*) AS count FROM node_migrations').get().count, 3);
    const backup = spawnSync(process.execPath, ['deploy/public-backup.mjs'], { env: { ...process.env, MINGDAN_DATABASE: filename }, encoding: 'utf8' });
    assert.equal(backup.status, 0, backup.stderr);
    const saved = readdirSync(resolve(directory, 'backups')).find(name => name.endsWith('.sqlite'));
    const snapshot = new DatabaseSync(resolve(directory, 'backups', saved), { readOnly: true });
    try { assert.equal(snapshot.prepare('SELECT COUNT(*) AS count FROM users').get().count, 3); } finally { snapshot.close(); }
  } finally { await app.close(); }
});

test('portable server only serves allowlisted public assets and rejects forged IP and host headers', async t => {
  const app = createPublicApp({ HOST: '127.0.0.1', MINGDAN_DATABASE: ':memory:', MINGDAN_ADMIN_PASSWORD: password });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  for (const path of ['/prototype/account.html', '/prototype/data.html', '/prototype/glass-atrium.webp', '/prototype/account']) assert.equal((await fetch(base + path)).status, 200, path);
  for (const path of ['/.dev.vars', '/deploy/public.env.example', '/server/accounts.mjs', '/prototype/../server/accounts.mjs', '/prototype/.env']) assert.equal((await fetch(base + path)).status, 404, path);
  const forgedHost = await new Promise((resolve, reject) => http.get(base + '/api/auth-options', { headers: { Host: 'unconfigured.example.test' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject));
  assert.equal(forgedHost, 403);
  for (let index = 0; index < 10; index++) {
    await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `203.0.113.${index}` }, body: JSON.stringify({ password: 'incorrect' }) });
  }
  const last = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.99' }, body: JSON.stringify({ password: 'incorrect' }) });
  assert.equal(last.status, 429);
});

test('public startup refuses missing credentials', () => {
  assert.throws(() => createPublicApp({ HOST: '0.0.0.0', MINGDAN_DATABASE: ':memory:', MINGDAN_ADMIN_PASSWORD: password }), /HTTPS origin/);
  assert.throws(() => createPublicApp({ HOST: '127.0.0.1', MINGDAN_DATABASE: ':memory:', MINGDAN_ADMIN_PASSWORD: 'short' }), /owner password/);
});
