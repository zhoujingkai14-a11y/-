import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBrief, analyzeWithAI } from './ai.mjs';

const text = '做一个品牌官网和活动报名 H5。H5 中展示活动海报，官网需要中英文。11月20日上线，修改轮次再商量。';
const brief = () => ({ title: '品牌官网与报名 H5', summary: '官网和报名 H5，修改约定待确认。',
  items: [{ name: '品牌官网', quantity: null, specification: '中英文', source: '官网需要中英文' }, { name: '活动报名 H5', quantity: 1, specification: '展示活动海报', source: '活动报名 H5' }],
  conditions: [{ kind: 'delivery', title: '上线时间', value: '11月20日上线', source: '11月20日上线', required: true, priority: 2 }, { kind: 'revision', title: '修改轮次与范围？', value: null, source: null, required: true, priority: 1 }], warnings: [] });
const config = { apiKey: 'test-key-not-a-real-secret', model: 'test-model', baseUrl: 'https://api.openai.com/v1' };
const response = raw => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(raw) }] }] }), { status: 200 });

test('normalization preserves unknown quantity, evidence, specifications and project-specific questions', () => {
  const result = normalizeBrief(brief(), text, config.model);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].quantity, null);
  assert.equal(result.items[0].unitPrice, null);
  assert.equal(text.slice(result.items[0].start, result.items[0].end), result.items[0].source);
  assert.equal(result.conditions[0].kind, 'revision');
  assert.equal(result.conditions[0].value, '');
  assert.equal(result.mode, 'ai');
  assert.equal(result.total, undefined);
});
test('invented citations are rejected instead of silently accepted', () => {
  const raw = brief(); raw.items[0].source = '客户确认做3页官网';
  assert.throws(() => normalizeBrief(raw, text, 'test'), { code: 'AI_EVIDENCE_MISMATCH' });
});
test('a known condition cannot be accepted without a quote', () => {
  const raw = brief(); raw.conditions[0].source = null;
  assert.throws(() => normalizeBrief(raw, text, 'test'), { code: 'AI_EVIDENCE_MISMATCH' });
});
test('invalid quantities and excessive result sizes are rejected', () => {
  const raw = brief(); raw.items[0].quantity = 1.5;
  assert.throws(() => normalizeBrief(raw, text, 'test'), { code: 'AI_INVALID_QUANTITY' });
  raw.items = Array(81).fill(raw.items[0]);
  assert.throws(() => normalizeBrief(raw, text, 'test'), { code: 'AI_INVALID_RESULT' });
});
test('Responses API contract uses strict structured output and never asks for pricing', async () => {
  const result = await analyzeWithAI(text, '2026-10-01', config, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, `Bearer ${config.apiKey}`);
    const payload = JSON.parse(options.body);
    assert.equal(payload.store, false);
    assert.equal(payload.text.format.strict, true);
    assert.equal(payload.text.format.type, 'json_schema');
    assert.equal(JSON.parse(payload.input).messages, text);
    assert.equal(payload.text.format.schema.properties.price, undefined);
    return response(brief());
  });
  assert.equal(result.items.length, 2);
});
test('missing credentials cause an explicit error and no provider call', async () => {
  await assert.rejects(analyzeWithAI(text, '', { ...config, apiKey: '' }, () => assert.fail('Provider must not be called')), { code: 'AI_NOT_CONFIGURED' });
});
test('timeouts and provider errors are sanitized', async () => {
  await assert.rejects(analyzeWithAI(text, '', config, async () => { throw new Error(config.apiKey); }), error => error.code === 'AI_UNREACHABLE' && !error.message.includes(config.apiKey));
  for (const status of [401, 429, 500]) await assert.rejects(analyzeWithAI(text, '', config, async () => new Response(config.apiKey, { status })), error => error.code === 'AI_PROVIDER_ERROR' && !error.message.includes(config.apiKey));
});
test('incomplete, refused and malformed outputs do not become a draft', async () => {
  await assert.rejects(analyzeWithAI(text, '', config, async () => new Response(JSON.stringify({ status: 'incomplete' }))), { code: 'AI_INCOMPLETE' });
  await assert.rejects(analyzeWithAI(text, '', config, async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }))), { code: 'AI_REFUSED' });
  await assert.rejects(analyzeWithAI(text, '', config, async () => new Response('{}')), { code: 'AI_INVALID_RESULT' });
});

