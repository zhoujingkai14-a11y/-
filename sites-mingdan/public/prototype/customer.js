(() => {
  'use strict';
  const token = location.hash.slice(1);
  const container = document.querySelector('#customerContent');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const money = value => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value);
  const labels = { pending: '待你核对', confirmed: '本版已确认', changes_requested: '调整意见已提交', expired: '链接已过期', superseded: '已有更新版本', revoked: '设计师已撤回链接' };
  const descriptions = { confirmed: '你的回复已保存，设计师可以看到此版本的确认记录。', changes_requested: '你的意见已保存。请等待设计师整理并发送新的版本。', expired: '此链接超过有效期，请向设计师索取新链接。', superseded: '本页保留旧版内容供回看。请向设计师索取最新版本后再确认。', revoked: '本页保留旧版内容供回看，已无法提交回复。请联系设计师。' };
  let snapshot, submitting = false;
  const draftKey = `mingdan-customer-draft:${token}`;
  let draft = { name: '', comment: '' };
  try { const stored = JSON.parse(sessionStorage.getItem(draftKey)); if (stored && typeof stored.name === 'string' && typeof stored.comment === 'string') draft = stored; } catch {}
  function preserveDraft() {
    const form = document.querySelector('#responseForm');
    if (!form) return;
    draft = { name: form.elements.name.value, comment: form.elements.comment.value };
    try { sessionStorage.setItem(draftKey, JSON.stringify(draft)); } catch {}
  }
  async function request(options = {}) {
    let response, data;
    try { response = await fetch(`/api/customer/${token}`, { signal: AbortSignal.timeout(15000), ...options }); data = await response.json(); }
    catch { throw new Error('连接中断或超时。请检查网络，再点击“刷新回复状态”核查结果。'); }
    if (!response.ok) { const error = new Error(data.message || '请求失败，请重试。'); error.code = data.code; throw error; }
    return data;
  }
  function render() {
    document.title = `${snapshot.title} · V${snapshot.number} 确认清单`;
    const reply = snapshot.response;
    container.innerHTML = `<header class="customer-head"><h1>${esc(snapshot.title || '项目确认清单')}</h1><p class="muted">需求与报价 · V${snapshot.number}</p><p class="muted">${snapshot.clientName ? `致 ${esc(snapshot.clientName)}。` : ''}请核对交付内容、条件与金额，确认一致后再回复。</p></header>
      <div class="customer-summary"><div><small>本版报价合计</small><strong>${money(snapshot.total)}</strong></div><span class="badge ${snapshot.status === 'pending' ? 'warn' : ''}">${labels[snapshot.status] || '查看清单'}</span></div>
      ${snapshot.status !== 'pending' ? `<section class="customer-state" role="status"><h2>${labels[snapshot.status]}</h2><p>${descriptions[snapshot.status]}</p>${reply ? `<p>${esc(reply.name)} · ${esc(new Date(reply.respondedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}<br>${esc(reply.comment || '已确认本版清单与价格')}</p>` : ''}</section>` : ''}
      ${snapshot.change ? `<section class="notice" style="margin-bottom:28px"><strong>这一版改了什么</strong><p>基于 V${snapshot.change.baseVersion}：${esc(snapshot.change.description)}<br>费用变化：${snapshot.change.delta >= 0 ? '+' : ''}${money(snapshot.change.delta)}${snapshot.change.scheduleText ? `<br>排期：${esc(snapshot.change.scheduleText)}` : ''}</p></section>` : ''}
      <div class="customer-layout"><div><h2>交付清单</h2><ol class="customer-items">${snapshot.items.map(item => `<li><div class="customer-item-top"><h3>${esc(item.name)} <span class="small muted">× ${item.quantity}</span></h3><strong>${money(item.amount)}</strong></div>${item.specification ? `<p>${esc(item.specification)}</p>` : ''}</li>`).join('')}</ol>
      ${snapshot.feeAdjustments.length ? `<div class="customer-conditions"><h2>费用调整</h2>${snapshot.feeAdjustments.map(item => `<div class="customer-item-top customer-condition"><span>${esc(item.label)}</span><strong>${money(item.amount)}</strong></div>`).join('')}</div>` : ''}
      <section class="customer-conditions"><h2>交付与协作条件</h2><dl>${snapshot.conditions.map(item => `<div class="customer-condition"><dt>${esc(item.title)}</dt><dd>${esc(item.value || '未记录')}</dd></div>`).join('')}</dl></section></div>
      ${snapshot.status === 'pending' ? `<form id="responseForm" class="customer-response"><h2>回复这一版</h2><p class="hint">确认会锁定 V${snapshot.number} 的清单与金额。需要修改时，请填写具体意见。</p><div class="field"><label for="customerName">你的称呼 <span class="muted">必填</span></label><input id="customerName" name="name" maxlength="100" autocomplete="name" required></div><div class="field"><label for="customerComment">意见或补充说明</label><textarea id="customerComment" name="comment" maxlength="3000" placeholder="有不同意见时，请说明哪一项需要调整。"></textarea></div><label class="check-label"><input id="customerReviewed" name="reviewed" type="checkbox" required><span>我已逐项核对本版交付内容、条件与总金额。</span></label><div class="actions"><button type="submit" name="action" value="confirm" class="button">确认本版清单与价格</button><button type="submit" name="action" value="changes" class="button secondary">提出调整意见</button></div><p id="customerError" class="customer-error" role="alert" tabindex="-1"></p><p class="hint">链接有效至 ${esc(new Date(snapshot.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}。</p></form>` : `<aside class="customer-response"><h2>回复已关闭</h2><p class="hint">${descriptions[snapshot.status]}</p><button type="button" id="refreshCustomer" class="button secondary">刷新状态</button></aside>`}</div>`;
    restoreForm();
  }
  function restoreForm() {
    const form = document.querySelector('#responseForm');
    if (!form) { try { sessionStorage.removeItem(draftKey); } catch {} return; }
    form.elements.name.value = draft.name;
    form.elements.comment.value = draft.comment;
    const progress = document.createElement('p'); progress.id = 'customerProgress'; progress.className = 'hint'; progress.setAttribute('role', 'status');
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.id = 'refreshCustomer'; refresh.className = 'text-button'; refresh.textContent = '刷新回复状态';
    document.querySelector('#customerError').before(progress);
    form.append(refresh);
  }
  async function load() {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { container.innerHTML = '<div class="customer-loading"><h1>确认链接不完整</h1><p>请打开设计师发送的完整链接，其中应包含 # 后的访问码。</p></div>'; return; }
    preserveDraft(); container.setAttribute('aria-busy', 'true');
    try { snapshot = await request(); render(); }
    catch (error) {
      const errorField = document.querySelector('#customerError');
      if (snapshot && errorField) { errorField.textContent = `${error.message} 填写内容仍保留在当前页面。`; errorField.focus(); }
      else container.innerHTML = `<div class="customer-loading"><h1>暂时无法打开清单</h1><p>${esc(error.message)}</p><button id="refreshCustomer" type="button" class="button secondary">重新加载</button></div>`;
    } finally { container.setAttribute('aria-busy', 'false'); }
  }
  document.addEventListener('submit', async event => {
    if (event.target.id !== 'responseForm') return;
    event.preventDefault(); if (submitting) return;
    const form = event.target, errorField = document.querySelector('#customerError');
    const action = event.submitter?.value || 'confirm', comment = form.elements.comment.value.trim();
    if (action === 'changes' && !comment) { errorField.textContent = '请填写需要调整的具体内容。'; form.elements.comment.focus(); return; }
    preserveDraft();
    submitting = true; form.querySelectorAll('button').forEach(button => button.disabled = true); errorField.textContent = '';
    document.querySelector('#customerProgress').textContent = '正在保存回复，请稍候…';
    try {
      const result = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, name: form.elements.name.value.trim(), comment, reviewed: form.elements.reviewed.checked, digest: snapshot.digest }) });
      snapshot.status = result.status; snapshot.response = result.response; render(); container.focus();
    } catch (error) {
      try {
        const current = await request();
        if (current.status !== 'pending') { snapshot = current; render(); container.focus(); return; }
      } catch {}
      errorField.textContent = `${error.message} 请先刷新回复状态，再决定是否重新提交。`;
      errorField.focus(); form.querySelectorAll('button').forEach(button => button.disabled = false);
    }
    finally { submitting = false; const progress = document.querySelector('#customerProgress'); if (progress) progress.textContent = ''; }
  });
  document.addEventListener('click', event => { if (event.target.closest('.skip-link')) { event.preventDefault(); container.focus(); } if (event.target.id === 'refreshCustomer') load(); });
  document.addEventListener('input', event => { if (event.target.closest('#responseForm')) preserveDraft(); });
  window.addEventListener('hashchange', () => {
    if (location.hash.slice(1) !== token && location.hash !== '#customerContent') { preserveDraft(); location.reload(); }
  });
  load();
})();
