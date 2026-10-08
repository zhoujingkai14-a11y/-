import { AppError } from './ai.mjs';
import { validateCatalogue } from '../public/prototype/pricing-engine.mjs';
const clone = value => structuredClone(value);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const money = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1000000 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
export function validateVersion(version) {
  if (!safeId(version.id) || !Number.isInteger(version.number) || version.number < 1 || !Array.isArray(version.items) || version.items.length < 1 || version.items.length > 100 || !Array.isArray(version.issues) || !version.issues.every(issue => typeof issue === 'string') || !['draft', 'designer-reviewed', 'client-confirmed'].includes(version.status)) {
    throw new AppError(400, 'INVALID_VERSION', '报价版本格式无效。');
  }
  let cents = 0;
  for (const item of version.items) {
    if (!safeId(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 160 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99 || !money(item.amount) || item.amount < 0) throw new AppError(400, 'INVALID_VERSION', '交付项名称、数量或金额无效。');
    if (typeof item.source !== 'string' && item.id !== 'sourceFile') throw new AppError(400, 'INVALID_VERSION', '交付项缺少依据。');
    if (item.pricingBasis !== undefined) { try { validateCatalogue({ services: [item.pricingBasis], checks: [] }); } catch { throw new AppError(400, 'INVALID_PRICE_BASIS', '套用的收费标准记录无效。'); } }
    if (item.rate === 'manual' && item.unitPrice !== null && item.unitPrice !== undefined && (!money(item.unitPrice) || item.unitPrice < 0 || (version.kind !== 'change' && Math.round(item.unitPrice * 100) * item.quantity !== Math.round(item.amount * 100)))) throw new AppError(400, 'INVALID_TOTAL', '项目金额与单价、数量不一致。');
    cents += Math.round(item.amount * 100);
  }
  for (const adjustment of version.feeAdjustments || []) {
    if (typeof adjustment.label !== 'string' || !money(adjustment.amount)) throw new AppError(400, 'INVALID_TOTAL', '费用调整格式无效。');
    cents += Math.round(adjustment.amount * 100);
  }
  if (!money(version.total) || version.total < 0 || cents !== Math.round(version.total * 100)) throw new AppError(400, 'INVALID_TOTAL', '报价合计与项目金额不一致。');
  if (version.conditions !== undefined && (!Array.isArray(version.conditions) || version.conditions.length > 40 || version.conditions.some(item => !safeId(item.id) || typeof item.title !== 'string' || typeof item.value !== 'string' || typeof item.required !== 'boolean'))) throw new AppError(400, 'INVALID_CONDITIONS', '交付条件格式无效。');
  if (version.pricingReview !== undefined) {
    const checks = version.pricingReview.checks;
    if (!Array.isArray(checks) || checks.length > 80 || checks.some(item => !safeId(item.id) || typeof item.title !== 'string' || item.title.length > 160 || typeof item.source !== 'string' || typeof item.resolved !== 'boolean' || !['ask', 'included', 'priced', 'not-needed'].includes(item.choice) || typeof item.note !== 'string' || item.note.length > 1500)) throw new AppError(400, 'INVALID_PRICING_REVIEW', '报价核对记录无效。');
    if (checks.some(check => check.resolved && (check.choice === 'ask' || !check.note.trim() || check.choice === 'priced' && !version.items.some(item => item.id === check.itemId && item.quantity > 0 && money(item.amount))))) throw new AppError(400, 'INVALID_PRICING_REVIEW', '漏算检查的处理依据或对应交付项无效。');
    if (version.status !== 'draft' && checks.some(check => !check.resolved)) throw new AppError(400, 'UNRESOLVED_PRICING', '请先处理报价核对提示，再标记设计师审核。');
  }
  const receipt = version.change?.pricingSuggestion;
  if (receipt !== undefined) {
    if (!receipt || typeof receipt.source !== 'string' || typeof receipt.originalMessage !== 'string' || typeof receipt.reviewed !== 'boolean' || !Array.isArray(receipt.questions) || receipt.questions.length > 15 || !receipt.questions.every(question => typeof question === 'string' && question.length <= 500) || !Array.isArray(receipt.answers) || receipt.answers.length !== receipt.questions.length || !receipt.answers.every(answer => typeof answer === 'string' && answer.length <= 2000)) throw new AppError(400, 'INVALID_CHANGE_ADVICE', '变更建议核对记录无效。');
    if (version.status !== 'draft' && (!receipt.reviewed || receipt.originalMessage.trim() !== version.change.source || !version.change.source.includes(receipt.source) || receipt.answers.some(answer => !answer.trim() || /待确认|未确认|不确定|还没定/.test(answer)))) throw new AppError(400, 'UNRESOLVED_CHANGE_ADVICE', '请核对采用的变更建议及问题答案，再标记已审核。');
  }
}

export function validateWorkspace(workspace) {
  if (workspace?.schema !== 1 || !Array.isArray(workspace.orders) || !workspace.orders.length || workspace.orders.length > 100) throw new AppError(400, 'INVALID_WORKSPACE', '订单工作区格式无效。');
  if (workspace.catalogue !== undefined) { try { validateCatalogue(workspace.catalogue); } catch (error) { throw new AppError(400, 'INVALID_CATALOGUE', error.message); } }
  const ids = new Set();
  for (const order of workspace.orders) {
    if (!safeId(order.id) || ids.has(order.id) || typeof order.title !== 'string' || typeof order.clientName !== 'string' || typeof order.chat !== 'string' || order.chat.length > 20000 || !order.draft || !Array.isArray(order.draft.items) || !Array.isArray(order.versions) || order.versions.length > 300) throw new AppError(400, 'INVALID_WORKSPACE', '订单数据不完整或超出限制。');
    ids.add(order.id);
    const versionIds = new Set();
    let previousNumber = 0;
    for (const version of order.versions) {
      validateVersion(version);
      if (versionIds.has(version.id) || version.number <= previousNumber) throw new AppError(400, 'INVALID_VERSION', '报价版本编号重复或顺序无效。');
      versionIds.add(version.id); previousNumber = version.number;
    }
  }
}


export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export function versionContent(version) {const copy=clone(version); for(const key of ['status','confirmationEvidence','confirmedAt','confirmationMode','share']) delete copy[key]; return canonical(copy);}