const deepseek = { provider: 'deepseek', apiKey: 'test-only-deepseek-key', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' };
const chatResponse = (raw, finish = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(raw), reasoning_content: 'This is not the result.' } }] }));
test('DeepSeek uses official Chat Completions with JSON output and local evidence validation', async () => {
  const result = await analyzeWithAI(text, '2026-10-01', deepseek, async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(init.headers.Authorization, `Bearer ${deepseek.apiKey}`);
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'deepseek-flash');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.stream, false);
    assert.match(body.messages[0].content, /JSON Schema/);
    assert.match(body.messages[0].content, /JSON structure example/);
    assert.deepEqual(JSON.parse(body.messages[1].content), { messageDate: '2026-10-01', messages: text });
    return chatResponse(brief());
  });
  assert.equal(result.items[0].quantity, null);
  assert.equal(result.items[0].unitPrice, null);
  assert.equal(result.model, 'deepseek-flash');
  assert.equal(text.slice(result.items[0].start, result.items[0].end), result.items[0].source);
  const invented = brief(); invented.items[0].source = 'invented';
  await assert.rejects(analyzeWithAI(text, '', deepseek, async () => chatResponse(invented)), { code: 'AI_EVIDENCE_MISMATCH' });
});
test('JSON mode does not bypass local schema validation', async () => {
  const mutations = [() => null, () => [], raw => ({ ...raw, price: 100 }), raw => { delete raw.items[0].source; return raw; }, raw => { raw.items[0].quantity = '1'; return raw; }, raw => { raw.conditions[0].kind = 'unknown'; return raw; }, raw => { raw.conditions[0].required = 1; return raw; }];
  for (const mutate of mutations) await assert.rejects(analyzeWithAI(text, '', deepseek, async () => chatResponse(mutate(brief()))), { code: 'AI_INVALID_RESULT' });
});
test('DeepSeek refuses incomplete, empty and unreadable responses and sanitizes balance errors', async () => {
  for (const finish of ['length', 'aborted', 'insufficient_system_resource']) await assert.rejects(analyzeWithAI(text, '', deepseek, async () => chatResponse(brief(), finish)), { code: 'AI_INCOMPLETE' });
  await assert.rejects(analyzeWithAI(text, '', deepseek, async () => chatResponse(brief(), 'content_filter')), { code: 'AI_REFUSED' });
  await assert.rejects(analyzeWithAI(text, '', deepseek, async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: ' ' } }] }))), { code: 'AI_EMPTY_RESULT' });
  for (const data of [null, {}, { choices: [{ finish_reason: 'stop', message: { content: null } }] }]) await assert.rejects(analyzeWithAI(text, '', deepseek, async () => new Response(JSON.stringify(data))), { code: 'AI_INVALID_RESPONSE' });
  await assert.rejects(analyzeWithAI(text, '', deepseek, async () => new Response(deepseek.apiKey, { status: 402 })), error => error.code === 'AI_BALANCE_EXHAUSTED' && /余额/.test(error.message) && !error.message.includes(deepseek.apiKey));
});
test('DeepSeek credentials never go to a different host or an unsupported provider', async () => {
  for (const baseUrl of ['https://api.openai.com/v1', 'https://api.deepseek.com.example.test', 'http://api.deepseek.com', 'https://example.test']) await assert.rejects(analyzeWithAI(text, '', { ...deepseek, baseUrl }, () => assert.fail('No credential may be sent')), { code: 'INVALID_AI_CONFIG' });
  await assert.rejects(analyzeWithAI(text, '', { ...deepseek, provider: 'unknown' }, () => assert.fail('No provider call')), { code: 'INVALID_AI_CONFIG' });
});
