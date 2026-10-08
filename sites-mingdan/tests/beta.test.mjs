import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { boot, designer, publish, workspace, password } from './support.mjs';
import { readConfig } from '../server/worker.mjs';
import { hash } from '../server/accounts.mjs';
import { calendarStart, usageCost, tokenUsage, PRICE_REVIEW_AT } from '../server/usage.mjs';

const text = '做一个官网';
const now = Date.parse('2026-10-02T10:00:00+08:00');
const response = (usage = { prompt_tokens: 2000, prompt_cache_hit_tokens: 500, completion_tokens: 200 }) => Response.json({
  ...(usage ? { usage } : {}), choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: '官网', summary: '',
    items: [{ name: '官网', quantity: 1, specification: '', source: text }], conditions: [], warnings: [] }) } }],
});

test('registration is invitation-only, email-bound, consented and single-use under concurrent requests', async t => {
  const { request, db } = await boot(t);
  assert.equal((await request('/api/register', 'POST', { email: 'a@example.test', password, name: 'A', aiConsent: true }, {}, false)).status, 400);
  const invitation = await request('/api/admin/invites', 'POST', { email: ' A@Example.test ' });
  assert.equal(invitation.status, 201); assert.equal(invitation.data.email, 'a@example.test');
  const token = invitation.data.url.split('=')[1];
  assert.equal(db.database.prepare('SELECT token_hash FROM invites').get().token_hash, hash(token));
  const input = { token, email: 'a@example.test', password, name: 'A', aiConsent: true };
  assert.equal((await request('/api/register', 'POST', { ...input, email: 'b@example.test' }, {}, false)).status, 400);
  assert.equal((await request('/api/register', 'POST', { ...input, aiConsent: false }, {}, false)).status, 400);
  assert.equal((await request('/api/register', 'POST', { ...input, password: 'short' }, {}, false)).data.code, 'INVALID_PASSWORD');
  const results = await Promise.all([1, 2].map(() => request('/api/register', 'POST', input, {}, false)));
  assert.deepEqual(results.map(item => item.status).sort(), [200, 409]);
  const user = db.database.prepare("SELECT * FROM users WHERE role='designer'").get();
  assert.match(user.password_hash, /^scrypt:16384:8:5:/); assert.notEqual(user.password_hash, password);
  assert.ok(user.ai_consent_at); assert.equal(db.database.prepare("SELECT COUNT(*) AS n FROM users WHERE role='designer'").get().n, 1);
  assert.equal((await request('/api/register', 'POST', input, {}, false)).data.code, 'INVALID_INVITE');
});

test('seats, invitation expiry, revocation and registration pause are enforced in the database', async t => {
  let time = now;
  const { request } = await boot(t, { env: { MINGDAN_BETA_MAX_USERS: '1' }, options: { clock: () => time } });
  const seats = await Promise.all(['a@example.test', 'b@example.test'].map(email => request('/api/admin/invites', 'POST', { email })));
  assert.deepEqual(seats.map(item => item.status).sort(), [201, 409]);
  const invite = seats.find(item => item.status === 201).data;
  await request('/api/admin/settings', 'POST', { aiEnabled: true, registrationEnabled: false });
  const input = { token: invite.url.split('=')[1], email: invite.email, password, name: 'A', aiConsent: true };
  assert.equal((await request('/api/register', 'POST', input, {}, false)).data.code, 'REGISTRATION_PAUSED');
  await request('/api/admin/settings', 'POST', { aiEnabled: true, registrationEnabled: true });
  await request(`/api/admin/invites/${invite.id}/revoke`, 'POST', {});
  assert.equal((await request('/api/register', 'POST', input, {}, false)).data.code, 'INVALID_INVITE');
  const next = (await request('/api/admin/invites', 'POST', { email: invite.email })).data;
  time += 8 * 86400000;
  assert.equal((await request('/api/register', 'POST', { ...input, token: next.url.split('=')[1] }, {}, false)).data.code, 'INVALID_INVITE');
});

