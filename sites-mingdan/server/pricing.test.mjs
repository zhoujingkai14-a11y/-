import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalogue, baseChecks, serviceSnapshot, quoteChecks, quoteCheckIssues, localHistory, changePrice } from '../public/prototype/pricing-engine.mjs';

const service = () => ({ id: 'signup', name: '报名 H5', category: '网站', unit: '项目', unitPrice: 2400.25, scope: '活动介绍与报名页面', included: ['报名表单页面'], excluded: ['支付接入'], includedRevisions: 2, active: true, updatedAt: '2026-10-01T00:00:00Z' });
const catalogue = () => ({ services: [service()], checks: baseChecks() });
const items = () => [{ id: 'h5', name: '报名 H5', quantity: 1, unitPrice: 2400.25, specification: '活动介绍与报名表', pricingBasis: serviceSnapshot(service()) }];
test('catalogue rejects duplicate ids, invalid money and incomplete charging units', () => {
  assert.equal(validateCatalogue(catalogue()).services.length, 1);
  for (const patch of [{ unitPrice: 0.001 }, { unitPrice: -1 }, { unit: '' }, { includedRevisions: 1.5 }]) assert.throws(() => validateCatalogue({ services: [{ ...service(), ...patch }], checks: [] }));
  assert.throws(() => validateCatalogue({ services: [service(), service()], checks: [] }));
});
test('applying a service takes a snapshot; changing or archiving the catalogue cannot rewrite it', () => {
  const original = service(), snapshot = serviceSnapshot(original); original.unitPrice = 5000; original.included.push('短信'); original.active = false;
  assert.equal(snapshot.unitPrice, 2400.25); assert.deepEqual(snapshot.included, ['报名表单页面']); assert.equal(snapshot.active, true);
});
test('keyword checks flag scope for review without generating a charge and highlight possible package coverage', () => {
  const result = quoteChecks('客户：报名表需要在线付款', items(), catalogue());
  assert.equal(result.length, 2); assert.equal(result.every(rule => !rule.resolved), true);
  assert.deepEqual(result.find(rule => rule.id === 'check-forms').coverage, ['报名 H5']);
  assert.equal(result.some(rule => 'amount' in rule), false);
});
test('checks require a note and a real priced item; changed scope invalidates the old resolution', () => {
  const text = '报名表需要付款', rows = items(), data = catalogue(), rule = quoteChecks(text, rows, data).find(item => item.id === 'check-payment');
  const resolutions = { [rule.id]: { signature: rule.signature, choice: 'priced', note: '客户确认另计支付接入', itemId: 'missing' } };
  assert.equal(quoteChecks(text, rows, data, resolutions).find(item => item.id === rule.id).resolved, false);
  resolutions[rule.id].itemId = 'h5'; assert.equal(quoteChecks(text, rows, data, resolutions).find(item => item.id === rule.id).resolved, true);
  rows[0].specification += '与退款'; assert.equal(quoteChecks(text, rows, data, resolutions).find(item => item.id === rule.id).resolved, false);
  assert.ok(quoteCheckIssues(text, rows, data, resolutions).length);
});
test('history excludes the current order and drafts and uses only the latest reviewed version per other order', () => {
  const current = { id: 'current', draft: { items: items() } }, version = (id, number, status, total) => ({ id, number, status, items: [{ ...items()[0], amount: total }], issues: [], total, orderTitle: '历史报名项目', createdAt: '2026-09-01' });
  const workspace = { orders: [{ ...current, versions: [version('self', 1, 'client-confirmed', 999)] }, { id: 'past', versions: [version('old', 1, 'designer-reviewed', 1200), version('latest', 2, 'client-confirmed', 2400.25), version('draft', 3, 'draft', 9000)] }, { id: 'draft-only', versions: [version('unreviewed', 1, 'draft', 777)] }] };
  const result = localHistory(workspace, current); assert.equal(result.length, 1); assert.equal(result[0].versionId, 'latest'); assert.equal(result[0].total, 2400.25);
  assert.equal('clientName' in result[0], false); assert.equal('sourceText' in result[0], false);
});
test('history is empty when records are unrelated or absent; it does not fabricate a benchmark', () => {
  const current = { id: 'current', draft: { items: [{ name: '报名 H5' }] } };
  assert.deepEqual(localHistory({ orders: [] }, current), []);
  assert.deepEqual(localHistory({ orders: [{ id: 'past', versions: [{ id: 'a', number: 1, status: 'designer-reviewed', issues: [], items: [{ name: '机械零件', quantity: 1, amount: 100 }], total: 100 }] }] }, current), []);
});
test('change suggestions calculate personal prices in cents and keep negotiation-dependent work unresolved', () => {
  const base = { items: [{ id: 'h5', amount: 2400.25 }] };
  assert.equal(changePrice({ type: 'add', category: 'new_scope', serviceId: 'signup', quantity: 3 }, [service()], base).delta, 7200.75);
  assert.equal(changePrice({ type: 'add', category: 'new_scope', serviceId: 'signup', quantity: null }, [service()], base).delta, null);
  assert.equal(changePrice({ type: 'replace', category: 'client_change', serviceId: 'signup', quantity: 1 }, [service()], base).delta, null);
  assert.equal(changePrice({ type: 'rework', category: 'included_revision' }, [], base).delta, 0);
  assert.equal(changePrice({ type: 'remove', category: 'extraction_error', targetItemId: 'h5' }, [], base).delta, -2400.25);
});
