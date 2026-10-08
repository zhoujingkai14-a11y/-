import { randomBytes } from 'node:crypto';
import { AppError, analyzeWithAI } from './ai.mjs';
import { validateVersion, validateWorkspace, versionContent } from './validation.mjs';
import { localHistory } from '../public/prototype/pricing-engine.mjs';
import { pricingContext, advisePricing } from './pricing-advice.mjs';
import { hash, getSessionUser, accountRoute, publicUser, normalizeEmail, verifyPassword } from './accounts.mjs';
import { CNY_UNITS, calendarStart, usageSummary, meteredAI } from './usage.mjs';

const clone = value => structuredClone(value);
const closedMessage = '此版本已收到回复、失效或被更新，请刷新页面查看状态。';
const securityHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (status, data, headers = {}) => Response.json(data, { status, headers: { ...securityHeaders, ...headers } });
const conflict = () => new AppError(409, 'WORKSPACE_CONFLICT', '另一窗口已保存新内容，请导出当前备份后刷新，避免覆盖。');

export function readConfig(env) {
  const hourlyLimit = Number(env.MINGDAN_AI_HOURLY_LIMIT || 200);
  if (!Number.isInteger(hourlyLimit) || hourlyLimit < 1 || hourlyLimit > 1000) throw new AppError(503, 'INVALID_CONFIG', 'AI 调用限制配置无效，请在站点设置中检查。');
  const integer = (name, fallback, max, min = 0) => { const value = Number(env[name] ?? fallback); if (!Number.isInteger(value) || value < min || value > max) throw new AppError(503, 'INVALID_CONFIG', '使用限制配置无效，请联系管理者。'); return value; };
  const budget = Number(env.MINGDAN_AI_MONTHLY_BUDGET_CNY ?? 0);
  if (!Number.isFinite(budget) || budget < 0 || budget > 1000000) throw new AppError(503, 'INVALID_CONFIG', 'AI 月预算配置无效；0 表示不设置预算上限。');
  const registrationMode = env.MINGDAN_REGISTRATION_MODE || 'public';
  if (!['public', 'invite'].includes(registrationMode)) throw new AppError(503, 'INVALID_CONFIG', '注册模式配置无效。');
  return { adminPassword: env.MINGDAN_ADMIN_PASSWORD || '', publicUrl: (env.MINGDAN_PUBLIC_URL || '').replace(/\/$/, ''), aiHourlyLimit: hourlyLimit,
    registrationMode, betaMaxUsers: integer('MINGDAN_BETA_MAX_USERS', 0, 1000000), userDailyLimit: integer('MINGDAN_AI_USER_DAILY_LIMIT', 0, 100000),
    userMonthlyLimit: integer('MINGDAN_AI_USER_MONTHLY_LIMIT', 0, 1000000), userMinuteLimit: integer('MINGDAN_AI_USER_MINUTE_LIMIT', 2, 60, 1),
    monthlyBudgetUnits: Math.floor(budget * CNY_UNITS), maxTextLength: 8000,
    ai: { provider: 'deepseek', apiKey: env.DEEPSEEK_API_KEY || '', model: env.DEEPSEEK_MODEL || 'deepseek-flash', baseUrl: 'https://api.deepseek.com', maxOutputTokens: 4096 } };
}

