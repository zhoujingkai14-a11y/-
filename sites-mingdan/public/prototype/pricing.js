import { emptyCatalogue, baseChecks, validateCatalogue, serviceSnapshot, quoteChecks, quoteCheckIssues, localHistory, validPrice } from './pricing-engine.mjs';

let catalogueOpen = false, editor = null, ruleEditor = null, advice = null, adviceBusy = false;
const catalogue = () => workspace.catalogue || { ...emptyCatalogue(), checks: baseChecks() };
const draftItems = () => state.draft.items.map(item => ({ ...item, unitPrice: item.rate === 'manual' ? item.unitPrice : state.draft.rates[item.rate] }));
const checks = () => quoteChecks(state.chat, draftItems(), catalogue(), state.draft.pricingChecks);
const followupQuestions = () => checks().filter(rule => !rule.resolved).map(rule => ({ title: rule.title }));
const reviewIssues = () => quoteCheckIssues(state.chat, draftItems(), catalogue(), state.draft.pricingChecks);
const splitLines = value => value.split(/[\n，,]/).map(part => part.trim()).filter(Boolean);
const connection = () => window.MingdanStage4?.status() || {};
const signature = mode => JSON.stringify([state.id, state.chat, state.draft, catalogue(), mode === 'change' ? [state.change, latestConfirmed()?.id] : null]);
const activeServices = () => catalogue().services.filter(service => service.active);
function saveCatalogue(next) { validateCatalogue(next); workspace.catalogue = next; persist(); render(); if (catalogueOpen) $('#pricingCatalogue').innerHTML = catalogueHTML(); }
function formService() {
  const values = Object.fromEntries(['name', 'category', 'unit', 'scope', 'price', 'included', 'excluded', 'revisions'].map(key => [key, $(`#service-${key}`).value]));
  return { id: editor.id || newId(), name: values.name.trim(), category: values.category.trim(), unit: values.unit.trim(), scope: values.scope.trim(), unitPrice: values.price === '' ? null : Number(values.price), included: splitLines(values.included), excluded: splitLines(values.excluded), includedRevisions: values.revisions === '' ? null : Number(values.revisions), active: editor.active ?? true, updatedAt: new Date().toISOString() };
}
function blankService() { return { name: '', category: '', unit: '项目', unitPrice: null, scope: '', included: [], excluded: [], includedRevisions: null, active: true }; }
function serviceForm() {
  if (!editor) return '';
  return `<form id="serviceForm" class="pricing-form"><h3>${editor.id ? '编辑收费标准' : '建立收费标准'}</h3><p class="hint">这是你的收费依据。空价格表示尚未定价；按项目计价时，请核对本次数量是否为一项完整项目。</p><div class="pricing-fields">
    <div class="field"><label for="service-name">服务名称 *</label><input id="service-name" maxlength="160" required value="${esc(editor.name)}" placeholder="例如：活动报名 H5 套餐"></div>
    <div class="field"><label for="service-category">项目分类</label><input id="service-category" maxlength="80" value="${esc(editor.category)}" placeholder="例如：网站、平面设计"></div>
    <div class="field"><label for="service-unit">收费单位 *</label><input id="service-unit" maxlength="30" required value="${esc(editor.unit)}" placeholder="项目、页、张或套"></div>
    <div class="field"><label for="service-price">每单位价格（元）</label><input id="service-price" type="number" min="0" max="1000000" step="0.01" value="${editor.unitPrice ?? ''}" placeholder="填写你自己的价格"></div>
    <div class="field pricing-wide"><label for="service-scope">适用范围 *</label><textarea id="service-scope" rows="2" maxlength="2000" required placeholder="明确这个价格适用于什么交付范围">${esc(editor.scope)}</textarea></div>
    <div class="field"><label for="service-included">已包含的工作（每行一项）</label><textarea id="service-included" rows="3">${esc(editor.included.join('\n'))}</textarea></div>
    <div class="field"><label for="service-excluded">不包含的工作（每行一项）</label><textarea id="service-excluded" rows="3">${esc(editor.excluded.join('\n'))}</textarea></div>
    <div class="field"><label for="service-revisions">包含修改轮次</label><input id="service-revisions" type="number" min="0" max="99" step="1" value="${editor.includedRevisions ?? ''}" placeholder="未约定可留空"></div></div><p id="serviceError" class="field-error" role="alert"></p><div class="actions"><button type="submit" class="button">保存收费标准</button><button type="button" class="button secondary" data-pricing-action="cancel-editor">取消编辑</button></div></form>`;
}
function catalogueHTML() {
  const current = catalogue();
  return `<div class="card-head"><div><h2>我的收费标准</h2><p class="hint">跨订单复用；套用后保存一份当时的价格与范围。之后改标准不会改旧报价。</p></div><button type="button" class="text-button" data-pricing-action="catalogue-toggle">收起标准</button></div>
    <div class="actions"><button class="button" data-pricing-action="new-service">新建服务项目</button><button class="button secondary" data-pricing-action="service-template">使用报名 H5 结构模板</button></div>
    ${current.services.length ? `<ul class="pricing-services">${current.services.map(service => `<li><div><strong>${esc(service.name)}</strong><span class="${service.active ? 'badge' : 'badge warn'}">${service.active ? '可使用' : '已停用'}</span><p class="small muted">${service.unitPrice === null ? '尚未定价' : money(service.unitPrice)} / ${esc(service.unit)}${service.category ? ' · ' + esc(service.category) : ''}</p><p class="small">${esc(service.scope)}</p></div><div class="actions"><button class="text-button" data-edit-service="${service.id}">编辑标准</button><button class="text-button" data-toggle-service="${service.id}">${service.active ? '停用' : '启用'}</button></div></li>`).join('')}</ul>` : '<p class="pricing-empty">还没有个人收费标准。先建立一个常用服务，今后可在交付项旁反复套用。结构模板不提供市场价。</p>'}
    ${serviceForm()}<details id="pricingRuleSettings" class="pricing-section"><summary>漏算检查规则 · ${current.checks.filter(rule => rule.active).length} 项启用</summary><p class="hint">这些是关键词触发的检查提示，不代表已经漏算，更不会自动收费。可编辑、停用或增加自己的规则。</p><ul class="pricing-rule-list">${current.checks.map(rule => `<li><div><strong>${esc(rule.title)}</strong><p class="small muted">${esc(rule.keywords.join('、'))} · ${rule.active ? '启用' : '停用'}</p></div><div class="actions"><button class="text-button" data-edit-rule="${rule.id}">编辑规则</button><button class="text-button" data-toggle-rule="${rule.id}">${rule.active ? '停用规则' : '启用规则'}</button></div></li>`).join('')}</ul><button class="button secondary" data-pricing-action="new-rule">增加检查规则</button>${ruleEditor ? `<form id="ruleForm" class="pricing-form"><div class="field"><label for="rule-title">核对问题 *</label><input id="rule-title" maxlength="160" required value="${esc(ruleEditor.title)}"></div><div class="field"><label for="rule-keywords">触发关键词（逗号分隔）*</label><input id="rule-keywords" required value="${esc(ruleEditor.keywords.join('，'))}"></div><div class="field"><label for="rule-detail">核对说明</label><textarea id="rule-detail" maxlength="1000">${esc(ruleEditor.detail)}</textarea></div><p id="ruleError" class="field-error" role="alert"></p><div class="actions"><button class="button" type="submit">保存检查规则</button><button type="button" class="button secondary" data-pricing-action="cancel-rule">取消</button></div></form>` : ''}</details>`;
}
function checkHTML(rule) {
  const resolution = rule.resolution;
  return `<details id="pricing-check-${rule.id}" class="pricing-check"><summary><span>${esc(rule.title)}</span><span class="${rule.resolved ? 'badge' : 'badge warn'}">${rule.resolved ? '已核对' : '待核对'}</span></summary><p class="small muted">${esc(rule.detail)}</p><p class="source">触发片段：“${esc(rule.source)}”</p>${rule.coverage.length ? `<p class="small">已套用标准的包含项可能覆盖此内容：${rule.coverage.map(esc).join('、')}。请核对范围，避免重复收费。</p>` : ''}<div class="pricing-fields"><div class="field"><label for="check-choice-${rule.id}">处理方式</label><select id="check-choice-${rule.id}">${[['ask','仍需客户确认'],['included','已包含在约定或套餐中'],['priced','已在交付清单单独计价'],['not-needed','本项目不需要']].map(([key, label]) => `<option value="${key}" ${resolution?.choice === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="field"><label for="check-item-${rule.id}">单独计价时对应的交付项</label><select id="check-item-${rule.id}"><option value="">选择实际交付项</option>${state.draft.items.map(item => `<option value="${item.id}" ${resolution?.itemId === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div></div><div class="field"><label for="check-note-${rule.id}">核对依据 *</label><textarea id="check-note-${rule.id}" rows="2" maxlength="1500" placeholder="例如：客户确认不需要付款；或已包含在报名套餐中">${esc(resolution?.note || '')}</textarea></div><button class="button secondary" data-resolve-check="${rule.id}">记录核对结果</button></details>`;
}
function historyHTML(records) {
  return records.length ? `<ul class="pricing-history">${records.map(record => `<li><div class="row"><strong>${esc(record.title)} · V${record.number}</strong><span>${money(record.total)}</span></div><p class="small muted">${esc(record.createdAt)} · ${record.status === 'client-confirmed' ? '客户确认记录' : '设计师已审核，尚无客户确认'}</p><p class="small">${record.items.map(item => `${esc(item.name)} × ${item.quantity}`).join('；')}</p><p class="small muted">${record.differences.map(esc).join('；') || '名称与数量相近，仍须核对具体范围。'}</p></li>`).join('')}</ul>` : '<p class="pricing-empty">没有足够相近的已审核历史记录。保存自己的真实项目后，这里才有参考依据。</p>';
}
function assistantHTML() {
  const rules = checks(), open = rules.filter(rule => !rule.resolved).length;
  return `<h2>报价依据与漏算检查</h2><p class="hint">提示用于核对范围；只有你明确加入交付清单的费用才会计入报价。</p><details id="pricingQuoteChecks" class="pricing-section" ${open ? 'open' : ''}><summary>常见遗漏检查 <span class="${open ? 'badge warn' : 'badge'}">${open ? open + ' 项待核对' : '当前提示已处理'}</span></summary>${rules.length ? rules.map(checkHTML).join('') : '<p class="small muted">当前没有关键词触发的检查。仍需人工核对完整原文，不能据此认定没有漏项。</p>'}</details><details id="pricingHistory" class="pricing-section"><summary>相似历史报价参考</summary><p class="hint">本机按名称、规格与已选服务查找，每笔订单只取最近的已审核版本；当前订单与未审核草稿不作为参考。历史价格不会自动套用。</p>${historyHTML(localHistory(workspace, state))}</details><details id="pricingAI" class="pricing-section" ${advice?.orderId === state.id ? 'open' : ''}><summary>AI 辅助匹配与检查</summary>${aiHTML('quote')}</details>`;
}
function aiHTML(mode) {
  const status = connection(), unavailable = !status.aiConfigured || !status.ready || status.blocked || status.aiUsage?.paused || status.aiUsage?.dailyRemaining === 0 || status.aiUsage?.monthlyRemaining === 0;
  return `<p class="hint">点击后发送本次需求、你的收费标准与脱敏历史摘要给 DeepSeek；与需求整理共享免费次数，建议须核对后采用。</p><button class="button secondary" data-pricing-action="${mode === 'change' ? 'ai-change' : 'ai-quote'}" ${unavailable || adviceBusy ? 'disabled' : ''}>${adviceBusy ? '正在生成建议…' : mode === 'change' ? 'AI 分析变更与费用依据' : 'AI 匹配收费标准并检查漏项'}</button>${unavailable ? '<p class="small muted">AI 暂不可用或额度不足。个人标准与常见检查仍可使用；账号页可查看用量。</p>' : ''}<div class="pricing-advice-results">${renderAdvice(mode)}</div>`;
}
function renderAdvice(mode) {
  if (!advice || advice.orderId !== state.id || advice.mode !== mode) return '';
  if (advice.error) return `<p class="field-error" role="alert">${esc(advice.error)}</p>`;
  const stale = advice.signature !== signature(mode), result = advice.data;
  if (!result) return '';
  const disabled = stale ? 'disabled' : '';
  return `<p class="small muted">模型：${esc(result.model)} · 原话与引用编号已检查，含义和范围仍需人工审核。</p>${stale ? '<p class="pricing-advice-stale" role="status">消息、草稿或收费标准已改变，这批建议已停用。请重新生成。</p>' : ''}${result.warnings.map(warning => `<p class="small pricing-advice-stale">${esc(warning)}</p>`).join('')}
    ${mode === 'quote' ? `<h3>个人标准匹配</h3>${result.matches.length ? result.matches.map((match, index) => `<div class="pricing-suggestion"><strong>${esc(match.itemName)} → ${esc(match.service.name)}</strong><p class="small">${match.service.unitPrice === null ? '标准尚未定价' : money(match.service.unitPrice) + ' / ' + esc(match.service.unit)}</p><p class="small">标准范围：${esc(match.service.scope)}<br>包含：${match.service.included.map(esc).join('；') || '未填写'}<br>不含：${match.service.excluded.map(esc).join('；') || '未填写'}</p><p class="small muted">${esc(match.reason)}</p><p class="source">原话：“${esc(match.source)}”</p><button class="button secondary" data-adopt-match="${index}" ${disabled} ${advice.appliedMatches?.includes(match.itemId) ? 'disabled' : ''}>${advice.appliedMatches?.includes(match.itemId) ? '已套用到本项' : '核对后套用标准'}</button></div>`).join('') : '<p class="small muted">模型未找到可靠匹配，请手动选择标准或自定价格。</p>'}
    <h3>需要补充核对的范围</h3>${result.checkHints.length ? result.checkHints.map((hint, index) => `<div class="pricing-suggestion"><strong>${esc(hint.title)}</strong><p class="small muted">${esc(hint.reason)}</p><p class="source">原话：“${esc(hint.source)}”</p><button class="button secondary" data-adopt-hint="${index}" ${disabled} ${advice.appliedHints?.includes(index) ? 'disabled' : ''}>${advice.appliedHints?.includes(index) ? '已加入核对问题' : '加入待确认问题'}</button></div>`).join('') : '<p class="small muted">没有额外可靠提示，不代表已经检查出所有漏项。</p>'}<h3>模型选择的历史参考</h3>${historyHTML(result.history)}${result.history.map(record => `<p class="small muted">${esc(record.title)}：${esc(record.reason)}</p>`).join('')}` : result.change ? `<div class="pricing-suggestion"><strong>建议分类：${CHANGE_LABELS[result.change.type] || '需要人工判断'} · ${CATEGORIES[result.change.category]}</strong><p class="small">费用变化建议：${result.change.price.delta === null ? '待协商' : money(result.change.price.delta)}</p><p class="small">${esc(result.change.price.basis)}</p><p class="small muted">${esc(result.change.reason)}</p><p class="source">变更原话：“${esc(result.change.source)}”</p>${result.change.questions.length ? `<ul class="small">${result.change.questions.map(question => `<li>${esc(question)}</li>`).join('')}</ul>` : ''}<button class="button secondary" data-pricing-action="adopt-change" ${disabled} ${result.change.type === 'unknown' || result.change.category === 'ambiguous' || advice.changeApplied ? 'disabled' : ''}>${advice.changeApplied ? '已采用为变更草稿' : '采用为草稿，核对费用与交期'}</button></div>` : ''}`;
}
function changePanelHTML() {
  const receipt = state.change.pricingSuggestion;
  return `<h2>变更费用建议</h2><p class="hint">新增可按个人标准核算；替换、取消与重做还需核对已完成工作和原约定。</p>${state.change.type === 'add' ? `<div class="field"><label for="changeService">新增交付使用的个人标准</label><div class="pricing-select-row"><select id="changeService"><option value="">选择服务项目</option>${activeServices().map(service => `<option value="${service.id}">${esc(service.name)} · ${service.unitPrice === null ? '待定价' : money(service.unitPrice)} / ${esc(service.unit)}</option>`).join('')}</select><button class="button secondary" data-pricing-action="use-change-service" ${!activeServices().length ? 'disabled' : ''}>套用到新增交付</button></div><p id="changeServicePreview" class="small muted"></p></div>${state.change.pricingBasis ? `<p class="small">已套用 ${esc(state.change.pricingBasis.name)}，按 ${esc(state.change.pricingBasis.unit)} 计价；数量仍按当前草稿填写。</p>` : ''}` : ''}${aiHTML('change')}${receipt ? `<div class="pricing-section"><h3>已采用的 AI 建议核对</h3><p class="small muted">${esc(receipt.reason)}</p>${receipt.questions.map((question, index) => `<div class="field"><label for="change-advice-answer-${index}">${esc(question)}</label><textarea id="change-advice-answer-${index}" rows="2" maxlength="2000" data-advice-answer="${index}">${esc(receipt.answers[index] || '')}</textarea></div>`).join('')}<label class="check-label"><input type="checkbox" id="changeAdviceReviewed" ${receipt.reviewed ? 'checked' : ''}> 已核对建议的分类、收费单位、原约定与上述答案</label><div class="actions"><button class="text-button" data-pricing-action="discard-change-receipt">取消采用记录，改为人工判断</button></div></div>` : ''}`;
}
function changeIssues() {
  const receipt = state.change.pricingSuggestion;
  if (!receipt) return [];
  const issues = [];
  if (receipt.originalMessage !== state.change.sourceText) issues.push('采用建议后变更消息已修改，请重新生成建议或改为人工判断');
  if (!receipt.reviewed) issues.push('尚未核对采用的 AI 变更建议');
  if (receipt.questions.some((_, index) => !isResolvedAnswer(receipt.answers[index]))) issues.push('AI 建议中的变更问题尚未确认');
  return issues;
}
function refreshAdvice() {
  for (const panel of [$('#pricingAssistant'), $('#pricingChangeAdvice')].filter(Boolean)) {
    const mode = panel.id === 'pricingAssistant' ? 'quote' : 'change', region = panel.querySelector('.pricing-advice-results');
    if (region) region.innerHTML = renderAdvice(mode);
    const button = panel.querySelector('[data-pricing-action="ai-quote"], [data-pricing-action="ai-change"]');
    if (button) { const status = connection(); button.disabled = !status.aiConfigured || !status.ready || status.blocked || status.aiUsage?.paused || status.aiUsage?.dailyRemaining === 0 || status.aiUsage?.monthlyRemaining === 0 || adviceBusy; button.textContent = adviceBusy ? '正在生成建议…' : mode === 'change' ? 'AI 分析变更与费用依据' : 'AI 匹配收费标准并检查漏项'; }
  }
}
async function requestAdvice(mode) {
  if (adviceBusy) return;
  const before = signature(mode), orderId = state.id;
  adviceBusy = true; refreshAdvice();
  try {
    await window.MingdanStage4.flush();
    const result = await window.MingdanStage4.api('/api/pricing/advice', { method: 'POST', body: JSON.stringify({ orderId, revision: connection().revision, mode }) });
    if (state.id !== orderId || signature(mode) !== before || result.revision !== connection().revision) { toast('等待期间内容已改变，本次建议未应用。'); return; }
    advice = { orderId, mode, signature: before, data: result, appliedMatches: [], appliedHints: [] }; refreshAdvice();
    toast('已生成建议，请先核对范围与依据。');
  } catch (error) { if (state.id === orderId) advice = { orderId, mode, signature: before, error: error.message }; toast(error.message); }
  finally { adviceBusy = false; await window.MingdanStage4.refreshUsage(); refreshAdvice(); }
}
function requireCurrentAdvice(mode) { if (!advice?.data || advice.orderId !== state.id || advice.mode !== mode || advice.signature !== signature(mode)) throw new Error('建议已过时，请重新生成后再采用。'); }
function enhance() {
  if (!$('#pricingLibraryButton')) { const button = document.createElement('button'); button.id = 'pricingLibraryButton'; button.className = 'topbar-button'; button.dataset.pricingAction = 'catalogue-toggle'; button.textContent = '我的收费标准'; $('.topbar-end').prepend(button); }
  let library = $('#pricingCatalogue');
  if (!library) { library = document.createElement('section'); library.id = 'pricingCatalogue'; library.className = 'card pricing-catalogue'; $('.topbar').after(library); }
  library.hidden = !catalogueOpen;
  if (catalogueOpen && !library.contains(document.activeElement)) library.innerHTML = catalogueHTML();
  $('#pricingLibraryButton').setAttribute('aria-expanded', String(catalogueOpen));
  if (state.page === 1) {
    for (const item of state.draft.items) {
      const row = document.querySelector(`[data-evidence-id="${item.id}"]`); if (!row || row.querySelector('.pricing-apply')) continue;
      const basis = item.pricingBasis, current = catalogue().services.find(service => service.id === basis?.id);
      const applied = basis ? `<p class="small">采用标准：${esc(basis.name)} · ${basis.unitPrice === null ? '尚未定价' : money(basis.unitPrice)} / ${esc(basis.unit)}${item.unitPrice !== basis.unitPrice ? ' · 本单已调整单价' : ''}</p><p class="small muted">${esc(basis.scope)}${current && current.updatedAt !== basis.updatedAt ? '；标准已更新，本单仍使用套用时的记录。' : ''}${current && !current.active ? '；该标准现已停用。' : ''}</p>` : '<p class="small muted">选择自己的标准，核对收费单位与包含范围后套用。</p>';
      const region = document.createElement('div'); region.className = 'pricing-apply';
      region.innerHTML = `<label for="pricing-service-${item.id}">套用个人收费标准</label><div class="pricing-select-row"><select id="pricing-service-${item.id}" data-service-preview="${item.id}"><option value="">选择服务项目</option>${activeServices().map(service => `<option value="${service.id}">${esc(service.name)} · ${service.unitPrice === null ? '待定价' : money(service.unitPrice)} / ${esc(service.unit)}</option>`).join('')}</select><button class="button secondary" data-use-service="${item.id}" ${!activeServices().length ? 'disabled' : ''}>套用到本项</button></div><div id="pricing-preview-${item.id}" class="small muted"></div>${applied}${basis ? `<details><summary>查看当时的包含范围</summary><p class="small">包含：${basis.included.map(esc).join('；') || '未填写'}<br>不含：${basis.excluded.map(esc).join('；') || '未填写'}<br>修改轮次：${basis.includedRevisions ?? '未约定'}</p></details>` : ''}`;
      row.append(region);
    }
    if (!$('#pricingAssistant')) { const panel = document.createElement('section'); panel.id = 'pricingAssistant'; panel.className = 'card'; panel.innerHTML = assistantHTML(); const delivery = $('.req')?.closest('.card'); if (delivery) delivery.after(panel); else $('.grid>.stack').prepend(panel); }
  }
  if (state.page === 3 && latestConfirmed() && !$('#pricingChangeAdvice')) { const panel = document.createElement('section'); panel.id = 'pricingChangeAdvice'; panel.className = 'card'; panel.innerHTML = changePanelHTML(); $('#changeSummaryPanel').before(panel); }
}
function refresh() {
  const panel = $('#pricingAssistant'); if (panel && !panel.contains(document.activeElement)) { const opened = [...panel.querySelectorAll('details[open][id]')].map(node => node.id); panel.innerHTML = assistantHTML(); for (const id of opened) { const node = document.getElementById(id); if (node) node.open = true; } }
  const changePanel = $('#pricingChangeAdvice'); if (changePanel && !changePanel.contains(document.activeElement)) changePanel.innerHTML = changePanelHTML();
  refreshAdvice();
}
document.addEventListener('submit', event => {
  if (!['serviceForm', 'ruleForm'].includes(event.target.id)) return;
  event.preventDefault();
  try {
    const next = clone(catalogue());
    if (event.target.id === 'serviceForm') {
      const service = formService(); if (!service.scope) throw new Error('请填写这个价格适用的交付范围。');
      const index = next.services.findIndex(item => item.id === service.id); if (index < 0) next.services.push(service); else next.services[index] = service;
      validateCatalogue(next); editor = null; saveCatalogue(next); toast('已保存个人标准，旧报价保持原价格。');
    } else {
      const rule = { id: ruleEditor.id || newId(), title: $('#rule-title').value.trim(), keywords: splitLines($('#rule-keywords').value), detail: $('#rule-detail').value.trim(), active: ruleEditor.active ?? true };
      const index = next.checks.findIndex(item => item.id === rule.id); if (index < 0) next.checks.push(rule); else next.checks[index] = rule;
      validateCatalogue(next); ruleEditor = null; saveCatalogue(next); $('#pricingRuleSettings').open = true; toast('已保存检查规则');
    }
  } catch (error) { $(event.target.id === 'serviceForm' ? '#serviceError' : '#ruleError').textContent = error.message; }
});
document.addEventListener('change', event => {
  if (event.target.id === 'changeService') { const service = activeServices().find(item => item.id === event.target.value); $('#changeServicePreview').textContent = service ? `${service.scope}；包含：${service.included.join('、') || '未填写'}；不含：${service.excluded.join('、') || '未填写'}。按 ${service.unit} 计价，请核对数量。` : ''; }
  if (event.target.id === 'changeAdviceReviewed') { state.change.pricingSuggestion.reviewed = event.target.checked; persist(); refreshDraftPreview(); }
  const id = event.target.dataset.servicePreview; if (!id) return;
  const service = activeServices().find(item => item.id === event.target.value);
  $(`#pricing-preview-${id}`).textContent = service ? `${service.scope}；包含：${service.included.join('、') || '未填写'}；不含：${service.excluded.join('、') || '未填写'}。按 ${service.unit} 计价，请核对交付数量。` : '';
});
document.addEventListener('input', event => {
  const key = event.target.id.replace(/^service-/, '');
  if (editor && event.target.closest('#serviceForm')) { const targetKey = { price: 'unitPrice', revisions: 'includedRevisions' }[key] || key; editor[targetKey] = ['included', 'excluded'].includes(key) ? splitLines(event.target.value) : ['price', 'revisions'].includes(key) ? event.target.value === '' ? null : Number(event.target.value) : event.target.value; }
  if (ruleEditor && event.target.closest('#ruleForm')) { const ruleKey = event.target.id.replace(/^rule-/, ''); ruleEditor[ruleKey] = ruleKey === 'keywords' ? splitLines(event.target.value) : event.target.value; }
  if (event.target.dataset.adviceAnswer !== undefined && state.change.pricingSuggestion) { state.change.pricingSuggestion.answers[Number(event.target.dataset.adviceAnswer)] = event.target.value; state.change.pricingSuggestion.reviewed = false; const checkbox = $('#changeAdviceReviewed'); if (checkbox) checkbox.checked = false; persist(); refreshDraftPreview(); }
});
document.addEventListener('click', async event => {
  const control = event.target.closest('[data-pricing-action], [data-edit-service], [data-toggle-service], [data-use-service], [data-resolve-check], [data-edit-rule], [data-toggle-rule], [data-adopt-match], [data-adopt-hint]'); if (!control) return;
  try {
    const action = control.dataset.pricingAction;
    if (action === 'ai-quote' || action === 'ai-change') await requestAdvice(action === 'ai-quote' ? 'quote' : 'change');
    if (control.dataset.adoptMatch !== undefined) {
      requireCurrentAdvice('quote'); const match = advice.data.matches[Number(control.dataset.adoptMatch)], item = state.draft.items.find(item => item.id === match.itemId), service = activeServices().find(service => service.id === match.serviceId);
      if (!item || !service) throw new Error('项目或收费标准已经改变，请重新生成建议。');
      mutate(() => { item.rate = 'manual'; item.unitPrice = service.unitPrice; item.pricingBasis = serviceSnapshot(service); item.pricingMatchEvidence = { model: advice.data.model, source: match.source, reason: match.reason, adoptedAt: new Date().toISOString() }; state.analysisReviewed = false; advice.appliedMatches.push(item.id); advice.signature = signature('quote'); }, { undoable: true }); toast('已采用个人标准，请核对本次数量与交付范围。');
    }
    if (control.dataset.adoptHint !== undefined) {
      requireCurrentAdvice('quote'); const index = Number(control.dataset.adoptHint), hint = advice.data.checkHints[index];
      if ((state.draft.conditions?.length || 0) >= 40) throw new Error('核对问题已达上限，请先整理现有问题。');
      mutate(() => { if (!state.draft.conditions) state.draft.conditions = QUESTION_META.map(meta => ({ id: meta.id, kind: 'other', title: meta.title, value: state.draft.answers[meta.id], source: state.draft.answerSources[meta.id] || '', required: true, priority: meta.priority })); if (!state.draft.conditions.some(item => item.title === hint.title)) state.draft.conditions.push({ id: `pricing-${newId()}`, kind: 'scope', title: hint.title, value: '', source: hint.source, required: true, priority: 1 }); state.analysisReviewed = false; advice.appliedHints.push(index); advice.signature = signature('quote'); }, { undoable: true }); toast('已加入核对问题，没有新增费用。');
    }
    if (action === 'use-change-service') {
      const service = activeServices().find(item => item.id === $('#changeService').value); if (!service) throw new Error('请先选择个人服务标准。');
      mutate(() => { state.change.unitPrice = service.unitPrice; state.change.itemName = state.change.itemName || service.name; state.change.pricingBasis = serviceSnapshot(service); if (state.change.pricingSuggestion) state.change.pricingSuggestion.reviewed = false; }, { undoable: true }); toast('已套用新增交付单价，数量、归因与交期仍需核对。');
    }
    if (action === 'adopt-change') {
      requireCurrentAdvice('change'); const proposal = advice.data.change; if (!proposal || proposal.type === 'unknown' || proposal.category === 'ambiguous') throw new Error('请先明确变更分类，再处理费用。');
      mutate(() => { const originalMessage = state.change.sourceText; const next = { ...resetChange(proposal.type), category: proposal.category, targetId: proposal.targetItemId || '', itemName: proposal.itemName || proposal.service?.name || '', quantity: proposal.quantity, unitPrice: proposal.type === 'add' ? proposal.price.unitPrice : null };
        if (proposal.type === 'add' && proposal.service) next.pricingBasis = serviceSnapshot(proposal.service);
        if (['included_revision','designer_error','extraction_error'].includes(proposal.category)) { next.reworkDecision = 'included'; next.replacementDecision = 'same'; }
        next.pricingSuggestion = { model: advice.data.model, source: proposal.source, originalMessage, reason: proposal.reason, questions: proposal.questions, answers: proposal.questions.map(() => ''), reviewed: false, adoptedAt: new Date().toISOString() };
        state.change = next; advice.changeApplied = true; advice.signature = signature('change'); }, { undoable: true }); toast('已采用为草稿，请核对建议中的问题、费用和交期。');
    }
    if (action === 'discard-change-receipt') { mutate(() => { delete state.change.pricingSuggestion; }, { undoable: true }); toast('已改为人工判断，请依据原约定核对。'); }
    if (action === 'catalogue-toggle') { catalogueOpen = !catalogueOpen; if (catalogueOpen) enhance(); $('#pricingCatalogue').hidden = !catalogueOpen; $('#pricingLibraryButton').setAttribute('aria-expanded', String(catalogueOpen)); }
    if (action === 'new-service' || action === 'service-template') { editor = blankService(); if (action === 'service-template') Object.assign(editor, { name: '活动报名 H5 套餐', category: '网站与 H5', scope: '手机活动介绍与报名页面；具体字段和上线方式由双方核对', included: ['手机布局', '活动介绍', '报名表单页面'], excluded: ['支付接入', '短信费用', '域名与服务器费用'] }); $('#pricingCatalogue').innerHTML = catalogueHTML(); $('#service-name').focus(); }
    if (action === 'cancel-editor') { editor = null; $('#pricingCatalogue').innerHTML = catalogueHTML(); }
    if (control.dataset.editService) { editor = clone(catalogue().services.find(service => service.id === control.dataset.editService)); $('#pricingCatalogue').innerHTML = catalogueHTML(); $('#service-name').focus(); }
    if (control.dataset.toggleService) { const next = clone(catalogue()); const service = next.services.find(item => item.id === control.dataset.toggleService); service.active = !service.active; service.updatedAt = new Date().toISOString(); saveCatalogue(next); }
    if (control.dataset.useService) {
      const item = state.draft.items.find(entry => entry.id === control.dataset.useService), service = activeServices().find(entry => entry.id === $(`#pricing-service-${item.id}`).value);
      if (!service) throw new Error('请先选择个人服务标准。');
      mutate(() => { item.rate = 'manual'; item.unitPrice = service.unitPrice; item.pricingBasis = serviceSnapshot(service); state.analysisReviewed = false; }, { undoable: true });
      toast(service.unitPrice === null ? '已记录收费范围，请补充本单单价。' : '已套用标准；请核对数量、范围和修改约定。');
    }
    if (control.dataset.resolveCheck) {
      const rule = checks().find(item => item.id === control.dataset.resolveCheck), choice = $(`#check-choice-${rule.id}`).value, note = $(`#check-note-${rule.id}`).value.trim(), itemId = $(`#check-item-${rule.id}`).value;
      if (!note) throw new Error('请填写核对依据，避免误把提示当成已确认。');
      const resolutions = { ...state.draft.pricingChecks, [rule.id]: { signature: rule.signature, choice, note, itemId } };
      if (choice === 'priced' && !quoteChecks(state.chat, draftItems(), catalogue(), resolutions).find(item => item.id === rule.id)?.resolved) throw new Error('请选择已经填写有效单价和数量的交付项。');
      mutate(() => { state.draft.pricingChecks = resolutions; state.analysisReviewed = false; }, { undoable: true }); toast(choice === 'ask' ? '已记录待确认，审核报价前仍需处理。' : '已记录核对结果，没有自动新增费用。');
    }
    if (action === 'new-rule') { ruleEditor = { title: '', keywords: [], detail: '', active: true }; $('#pricingCatalogue').innerHTML = catalogueHTML(); $('#pricingRuleSettings').open = true; $('#rule-title').focus(); }
    if (action === 'cancel-rule') { ruleEditor = null; $('#pricingCatalogue').innerHTML = catalogueHTML(); $('#pricingRuleSettings').open = true; }
    if (control.dataset.editRule) { ruleEditor = clone(catalogue().checks.find(rule => rule.id === control.dataset.editRule)); $('#pricingCatalogue').innerHTML = catalogueHTML(); $('#pricingRuleSettings').open = true; $('#rule-title').focus(); }
    if (control.dataset.toggleRule) { const next = clone(catalogue()); const rule = next.checks.find(item => item.id === control.dataset.toggleRule); rule.active = !rule.active; saveCatalogue(next); $('#pricingRuleSettings').open = true; }
  } catch (error) { toast(error.message); }
});
function snapshotReview() {
  return { checkedAt: new Date().toISOString(), checks: checks().map(rule => ({ id: rule.id, title: rule.title, source: rule.source, resolved: rule.resolved, choice: rule.resolution?.choice || 'ask', note: rule.resolution?.note || '', itemId: rule.resolution?.itemId || '' })) };
}
function importCatalogue(incoming, orders) {
  if (!incoming) return;
  validateCatalogue(incoming); const next = clone(catalogue()); const mapping = new Map();
  for (const service of incoming.services) { const same = next.services.find(item => JSON.stringify(item) === JSON.stringify(service)); if (same) { mapping.set(service.id, same.id); continue; } const id = next.services.some(item => item.id === service.id) ? newId() : service.id; mapping.set(service.id, id); next.services.push({ ...clone(service), id }); }
  for (const rule of incoming.checks) { if (next.checks.some(item => JSON.stringify(item) === JSON.stringify(rule))) continue; next.checks.push({ ...clone(rule), id: next.checks.some(item => item.id === rule.id) ? newId() : rule.id }); }
  validateCatalogue(next);
  for (const order of orders) for (const item of [...order.draft.items, ...order.versions.flatMap(version => version.items)]) if (item.pricingBasis && mapping.has(item.pricingBasis.id)) item.pricingBasis.id = mapping.get(item.pricingBasis.id);
  workspace.catalogue = next;
}
window.MingdanPricingUI = { enhance, refresh, refreshAdvice, reviewIssues, followupQuestions, changeIssues, snapshotReview, importCatalogue };
enhance();
refreshDraftPreview();