test('workspaces, history, quotes and customer links remain isolated even with colliding order IDs', async t => {
  const { request } = await boot(t);
  const a = await designer(request, 'a@example.test'), b = await designer(request, 'b@example.test');
  const stateA = workspace(), stateB = workspace(); stateA.orders[0].chat = 'A private message'; stateB.orders[0].chat = 'B private message';
  const first = await publish(a.request, stateA), second = await publish(b.request, stateB);
  assert.notEqual(first.share.url, second.share.url);
  assert.equal((await a.request('/api/workspace')).data.workspace.orders[0].chat, 'A private message');
  assert.equal((await b.request('/api/workspace')).data.workspace.orders[0].chat, 'B private message');
  assert.equal((await request('/api/workspace')).data.workspace, null);
  assert.equal((await b.request(`/api/shares/${first.share.id}/revoke`, 'POST', {})).status, 404);
  assert.equal((await b.request('/api/admin/overview')).status, 403);
  assert.equal((await b.request('/api/admin/invites', 'POST', { email: 'third@example.test' })).status, 403);
  const path = `/api/customer/${first.token}`, snapshot = (await request(path, 'GET', undefined, {}, false)).data;
  await request(path, 'POST', { action: 'confirm', name: 'A client', comment: '', digest: snapshot.digest, reviewed: true }, {}, false);
  assert.equal((await a.request('/api/workspace')).data.workspace.orders[0].versions[0].status, 'client-confirmed');
  assert.equal((await b.request('/api/workspace')).data.workspace.orders[0].versions[0].status, 'designer-reviewed');
  assert.deepEqual((await b.request('/api/pricing/history?orderId=order-1')).data.records, []);
  const missing = await b.request('/api/pricing/advice', 'POST', { orderId: 'a-only-order', revision: 1, mode: 'quote' });
  assert.equal(missing.status, 404);
});

test('an old tab cannot write or log out a newly logged-in account; forged identity headers grant no access', async t => {
  const { request } = await boot(t), a = await designer(request, 'a@example.test'), b = await designer(request, 'b@example.test');
  for (const [path, data] of [['/api/workspace', { revision: 0, workspace: workspace() }], ['/api/logout', {}]]) {
    assert.equal((await b.request(path, path.endsWith('workspace') ? 'PUT' : 'POST', data, { 'X-Mingdan-Account': a.user.id })).data.code, 'ACCOUNT_CHANGED');
  }
  assert.equal((await b.request('/api/me')).status, 200);
  assert.equal((await request('/api/workspace', 'GET', undefined, { 'X-Mingdan-Account': a.user.id, 'oai-authenticated-user-id': a.user.id }, false)).status, 401);
  assert.equal((await b.request('/api/admin/overview', 'GET', undefined, { 'X-Mingdan-Account': 'owner' })).status, 409);
});

test('recovery consumes one link, invalidates old sessions, and suspended accounts preserve their data', async t => {
  const { request, db } = await boot(t), member = await designer(request);
  await member.request('/api/workspace', 'PUT', { revision: 0, workspace: workspace() });
  const recovery = (await request('/api/admin/invites', 'POST', { email: member.user.email, purpose: 'recovery' })).data;
  const input = { email: member.user.email, token: recovery.url.split('=')[1], password: 'new-test-only-password' };
  const recovered = await request('/api/recover', 'POST', input, {}, false);
  assert.equal(recovered.status, 200); assert.equal((await member.request('/api/me')).status, 401);
  assert.equal((await request('/api/recover', 'POST', input, {}, false)).status, 400);
  assert.equal((await request('/api/login', 'POST', { email: member.user.email, password }, {}, false)).status, 401);
  const login = await request('/api/login', 'POST', { email: member.user.email, password: input.password }, {}, false);
  assert.equal(login.status, 200);
  await request(`/api/admin/users/${member.user.id}`, 'POST', { status: 'paused' });
  assert.equal((await request('/api/me', 'GET', undefined, { cookie: login.headers.get('set-cookie').split(';')[0] }, false)).status, 401);
  assert.equal(db.database.prepare('SELECT COUNT(*) AS n FROM workspaces WHERE user_id=?').get(member.user.id).n, 1);
  await request(`/api/admin/users/${member.user.id}`, 'POST', { status: 'active' });
  assert.equal((await request('/api/login', 'POST', { email: member.user.email, password: input.password }, {}, false)).status, 200);
});

test('pre-upgrade pages without an account marker cannot read, write or log out another session', async t => {
  const { request } = await boot(t), member = await designer(request);
  for (const [path, method, data] of [['/api/workspace', 'GET'], ['/api/workspace', 'PUT', { revision: 0, workspace: workspace() }], ['/api/logout', 'POST', {}]]) {
    assert.equal((await request(path, method, data, { cookie: member.cookie }, false)).data.code, 'ACCOUNT_CHANGED');
  }
  assert.equal((await request('/api/me', 'GET', undefined, { cookie: member.cookie }, false)).status, 200);
  assert.equal((await member.request('/api/workspace')).data.workspace, null);
});