async function adminRoute(request, store, config, origin) {
  const path = new URL(request.url).pathname, now = store.clock();
  if (path === '/api/admin/overview' && request.method === 'GET') {
    const month = calendarStart(now, true);
    const { results: users } = await store.statement(`SELECT u.id,u.email,u.name,u.status,u.created_at,u.last_login_at,
      COALESCE(json_array_length(w.data,'$.orders'),0) AS order_count,
      (SELECT COALESCE(SUM(json_array_length(o.value,'$.versions')),0) FROM json_each(w.data,'$.orders') AS o) AS version_count,
      (SELECT COUNT(*) FROM ai_calls WHERE user_id=u.id AND started_at>=?) AS ai_calls,
      (SELECT COALESCE(SUM(charged_units),0) FROM ai_calls WHERE user_id=u.id AND started_at>=?) AS cost_units
      FROM users u LEFT JOIN workspaces w ON w.user_id=u.id WHERE u.role='designer' ORDER BY u.created_at DESC LIMIT 200`, month, month).all();
    const total = await store.first("SELECT COUNT(*) AS count FROM users WHERE role='designer'");
    const { results: invites } = await store.statement('SELECT id,email,purpose,status,created_at,expires_at FROM invites ORDER BY created_at DESC LIMIT 50').all();
    const { results: feedback } = await store.statement('SELECT f.id,f.category,f.text,f.created_at,u.name FROM feedback f JOIN users u ON u.id=f.user_id ORDER BY f.created_at DESC LIMIT 50').all();
    return json(200, { users, userCount: total.count, invites, feedback, policy: await store.policy(), registrationMode: config.registrationMode, maxUsers: config.betaMaxUsers, usage: await usageSummary(store, config, 'owner') });
  }
  if (path === '/api/admin/invites' && request.method === 'POST') {
    const input = await body(request), email = normalizeEmail(input.email), purpose = input.purpose === 'recovery' ? 'recovery' : 'signup';
    await store.throttle('admin-invites', 30, 3600000);
    const target = purpose === 'recovery' ? await store.first("SELECT id FROM users WHERE email=? AND role='designer' AND status='active'", email) : null;
    if (purpose === 'recovery' && !target) throw new AppError(404, 'ACCOUNT_NOT_FOUND', '该设计师账号不存在或已暂停。');
    if (purpose === 'signup' && await store.first('SELECT id FROM users WHERE email=?', email)) throw new AppError(409, 'ACCOUNT_EXISTS', '该邮箱已注册，请使用账号恢复入口。');
    await store.run("UPDATE invites SET status='expired' WHERE status='pending' AND expires_at<=?", now);
    const id = randomBytes(16).toString('hex'), token = randomBytes(32).toString('base64url');
    const expires = now + (purpose === 'signup' ? 7 * 86400000 : 86400000);
    const result = await store.run(`INSERT INTO invites (id,token_hash,email,purpose,target_user_id,status,created_at,expires_at)
      SELECT ?,?,?,?,?,'pending',?,? WHERE NOT EXISTS (SELECT 1 FROM invites WHERE email=? AND purpose=? AND status='pending' AND expires_at>?)
      AND (?='recovery' OR ?=0 OR (SELECT COUNT(*) FROM users WHERE role='designer')+(SELECT COUNT(*) FROM invites WHERE purpose='signup' AND status='pending' AND expires_at>?)<?)
      AND (?='recovery' OR EXISTS (SELECT 1 FROM beta_settings WHERE id=1 AND registration_enabled=1))`,
      id, hash(token), email, purpose, target?.id || null, now, expires, email, purpose, now, purpose, config.betaMaxUsers, now, config.betaMaxUsers, purpose);
    if (!result.meta.changes) throw new AppError(409, 'INVITE_UNAVAILABLE', '已有有效邀请、内测名额已满或注册已暂停。请先检查邀请记录。');
    return json(201, { id, email, purpose, expiresAt: new Date(expires).toISOString(), url: `${config.publicUrl || origin}/prototype/account.html#${purpose === 'signup' ? 'invite' : 'recover'}=${token}` });
  }
  const revoke = path.match(/^\/api\/admin\/invites\/([a-f0-9]{32})\/revoke$/);
  if (revoke && request.method === 'POST') {
    const result = await store.run("UPDATE invites SET status='revoked' WHERE id=? AND status='pending'", revoke[1]);
    if (!result.meta.changes) throw new AppError(409, 'INVITE_CLOSED', '邀请已使用或失效。');
    return json(200, { ok: true });
  }
  const account = path.match(/^\/api\/admin\/users\/([a-f0-9]{32})$/);
  if (account && request.method === 'POST') {
    const input = await body(request);
    if (!['active', 'paused'].includes(input.status)) throw new AppError(400, 'INVALID_STATUS', '账号状态无效。');
    const result = await store.run("UPDATE users SET status=? WHERE id=? AND role='designer'", input.status, account[1]);
    if (!result.meta.changes) throw new AppError(404, 'ACCOUNT_NOT_FOUND', '设计师账号不存在。');
    if (input.status === 'paused') await store.run('DELETE FROM sessions WHERE user_id=?', account[1]);
    return json(200, { ok: true });
  }
  if (path === '/api/admin/settings' && request.method === 'POST') {
    const input = await body(request);
    if (typeof input.aiEnabled !== 'boolean' || typeof input.registrationEnabled !== 'boolean') throw new AppError(400, 'INVALID_POLICY', '请检查内测开关状态。');
    await store.run('UPDATE beta_settings SET ai_enabled=?,registration_enabled=? WHERE id=1', Number(input.aiEnabled), Number(input.registrationEnabled));
    return json(200, { ok: true });
  }
  throw new AppError(404, 'NOT_FOUND', '管理接口不存在。');
}

