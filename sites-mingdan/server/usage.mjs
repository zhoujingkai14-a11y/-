import { randomBytes } from 'node:crypto';
import { AppError } from './ai.mjs';

export const CNY_UNITS = 1000000;
export const PRICE_SOURCE = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/';
export const PRICE_DATE = '2026-10-02';
export const PRICE_REVIEW_AT = Date.parse('2026-11-02T00:00:00+08:00');
// Peak rates avoid assuming off-peak discounts or a holiday calendar.
export const FLASH_RATES = { cacheHit: 0.04, input: 2, output: 8 };
export function calendarStart(now, month = false) {
  const date = new Date(now + 8 * 3600000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), month ? 1 : date.getUTCDate()) - 8 * 3600000;
}
export function tokenUsage(value) {
  if (!value || !['prompt_tokens', 'completion_tokens'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)) return null;
  const input = value.prompt_tokens, output = value.completion_tokens;
  const hit = value.prompt_cache_hit_tokens ?? value.prompt_tokens_details?.cached_tokens ?? 0;
  if (!Number.isSafeInteger(hit) || hit < 0 || hit > input || input > 1000000 || output > 1000000) return null;
  return { input, output, hit, miss: input - hit };
}
export function usageCost(usage) {
  return Math.ceil(usage.hit * FLASH_RATES.cacheHit + usage.miss * FLASH_RATES.input + usage.output * FLASH_RATES.output);
}
export async function usageSummary(store, config, userId) {
  const now = store.clock(), day = calendarStart(now), month = calendarStart(now, true);
  const mine = await store.first(`SELECT COUNT(*) AS month_count,COALESCE(SUM(started_at>=?),0) AS day_count,
    COALESCE(SUM(charged_units),0) AS cost_units,COALESCE(SUM(prompt_tokens),0) AS input_tokens,
    COALESCE(SUM(completion_tokens),0) AS output_tokens,COALESCE(SUM(status='succeeded'),0) AS succeeded,
    COALESCE(SUM(status='failed'),0) AS failed,COALESCE(SUM(cost_kind='conservative'),0) AS unknown_usage
    FROM ai_calls WHERE user_id=? AND started_at>=?`, day, userId, month);
  const global = await store.first(`SELECT COALESCE(SUM(charged_units),0) AS cost_units,COUNT(*) AS calls,
    COALESCE(SUM(cost_kind='conservative'),0) AS unknown_usage FROM ai_calls WHERE started_at>=?`, month);
  const hour = await store.first('SELECT COUNT(*) AS count FROM ai_calls WHERE started_at>?', now - 3600000);
  const policy = await store.policy();
  return { dailyLimit: config.userDailyLimit, monthlyLimit: config.userMonthlyLimit, callsToday: mine.day_count, callsThisMonth: mine.month_count,
    dailyRemaining: config.userDailyLimit ? Math.max(0, config.userDailyLimit - mine.day_count) : null, monthlyRemaining: config.userMonthlyLimit ? Math.max(0, config.userMonthlyLimit - mine.month_count) : null,
    hourlyLimit: config.aiHourlyLimit, requestsThisHour: hour.count, remaining: Math.max(0, config.aiHourlyLimit - hour.count),
    inputTokens: mine.input_tokens, outputTokens: mine.output_tokens, succeeded: mine.succeeded, failed: mine.failed, conservativeCalls: mine.unknown_usage,
    estimatedCny: mine.cost_units / CNY_UNITS, paused: !policy.ai_enabled || Boolean(config.monthlyBudgetUnits && now >= PRICE_REVIEW_AT), priceReviewRequired: now >= PRICE_REVIEW_AT,
    userMinuteLimit: config.userMinuteLimit,
    siteBudget: { enabled: config.monthlyBudgetUnits > 0, limitCny: config.monthlyBudgetUnits ? config.monthlyBudgetUnits / CNY_UNITS : null, accountedCny: global.cost_units / CNY_UNITS,
      remainingCny: config.monthlyBudgetUnits ? Math.max(0, config.monthlyBudgetUnits - global.cost_units) / CNY_UNITS : null, conservativeCalls: global.unknown_usage },
    resetAt: new Date(calendarStart(now) + 86400000).toISOString(), model: config.ai.model, priceDate: PRICE_DATE,
    priceSource: PRICE_SOURCE, priceReviewAt: new Date(PRICE_REVIEW_AT).toISOString(), accounting: 'peak-rate-estimate', maxTextLength: config.maxTextLength };
}