test('owner beta statistics expose counts and voluntary feedback, not private workspace content', async t => {
  const { request } = await boot(t), member = await designer(request);
  await publish(member.request);
  assert.equal((await member.request('/api/feedback', 'POST', { category: 'suggestion', text: 'Make the quote review clearer' })).status, 201);
  const overview = await request('/api/admin/overview');
  assert.equal(overview.status, 200); assert.equal(overview.data.users[0].order_count, 1); assert.equal(overview.data.users[0].version_count, 1);
  assert.equal(overview.data.feedback[0].text, 'Make the quote review clearer');
  for (const privateField of ['Private', 'rates', 'sourceText', 'password_hash', 'token_hash']) assert.equal(JSON.stringify(overview.data).includes(privateField), false);
  assert.equal((await member.request('/api/admin/overview')).status, 403);
});

test('old owner workspace, sessions, quotes and usage are preserved during populated database migration', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(readFileSync(new URL('../drizzle/0000_tense_justin_hammer.sql', import.meta.url), 'utf8'));
  const state = workspace(), token = 'x'.repeat(43);
  db.prepare('INSERT INTO workspace (id,revision,data,mutation_token) VALUES (1,7,?,?)').run(JSON.stringify(state), 'old-marker');
  db.prepare('INSERT INTO sessions (token_hash,expires_at) VALUES (?,?)').run(hash(token), now + 86400000);
  db.prepare('INSERT INTO shares (id,token,order_id,version_id,snapshot,digest,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)').run('old-share', 'y'.repeat(43), 'order-1', 'version-1', JSON.stringify(state.orders[0].versions[0]), 'old-digest', 'confirmed', now, now + 86400000);
  db.prepare('INSERT INTO ai_calls (id,started_at,purpose,status) VALUES (?,?,?,?)').run('old-call', now, 'brief', 'succeeded');
  db.exec(readFileSync(new URL('../drizzle/0001_curved_titania.sql', import.meta.url), 'utf8'));
  assert.deepEqual(JSON.parse(db.prepare("SELECT data FROM workspaces WHERE user_id='owner'").get().data), state);
  assert.equal(db.prepare("SELECT revision FROM workspaces WHERE user_id='owner'").get().revision, 7);
  assert.equal(db.prepare('SELECT user_id FROM sessions').get().user_id, 'owner');
  assert.equal(db.prepare('SELECT user_id,status,token FROM shares').get().user_id, 'owner');
  assert.equal(db.prepare('SELECT status,token FROM shares').get().status, 'confirmed');
  const oldCall = db.prepare('SELECT * FROM ai_calls').get();
  assert.equal(oldCall.user_id, 'owner'); assert.equal(oldCall.charged_units, 1000000); assert.equal(oldCall.cost_kind, 'conservative');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workspaces WHERE user_id!='owner'").get().n, 0);
});

test('measured tokens settle the initial reservation; missing usage and provider failure remain charged', async t => {
  let n = 0;
  const { request, db } = await boot(t, { env: { DEEPSEEK_API_KEY: 'fixture' }, options: { clock: () => now, fetchImpl: async (url, init) => {
    assert.equal(JSON.parse(init.body).max_tokens, 4096); assert.equal(JSON.parse(init.body).thinking.type, 'disabled');
    n++; if (n === 1) return response(); if (n === 2) return response(null); throw new Error('Provider unavailable');
  } } });
  assert.equal((await request('/api/analyze', 'POST', { text })).status, 200);
  let row = db.database.prepare('SELECT * FROM ai_calls').get();
  assert.equal(row.charged_units, 4620); assert.equal(row.cost_kind, 'measured'); assert.ok(row.reserved_units > row.charged_units);
  assert.equal((await request('/api/analyze', 'POST', { text })).status, 200);
  assert.equal((await request('/api/analyze', 'POST', { text })).status, 502);
  const rows = db.database.prepare('SELECT * FROM ai_calls ORDER BY rowid').all();
  assert.equal(rows[1].charged_units, rows[1].reserved_units); assert.equal(rows[2].charged_units, rows[2].reserved_units);
  const usage = (await request('/api/me')).data.usage;
  assert.equal(usage.conservativeCalls, 2); assert.equal(usage.failed, 1); assert.equal(usage.dailyRemaining, 0);
  assert.equal((await request('/api/analyze', 'POST', { text })).data.code, 'USER_AI_LIMIT'); assert.equal(n, 3);
});