async function body(request, maxLength = 5 * 1024 * 1024) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AppError(415, 'INVALID_CONTENT_TYPE', '请以 JSON 格式提交。');
  const reader = request.body?.getReader(), chunks = [];
  let length = 0;
  if (!reader) throw new AppError(400, 'INVALID_JSON', '请求内容格式无效。');
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxLength) { await reader.cancel(); throw new AppError(413, 'BODY_TOO_LARGE', '提交的数据过大，请减少内容后重试。'); }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
    return value;
  }
  catch { throw new AppError(400, 'INVALID_JSON', '请求内容格式无效。'); }
}

function createStore(db, config, origin, clock, userId) {
  const statement = (sql, ...params) => db.prepare(sql).bind(...params);
  const first = (sql, ...params) => statement(sql, ...params).first();
  const run = (sql, ...params) => statement(sql, ...params).run();
  const stored = () => first('SELECT revision,data FROM workspaces WHERE user_id=?', userId);
  const latestShare = (orderId, versionId) => first('SELECT * FROM shares WHERE user_id=? AND order_id=? AND version_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1', userId, orderId, versionId);
  const policy = () => first('SELECT ai_enabled,registration_enabled FROM beta_settings WHERE id=1');
  const effectiveStatus = share => ['pending', 'changes_requested'].includes(share.status) && clock() > share.expires_at ? 'expired' : share.status;
  const shareInfo = share => ({ id: share.id, url: `${config.publicUrl || origin}/prototype/customer.html#${share.token}`, status: effectiveStatus(share),
    expiresAt: new Date(share.expires_at).toISOString(), response: share.response ? JSON.parse(share.response) : null });
  async function shareMap() {
    const { results } = await statement('SELECT id,token,order_id,version_id,status,expires_at,response FROM shares WHERE user_id=? ORDER BY created_at DESC,rowid DESC', userId).all();
    const latest = new Map();
    for (const share of results) { const key = `${share.order_id}:${share.version_id}`; if (!latest.has(key)) latest.set(key, share); }
    return latest;
  }
  async function overlay(workspace) {
    const copy = clone(workspace), latest = await shareMap();
    for (const order of copy.orders) for (const version of order.versions) {
      const share = latest.get(`${order.id}:${version.id}`);
      if (!share) continue;
      version.share = shareInfo(share);
      version.status = share.status === 'confirmed' ? 'client-confirmed' : 'designer-reviewed';
      version.confirmationMode = share.status === 'confirmed' ? 'online' : '';
      version.confirmationEvidence = ''; version.confirmedAt = '';
      if (share.status === 'confirmed') {
        const response = JSON.parse(share.response);
        version.confirmedAt = response.respondedAt;
        version.confirmationEvidence = `客户通过确认页面提交：${response.name}${response.comment ? `；${response.comment}` : ''}`;
      }
    }
    return copy;
  }
  function publicSnapshot(share) {
    const version = JSON.parse(share.snapshot);
    return { title: version.orderTitle, clientName: version.clientName || '', number: version.number,
      items: version.items.map(item => ({ name: item.name, quantity: item.quantity, specification: item.specification || '', amount: item.amount })),
      total: version.total, feeAdjustments: (version.feeAdjustments || []).map(item => ({ label: item.label, amount: item.amount })),
      conditions: version.conditions ? version.conditions.map(item => ({ title: item.title, value: item.value })) : Object.entries(version.answers || {}).map(([id, value]) => ({ title: ({ delivery: '交付时间', revisions: '修改约定', sourceFile: '文件交付', sizes: '交付规格' })[id] || id, value })),
      change: version.change ? { baseVersion: version.change.baseVersion, description: version.change.description, delta: version.change.delta, scheduleText: version.change.scheduleText } : null,
      status: effectiveStatus(share), digest: share.digest, expiresAt: new Date(share.expires_at).toISOString(), response: share.response ? JSON.parse(share.response) : null };
  }
  async function throttle(key, limit, windowMs) {
    const now = clock();
    const row = await first(`INSERT INTO rate_limits (key,started_at,count) VALUES (?,?,1)
      ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN rate_limits.started_at<=? THEN 1 ELSE rate_limits.count+1 END,
      started_at=CASE WHEN rate_limits.started_at<=? THEN excluded.started_at ELSE rate_limits.started_at END
      RETURNING count`, key, now, now - windowMs, now - windowMs);
    if (row.count > limit) throw new AppError(429, 'TOO_MANY_REQUESTS', '请求过于频繁，请稍后重试。');
  }
  return { db, clock, statement, first, run, stored, latestShare, effectiveStatus, shareInfo, shareMap, overlay, publicSnapshot, throttle, policy };
}