export async function meteredAI(store, config, userId, purpose, action, fetchImpl) {
  if (!config.ai.apiKey) throw new AppError(503, 'AI_NOT_CONFIGURED', 'AI 暂未配置，可以先手动整理。');
  if (config.ai.model !== 'deepseek-flash') throw new AppError(503, 'UNPRICED_MODEL', '当前模型尚无经核对的预算价格，AI 已暂停，请联系管理者。');
  if (config.monthlyBudgetUnits && store.clock() >= PRICE_REVIEW_AT) throw new AppError(503, 'PRICE_REVIEW_REQUIRED', 'AI 价格需要重新核对，调用已暂停；已有订单和手动整理仍可使用。');
  const policy = await store.policy();
  if (!policy.ai_enabled) throw new AppError(429, 'AI_PAUSED', '本轮 AI 调用已暂停，已有草稿和手动整理仍可使用。');
  let reserved = false, captured = null, id;
  const measuredFetch = async (url, init) => {
    if (reserved) throw new AppError(502, 'AI_RETRY_BLOCKED', '本次 AI 请求未自动重试，请检查结果后再决定。');
    const payload = JSON.parse(init.body);
    const bytes = Buffer.byteLength(init.body, 'utf8');
    if (bytes > 64000 || payload.max_tokens !== config.ai.maxOutputTokens || payload.thinking?.type !== 'disabled') throw new AppError(400, 'AI_INPUT_LIMIT', 'AI 上下文过长，请缩短消息或报价参考资料；草稿已保留。');
    const reserve = Math.ceil((bytes + 2048) * FLASH_RATES.input + config.ai.maxOutputTokens * FLASH_RATES.output);
    const now = store.clock(), day = calendarStart(now), month = calendarStart(now, true);
    id = randomBytes(16).toString('hex');
    const result = await store.run(`INSERT INTO ai_calls (id,user_id,started_at,purpose,status,reserved_units,charged_units,cost_kind)
      SELECT ?,?,?,?,'running',?,?,'conservative' WHERE
      EXISTS (SELECT 1 FROM users WHERE id=? AND status='active') AND EXISTS (SELECT 1 FROM beta_settings WHERE id=1 AND ai_enabled=1)
      AND (?=0 OR (SELECT COUNT(*) FROM ai_calls WHERE user_id=? AND started_at>=?)<?)
      AND (?=0 OR (SELECT COUNT(*) FROM ai_calls WHERE user_id=? AND started_at>=?)<?)
      AND (SELECT COUNT(*) FROM ai_calls WHERE user_id=? AND started_at>?)<?
      AND (SELECT COUNT(*) FROM ai_calls WHERE started_at>?)<?
      AND (?=0 OR (SELECT COALESCE(SUM(charged_units),0) FROM ai_calls WHERE started_at>=?)+?<=?)
      AND (SELECT COUNT(*) FROM ai_calls WHERE status='running' AND started_at>?)<4
      AND (SELECT COUNT(*) FROM ai_calls WHERE user_id=? AND status='running' AND started_at>?)<1`,
    id, userId, now, purpose, reserve, reserve, userId,
    config.userDailyLimit, userId, day, config.userDailyLimit, config.userMonthlyLimit, userId, month, config.userMonthlyLimit,
    userId, now - 60000, config.userMinuteLimit, now - 3600000, config.aiHourlyLimit, config.monthlyBudgetUnits, month, reserve, config.monthlyBudgetUnits,
    now - 120000, userId, now - 120000);
    if (!result.meta.changes) {
      const summary = await usageSummary(store, config, userId);
      if (summary.paused) throw new AppError(429, 'AI_PAUSED', '本轮 AI 调用已暂停，可继续手动整理。');
      if (summary.dailyRemaining === 0 || summary.monthlyRemaining === 0) throw new AppError(429, 'USER_AI_LIMIT', '你的 AI 次数额度已用完，现有订单和手动整理仍可使用。');
      if (summary.siteBudget.enabled && summary.siteBudget.remainingCny * CNY_UNITS < reserve) throw new AppError(429, 'AI_BUDGET_LIMIT', '本轮 AI 预算不足以覆盖下一次调用，已暂停调用；草稿已保留。');
      const minute = await store.first('SELECT COUNT(*) AS count FROM ai_calls WHERE user_id=? AND started_at>?', userId, now - 60000);
      if (minute.count >= config.userMinuteLimit) throw new AppError(429, 'AI_RATE_LIMIT', 'AI 请求过于频繁，请等待一分钟后再试；草稿已保留。');
      if (!summary.remaining) throw new AppError(429, 'AI_USAGE_LIMIT', '已达到全站每小时调用限制，请稍后重试。');
      throw new AppError(429, 'AI_BUSY', '已有 AI 任务运行，请等待结果后重试。');
    }
    reserved = true;
    const response = await fetchImpl(url, init);
    try { captured = tokenUsage((await response.clone().json()).usage); } catch {}
    return response;
  };
  try {
    const result = await action({ ...config.ai }, measuredFetch);
    await settle('succeeded');
    return result;
  } catch (error) { await settle('failed'); throw error; }
  async function settle(status) {
    if (!reserved) return;
    if (captured) {
      const cost = usageCost(captured);
      await store.run(`UPDATE ai_calls SET status=?,charged_units=?,prompt_tokens=?,cache_hit_tokens=?,completion_tokens=?,cost_kind='measured' WHERE id=?`,
        status, cost, captured.input, captured.hit, captured.output, id);
      const row = await store.first('SELECT reserved_units FROM ai_calls WHERE id=?', id);
      if (config.monthlyBudgetUnits && cost > row.reserved_units) await store.run('UPDATE beta_settings SET ai_enabled=0 WHERE id=1');
    }
    else await store.run('UPDATE ai_calls SET status=? WHERE id=?', status, id);
  }
}
