import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleAPI } from '../server/worker.mjs';

export const password = 'test-only-long-password';
export function version(number = 1) {
  return { id: `version-${number}`, number, kind: number === 1 ? 'initial' : 'change', status: 'designer-reviewed', orderTitle: '测试品牌官网', clientName: '测试客户',
    sourceText: 'Private client message', rates: { privateRate: 5000 },
    items: [{ id: 'website', name: '品牌官网', quantity: 1, unitPrice: 8800.25, amount: 8800.25, rate: 'manual', source: '做一个品牌官网', specification: '中英文' }],
    conditions: [{ id: 'deadline', title: '交付时间', value: '2026-11-20', source: 'Private condition source', required: true }],
    total: 8800.25, feeAdjustments: [], issues: [], confirmationEvidence: '', confirmedAt: '' };
}
export function workspace() { return { schema: 1, activeId: 'order-1', orders: [{ id: 'order-1', title: '测试品牌官网', clientName: '测试客户', chat: 'Private client message', draft: { items: [] }, versions: [version()] }] }; }

export function sqliteD1() {
  const database = new DatabaseSync(':memory:');
  for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) database.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8'));
  function prepare(sql, params = []) {
    return { bind: (...values) => prepare(sql, values),
      async first() { return database.prepare(sql).get(...params) || null; },
      async all() { return { success: true, results: database.prepare(sql).all(...params) }; },
      async run() { const result = database.prepare(sql).run(...params); return { success: true, meta: { changes: Number(result.changes) } }; },
      sql, params };
  }
  return { prepare, database, async batch(statements) {
    database.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(({ sql, params }) => ({ success: true, meta: { changes: Number(database.prepare(sql).run(...params).changes) } })); database.exec('COMMIT'); return results; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  } };
}
export async function boot(t, { env = {}, options = {}, db = sqliteD1() } = {}) {
  if (db.database) t.after(() => db.database.close());
  const runtime = { DB: db, MINGDAN_ADMIN_PASSWORD: password, MINGDAN_REGISTRATION_MODE: 'invite', MINGDAN_BETA_MAX_USERS: '10',
    MINGDAN_AI_MONTHLY_BUDGET_CNY: '10', MINGDAN_AI_USER_DAILY_LIMIT: '3', MINGDAN_AI_USER_MONTHLY_LIMIT: '30', MINGDAN_AI_USER_MINUTE_LIMIT: '60', ...env };
  let cookie = '';
  async function request(path, method = 'GET', data, headers = {}, authenticated = true) {
    const response = await handleAPI(new Request(`https://mingdan.test${path}`, { method, headers: { 'content-type': 'application/json', ...(authenticated && cookie ? { cookie, 'X-Mingdan-Account': 'owner' } : {}), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), runtime, options);
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  async function login() { const result = await request('/api/login', 'POST', { password }); cookie = result.headers.get('set-cookie')?.split(';')[0] || ''; return result; }
  await login();
  return { db, runtime, request, login };
}
export async function publish(request, state = workspace(), revision = 0) {
  const saved = await request('/api/workspace', 'PUT', { workspace: state, revision });
  if (saved.status !== 200) throw new Error(JSON.stringify(saved));
  const share = await request('/api/shares', 'POST', { orderId: 'order-1', versionId: state.orders[0].versions.at(-1).id });
  if (![200, 201].includes(share.status)) throw new Error(JSON.stringify(share));
  return { share: share.data, token: share.data.url.split('#')[1], revision: saved.data.revision };
}

export async function designer(ownerRequest, email = 'designer@example.test', name = 'Test designer') {
  const invite = await ownerRequest('/api/admin/invites', 'POST', { email });
  if (invite.status !== 201) throw new Error(JSON.stringify(invite));
  const token = invite.data.url.split('=')[1];
  const registered = await ownerRequest('/api/register', 'POST', { token, email, name, password, aiConsent: true }, {}, false);
  if (registered.status !== 200) throw new Error(JSON.stringify(registered));
  const cookie = registered.headers.get('set-cookie').split(';')[0], user = registered.data.user;
  const request = (path, method = 'GET', data, headers = {}, authenticated = true) => ownerRequest(path, method, data, { ...(authenticated ? { cookie, 'X-Mingdan-Account': user.id } : {}), ...headers }, false);
  return { user, cookie, request, token };
}
