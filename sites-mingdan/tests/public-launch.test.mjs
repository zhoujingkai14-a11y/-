import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, password, workspace, publish } from './support.mjs';
import { hash } from '../server/accounts.mjs';
import { readConfig } from '../server/worker.mjs';
import { PRICE_REVIEW_AT } from '../server/usage.mjs';

const publicEnv = { MINGDAN_REGISTRATION_MODE: 'public', MINGDAN_BETA_MAX_USERS: '0', MINGDAN_AI_MONTHLY_BUDGET_CNY: '0',
  MINGDAN_AI_USER_DAILY_LIMIT: '0', MINGDAN_AI_USER_MONTHLY_LIMIT: '0', MINGDAN_AI_USER_MINUTE_LIMIT: '2', DEEPSEEK_API_KEY: 'fixture' };
const input = email => ({ email, name: 'Public designer', password, aiConsent: true });
const aiResponse = () => Response.json({ usage: { prompt_tokens: 1000, completion_tokens: 100 }, choices: [{ finish_reason: 'stop',
  message: { content: JSON.stringify({ title: '官网', summary: '', items: [{ name: '官网', quantity: 1, specification: '', source: '做一个官网' }], conditions: [], warnings: [] }) } }] });
async function signup(request, email = 'public@example.test', headers = {}) {
  const result = await request('/api/register', 'POST', input(email), headers, false);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const cookie = result.headers.get('set-cookie').split(';')[0], user = result.data.user;
  const memberRequest = (path, method = 'GET', data, extra = {}, authenticated = true) => request(path, method, data,
    { ...(authenticated ? { cookie, 'X-Mingdan-Account': user.id } : {}), ...extra }, false);
  return { ...result.data, cookie, request: memberRequest };
}

