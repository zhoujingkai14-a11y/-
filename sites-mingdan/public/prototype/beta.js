(() => {
  'use strict';
  const $ = selector => document.querySelector(selector), account = window.MingdanAccount;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const currency = value => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const date = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  let overview = null, refreshing = false, policyBusy = false, hasUsage = false;
  const rowMessages = new Map(), pendingActions = new Set();
  function message(text, error = false, target = '#pageMessage') {
    if (target.startsWith('#invite-') || target.startsWith('#member-')) rowMessages.set(target, { text, error });
    const box = $(target) || $(target.startsWith('#member-') ? '#memberMessage' : '#inviteMessage');
    box.hidden = !text; box.textContent = text;
    box.classList.toggle('is-error', error); box.setAttribute('role', error ? 'alert' : 'status');
  }
  function rowMessage(target) {
    const value = rowMessages.get(target);
    return `<p id="${esc(target.slice(1))}" class="message record-message${value?.error ? ' is-error' : ''}" role="${value?.error ? 'alert' : 'status'}" aria-live="polite"${value?.text ? '' : ' hidden'}>${esc(value?.text)}</p>`;
  }
  async function api(path, input) {
    const response = await fetch(path, { method: input ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-Mingdan-Account': account?.id || '', ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}) });
    const data = await response.json();
    if (!response.ok) {
      if (['LOGIN_REQUIRED', 'ACCOUNT_CHANGED'].includes(data.code)) location.replace('/prototype/account.html');
      throw new Error(data.message || '连接失败，请稍后重试。');
    }
    return data;
  }
  function renderUsage(usage) {
    const budget = usage.siteBudget;
    $('#usageCards').innerHTML = `<div class="metric"><p class="metric-label">${usage.dailyLimit ? '今日剩余 AI 次数' : '今日 AI 调用'}</p><p class="metric-value">${usage.dailyLimit ? usage.dailyRemaining : usage.callsToday}${usage.dailyLimit ? `<small>/ ${usage.dailyLimit}</small>` : '<small>次</small>'}</p><p class="field-help">每分钟最多 ${usage.userMinuteLimit} 次，同账号同时 1 个任务</p></div><div class="metric"><p class="metric-label">${usage.monthlyLimit ? '本月剩余 AI 次数' : '本月 AI 调用'}</p><p class="metric-value">${usage.monthlyLimit ? usage.monthlyRemaining : usage.callsThisMonth}${usage.monthlyLimit ? `<small>/ ${usage.monthlyLimit}</small>` : '<small>次</small>'}</p><p class="field-help">成功 ${usage.succeeded} 次 · 失败 ${usage.failed} 次</p></div><div class="metric"><p class="metric-label">${account.role === 'owner' ? budget.enabled ? '全站月预算剩余' : '全站本月费用估算' : '本月用量折算'}</p><p class="metric-value">¥${currency(account.role === 'owner' ? budget.enabled ? budget.remainingCny : budget.accountedCny : usage.estimatedCny)}</p><p class="field-help">${account.role === 'owner' ? budget.enabled ? `月预算 ¥${currency(budget.limitCny)} · 已记账 ¥${currency(budget.accountedCny)}` : '未设置站内预算上限，实际余额以 DeepSeek 为准' : `输入 ${usage.inputTokens.toLocaleString()} / 输出 ${usage.outputTokens.toLocaleString()} tokens`}</p></div>`;
    $('#usageCards').setAttribute('aria-busy', 'false');
    $('#usageNote').textContent = `${usage.paused ? 'AI 当前已暂停。' : '需求整理与报价建议均记录用量。'}${usage.priceReviewRequired ? '计价资料已到复核日期，费用估算可能过期。' : ''}返回后按模型用量与已核对价格估算；失败也可能消耗调用次数。${usage.conservativeCalls || budget.conservativeCalls ? `其中 ${account.role === 'owner' ? budget.conservativeCalls : usage.conservativeCalls} 次缺少完整用量，费用采用保守估算。` : ''}这不是 DeepSeek 余额或实际账单，也不向你收费。统计按北京时间自然日、自然月计算。`;
  }
  function renderOwner(data) {
    overview = data; $('#ownerArea').hidden = false;
    $('#pageHeading').textContent = '站点管理';
    const pending = data.invites.filter(item => item.purpose === 'signup' && item.status === 'pending' && item.expires_at > Date.now()).length;
    $('#seatsLabel').textContent = `${data.userCount} 位账号 · ${pending} 位待注册邀请${data.maxUsers ? ` / 上限 ${data.maxUsers} 位` : ' · 无人数上限'}`;
    $('#aiPolicyLabel').textContent = data.policy.ai_enabled ? data.usage.siteBudget.enabled ? '已开放，受调用频率与月预算限制' : '已开放，未设置月预算上限；保留调用频率保护' : '已暂停，仍可手动整理和查看历史版本';
    $('#registrationPolicyLabel').textContent = data.policy.registration_enabled ? data.registrationMode === 'public' ? '公开注册，无需邀请链接' : '只允许持有效邀请链接注册' : '暂停新注册，已有账号仍可登录';
    $('#toggleAI').textContent = data.policy.ai_enabled ? '暂停 AI' : '恢复 AI';
    $('#toggleRegistration').textContent = data.policy.registration_enabled ? '暂停注册' : '恢复注册';
    const statuses = { pending: '待使用', used: '已使用', expired: '已过期', revoked: '已撤回' };
    $('#invitationList').innerHTML = data.invites.length ? data.invites.map(item => {
      const active = item.status === 'pending' && item.expires_at > Date.now();
      const target = `#invite-${item.id}`;
      return `<div class="record"><div class="record-detail"><strong>${esc(item.email)}</strong><p>${item.purpose === 'signup' ? '邀请注册' : '账号恢复'} · ${item.status === 'pending' && !active ? '已过期' : statuses[item.status] || esc(item.status)} · ${esc(date(item.expires_at))} 到期</p></div>${active ? `<button type="button" class="text-button" data-revoke="${esc(item.id)}"${pendingActions.has(target) ? ' disabled' : ''} aria-label="撤回 ${esc(item.email)} 的邀请">撤回</button>` : ''}${rowMessage(target)}</div>`;
    }).join('') : '<p class="empty-state">还没有发出邀请。确认首批设计师邮箱后，从这里开始。</p>';
    $('#memberList').innerHTML = data.users.length ? data.users.map(user => {
      const target = `#member-${user.id}`;
      return `<div class="record"><div class="record-detail"><strong>${esc(user.name)} <span class="muted">· ${esc(user.email)}</span></strong><p>${user.status === 'active' ? '使用中' : '已暂停'} · ${user.order_count} 笔订单 · ${user.version_count} 个报价版本 · 本月 ${user.ai_calls} 次 AI</p><p>最近登录：${user.last_login_at ? esc(date(user.last_login_at)) : '尚未登录'} · 预算记账 ¥${currency(user.cost_units / 1000000)}</p></div><button class="text-button" type="button" data-account="${esc(user.id)}" data-status="${user.status === 'active' ? 'paused' : 'active'}"${pendingActions.has(target) ? ' disabled' : ''} aria-label="${user.status === 'active' ? '暂停' : '恢复'} ${esc(user.name)} 的账号">${user.status === 'active' ? '暂停账号' : '恢复账号'}</button>${rowMessage(target)}</div>`;
    }).join('') : '<p class="empty-state">首位设计师注册后，会显示在这里。每位设计师拥有独立工作区。</p>';
    const categories = { bug: '问题', suggestion: '建议', pricing: '报价体验' };
    $('#feedbackList').innerHTML = data.feedback.length ? data.feedback.map(item => `<article class="record"><div class="record-detail"><h3>${esc(item.name)} · ${categories[item.category] || esc(item.category)}</h3><p>${esc(date(item.created_at))}</p><p class="record-text">${esc(item.text)}</p></div></article>`).join('') : '<p class="empty-state">还没有收到反馈。先完成真实订单，再评估订阅方案。</p>';
  }
  async function refresh() {
    if (refreshing) return false;
    refreshing = true; $('#refreshButton').disabled = true;
    $('#usageCards').setAttribute('aria-busy', 'true');
    message('', false, '#usageMessage');
    let usageUpdated = false;
    try {
      const current = await api('/api/me');
      $('#accountIdentity').textContent = `${current.user.name} · ${current.user.role === 'owner' ? '站点管理者' : current.user.email}`;
      $('#securityArea').hidden = current.user.role !== 'designer';
      renderUsage(current.usage); hasUsage = true; usageUpdated = true;
      if (current.user.role === 'owner') { const data = await api('/api/admin/overview'); renderOwner(data); }
      return true;
    } catch (error) {
      if (!hasUsage) $('#usageCards').innerHTML = '<p class="metric-state muted">暂时无法读取额度与预算，请点击上方“刷新用量”重试。</p>';
      const prefix = usageUpdated ? '用量已更新，但管理信息未刷新。' : hasUsage ? '刷新失败，下方保留上次数据，尚未更新。' : '额度加载失败。';
      message(`${prefix}${error.message}请点击“刷新用量”重试。`, true, '#usageMessage');
      return false;
    }
    finally { refreshing = false; $('#refreshButton').disabled = false; $('#usageCards').setAttribute('aria-busy', 'false'); }
  }
  async function withButton(button, action, target = '#pageMessage', pending = '正在处理…') {
    if (button.disabled || pendingActions.has(target)) return;
    button.disabled = true; pendingActions.add(target); message(pending, false, target);
    try { await action(); } catch (error) { message(error.message, true, target); }
    finally {
      pendingActions.delete(target); button.disabled = false;
      const current = $(target)?.closest('.record')?.querySelector('button'); if (current) current.disabled = false;
    }
  }
  $('#refreshButton').addEventListener('click', refresh);
  $('#logoutButton').addEventListener('click', event => withButton(event.currentTarget, async () => {
    await api('/api/logout', {}); localStorage.setItem('mingdan-active-account', ''); location.replace('/prototype/account.html');
  }));
  $('#inviteForm').addEventListener('submit', event => {
    event.preventDefault(); withButton($('#createInvite'), async () => {
      const result = await api('/api/admin/invites', { email: $('#inviteEmail').value.trim(), purpose: $('#invitePurpose').value });
      $('#inviteResult').hidden = false; $('#inviteURL').value = result.url;
      $('#inviteExpiry').textContent = `${result.email} · ${date(result.expiresAt)} 到期`;
      message('', false, '#copyMessage');
      const updated = await refresh();
      message(`链接已生成，请立即复制并保存。${updated ? '' : '管理列表暂未更新，请稍后刷新。'}`, false, '#inviteMessage');
      $('#inviteURL').focus(); $('#inviteURL').select();
    }, '#inviteMessage', '正在生成专属链接…');
  });
  $('#copyInvite').addEventListener('click', event => withButton(event.currentTarget, async () => {
    try { await navigator.clipboard.writeText($('#inviteURL').value); message('邀请链接已复制。请只发送给对应邮箱的设计师。', false, '#copyMessage'); }
    catch { $('#inviteURL').focus(); $('#inviteURL').select(); message('浏览器未允许自动复制，请使用 Ctrl+C 或长按复制已选中的链接。', false, '#copyMessage'); }
  }, '#copyMessage', '正在复制链接…'));
  async function setPolicy(field) {
    if (policyBusy || !overview || refreshing) return;
    policyBusy = true; $('#toggleAI').disabled = true; $('#toggleRegistration').disabled = true;
    message('正在更新开关…', false, '#policyMessage');
    try {
      await api('/api/admin/settings', { aiEnabled: field === 'ai' ? !overview.policy.ai_enabled : Boolean(overview.policy.ai_enabled),
        registrationEnabled: field === 'registration' ? !overview.policy.registration_enabled : Boolean(overview.policy.registration_enabled) });
      const updated = await refresh();
      message(`开关已保存。${updated ? '已有数据继续保留。' : '显示状态暂未更新，请刷新后继续操作。'}`, false, '#policyMessage');
    } catch (error) { message(error.message, true, '#policyMessage'); }
    finally { policyBusy = false; $('#toggleAI').disabled = false; $('#toggleRegistration').disabled = false; }
  }
  $('#toggleAI').addEventListener('click', () => setPolicy('ai'));
  $('#toggleRegistration').addEventListener('click', () => setPolicy('registration'));
  $('#ownerArea').addEventListener('click', event => {
    const revoke = event.target.closest('[data-revoke]'), user = event.target.closest('[data-account]');
    if (revoke) {
      const target = `#invite-${revoke.dataset.revoke}`;
      withButton(revoke, async () => {
        await api(`/api/admin/invites/${revoke.dataset.revoke}/revoke`, {});
        const updated = await refresh(); message(`邀请已撤回。${updated ? '' : '列表尚未更新，请稍后刷新。'}`, false, target);
      }, target, '正在撤回邀请…');
    }
    if (user) {
      const target = `#member-${user.dataset.account}`;
      withButton(user, async () => {
        await api(`/api/admin/users/${user.dataset.account}`, { status: user.dataset.status });
        const updated = await refresh(); message(`账号状态已更新，已有数据继续保留。${updated ? '' : '列表尚未更新，请稍后刷新。'}`, false, target);
      }, target, '正在更新账号…');
    }
  });
  $('#feedbackForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('#sendFeedback'); if (button.disabled) return;
    button.disabled = true; message('', false, '#feedbackMessage');
    try {
      await api('/api/feedback', { category: $('#feedbackCategory').value, text: $('#feedbackText').value.trim() });
      $('#feedbackText').value = ''; message('反馈已收到，谢谢你描述具体情况。', false, '#feedbackMessage');
      if (account?.role === 'owner') await refresh();
    } catch (error) { message(error.message, true, '#feedbackMessage'); }
    finally { button.disabled = false; }
  });
  $('#recoveryKeyForm').addEventListener('submit', event => {
    event.preventDefault();
    withButton($('#rotateRecoveryKey'), async () => {
      const result = await api('/api/account/recovery-key', { password: $('#currentPassword').value });
      $('#currentPassword').value = ''; $('#newRecoveryKeyArea').hidden = false; $('#newRecoveryKey').value = result.recoveryKey;
      message('新密钥已生成，旧密钥已失效。请现在复制并保存。', false, '#recoveryKeyMessage');
      $('#newRecoveryKey').focus(); $('#newRecoveryKey').select();
    }, '#recoveryKeyMessage');
  });
  window.addEventListener('storage', event => { if (event.key === 'mingdan-active-account' && event.newValue !== account?.id) location.replace('/prototype/account.html'); });
  if (account) refresh();
})();
