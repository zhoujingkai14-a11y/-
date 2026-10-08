import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, publish, workspace, version, password, designer } from './support.mjs';

test('owner sessions are required even with platform identity headers; logout revokes them', async t => {
  const { request, login } = await boot(t);
  assert.equal((await request('/api/workspace', 'GET', undefined, { 'oai-authenticated-user-id': 'another-user' }, false)).status, 401);
  assert.equal((await request('/api/login', 'POST', { password: 'wrong' })).status, 401);
  const result = await login();
  assert.match(result.headers.get('set-cookie'), /HttpOnly.*SameSite=Strict.*Secure/);
  const status = await request('/api/status');
  assert.equal(status.data.aiConfigured, false);
  assert.equal(JSON.stringify(status.data).includes(password), false);
  assert.equal((await request('/api/logout', 'POST', {})).status, 200);
  assert.equal((await request('/api/status')).status, 401);
});

test('atomic workspace compare-and-swap prevents concurrent stale writes', async t => {
  const { request } = await boot(t);
  assert.deepEqual((await request('/api/workspace')).data, { revision: 0, workspace: null });
  const results = await Promise.all([1, 2].map(value => { const state = workspace(); state.orders[0].title += value; return request('/api/workspace', 'PUT', { workspace: state, revision: 0 }); }));
  assert.deepEqual(results.map(item => item.status).sort(), [200, 409]);
  assert.equal((await request('/api/workspace')).data.revision, 1);
});

test('invalid money, unresolved approval and forged online confirmation are rejected', async t => {
  const { request } = await boot(t);
  let state = workspace(); state.orders[0].versions[0].total = 1;
  assert.equal((await request('/api/workspace', 'PUT', { workspace: state, revision: 0 })).data.code, 'INVALID_TOTAL');
  state = workspace(); state.orders[0].versions[0].issues = ['排期待确认'];
  assert.equal((await request('/api/workspace', 'PUT', { workspace: state, revision: 0 })).data.code, 'UNRESOLVED_VERSION');
  state = workspace(); state.orders[0].versions[0].status = 'client-confirmed';
  assert.equal((await request('/api/workspace', 'PUT', { workspace: state, revision: 0 })).data.code, 'INVALID_CONFIRMATION');
});

test('saved quote contents remain immutable when drafts and current prices change', async t => {
  const { request } = await boot(t), state = workspace();
  await publish(request, state);
  state.orders[0].versions[0].items[0].amount = 500; state.orders[0].versions[0].items[0].unitPrice = 500; state.orders[0].versions[0].total = 500;
  assert.equal((await request('/api/workspace', 'PUT', { workspace: state, revision: 1 })).data.code, 'IMMUTABLE_VERSION');
  assert.equal((await request('/api/workspace')).data.workspace.orders[0].versions[0].total, 8800.25);
});

test('parallel link creation is idempotent; customer sees only the public snapshot', async t => {
  const { request, db } = await boot(t);
  await request('/api/workspace', 'PUT', { workspace: workspace(), revision: 0 });
  const shares = await Promise.all([1, 2].map(() => request('/api/shares', 'POST', { orderId: 'order-1', versionId: 'version-1' })));
  assert.equal(shares[0].data.url, shares[1].data.url);
  assert.equal(db.database.prepare('SELECT COUNT(*) AS count FROM shares').get().count, 1);
  const snapshot = await request(`/api/customer/${shares[0].data.url.split('#')[1]}`, 'GET', undefined, {}, false);
  assert.equal(snapshot.status, 200);
  for (const text of ['Private', 'sourceText', 'unitPrice', 'rates']) assert.equal(JSON.stringify(snapshot.data).includes(text), false);
});

