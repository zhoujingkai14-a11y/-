export const emptyCatalogue = () => ({ services: [], checks: [] });
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const textValid = (value, limit) => typeof value === 'string' && value.length <= limit;
export const validPrice = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
const listValid = (value, count, length) => Array.isArray(value) && value.length <= count && value.every(item => textValid(item, length) && item.trim());
export function validateCatalogue(catalogue) {
  if (!catalogue || !Array.isArray(catalogue.services) || catalogue.services.length > 150 || !Array.isArray(catalogue.checks) || catalogue.checks.length > 80) throw new Error('收费标准格式无效或超出数量限制。');
  const ids = new Set();
  for (const service of catalogue.services) {
    if (!idValid(service.id) || ids.has(service.id) || !textValid(service.name, 160) || !service.name.trim() || !textValid(service.category, 80) || !textValid(service.unit, 30) || !service.unit.trim() || !(service.unitPrice === null || validPrice(service.unitPrice)) || !textValid(service.scope, 2000) || !listValid(service.included, 30, 200) || !listValid(service.excluded, 30, 200) || !(service.includedRevisions === null || Number.isInteger(service.includedRevisions) && service.includedRevisions >= 0 && service.includedRevisions <= 99) || typeof service.active !== 'boolean' || !textValid(service.updatedAt, 100)) throw new Error('服务名称、收费单位、金额或包含范围无效。');
    ids.add(service.id);
  }
  ids.clear();
  for (const rule of catalogue.checks) {
    if (!idValid(rule.id) || ids.has(rule.id) || !textValid(rule.title, 160) || !rule.title.trim() || !listValid(rule.keywords, 20, 60) || !rule.keywords.length || !textValid(rule.detail, 1000) || typeof rule.active !== 'boolean') throw new Error('漏算检查的名称或关键词无效。');
    ids.add(rule.id);
  }
  return catalogue;
}
export const baseChecks = () => [
  { id: 'check-payment', title: '付款与退款是否在交付范围内？', keywords: ['付款', '支付', '退款'], detail: '核对接入方式、账户由谁提供、第三方手续费和原套餐包含范围。' },
  { id: 'check-forms', title: '表单、通知与数据处理由谁负责？', keywords: ['报名', '表单', '短信', '通知'], detail: '核对字段、保存位置、通知方式和隐私说明；页面展示与后台处理要分清。' },
  { id: 'check-language', title: '多语言内容与翻译由谁提供？', keywords: ['多语言', '英文', '中英', '翻译'], detail: '核对页面数量和文案来源；不默认把翻译计入设计费用。' },
  { id: 'check-deploy', title: '上线、域名与后续维护如何约定？', keywords: ['上线', '部署', '域名', '维护'], detail: '核对客户已有环境、上线支持及第三方费用，避免和套餐重复计费。' },
  { id: 'check-source', title: '源文件与使用权限如何交付？', keywords: ['源文件', '版权', '商用', '授权'], detail: '先核对是否包含以及允许的使用方式，再决定是否单独收费。' },
  { id: 'check-rush', title: '加急与修改轮次是否需要重新约定？', keywords: ['加急', '今天', '明天', '改到满意', '无限修改'], detail: '核对可行交期与修改边界，不能把所有修改都视为加价。' }
].map(rule => ({ ...rule, active: true }));
export function serviceSnapshot(service) { return structuredClone(service); }
export function checkSignature(rule, text, items) {
  return JSON.stringify([rule.id, rule.title, rule.keywords, rule.detail, text, items.map(item => [item.id, item.name, item.quantity, item.specification || '', item.unitPrice, item.pricingBasis || null])]);
}
export function quoteChecks(text, items, catalogue, resolutions = {}) {
  const haystack = [text, ...items.map(item => `${item.name} ${item.specification || ''}`)].join('\n');
  return catalogue.checks.filter(rule => rule.active).flatMap(rule => {
    const keyword = rule.keywords.find(word => haystack.toLowerCase().includes(word.toLowerCase()));
    if (!keyword) return [];
    const index = haystack.toLowerCase().indexOf(keyword.toLowerCase());
    const source = haystack.slice(Math.max(0, index - 24), Math.min(haystack.length, index + keyword.length + 50));
    const signature = checkSignature(rule, text, items), resolution = resolutions[rule.id];
    const linkedPrice = items.some(item => item.id === resolution?.itemId && Number.isInteger(item.quantity) && item.quantity > 0 && validPrice(item.unitPrice));
    const resolved = resolution?.signature === signature && ['included', 'priced', 'not-needed'].includes(resolution.choice) && typeof resolution.note === 'string' && Boolean(resolution.note.trim()) && (resolution.choice !== 'priced' || linkedPrice);
    const coverage = items.filter(item => item.pricingBasis?.included?.some(part => rule.keywords.some(word => part.includes(word)))).map(item => item.name);
    return [{ ...rule, source, signature, resolved, resolution: resolution?.signature === signature ? resolution : null, coverage }];
  });
}
export function quoteCheckIssues(text, items, catalogue, resolutions) {
  return quoteChecks(text, items, catalogue, resolutions).filter(rule => !rule.resolved).map(rule => `漏算检查尚未核对：${rule.title}`);
}
const normalized = value => String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
function terms(value) {
  const text = normalized(value), values = new Set();
  for (const word of text.match(/[a-z0-9]+/g) || []) if (word.length >= 2) values.add(word);
  for (const word of text.match(/[\p{Script=Han}]+/gu) || []) for (let index = 0; index < word.length - 1; index++) values.add(word.slice(index, index + 2));
  return values;
}
export function historyCandidates(workspace, currentOrder) {
  return workspace.orders.filter(order => order.id !== currentOrder.id).flatMap(order => {
    const version = [...order.versions].reverse().find(entry => ['designer-reviewed', 'client-confirmed'].includes(entry.status) && !entry.issues?.length);
    if (!version) return [];
    const items = version.items.filter(item => item.id !== 'sourceFile').map(item => ({ name: item.name, quantity: item.quantity, specification: item.specification || '', amount: item.amount, unitPrice: item.unitPrice ?? null, serviceId: item.pricingBasis?.id || null, unit: item.pricingBasis?.unit || '' }));
    const query = terms(currentOrder.draft.items.map(item => `${item.name} ${item.specification || ''}`).join(' '));
    const candidate = terms(items.map(item => `${item.name} ${item.specification}`).join(' '));
    const overlap = [...query].filter(word => candidate.has(word)).length;
    const score = overlap / Math.max(1, new Set([...query, ...candidate]).size);
    const commonServices = currentOrder.draft.items.filter(item => item.pricingBasis && items.some(old => old.serviceId === item.pricingBasis.id)).length;
    const differences = [];
    for (const item of currentOrder.draft.items) {
      const old = items.find(entry => normalized(entry.name) === normalized(item.name));
      if (!old) differences.push(`当前新增或名称不同：${item.name}`);
      else { if (old.quantity !== item.quantity) differences.push(`${item.name}：历史数量 ${old.quantity}，当前 ${item.quantity ?? '待确认'}`); if (old.specification !== (item.specification || '')) differences.push(`${item.name}：规格需要重新比较`); }
    }
    for (const old of items) if (!currentOrder.draft.items.some(item => normalized(item.name) === normalized(old.name))) differences.push(`历史额外包含：${old.name}`);
    return [{ orderId: order.id, versionId: version.id, number: version.number, title: version.orderTitle, createdAt: version.createdAt, status: version.status, total: version.total, items, score: score + (commonServices ? 1 : 0), differences }];
  }).sort((a, b) => b.score - a.score).slice(0, 10);
}
export function localHistory(workspace, order) { return historyCandidates(workspace, order).filter(item => item.score >= 0.2).slice(0, 3); }
export function changePrice(proposal, services, base) {
  const service = services.find(item => item.id === proposal.serviceId && item.active);
  const target = base?.items.find(item => item.id === proposal.targetItemId);
  const zero = ['included_revision', 'designer_error', 'extraction_error'].includes(proposal.category);
  if (zero && proposal.type !== 'remove') return { delta: 0, unitPrice: 0, basis: '按约定内修改或纠错处理；设计师仍须核对归因。' };
  if (zero && proposal.type === 'remove' && target) return { delta: -target.amount, unitPrice: null, basis: '纠正原交付范围，扣除该项原金额；须核对原记录。' };
  if (proposal.type === 'add' && proposal.category === 'new_scope' && service && validPrice(service.unitPrice) && Number.isInteger(proposal.quantity) && proposal.quantity >= 1 && proposal.quantity <= 99) return { delta: Math.round(service.unitPrice * 100) * proposal.quantity / 100, unitPrice: service.unitPrice, basis: `个人标准：${service.name}，按 ${service.unit} 计价；价格保存时间 ${service.updatedAt}` };
  return { delta: null, unitPrice: service?.unitPrice ?? null, basis: '依据不足，需核对数量、范围及已完成工作，再协商费用。' };
}
