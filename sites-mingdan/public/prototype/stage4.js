(() => {
  'use strict';
  let connection = null, revision = 0, ready = false, blocked = false, dirty = 0, saved = 0, saveTimer, saving = null, busy = false, pendingAnalysis = null;
  const account = window.MingdanAccount;
  const revisionKey = `mingdan-account-${account?.id || 'signed-out'}-revision`;
  const backupKey = `mingdan-account-${account?.id || 'signed-out'}-before-sync`;
  const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const shareLabels = { pending: '等待客户回复', confirmed: '客户已在线确认', changes_requested: '客户提出了调整', expired: '链接已过期', superseded: '已由新版本替代', revoked: '链接已撤回' };

  async function api(path, options = {}) {
    let response;
    try { response = await fetch(path, { credentials: 'same-origin', signal: AbortSignal.timeout(75000), ...options,
      headers: { 'Content-Type': 'application/json', 'X-Mingdan-Account': account?.id || 'signed-out', ...options.headers } }); }
    catch { throw new Error('无法连接服务端，当前草稿仍保存在此浏览器。请检查网络后重试。'); }
    let data;
    try { data = await response.json(); } catch { throw new Error('服务端未返回可读取的结果，请重新检测连接。'); }
    if (!response.ok) { const error = new Error(data.message || '请求失败，请重试。'); error.code = data.code; throw error; }
    return data;
  }
  function cache() { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); }
  function mergeResponses(remote) {
    for (const order of workspace.orders) {
      const counterpart = remote.orders.find(item => item.id === order.id);
      for (const version of order.versions) {
        const record = counterpart?.versions.find(item => item.id === version.id);
        if (!record?.share) continue;
        for (const key of ['share', 'status', 'confirmationMode', 'confirmationEvidence', 'confirmedAt']) version[key] = clone(record[key]);
      }
    }
    cache();
  }
  function showConnection(message = '') {
    const syncLabel = blocked ? '同步已暂停 · 本机留存' : !ready ? '仅本机留存' : saving || dirty > saved ? '服务端同步中 · 本机已保存' : '服务端与本机已保存';
    let panel = $('#stage4Connection');
    if (!panel) { panel = document.createElement('div'); panel.id = 'stage4Connection'; panel.className = 'connection-line'; $('.topbar').after(panel); }
    const usage = connection?.aiUsage;
    const aiText = !connection ? '正在检测 AI 状态' : !connection.aiConfigured ? 'AI 暂未配置，可先手动整理' : usage?.paused ? 'AI 暂停中，草稿与手动整理可继续使用' : usage?.dailyLimit || usage?.monthlyLimit ? `AI 已连接 · 今日剩余 ${usage?.dailyRemaining ?? '不限'} 次 · 本月剩余 ${usage?.monthlyRemaining ?? '不限'} 次` : `AI 已连接 · 每分钟最多 ${usage?.userMinuteLimit ?? 2} 次 · 每次结果请人工核对`;
    panel.innerHTML = `<div><strong>${blocked?'服务端同步已暂停':ready?'服务端已连接':message?'服务端未连接':'连接服务端中'}</strong><span>${esc(message || aiText)}</span></div><div class="actions"><a class="text-button" href="beta.html">${account?.role === 'owner' ? '站点管理' : '账号与用量'}</a><button type="button" class="text-button" data-action="check-connection">重新检测连接</button><button type="button" class="text-button" data-action="logout-account">退出账号</button>${localStorage.getItem(backupKey)?'<button type="button" class="text-button" data-action="export-sync-backup">导出同步前备份</button>':''}${blocked?'<button type="button" class="button secondary" data-action="reload-server">保留备份并拉取服务端版本</button>':''}</div>`;
    const status = $('.status-end'); if (status) status.textContent = syncLabel;
    $('.local-status').textContent = syncLabel;
    $('.side-bottom p').textContent = !ready || blocked ? '当前修改保留在本机。请导出备份并恢复连接后同步。' : saving || dirty > saved ? '当前修改正在同步，草稿已在本机留存。' : '草稿已同步到服务端。客户通过独立确认页回复，历史版本留存。';
    const identity = $('.order-details');
    if (identity) { const badge = identity.querySelector('.badge'); if (badge) badge.textContent = syncLabel; const note = identity.querySelector('.hint:last-child'); if (note) note.textContent = `${syncLabel}。导出的备份包含客户消息与报价，请妥善保管。`; }
  }
  function scheduleSave() {
    dirty++;
    clearTimeout(saveTimer);
    if (ready && !blocked) saveTimer = setTimeout(() => flush().catch(error => toast(error.message)), 650);
    showConnection();
  }
  function flush() {
    if (!ready || blocked) throw new Error('服务端尚未连接或同步已暂停，请先恢复连接。');
    if (saving) return saving;
    saving = Promise.resolve().then(async () => {
      while (saved < dirty) {
        const checkpoint = dirty;
        showConnection();
        const result = await api('/api/workspace', { method: 'PUT', body: JSON.stringify({ revision, workspace: clone(workspace) }) });
        revision = result.revision; saved = checkpoint;
        localStorage.setItem(revisionKey, String(revision));
      }
    }).catch(error => { blocked = true; showConnection(error.message); throw error; }).finally(() => { saving = null; showConnection(); });
    return saving;
  }
  async function connect(force = false) {
    try {
      connection = await api('/api/status');
      const remote = await api('/api/workspace');
      if (remote.workspace) {
        const localRevision = Number(localStorage.getItem(revisionKey) ?? -1);
        if (force || localRevision !== remote.revision) {
          localStorage.setItem(backupKey, JSON.stringify({ kind: 'mingdan-backup', schema: 1, orders: workspace.orders, ...(workspace.catalogue ? { catalogue: workspace.catalogue } : {}) }));
          workspace = remote.workspace; state = workspace.orders.find(order => order.id === workspace.activeId) || workspace.orders[0]; undoStack.length = 0;
          cache(); dirty = saved;
        } else { mergeResponses(remote.workspace); if (stableJSON(workspace) !== stableJSON(remote.workspace)) dirty++; }
      }
      for (const order of workspace.orders) for (const version of order.versions) if (version.status === 'client-confirmed' && !version.confirmationMode && !version.share) version.confirmationMode = 'manual';
      revision = remote.revision; localStorage.setItem(revisionKey, String(revision)); ready = true; blocked = false;
      if (!remote.workspace) dirty++;
      if (dirty > saved) await flush();
      render(); showConnection();
    } catch (error) {
      ready = false; showConnection(error.message);
      if (['LOGIN_REQUIRED', 'ACCOUNT_CHANGED'].includes(error.code)) showLogin();
    }
  }
  function showLogin() {
    location.replace('/prototype/account.html');
  }
  function applyAnalysis(analysis) {
    mutate(() => {
      state.chat = analysis.text;
      state.analysis = analysis; state.extracted = true; state.inputDirty = false; state.analysisReviewed = false;
      state.draft.items = clone(analysis.items); state.draft.conditions = clone(analysis.conditions);
      state.draft.answers = { delivery: '', revisions: '', sourceFile: '', sizes: '' }; state.draft.answerSources = {}; state.draft.sourceChoice = 'no';
      if (!state.title.trim() && analysis.title) state.title = analysis.title;
      state.replyHistory = []; state.replyApplied = []; state.proposals = []; state.followupText = ''; state.page = 1;
    }, { undoable: true });
    window.dispatchEvent(new CustomEvent('mingdan:extracted', { detail: { sourceRect: null, sourceText: analysis.items[0]?.source || '' } }));
  }
  async function extractAI(withReply = false) {
    if (busy) return;
    if (!state.chat.trim()) { toast('请先输入客户消息。'); $('#chatInput').focus(); return; }
    if (withReply && !state.replyText.trim()) { toast('请先填写客户的补充回复。'); $('#replyInput').focus(); return; }
    const orderId = state.id, originalText = state.chat, reply = state.replyText, date = state.messageDate;
    const text = withReply ? `${originalText}\n\n客户补充回复（${state.replyDate}）：\n${reply}` : originalText;
    busy = true; enhance();
    try {
      const analysis = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ text, messageDate: date }) });
      if (state.id !== orderId || state.chat !== originalText || state.messageDate !== date || withReply && state.replyText !== reply) { toast('等待期间消息已修改或订单已切换，本次结果未应用。'); return; }
      if (state.draft.items.length) {
        pendingAnalysis = { analysis, orderId, text: originalText, date, reply: withReply ? reply : null };
        const preview = document.createElement('div'); preview.id = 'newAnalysisPreview'; preview.className = 'notice';
        preview.innerHTML = `<strong>AI 已生成新的候选草稿</strong><p>${analysis.items.length} 项交付、${analysis.conditions.length} 项条件。应用后会重建当前草稿，已有报价版本仍可查看；当前草稿可撤销。</p><div class="actions"><button class="button" data-action="apply-ai-result">应用新草稿</button><button class="button secondary" data-action="cancel-ai-result">保留当前草稿</button></div>`;
        $('#newAnalysisPreview')?.remove(); $('.composer').append(preview);
      } else { applyAnalysis(analysis); toast('AI 候选已生成，请核对原话、缺项与数量，再填写自己的单价。'); }
    } catch (error) { toast(error.message); }
    finally { busy = false; try { connection = await api('/api/status'); } catch {} enhance(); }
  }
  function startManual() {
    if (!state.chat.trim()) { toast('请先粘贴客户消息。'); return; }
    if (state.draft.items.length) { state.page = 1; render(); return; }
    applyAnalysis({ version: 'manual-1.0', mode: 'manual', text: state.chat, items: [], facts: {}, dateCandidates: [], issues: [],
      conditions: ['交付内容与范围如何约定？', '何时交付、对应哪个阶段？', '客户与设计师分别提供哪些资料？', '修改范围与轮次如何约定？', '如何交付与验收？'].map((title, index) => ({ id: `condition-${index + 1}`, title, kind: ['scope', 'delivery', 'materials', 'revision', 'acceptance'][index], value: '', source: '', required: true, priority: index + 1 })) });
    toast('已保留原文，当前为手动整理，没有调用 AI。');
  }
  function enhance() {
    showConnection();
    $('.mode-badge').textContent = '设计师工作台';
    if (state.page === 0) {
      const button = $('[data-action="extract"], [data-action="ai-extract"]');
      const unavailable = !ready || blocked || !connection?.aiConfigured || connection?.aiUsage?.paused || connection?.aiUsage?.dailyRemaining === 0 || connection?.aiUsage?.monthlyRemaining === 0;
      if (button) { button.dataset.action = 'ai-extract'; button.disabled = busy || unavailable;
        button.innerHTML = busy ? '<span class="loading-dot" aria-hidden="true"></span>正在理解与核对原话…' : 'AI 整理需求 <span aria-hidden="true">↗</span>'; }
      const note = $('.privacy-note'); if (note) note.textContent = connection?.aiConfigured ? unavailable ? 'AI 暂停或额度不足，可继续手动整理；账号页可查看用量' : '点击后将客户消息发送至 DeepSeek，每次最多 8,000 字' : 'AI 尚未连接，可先手动建立交付清单';
      if (!$('#manualStart')) { const button = document.createElement('button'); button.id = 'manualStart'; button.className = 'button secondary'; button.dataset.action = 'manual-start'; button.textContent = '手动整理'; $('.composer-actions').append(button); }
      const limits = $('#parserLimits p'); if (limits) limits.textContent = 'AI 会生成带原话依据的候选清单，仍需设计师核对。未配置密钥、服务失败或依据不匹配时，保留原文与草稿，可转为手动整理。重新 AI 整理后可选择是否应用新草稿。';
      const subtitle = $('#inputState'); if (subtitle && !state.inputDirty) subtitle.textContent = '支持设计、品牌、官网与 H5 等项目需求';
      const replyButton = $('[data-action="parse-reply"], [data-action="ai-reply"]');
      if (replyButton) { replyButton.dataset.action = 'ai-reply'; replyButton.textContent = '合并补充回复，重新 AI 整理'; replyButton.disabled = busy || unavailable; }
      if (state.analysis?.mode === 'ai') { $('.insight-panel h2').textContent = 'AI 候选已生成'; $('.insight-panel>p').textContent = state.analysis.summary || '请逐项核对后再生成报价。'; }
      if (state.analysis?.mode === 'manual') { $('.insight-panel h2').textContent = '原文已留存'; $('.insight-panel>p').textContent = '进入第二步手动建立清单。'; }
    }
    if (state.page === 1 && state.analysis?.mode === 'ai') {
      const audit = $('.audit-body p'); if (audit) audit.textContent = `AI 候选 · ${state.analysis.model}。结构和引用已校验，需求是否完整、含义是否正确仍需人工审核。`;
    }
    if (state.page === 1 && state.analysis?.mode === 'manual') { const audit = $('.audit-body p'); if (audit) audit.textContent = '当前为手动整理，未调用 AI。请对照完整原文逐项核对后，再勾选下方审核。'; }
    if (state.page === 2 && selectedVersion()) {
      const version = selectedVersion();
      const existing = $('#sharePanel'); existing?.remove();
      const panel = document.createElement('section'); panel.id = 'sharePanel'; panel.className = 'card share-panel';
      const share = version.share;
      panel.innerHTML = `<h2>让客户核对这个版本</h2><p class="hint">客户只会看到交付、条件、金额与变更摘要；回复绑定 V${version.number}。</p>${share?`<div class="notice ${share.status==='confirmed'?'good':''}"><strong>${shareLabels[share.status]||share.status}</strong>${share.response?`<p>${esc(share.response.name)}：${esc(share.response.comment||'已确认本版清单与价格')}<br>${esc(new Date(share.response.respondedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}</p>`:''}</div><div class="field" style="margin-top:14px"><label for="customerLink">客户确认链接</label><input id="customerLink" readonly value="${esc(share.url)}"></div><div class="actions"><button class="button" data-action="copy-customer-link">复制链接</button><a class="button secondary" href="${esc(share.url)}" target="_blank" rel="noreferrer">预览客户页面</a><button class="text-button" data-action="refresh-client">刷新客户回复</button>${['pending','changes_requested'].includes(share.status)?'<button class="text-button" data-action="revoke-share">撤回链接</button>':''}</div>`:`<button class="button" data-action="publish-share" ${version.status!=='designer-reviewed'||version!==state.versions.at(-1)||!ready?'disabled':''}>生成客户确认链接</button><p class="hint">先完成设计师审核，再生成最新版本的链接。</p>`}${connection?.localOnly?'<p class="small muted" style="margin-top:14px">本机联调链接只能在这台电脑打开。发布到服务器后，才能发送给外部客户。</p>':''}`;
      $('.grid>.stack').prepend(panel);
      const manualButton = $('[data-action="confirm-version"]');
      if (manualButton) { manualButton.textContent = '记录线下客户确认'; manualButton.disabled = Boolean(share) || version.status !== 'designer-reviewed' || !state.confirmationEvidence.trim(); manualButton.closest('.actions').hidden = Boolean(share); }
      const manualField = $('#confirmationEvidence');
      if (manualField) { manualField.readOnly = Boolean(share); manualField.closest('.field').hidden = Boolean(share); const note = manualField.closest('.field').nextElementSibling; if (note) note.textContent = share ? '本版通过客户链接收集回复。人工记录不能用于确认这一版，请在上方查看客户的实际回复。' : '请根据实际沟通记录填写。这里只记录人工确认，不核验聊天真伪。'; }
      const recordLabel = $('label[for="confirmationEvidence"]'); if (recordLabel) recordLabel.textContent = '线下确认记录（人工）';
      const sheetNote = $('.sheet>.tiny'); if (sheetNote) sheetNote.textContent = version.confirmationMode === 'online' ? '客户通过确认页面提交的回复；称呼未经身份核验，不代表已经付款。' : '尚无在线客户确认；线下确认须人工记录实际沟通依据。';
      updateClientResponseUI();
    }
    window.MingdanPricingUI?.refreshAdvice();
  }
  function updateClientResponseUI() {
    if (state.page !== 2) return;
    const version = selectedVersion(), share = version?.share;
    if (!share) return;
    const responseNotice = $('#sharePanel>.notice');
    if (responseNotice) { responseNotice.className = `notice ${share.status === 'confirmed' ? 'good' : ''}`; responseNotice.innerHTML = `<strong>${shareLabels[share.status] || esc(share.status)}</strong>${share.response ? `<p>${esc(share.response.name)}：${esc(share.response.comment || '已确认本版清单与价格')}<br>${esc(new Date(share.response.respondedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</p>` : ''}`; }
    const revokeButton = $('[data-action="revoke-share"]'); if (revokeButton) revokeButton.disabled = !['pending', 'changes_requested'].includes(share.status);
    const audit = $('#confirmationEvidence')?.closest('.card');
    for (const badge of [audit?.querySelector('.card-head>span'), $('.sheet-title>span')]) if (badge) { badge.className = statusClass(version.status); badge.textContent = statusText(version.status); }
    const auditNotice = audit?.querySelector(':scope>.notice');
    if (auditNotice) auditNotice.textContent = share.status === 'confirmed' ? '设计师审核已完成，客户已确认本版。' : share.status === 'changes_requested' ? '设计师审核已完成，客户提出了调整，请核对后保存新版本。' : share.status === 'pending' ? '设计师审核已完成，等待客户核对与回复。' : `${shareLabels[share.status] || '链接已关闭'}，客户回复已关闭。请保存并审核新版本，再生成新的客户链接。`;
    if (share.response) {
      let record = $('.sheet>.stage4-client-record');
      if (!record) { record = document.createElement('div'); record.className = 'notice stage4-client-record'; record.setAttribute('role', 'status'); $('.sheet>.tiny').before(record); }
      record.className = `notice stage4-client-record ${share.status === 'confirmed' ? 'good' : ''}`;
      record.textContent = `${share.status === 'confirmed' ? '客户在线确认记录' : '客户调整意见（尚未确认）'}：${share.response.name}；${share.response.comment || '已确认本版清单与价格'}`;
    }
    const sheetNote = $('.sheet>.tiny'); if (sheetNote) sheetNote.textContent = version.confirmationMode === 'online' ? '客户通过确认页面提交的回复；称呼未经身份核验，不代表已经付款。' : !['pending', 'changes_requested'].includes(share.status) ? '本版链接已关闭，尚无在线客户确认；请保存并审核新版本后重新发送。' : '尚无在线客户确认；如客户提出调整，请形成新版本重新确认。';
  }
  async function refreshResponses() {
    if (!ready || blocked) throw new Error('同步尚未恢复，请先保留备份并拉取服务端版本。');
    await flush();
    const remote = await api('/api/workspace');
    if (remote.revision !== revision) { blocked = true; showConnection('另一窗口更新了工作区，请保留备份后拉取。'); throw new Error('服务端已有新内容，本次刷新未覆盖当前草稿。请保留备份后拉取服务端版本。'); }
    if (remote.workspace) { const previous = stableJSON(selectedVersion()); mergeResponses(remote.workspace); if (previous !== stableJSON(selectedVersion())) updateClientResponseUI(); }
  }
  document.addEventListener('click', async event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    try {
      if (action === 'ai-extract') await extractAI();
      if (action === 'ai-reply') await extractAI(true);
      if (action === 'manual-start') startManual();
      if (action === 'apply-ai-result') {
        if (!pendingAnalysis || state.id !== pendingAnalysis.orderId || state.chat !== pendingAnalysis.text || state.messageDate !== pendingAnalysis.date || pendingAnalysis.reply !== null && state.replyText !== pendingAnalysis.reply) throw new Error('消息已变化，请重新整理。');
        applyAnalysis(pendingAnalysis.analysis); pendingAnalysis = null;
      }
      if (action === 'cancel-ai-result') { pendingAnalysis = null; $('#newAnalysisPreview')?.remove(); }
      if (action === 'add-condition') {
        mutate(() => { state.draft.conditions.push({ id: `condition-${Date.now()}`, title: '补充问题（请填写）', kind: 'other', value: '', source: '', required: true, priority: 5 }); state.analysisReviewed = false; }, { undoable: true });
        document.querySelectorAll('[data-condition-title]')[state.draft.conditions.length - 1]?.focus();
      }
      if (action === 'ai-help') {
        let help = $('#aiHelp');
        if (help) { help.remove(); return; }
        help = document.createElement('div'); help.id = 'aiHelp'; help.className = 'notice';
        help.innerHTML = '<strong>连接 AI</strong><p>在此站点的设置中添加 DEEPSEEK_API_KEY，标记为私密变量；保存并重新发布后，点击“重新检测连接”。密钥由服务端使用，网页不会显示。没有密钥时可先手动整理，核对报价与客户确认流程。</p>';
        $('#stage4Connection').after(help);
      }
      if (action === 'check-connection') { if (!ready) await connect(); else { connection = await api('/api/status'); enhance(); toast(connection.aiConfigured?'AI 已配置，可开始整理':'尚未配置 AI API Key'); } }
      if (action === 'reload-server') await connect(true);
      if (action === 'export-sync-backup') { const url = URL.createObjectURL(new Blob([localStorage.getItem(backupKey)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'mingdan-before-server-sync.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      if (action === 'logout-account') {
        cache();
        if (ready && !blocked) await flush();
        await api('/api/logout', { method: 'POST', body: '{}' });
        localStorage.setItem('mingdan-active-account', '');
        location.replace('/prototype/account.html');
      }
      if (action === 'publish-share') {
        const version = selectedVersion(); await flush();
        version.share = await api('/api/shares', { method: 'POST', body: JSON.stringify({ orderId: state.id, versionId: version.id }) });
        cache(); render(); await refreshResponses(); toast('确认链接已生成，客户回复将绑定这个报价版本。');
      }
      if (action === 'copy-customer-link') { await navigator.clipboard.writeText(selectedVersion().share.url); toast('客户确认链接已复制'); }
      if (action === 'refresh-client') { await refreshResponses(); toast('已刷新客户回复'); }
      if (action === 'revoke-share') { await api(`/api/shares/${selectedVersion().share.id}/revoke`, { method: 'POST', body: '{}' }); await refreshResponses(); }
    } catch (error) { toast(error.message); }
  });
  async function refreshUsage() { try { connection = await api('/api/status'); enhance(); } catch {} }
  window.MingdanStage4 = { enhance, scheduleSave, flush, api, refreshUsage, status: () => ({ ...connection, revision, ready, blocked }) };
  window.addEventListener('pagehide', () => { if (ready && !blocked && !saving && saved < dirty) fetch('/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Mingdan-Account': account?.id || 'signed-out' }, body: JSON.stringify({ revision, workspace }), keepalive: true }).catch(() => {}); });
  window.addEventListener('storage', event => { if (event.key === 'mingdan-active-account' && event.newValue !== account?.id) { cache(); blocked = true; location.replace('/prototype/account.html'); } });
  setInterval(() => { if (state.page === 2 && selectedVersion()?.share?.status === 'pending') refreshResponses().catch(() => {}); }, 15000);
  connect();
})();