test('atomic budget reservations block a second account before any model request; settings cannot raise the budget', async t => {
  let release, started; const pending = new Promise(resolve => { started = resolve; }); let calls = 0;
  const { request, db } = await boot(t, { env: { DEEPSEEK_API_KEY: 'fixture', MINGDAN_AI_MONTHLY_BUDGET_CNY: '0.08' }, options: { clock: () => now, fetchImpl: async () => {
    calls++; started(); await new Promise(resolve => { release = resolve; }); return response(null);
  } } });
  const member = await designer(request);
  const first = request('/api/analyze', 'POST', { text }); await pending;
  const row = db.database.prepare('SELECT * FROM ai_calls').get(); assert.ok(row.charged_units <= 80000 && row.charged_units > 40000);
  assert.equal((await member.request('/api/analyze', 'POST', { text })).data.code, 'AI_BUDGET_LIMIT'); assert.equal(calls, 1);
  release(); assert.equal((await first).status, 200);
  assert.equal((await member.request('/api/analyze', 'POST', { text })).data.code, 'AI_BUDGET_LIMIT');
  await request('/api/admin/settings', 'POST', { aiEnabled: true, registrationEnabled: true, budget: 9999 });
  assert.equal((await request('/api/me')).data.usage.siteBudget.limitCny, .08);
  assert.equal(readConfig({ MINGDAN_AI_MONTHLY_BUDGET_CNY: '10.01' }).monthlyBudgetUnits, 10010000);
  assert.throws(() => readConfig({ MINGDAN_AI_MONTHLY_BUDGET_CNY: '-1' }));
});

test('user daily and monthly quotas use Beijing calendar boundaries and do not reset on login', async t => {
  let time = Date.parse('2026-10-02T23:59:00+08:00'); let calls = 0;
  const { request, login } = await boot(t, { env: { DEEPSEEK_API_KEY: 'fixture', MINGDAN_AI_USER_DAILY_LIMIT: '1', MINGDAN_AI_USER_MONTHLY_LIMIT: '2' }, options: { clock: () => time, fetchImpl: async () => { calls++; return response(); } } });
  assert.equal((await request('/api/analyze', 'POST', { text })).status, 200); await login();
  assert.equal((await request('/api/analyze', 'POST', { text })).data.code, 'USER_AI_LIMIT');
  time += 120000;
  assert.equal((await request('/api/analyze', 'POST', { text })).status, 200);
  time += 86400000; await login();
  assert.equal((await request('/api/analyze', 'POST', { text })).data.code, 'USER_AI_LIMIT');
  time = Date.parse('2026-11-01T00:00:00+08:00'); await login();
  assert.equal((await request('/api/analyze', 'POST', { text })).status, 200); assert.equal(calls, 3);
  assert.equal(new Date(calendarStart(now, true)).toISOString(), '2026-09-30T16:00:00.000Z');
});

test('oversized input, unpriced models, price review and paused AI never send a provider request', async t => {
  const options = { clock: () => now, fetchImpl: () => assert.fail('Must reject before network') };
  const { request } = await boot(t, { env: { DEEPSEEK_API_KEY: 'fixture' }, options });
  assert.equal((await request('/api/analyze', 'POST', { text: '长'.repeat(8001) })).status, 400);
  await request('/api/admin/settings', 'POST', { aiEnabled: false, registrationEnabled: true });
  assert.equal((await request('/api/analyze', 'POST', { text })).data.code, 'AI_PAUSED');
  const unpriced = await boot(t, { env: { DEEPSEEK_API_KEY: 'fixture', DEEPSEEK_MODEL: 'other-model' }, options });
  assert.equal((await unpriced.request('/api/analyze', 'POST', { text })).data.code, 'UNPRICED_MODEL');
  const expired = await boot(t, { env: { DEEPSEEK_API_KEY: 'fixture' }, options: { ...options, clock: () => PRICE_REVIEW_AT } });
  assert.equal((await expired.request('/api/analyze', 'POST', { text })).data.code, 'PRICE_REVIEW_REQUIRED');
});

test('token accounting rejects invalid usage and an unexpected reservation overrun pauses later calls', async t => {
  assert.equal(tokenUsage({ prompt_tokens: 10, completion_tokens: 2, prompt_cache_hit_tokens: 11 }), null);
  assert.equal(usageCost(tokenUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 100 } })), 164);
  const { request } = await boot(t, { env: { DEEPSEEK_API_KEY: 'fixture' }, options: { clock: () => now, fetchImpl: async () => response({ prompt_tokens: 500000, completion_tokens: 200 }) } });
  assert.equal((await request('/api/analyze', 'POST', { text })).status, 200);
  assert.equal((await request('/api/analyze', 'POST', { text })).data.code, 'AI_PAUSED');
});