test('version-bound customer confirmations are accepted exactly once and reflected for the designer', async t => {
  const { request } = await boot(t), { token } = await publish(request);
  const snapshot = (await request(`/api/customer/${token}`, 'GET', undefined, {}, false)).data;
  const reply = { action: 'confirm', name: '测试客户', comment: '按本版执行', reviewed: true, digest: snapshot.digest };
  assert.equal((await request(`/api/customer/${token}`, 'POST', { ...reply, digest: 'wrong' }, {}, false)).status, 400);
  const results = await Promise.all([1, 2].map(() => request(`/api/customer/${token}`, 'POST', reply, {}, false)));
  assert.deepEqual(results.map(item => item.status).sort(), [200, 409]);
  const saved = (await request('/api/workspace')).data.workspace.orders[0].versions[0];
  assert.equal(saved.status, 'client-confirmed'); assert.equal(saved.confirmationMode, 'online'); assert.equal(saved.share.response.name, reply.name);
});

test('a new quote supersedes an unconfirmed link and preserves previously confirmed history', async t => {
  const { request } = await boot(t), state = workspace(), first = await publish(request, state);
  const snapshot = (await request(`/api/customer/${first.token}`)).data;
  await request(`/api/customer/${first.token}`, 'POST', { action: 'changes', name: '客户', comment: '补充英文页面', reviewed: true, digest: snapshot.digest }, {}, false);
  state.orders[0].versions.push(version(2)); const second = await publish(request, state, first.revision);
  assert.equal((await request(`/api/customer/${first.token}`)).data.status, 'superseded');
  assert.equal((await request(`/api/customer/${first.token}`, 'POST', {})).status, 409);
  const secondSnapshot = (await request(`/api/customer/${second.token}`)).data;
  await request(`/api/customer/${second.token}`, 'POST', { action: 'confirm', name: '客户', comment: '', reviewed: true, digest: secondSnapshot.digest }, {}, false);
  state.orders[0].versions.push(version(3)); await publish(request, state, second.revision);
  assert.equal((await request(`/api/customer/${second.token}`)).data.status, 'confirmed');
});

test('sharing aborts atomically when another window changes the workspace before the batch', async t => {
  const { request, db } = await boot(t);
  await request('/api/workspace', 'PUT', { workspace: workspace(), revision: 0 });
  const original = db.batch;
  db.batch = statements => { db.database.prepare("UPDATE workspaces SET revision=revision+1 WHERE user_id='owner'").run(); return original(statements); };
  assert.equal((await request('/api/shares', 'POST', { orderId: 'order-1', versionId: 'version-1' })).data.code, 'WORKSPACE_CONFLICT');
  assert.equal(db.database.prepare('SELECT COUNT(*) AS count FROM shares').get().count, 0);
});

test('revoked and expired links reject replies; a revoked quote can be reissued', async t => {
  let time = Date.now();
  const { request } = await boot(t, { options: { clock: () => time } }), first = await publish(request);
  await request(`/api/shares/${first.share.id}/revoke`, 'POST', {});
  assert.equal((await request(`/api/customer/${first.token}`)).data.status, 'revoked');
  const next = await request('/api/shares', 'POST', { orderId: 'order-1', versionId: 'version-1' });
  assert.notEqual(next.data.url, first.share.url);
  time += 8 * 86400000;
  const path = `/api/customer/${next.data.url.split('#')[1]}`;
  assert.equal((await request(path)).data.status, 'expired');
  assert.equal((await request(path, 'POST', {})).status, 409);
});

