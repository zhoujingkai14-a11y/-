import test from 'node:test';
import assert from 'node:assert/strict';
import { pricingContext, normalizePricingAdvice, advisePricing } from './pricing-advice.mjs';

const service = { id: 'signup', name: '报名 H5', category: '网站', unit: '项目', unitPrice: 2400.25, scope: '活动介绍与报名页面', included: ['报名表单页面'], excluded: ['支付接入'], includedRevisions: 2, active: true, updatedAt: '2026-10-01T00:00:00Z' };
function fixture(mode = 'quote') {
  const order = { id: 'current', chat: '客户：做一个报名 H5，另外新增一个报名 H5', draft: { items: [{ id: 'h5', name: '报名 H5', source: '做一个报名 H5', quantity: 1, specification: '活动介绍与报名表' }] }, change: { sourceText: '客户：另外新增一个报名 H5' }, versions: [{ id: 'base', number: 1, status: 'client-confirmed', total: 1000, items: [{ id: 'h5', name: '报名 H5', quantity: 1, amount: 1000, specification: '报名表' }], conditions: [] }] };
  const workspace = { catalogue: { services: [service], checks: [] }, orders: [order, { id: 'past', versions: [{ id: 'history', number: 1, status: 'designer-reviewed', total: 2400.25, items: [{ name: '报名 H5', quantity: 1, amount: 2400.25 }], issues: [], orderTitle: '历史报名项目', createdAt: '2026-09-01', sourceText: 'private past text', clientName: 'private contact' }] }] };
  return pricingContext(workspace, order, mode);
}
const output = () => ({ matches: [{ itemId: 'h5', serviceId: 'signup', source: '做一个报名 H5', reason: '范围相近，需核对套餐是否包含后台处理' }], checkHints: [{ title: '报名数据保存位置如何约定？', source: '报名 H5', reason: '后台处理是否属于本次范围需要确认' }], history: [{ versionId: 'history', reason: '都包含报名页面，仍需比较功能' }], change: null, warnings: [] });
const proposal = () => ({ type: 'add', category: 'new_scope', serviceId: 'signup', targetItemId: null, itemName: '报名 H5', quantity: 1, source: '新增一个报名 H5', reason: '客户明确要求增加独立交付', questions: ['是否包含支付接入？'] });
test('pricing context sends only catalogue and redacted historical summaries', () => {
  const context = fixture(); assert.equal(context.services[0].unitPrice, 2400.25);
  assert.equal(JSON.stringify(context).includes('private past text'), false); assert.equal(JSON.stringify(context).includes('private contact'), false);
});
test('matches and history use real references and preserve exact evidence', () => {
  const result = normalizePricingAdvice(output(), fixture(), 'test-model');
  assert.equal(result.matches[0].service.unitPrice, 2400.25); assert.equal(result.matches[0].source, '做一个报名 H5'); assert.equal(result.history[0].total, 2400.25);
});
test('unknown services, historical versions, duplicate matches and invented evidence are rejected', () => {
  for (const mutation of [raw => raw.matches[0].serviceId = 'fake', raw => raw.history[0].versionId = 'fake', raw => raw.matches.push(raw.matches[0]), raw => raw.matches[0].source = '并不存在的客户原话']) {
    const raw = output(); mutation(raw); assert.throws(() => normalizePricingAdvice(raw, fixture(), 'test-model'));
  }
});
test('program prices a change from personal rules regardless of model-supplied numeric fields', () => {
  const raw = { ...output(), matches: [], checkHints: [], history: [], change: { ...proposal(), delta: 999999, unitPrice: 1 } };
  const result = normalizePricingAdvice(raw, fixture('change'), 'test-model'); assert.equal(result.change.price.delta, 2400.25); assert.equal(result.change.price.unitPrice, 2400.25);
});
test('unknown quantities and negotiation-dependent changes keep the fee unresolved', () => {
  const raw = { ...output(), matches: [], checkHints: [], history: [], change: { ...proposal(), quantity: null } };
  assert.equal(normalizePricingAdvice(raw, fixture('change'), 'test-model').change.price.delta, null);
  raw.change = { ...proposal(), type: 'replace', category: 'client_change', targetItemId: 'h5' };
  assert.equal(normalizePricingAdvice(raw, fixture('change'), 'test-model').change.price.delta, null);
});
test('invalid change references, type/category pairs and irrelevant quote-mode changes are rejected', () => {
  for (const mutation of [value => value.targetItemId = 'fake', value => value.category = 'client_change', value => value.quantity = 0, value => value.source = 'invented']) {
    const change = proposal(); mutation(change); assert.throws(() => normalizePricingAdvice({ ...output(), change }, fixture('change'), 'test-model'));
  }
  assert.throws(() => normalizePricingAdvice({ ...output(), change: proposal() }, fixture(), 'test-model'));
});
test('pricing API uses strict Responses output, store false and no network when the key is missing', async () => {
  let called = false;
  const fetchMock = async (url, init) => { called = true; const body = JSON.parse(init.body); assert.match(url, /\/responses$/); assert.equal(body.store, false); assert.equal(body.text.format.strict, true); assert.equal(body.text.format.name, 'mingdan_pricing_advice'); return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output()) }] }] }) }; };
  await assert.rejects(advisePricing(fixture(), { apiKey: '', model: 'test', baseUrl: 'https://example.test' }, fetchMock), error => error.code === 'AI_NOT_CONFIGURED'); assert.equal(called, false);
  assert.equal((await advisePricing(fixture(), { apiKey: 'test-only', model: 'test', baseUrl: 'https://example.test' }, fetchMock)).matches.length, 1);
});
test('inactive standards cannot be proposed and an oversized context is rejected before a provider call', async () => {
  const context = fixture(); context.services[0] = { ...context.services[0], active: false }; context.services = context.services.filter(service => service.active);
  assert.throws(() => normalizePricingAdvice(output(), context, 'test-model'));
  context.messages = 'a'.repeat(120001); let called = false;
  await assert.rejects(advisePricing(context, { apiKey: 'test-only' }, () => { called = true; }), error => error.code === 'PRICING_CONTEXT_TOO_LARGE'); assert.equal(called, false);
});

test('DeepSeek pricing handles nullable changes and calculates adopted suggestions from personal rates', async () => {
  const config = { provider: 'deepseek', apiKey: 'test-only', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' };
  const mock = raw => async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    const body = JSON.parse(init.body);
    assert.equal(body.response_format.type, 'json_object');
    assert.equal(JSON.parse(body.messages[1].content).services[0].unitPrice, service.unitPrice);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }] }));
  };
  const result = await advisePricing(fixture(), config, mock(output()));
  assert.equal(result.matches[0].service.unitPrice, 2400.25);
  assert.equal(result.change, null);
  const raw = { ...output(), matches: [], checkHints: [], history: [], change: proposal() };
  assert.equal((await advisePricing(fixture('change'), config, mock(raw))).change.price.delta, 2400.25);
  raw.change.delta = 999999;
  await assert.rejects(advisePricing(fixture('change'), config, mock(raw)), { code: 'AI_INVALID_RESULT' });
});