export async function handleAPI(request, env, { fetchImpl = fetch, clock = Date.now } = {}) {
  const url = new URL(request.url), origin = url.origin;
  try {
    const config = readConfig(env);
    if (!['GET', 'HEAD'].includes(request.method) &&
      (request.headers.get('sec-fetch-site') === 'cross-site' || request.headers.get('origin') && ![origin, config.publicUrl].includes(request.headers.get('origin')))) {
      throw new AppError(403, 'INVALID_ORIGIN', '请求来源无效。');
    }
    if (url.pathname === '/api/health' && request.method === 'GET') return json(200, { app: 'mingdan', stage: 4, hosting: 'sites' });
    if (!env.DB) throw new AppError(503, 'STORAGE_NOT_CONFIGURED', '数据保存尚未就绪，请检查站点部署状态。');
    const user = await getSessionUser(request, env.DB, clock);
    const store = createStore(env.DB, config, origin, clock, user?.id);
    const { first, run, stored, overlay, latestShare, effectiveStatus, shareInfo } = store;
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (url.pathname === '/api/auth-options' && request.method === 'GET') {
      const policy = await store.policy();
      return json(200, { registrationMode: config.registrationMode, registrationEnabled: Boolean(policy.registration_enabled) });
    }
    if (['/api/login', '/api/logout', '/api/register', '/api/recover'].includes(url.pathname) && request.method === 'POST') {
      if (url.pathname === '/api/logout' && user && request.headers.get('X-Mingdan-Account') !== user.id) throw new AppError(409, 'ACCOUNT_CHANGED', '当前账号已改变，请重新打开登录页。');
      const result = await accountRoute(request, url.pathname, await body(request, 8192), store, config, ip);
      return json(200, result.data, { 'Set-Cookie': result.cookie });
    }
    if (url.pathname === '/api/account-bootstrap.js' && request.method === 'GET') {
      const script = user ? `window.MingdanAccount=${JSON.stringify(publicUser(user))};` : 'location.replace("/prototype/account.html");';
      return new Response(script, { headers: { ...securityHeaders, 'Content-Type': 'text/javascript; charset=utf-8' } });
    }
    const customerMatch = url.pathname.match(/^\/api\/customer\/([A-Za-z0-9_-]{43})$/);
    if (customerMatch) {
      const share = await first('SELECT * FROM shares WHERE token=?', customerMatch[1]);
      if (!share) throw new AppError(404, 'SHARE_NOT_FOUND', '确认链接不存在，请向设计师索取新链接。');
      if (request.method === 'GET') return json(200, store.publicSnapshot(share));
      if (request.method === 'POST') {
        await store.throttle(`reply:${hash(ip)}:${share.id}`, 20, 600000);
        if (effectiveStatus(share) !== 'pending') throw new AppError(409, 'SHARE_CLOSED', closedMessage);
        const input = await body(request);
        if (!['confirm', 'changes'].includes(input.action) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || typeof input.comment !== 'string' || input.comment.length > 3000 || input.action === 'changes' && !input.comment.trim() || input.digest !== share.digest || input.reviewed !== true) throw new AppError(400, 'INVALID_RESPONSE', '请填写称呼，核对清单，并填写需要调整的内容。');
        const response = { action: input.action, name: input.name.trim(), comment: input.comment.trim(), respondedAt: new Date(clock()).toISOString() };
        const status = input.action === 'confirm' ? 'confirmed' : 'changes_requested';
        const result = await run('UPDATE shares SET status=?,response=? WHERE id=? AND status=? AND expires_at>=? AND digest=?', status, JSON.stringify(response), share.id, 'pending', clock(), input.digest);
        if (!result.meta.changes) throw new AppError(409, 'SHARE_CLOSED', closedMessage);
        return json(200, { ok: true, status, response });
      }
    }
    if (!user) throw new AppError(401, 'LOGIN_REQUIRED', '请先登录你的设计师账号。');
    if ((url.pathname !== '/api/me' || request.headers.has('x-mingdan-account')) && request.headers.get('x-mingdan-account') !== user.id) throw new AppError(409, 'ACCOUNT_CHANGED', '账号已切换或页面版本过旧，请重新打开工作台。当前草稿仍保留在原账号。');
    if (url.pathname === '/api/me' && request.method === 'GET') return json(200, { user: publicUser(user), usage: await usageSummary(store, config, user.id) });
    if (url.pathname === '/api/status' && request.method === 'GET') return json(200, { stage: 'beta', hosting: 'sites', user: publicUser(user), aiConfigured: Boolean(config.ai.apiKey), provider: config.ai.provider, model: config.ai.model, localOnly: false, publicUrl: config.publicUrl || origin, aiUsage: await usageSummary(store, config, user.id) });
    if (url.pathname.startsWith('/api/admin/')) {
      if (user.role !== 'owner') throw new AppError(403, 'ADMIN_REQUIRED', '此操作仅限管理者。');
      return await adminRoute(request, store, config, origin);
    }
    if (url.pathname === '/api/account/recovery-key' && request.method === 'POST') {
      if (user.role !== 'designer') throw new AppError(403, 'DESIGNER_REQUIRED', '管理者请使用原管理密码入口。');
      await store.throttle(`recovery-key:${user.id}`, 5, 3600000);
      const input = await body(request), member = await first('SELECT password_hash FROM users WHERE id=?', user.id);
      if (!await verifyPassword(input.password, member?.password_hash)) throw new AppError(401, 'PASSWORD_REQUIRED', '当前密码不正确，恢复密钥未更改。');
      const recoveryKey = randomBytes(32).toString('base64url');
      const result = await run("UPDATE users SET recovery_key_hash=? WHERE id=? AND status='active' AND password_hash=?", hash(recoveryKey), user.id, member.password_hash);
      if (!result.meta.changes) throw new AppError(409, 'ACCOUNT_CHANGED', '账号状态已改变，请重新登录。');
      return json(200, { recoveryKey });
    }
    if (url.pathname === '/api/feedback' && request.method === 'POST') {
      await store.throttle(`feedback:${user.id}`, 5, 3600000);
      const input = await body(request);
      if (!['usability', 'extraction', 'pricing', 'bug', 'suggestion'].includes(input.category) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000) throw new AppError(400, 'INVALID_FEEDBACK', '请选择反馈类型，并填写 1—2000 字说明。');
      await run('INSERT INTO feedback (id,user_id,category,text,created_at) VALUES (?,?,?,?,?)', randomBytes(16).toString('hex'), user.id, input.category, input.text.trim(), clock());
      return json(201, { ok: true });
    }
    if (url.pathname === '/api/workspace' && request.method === 'GET') {
      const row = await stored(); return json(200, { revision: row?.revision || 0, workspace: row ? await overlay(JSON.parse(row.data)) : null });
    }
    if (url.pathname === '/api/workspace' && request.method === 'PUT') {
      await store.throttle(`save:${user.id}`, 60, 60000);
      const input = await body(request); validateWorkspace(input.workspace);
      const row = await stored();
      if (!Number.isInteger(input.revision) || input.revision !== (row?.revision || 0)) throw conflict();
      const old = row ? JSON.parse(row.data) : null, next = clone(input.workspace);
      for (const order of old?.orders || []) {
        const nextOrder = next.orders.find(item => item.id === order.id);
        if (!nextOrder && order.versions.length) throw new AppError(409, 'IMMUTABLE_VERSION', '已保存报价的订单不能从工作区移除。');
        for (const version of order.versions) {
          const candidate = nextOrder?.versions.find(item => item.id === version.id);
          if (!candidate || versionContent(candidate) !== versionContent(version)) throw new AppError(409, 'IMMUTABLE_VERSION', '已保存的需求与报价不能改写，请新建版本。');
        }
      }
      const shares = await store.shareMap();
      for (const order of next.orders) for (const version of order.versions) {
        const share = shares.get(`${order.id}:${version.id}`), previous = old?.orders.find(item => item.id === order.id)?.versions.find(item => item.id === version.id);
        if (!share && version.status === 'client-confirmed' && previous?.status !== 'client-confirmed' && (version.confirmationMode !== 'manual' || !version.confirmationEvidence?.trim())) throw new AppError(400, 'INVALID_CONFIRMATION', '客户在线确认必须通过客户页面提交。线下确认须明确记录实际依据。');
        if (share) { version.status = 'designer-reviewed'; version.confirmationMode = ''; version.confirmationEvidence = ''; version.confirmedAt = ''; }
        delete version.share;
        if (version.status !== 'draft' && version.issues.length) throw new AppError(400, 'UNRESOLVED_VERSION', '存在待确认事项的报价不能标记已审核。');
      }
      const revision = input.revision + 1;
      const result = await run(`INSERT INTO workspaces (user_id,revision,data,mutation_token) VALUES (?,?,?,'')
        ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,data=excluded.data,mutation_token='' WHERE workspaces.revision=?`, user.id, revision, JSON.stringify(next), input.revision);
      if (!result.meta.changes) throw conflict();
      return json(200, { revision });
    }
    if (url.pathname === '/api/analyze' && request.method === 'POST') {
      const input = await body(request);
      if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > config.maxTextLength) throw new AppError(400, 'INVALID_INPUT', `内测期间每次 AI 整理支持 1—${config.maxTextLength} 字；可以分段核对或手动整理。`);
      return json(200, await meteredAI(store, config, user.id, 'brief', (ai, measuredFetch) => analyzeWithAI(input.text, input.messageDate, ai, measuredFetch), fetchImpl));
    }
    if (url.pathname === '/api/pricing/history' && request.method === 'GET') {
      const row = await stored(), workspace = row && await overlay(JSON.parse(row.data)), order = workspace?.orders.find(item => item.id === url.searchParams.get('orderId'));
      if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', '订单不存在。');
      return json(200, { revision: row.revision, records: localHistory(workspace, order) });
    }
    if (url.pathname === '/api/pricing/advice' && request.method === 'POST') {
      const input = await body(request), row = await stored();
      if (!row || input.revision !== row.revision) throw conflict();
      const workspace = await overlay(JSON.parse(row.data)), order = workspace.orders.find(item => item.id === input.orderId);
      if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', '订单不存在。');
      const context = pricingContext(workspace, order, input.mode);
      return json(200, await meteredAI(store, config, user.id, `pricing-${input.mode}`, async (ai, measuredFetch) => {
        const advice = await advisePricing(context, ai, measuredFetch);
        if ((await stored()).revision !== row.revision) throw conflict();
        return { revision: row.revision, orderId: order.id, mode: input.mode, baseVersionId: context.base?.id || null, ...advice };
      }, fetchImpl));
    }
    if (url.pathname === '/api/shares' && request.method === 'POST') {
      const input = await body(request), row = await stored(), workspace = row && JSON.parse(row.data);
      const order = workspace?.orders.find(item => item.id === input.orderId), version = order?.versions.find(item => item.id === input.versionId);
      if (!version || version !== order.versions.at(-1)) throw new AppError(400, 'INVALID_SHARE_VERSION', '只可发送当前订单最新的报价版本。');
      validateVersion(version);
      if (version.status !== 'designer-reviewed' || version.issues.length || version.conditions?.some(item => item.required && (!item.value.trim() || /待确认|未确认|不确定|还没定/.test(item.value)))) throw new AppError(400, 'UNREVIEWED_VERSION', '请先处理待确认事项并完成设计师审核。');
      const existing = await latestShare(order.id, version.id);
      if (existing && ['pending', 'confirmed', 'changes_requested'].includes(effectiveStatus(existing))) return json(200, shareInfo(existing));
      const id = randomBytes(16).toString('hex'), token = randomBytes(32).toString('base64url'), now = clock();
      // The batch owns a revision-bound marker. Later statements cannot commit if the workspace changed.
      const results = await env.DB.batch([
        store.statement('UPDATE workspaces SET mutation_token=? WHERE user_id=? AND revision=?', id, user.id, row.revision),
        store.statement(`UPDATE shares SET status='superseded' WHERE user_id=? AND order_id=? AND status IN ('pending','changes_requested')
          AND EXISTS (SELECT 1 FROM workspaces WHERE user_id=? AND mutation_token=?)
          AND NOT EXISTS (SELECT 1 FROM shares WHERE user_id=? AND order_id=? AND version_id=? AND (status='confirmed' OR status IN ('pending','changes_requested') AND expires_at>=?))`, user.id, order.id, user.id, id, user.id, order.id, version.id, now),
        store.statement(`INSERT INTO shares (id,token,user_id,order_id,version_id,snapshot,digest,status,created_at,expires_at)
          SELECT ?,?,?,?,?,?,?,'pending',?,? WHERE EXISTS (SELECT 1 FROM workspaces WHERE user_id=? AND mutation_token=?)
          AND NOT EXISTS (SELECT 1 FROM shares WHERE user_id=? AND order_id=? AND version_id=? AND (status='confirmed' OR status IN ('pending','changes_requested') AND expires_at>=?))`, id, token, user.id, order.id, version.id, JSON.stringify(version), hash(versionContent(version)), now, now + 7 * 86400000, user.id, id, user.id, order.id, version.id, now),
      ]);
      if (!results[0].meta.changes) throw conflict();
      const share = await latestShare(order.id, version.id);
      if (!share) throw conflict();
      return json(share.id === id ? 201 : 200, shareInfo(share));
    }
    const revokeMatch = url.pathname.match(/^\/api\/shares\/([a-f0-9]{32})\/revoke$/);
    if (revokeMatch && request.method === 'POST') {
      if (!(await first('SELECT id FROM shares WHERE id=? AND user_id=?', revokeMatch[1], user.id))) throw new AppError(404, 'SHARE_NOT_FOUND', '确认链接不存在。');
      const result = await run("UPDATE shares SET status='revoked' WHERE id=? AND user_id=? AND status IN ('pending','changes_requested')", revokeMatch[1], user.id);
      if (!result.meta.changes) throw new AppError(409, 'SHARE_CLOSED', '已确认或已失效的链接不能撤回。');
      return json(200, { ok: true });
    }
    throw new AppError(404, 'NOT_FOUND', '接口不存在。');
  } catch (error) {
    return json(error instanceof AppError ? error.status : 500, { code: error instanceof AppError ? error.code : 'INTERNAL_ERROR', message: error instanceof AppError ? error.message : '服务暂时无法处理，请稍后重试。' });
  }
}
