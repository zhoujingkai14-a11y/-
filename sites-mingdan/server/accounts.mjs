import { randomBytes, createHash, timingSafeEqual, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError } from './ai.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
const derive = promisify(scrypt);
export const publicUser = user => ({ id: user.id, email: user.email, name: user.name, role: user.role });
export const sessionToken = request => request.headers.get('cookie')?.match(/(?:^|;\s*)mingdan_session=([A-Za-z0-9_-]{43})/)?.[1];
export const sessionCookie = (token, url) => `mingdan_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 86400 : 0}${new URL(url).protocol === 'https:' ? '; Secure' : ''}`;

export function normalizeEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new AppError(400, 'INVALID_EMAIL', '请输入有效的邮箱地址。');
  return value.trim().toLowerCase();
}
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new AppError(400, 'INVALID_PASSWORD', '密码须为 12—128 个字符。');
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 32, { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 });
  return `scrypt:16384:8:5:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const parts = stored?.split(':');
  if (parts?.length !== 6 || parts[0] !== 'scrypt' || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{64}$/.test(parts[5])) return false;
  const key = await derive(password, parts[4], 32, { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 });
  return timingSafeEqual(key, Buffer.from(parts[5], 'hex'));
}
export async function getSessionUser(request, db, clock = Date.now) {
  const token = sessionToken(request);
  if (!token || !db) return null;
  return db.prepare(`SELECT users.id,users.email,users.name,users.role FROM sessions JOIN users ON users.id=sessions.user_id
    WHERE sessions.token_hash=? AND sessions.expires_at>? AND users.status='active'`).bind(hash(token), clock()).first();
}

export async function accountRoute(request, path, input, store, config, ip) {
  const { first, run, statement, db, clock } = store;
  if (path === '/api/logout') {
    const token = sessionToken(request);
    if (token) await run('DELETE FROM sessions WHERE token_hash=?', hash(token));
    return { data: { ok: true }, cookie: sessionCookie('', request.url) };
  }
  await store.throttle(`auth:${hash(ip)}`, 10, 600000);
  const token = randomBytes(32).toString('base64url'), now = clock();
  if (path === '/api/login') {
    let user;
    if (!input.email) {
      if (config.adminPassword.length < 12) throw new AppError(503, 'OWNER_NOT_CONFIGURED', '管理者入口尚未配置。');
      if (typeof input.password === 'string' && input.password.length <= 1000 && timingSafeEqual(Buffer.from(hash(input.password)), Buffer.from(hash(config.adminPassword)))) user = await first("SELECT * FROM users WHERE id='owner' AND status='active'");
    } else {
      const email = normalizeEmail(input.email);
      await store.throttle(`login:${hash(email)}`, 10, 600000);
      const candidate = await first("SELECT * FROM users WHERE email=? AND role='designer' AND status='active'", email);
      if (await verifyPassword(input.password, candidate?.password_hash)) user = candidate;
      // Keep unknown-account attempts comparable to normal password verification.
      if (!candidate && typeof input.password === 'string' && input.password.length >= 12 && input.password.length <= 128) await passwordHash(input.password);
    }
    if (!user) throw new AppError(401, 'LOGIN_FAILED', '账号或密码不正确，或账号已暂停。');
    await run('INSERT INTO sessions (token_hash,expires_at,user_id) VALUES (?,?,?)', hash(token), now + 86400000, user.id);
    await run('UPDATE users SET last_login_at=? WHERE id=?', now, user.id);
    return { data: { ok: true, user: publicUser(user) }, cookie: sessionCookie(token, request.url) };
  }
  const email = normalizeEmail(input.email);
  const recoveryKey = randomBytes(32).toString('base64url');
  if (path === '/api/register' && !input.token && config.registrationMode === 'public') {
    const policy = await store.policy();
    if (!policy.registration_enabled) throw new AppError(403, 'REGISTRATION_PAUSED', '新账号注册暂时暂停，已有账号仍可登录。');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 40 || input.aiConsent !== true || input.website) throw new AppError(400, 'INVALID_REGISTRATION', '请填写称呼，并确认了解 AI 消息处理方式。');
    await store.throttle(`signup:${hash(ip)}`, 5, 3600000);
    await store.throttle('signup-global', 100, 3600000);
    const encoded = await passwordHash(input.password), id = randomBytes(16).toString('hex');
    const results = await db.batch([
      statement(`INSERT INTO users (id,email,name,password_hash,recovery_key_hash,role,status,created_at,last_login_at,ai_consent_at)
        SELECT ?,?,?,?,?,'designer','active',?,?,? WHERE NOT EXISTS (SELECT 1 FROM users WHERE email=?)
        AND (?=0 OR (SELECT COUNT(*) FROM users WHERE role='designer')<?)
        AND EXISTS (SELECT 1 FROM beta_settings WHERE id=1 AND registration_enabled=1)`, id, email, input.name.trim(), encoded, hash(recoveryKey), now, now, now, email, config.betaMaxUsers, config.betaMaxUsers),
      statement('INSERT INTO sessions (token_hash,expires_at,user_id) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=?)', hash(token), now + 86400000, id, id),
    ]);
    if (!results[0].meta.changes) throw new AppError(409, 'REGISTRATION_UNAVAILABLE', '该邮箱已注册或注册暂不可用。已有账号可直接登录。');
    return { data: { ok: true, user: publicUser(await first('SELECT * FROM users WHERE id=?', id)), recoveryKey }, cookie: sessionCookie(token, request.url) };
  }
  if (path === '/api/recover' && !input.token) {
    await store.throttle(`recover:${hash(email)}`, 5, 3600000);
    if (typeof input.recoveryKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.recoveryKey)) throw new AppError(400, 'INVALID_RECOVERY', '请填写注册时保存的完整恢复密钥。');
    const candidate = await first("SELECT id FROM users WHERE email=? AND role='designer' AND status='active' AND recovery_key_hash=?", email, hash(input.recoveryKey));
    if (!candidate) throw new AppError(400, 'INVALID_RECOVERY', '邮箱或恢复密钥不正确，或账号已暂停。');
    const encoded = await passwordHash(input.password);
    const results = await db.batch([
      statement("UPDATE users SET password_hash=?,recovery_key_hash=? WHERE id=? AND status='active' AND recovery_key_hash=?", encoded, hash(recoveryKey), candidate.id, hash(input.recoveryKey)),
      statement('DELETE FROM sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM users WHERE id=? AND recovery_key_hash=?)', candidate.id, candidate.id, hash(recoveryKey)),
      statement('INSERT INTO sessions (token_hash,expires_at,user_id) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND recovery_key_hash=?)', hash(token), now + 86400000, candidate.id, candidate.id, hash(recoveryKey)),
    ]);
    if (!results[0].meta.changes) throw new AppError(400, 'INVALID_RECOVERY', '恢复密钥已失效，请使用最近保存的密钥。');
    return { data: { ok: true, user: publicUser(await first('SELECT * FROM users WHERE id=?', candidate.id)), recoveryKey }, cookie: sessionCookie(token, request.url) };
  }
  if (typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw new AppError(400, 'INVALID_INVITE', '邀请链接无效，请向管理者索取新链接。');
  const invite = await first("SELECT * FROM invites WHERE token_hash=? AND email=? AND status='pending' AND expires_at>?", hash(input.token), email, now);
  const purpose = path === '/api/register' ? 'signup' : 'recovery';
  if (!invite || invite.purpose !== purpose) throw new AppError(400, 'INVALID_INVITE', '邀请链接无效、已使用或已过期，请联系管理者。');
  const policy = await store.policy();
  if (purpose === 'signup' && !policy.registration_enabled) throw new AppError(403, 'REGISTRATION_PAUSED', '本轮内测暂时停止注册，已有账号仍可使用。');
  const encoded = await passwordHash(input.password);
  let user;
  if (purpose === 'signup') {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 40 || input.aiConsent !== true) throw new AppError(400, 'INVALID_REGISTRATION', '请填写称呼，并确认了解 AI 消息处理方式。');
    const id = randomBytes(16).toString('hex');
    const results = await db.batch([
      statement(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,last_login_at,ai_consent_at)
        SELECT ?,?,?,?,'designer','active',?,?,? WHERE EXISTS (SELECT 1 FROM invites WHERE id=? AND status='pending' AND expires_at>?)
        AND NOT EXISTS (SELECT 1 FROM users WHERE email=?) AND (?=0 OR (SELECT COUNT(*) FROM users WHERE role='designer')<?)
        AND EXISTS (SELECT 1 FROM beta_settings WHERE id=1 AND registration_enabled=1)`, id, email, input.name.trim(), encoded, now, now, now, invite.id, now, email, config.betaMaxUsers, config.betaMaxUsers),
      statement("UPDATE invites SET status='used',used_by=? WHERE id=? AND status='pending' AND EXISTS (SELECT 1 FROM users WHERE id=?)", id, invite.id, id),
      statement('INSERT INTO sessions (token_hash,expires_at,user_id) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=?)', hash(token), now + 86400000, id, id),
    ]);
    if (!results[0].meta.changes) throw new AppError(409, 'REGISTRATION_UNAVAILABLE', '该邮箱已注册、邀请已使用或本轮名额已满。已有账号可直接登录。');
    user = await first('SELECT * FROM users WHERE id=?', id);
  } else {
    const results = await db.batch([
      statement(`UPDATE users SET password_hash=? WHERE id=? AND status='active' AND EXISTS
        (SELECT 1 FROM invites WHERE id=? AND purpose='recovery' AND status='pending' AND expires_at>?)`, encoded, invite.target_user_id, invite.id, now),
      statement("UPDATE invites SET status='used',used_by=? WHERE id=? AND status='pending' AND EXISTS (SELECT 1 FROM users WHERE id=? AND password_hash=?)", invite.target_user_id, invite.id, invite.target_user_id, encoded),
      statement('DELETE FROM sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM users WHERE id=? AND password_hash=?)', invite.target_user_id, invite.target_user_id, encoded),
      statement('INSERT INTO sessions (token_hash,expires_at,user_id) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND password_hash=?)', hash(token), now + 86400000, invite.target_user_id, invite.target_user_id, encoded),
    ]);
    if (!results[0].meta.changes) throw new AppError(400, 'INVALID_INVITE', '恢复链接已失效，请联系管理者。');
    user = await first('SELECT * FROM users WHERE id=?', invite.target_user_id);
  }
  await run('UPDATE users SET recovery_key_hash=? WHERE id=?', hash(recoveryKey), user.id);
  return { data: { ok: true, user: publicUser(user), recoveryKey }, cookie: sessionCookie(token, request.url) };
}