test('cross-site writes are blocked and missing AI keys never trigger a model request', async t => {
  const { request } = await boot(t, { options: { fetchImpl: () => assert.fail('Missing key must not send a request') } });
  assert.equal((await request('/api/workspace', 'PUT', { workspace: workspace(), revision: 0 }, { origin: 'https://other.test' })).status, 403);
  assert.equal((await request('/api/login', 'POST', { password }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await request('/api/analyze', 'POST', { text: '做一个官网' })).data.code, 'AI_NOT_CONFIGURED');
});

const briefResponse = () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: '官网', summary: '', items: [{ name: '官网', quantity: 1, specification: '', source: '做一个官网' }], conditions: [], warnings: [] }) } }] });
test('AI quota is shared across requests and restarts; invalid input consumes no quota', async t => {
  let calls = 0;
  const { request, runtime } = await boot(t, { env: { DEEPSEEK_API_KEY: 'test-only-key', MINGDAN_AI_HOURLY_LIMIT: '1' }, options: { fetchImpl: async (url, init) => { calls++; assert.equal(url, 'https://api.deepseek.com/chat/completions'); assert.equal(JSON.parse(init.body).response_format.type, 'json_object'); return briefResponse(); } } });
  assert.equal((await request('/api/analyze', 'POST', { text: '' })).status, 400);
  const results = await Promise.all([1, 2, 3].map(() => request('/api/analyze', 'POST', { text: '做一个官网' })));
  assert.deepEqual(results.map(item => item.status).sort(), [200, 429, 429]);
  assert.equal(calls, 1);
  assert.equal((await request('/api/status')).data.aiUsage.remaining, 0);
  const restarted = await boot(t, { env: runtime, db: { prepare: runtime.DB.prepare, batch: runtime.DB.batch } });
  assert.equal((await restarted.request('/api/analyze', 'POST', { text: '做一个官网' })).data.code, 'AI_USAGE_LIMIT');
});

test('AI concurrency is reserved in the database across separate Worker requests', async t => {
  const release = [], resolvers = [];
  const { request } = await boot(t, { env: { DEEPSEEK_API_KEY: 'test-only-key' }, options: { fetchImpl: () => new Promise(resolve => { release.push(() => resolve(briefResponse())); while (resolvers.length) resolvers.shift()(); }) } });
  const member = await designer(request);
  const first = request('/api/analyze', 'POST', { text: '做一个官网' });
  if (release.length < 1) await new Promise(resolve => resolvers.push(resolve));
  const second = member.request('/api/analyze', 'POST', { text: '做一个官网' });
  if (release.length < 2) await new Promise(resolve => resolvers.push(resolve));
  assert.equal((await request('/api/analyze', 'POST', { text: '做一个官网' })).data.code, 'AI_BUSY');
  release.forEach(resolve => resolve());
  assert.equal((await first).status, 200); assert.equal((await second).status, 200);
});

test('pricing advice uses personal rates and discards results after a concurrent edit', async t => {
  let release, started;
  const pending = new Promise(resolve => { started = resolve; });
  const fetchImpl = async () => {
    started();
    await new Promise(resolve => { release = resolve; });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ matches: [{ itemId: 'draft-website', serviceId: 'website-rate', source: '做一个品牌官网', reason: '需核对语言范围' }], checkHints: [], history: [], change: null, warnings: [] }) } }] });
  };
  const { request } = await boot(t, { env: { DEEPSEEK_API_KEY: 'test-only-key' }, options: { fetchImpl } });
  const state = workspace(); state.orders[0].chat = '做一个品牌官网';
  state.orders[0].draft.items = [{ id: 'draft-website', name: '品牌官网', quantity: 1, source: '做一个品牌官网' }];
  state.catalogue = { services: [{ id: 'website-rate', name: '品牌官网', category: '网站', unit: '项目', unitPrice: 8800.25, scope: '官网视觉', included: [], excluded: [], includedRevisions: 2, active: true, updatedAt: '2026-10-01T00:00:00Z' }], checks: [] };
  await request('/api/workspace', 'PUT', { workspace: state, revision: 0 });
  const advice = request('/api/pricing/advice', 'POST', { orderId: 'order-1', revision: 1, mode: 'quote' });
  await pending;
  state.orders[0].title = 'Edited during model request';
  assert.equal((await request('/api/workspace', 'PUT', { workspace: state, revision: 1 })).status, 200);
  release();
  assert.equal((await advice).data.code, 'WORKSPACE_CONFLICT');
  assert.equal((await request('/api/workspace')).data.workspace.orders[0].draft.items[0].unitPrice, undefined);
  const next = request('/api/pricing/advice', 'POST', { orderId: 'order-1', revision: 2, mode: 'quote' });
  await new Promise(resolve => setTimeout(resolve, 0)); release();
  const result = await next;
  assert.equal(result.status, 200); assert.equal(result.data.matches[0].service.unitPrice, 8800.25);
});