test('public signup creates a separate designer session without an invite and customer replies need no login', async t => {
  const { request, db } = await boot(t, { env: publicEnv });
  assert.deepEqual((await request('/api/auth-options', 'GET', undefined, {}, false)).data, { registrationMode: 'public', registrationEnabled: true });
  const a = await signup(request), b = await signup(request, 'second@example.test');
  assert.equal(a.user.role, 'designer'); assert.match(a.recoveryKey, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(db.database.prepare('SELECT recovery_key_hash FROM users WHERE id=?').get(a.user.id).recovery_key_hash, hash(a.recoveryKey));
  assert.equal((await a.request('/api/workspace')).data.workspace, null);
  const quote = await publish(a.request, workspace());
  assert.equal((await b.request('/api/workspace')).data.workspace, null);
  assert.equal((await request('/api/workspace')).data.workspace, null);
  assert.equal((await b.request(`/api/shares/${quote.share.id}/revoke`, 'POST', {})).status, 404);
  assert.equal((await a.request('/api/admin/overview')).status, 403);
  const path = `/api/customer/${quote.token}`, customer = await request(path, 'GET', undefined, {}, false);
  assert.equal(customer.status, 200); assert.equal(JSON.stringify(customer.data).includes('Private'), false);
  assert.equal((await request(path, 'POST', { action: 'confirm', name: 'Test client', comment: '', reviewed: true, digest: customer.data.digest }, {}, false)).status, 200);
  assert.equal((await a.request('/api/workspace')).data.workspace.orders[0].versions[0].status, 'client-confirmed');
});

test('public duplicate signup is atomic, validates consent and respects registration pause', async t => {
  const { request, db } = await boot(t, { env: publicEnv });
  assert.equal((await request('/api/register', 'POST', { ...input('a@example.test'), aiConsent: false }, {}, false)).status, 400);
  assert.equal((await request('/api/register', 'POST', { ...input('a@example.test'), website: 'spam' }, {}, false)).status, 400);
  const results = await Promise.all([1, 2].map(() => request('/api/register', 'POST', input('a@example.test'), {}, false)));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM users WHERE role='designer'").get().count, 1);
  await request('/api/admin/settings', 'POST', { aiEnabled: true, registrationEnabled: false });
  assert.equal((await request('/api/register', 'POST', input('b@example.test'), {}, false)).data.code, 'REGISTRATION_PAUSED');
  assert.equal((await request('/api/login', 'POST', { email: 'a@example.test', password }, {}, false)).status, 200);
});

test('public recovery rotates its single-use key atomically and invalidates all old sessions', async t => {
  const { request } = await boot(t, { env: publicEnv }), a = await signup(request);
  await a.request('/api/workspace', 'PUT', { workspace: workspace(), revision: 0 });
  const recovery = { email: a.user.email, recoveryKey: a.recoveryKey, password: 'changed-public-password' };
  assert.equal((await request('/api/recover', 'POST', { ...recovery, recoveryKey: 'z'.repeat(43) }, {}, false)).data.code, 'INVALID_RECOVERY');
  const results = await Promise.all([1, 2].map(() => request('/api/recover', 'POST', recovery, {}, false)));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
  const recovered = results.find(result => result.status === 200);
  assert.notEqual(recovered.data.recoveryKey, a.recoveryKey);
  assert.equal((await a.request('/api/me')).status, 401);
  assert.equal((await request('/api/login', 'POST', { email: a.user.email, password }, {}, false)).status, 401);
  const login = await request('/api/login', 'POST', { email: a.user.email, password: recovery.password }, {}, false);
  assert.equal(login.status, 200);
  const saved = await request('/api/workspace', 'GET', undefined, { cookie: login.headers.get('set-cookie').split(';')[0], 'X-Mingdan-Account': a.user.id }, false);
  assert.equal(saved.data.workspace.orders.length, 1);
});

test('recovery key replacement requires the current password and discloses no other account key', async t => {
  const { request, db } = await boot(t, { env: publicEnv }), a = await signup(request);
  assert.equal((await a.request('/api/account/recovery-key', 'POST', { password: 'incorrect' })).status, 401);
  assert.equal(db.database.prepare('SELECT recovery_key_hash FROM users WHERE id=?').get(a.user.id).recovery_key_hash, hash(a.recoveryKey));
  const rotated = await a.request('/api/account/recovery-key', 'POST', { password });
  assert.equal(rotated.status, 200); assert.notEqual(rotated.data.recoveryKey, a.recoveryKey);
  assert.equal((await request('/api/recover', 'POST', { email: a.user.email, recoveryKey: a.recoveryKey, password }, {}, false)).status, 400);
  assert.equal(JSON.stringify((await a.request('/api/me')).data).includes(rotated.data.recoveryKey), false);
  assert.equal((await request('/api/account/recovery-key', 'POST', { password })).status, 403);
});

test('zero monthly budget disables financial cutoff even after old price review; usage stays recorded', async t => {
  const { request, db } = await boot(t, { env: publicEnv, options: { clock: () => PRICE_REVIEW_AT + 1000, fetchImpl: async () => aiResponse() } });
  db.database.prepare("INSERT INTO ai_calls (id,user_id,started_at,purpose,status,charged_units) VALUES ('old-cost','owner',?,'brief','succeeded',50000000)").run(PRICE_REVIEW_AT);
  assert.equal((await request('/api/analyze', 'POST', { text: '做一个官网' })).status, 200);
  const usage = (await request('/api/me')).data.usage;
  assert.equal(usage.siteBudget.enabled, false); assert.equal(usage.siteBudget.limitCny, null); assert.equal(usage.siteBudget.remainingCny, null);
  assert.equal(usage.dailyRemaining, null); assert.equal(usage.monthlyRemaining, null); assert.equal(usage.paused, false); assert.equal(usage.priceReviewRequired, true);
  assert.ok(usage.siteBudget.accountedCny >= 50);
  assert.equal(readConfig({}).monthlyBudgetUnits, 0);
});

test('provider balance exhaustion returns a recoverable message and leaves orders usable', async t => {
  let calls = 0;
  const { request } = await boot(t, { env: publicEnv, options: { fetchImpl: async () => { calls++; return new Response('Provider private response', { status: 402 }); } } });
  const a = await signup(request);
  await a.request('/api/workspace', 'PUT', { workspace: workspace(), revision: 0 });
  const result = await a.request('/api/analyze', 'POST', { text: '做一个官网' });
  assert.equal(result.status, 503); assert.equal(result.data.code, 'AI_BALANCE_EXHAUSTED'); assert.equal(calls, 1);
  assert.equal(JSON.stringify(result.data).includes('Provider private'), false);
  assert.equal((await a.request('/api/workspace')).data.workspace.orders.length, 1);
  assert.equal((await publish(a.request, workspace(), 1)).share.status, 'pending');
});

test('public AI minute limits block bursts without exhausting a monthly quota', async t => {
  let time = Date.now(), calls = 0;
  const { request } = await boot(t, { env: publicEnv, options: { clock: () => time, fetchImpl: async () => { calls++; return aiResponse(); } } });
  for (let i = 0; i < 2; i++) assert.equal((await request('/api/analyze', 'POST', { text: '做一个官网' })).status, 200);
  assert.equal((await request('/api/analyze', 'POST', { text: '做一个官网' })).data.code, 'AI_RATE_LIMIT'); assert.equal(calls, 2);
  time += 61000;
  assert.equal((await request('/api/analyze', 'POST', { text: '做一个官网' })).status, 200);
});

test('public signup rejects an IP registration burst before creating another account', async t => {
  const { request, db } = await boot(t, { env: publicEnv });
  for (let i = 0; i < 5; i++) await signup(request, `signup-${i}@example.test`);
  assert.equal((await request('/api/register', 'POST', input('sixth@example.test'), {}, false)).status, 429);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM users WHERE role='designer'").get().count, 5);
});
