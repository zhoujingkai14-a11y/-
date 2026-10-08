(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const invitation = fragment.get('invite'), recovery = fragment.get('recover');
  let mode = invitation || fragment.has('register') ? 'register' : recovery || fragment.has('reset') ? 'recover' : 'login';
  const token = invitation || recovery;
  let submitting = false, registeredUser = null, authOptions = null;
  const arrow = '<svg class="arrow-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M7 17 17 7M7 7h10v10"/></svg>';
  const labels = {
    login: ['设计师登录', '使用你的邮箱和密码，回到自己的工作区。', '登录工作台'],
    owner: ['管理者登录', '使用站点管理密码。设计师请使用自己的独立账号。', '进入工作台'],
    register: ['建立你的工作区', invitation ? '请填写邀请对应的邮箱。注册免费，无自动扣费。' : '注册免费，无需邀请。用自己的标准，整理第一笔需求。', '免费创建账号'],
    recover: ['恢复账号密码', recovery ? '填写原账号邮箱。恢复后，其他设备的旧登录会失效。' : '填写账号邮箱和保存的恢复密钥，再设置新密码。', '保存新密码'],
  };
  function message(text, error = false) {
    const box = $('#authStatus'); box.hidden = !text; box.textContent = text;
    box.classList.toggle('is-error', error); box.setAttribute('role', error ? 'alert' : 'status');
  }
  function renderMode() {
    const [heading, description, submit] = labels[mode];
    $('#formHeading').textContent = heading;
    $('#formDescription').textContent = description; $('#submitButton').innerHTML = `${submit} ${arrow}`;
    const fresh = ['register', 'recover'].includes(mode);
    $('#emailField').hidden = mode === 'owner'; $('#email').required = mode !== 'owner';
    $('#nameField').hidden = mode !== 'register'; $('#displayName').required = mode === 'register';
    $('#confirmField').hidden = !fresh; $('#confirmPassword').required = fresh;
    $('#consentField').hidden = mode !== 'register'; $('#aiConsent').required = mode === 'register';
    $('#recoveryField').hidden = mode !== 'recover' || Boolean(recovery); $('#recoveryKey').required = mode === 'recover' && !recovery;
    $('#emailNotice').hidden = mode !== 'register';
    $('#passwordHelp').hidden = !fresh; $('#password').minLength = fresh ? 12 : 1;
    $('#password').autocomplete = fresh ? 'new-password' : 'current-password';
    $('#passwordLabel').textContent = mode === 'recover' ? '新密码' : mode === 'owner' ? '管理者密码' : '密码';
    $('#loginNotes').hidden = fresh || mode === 'owner';
    $('#modeSwitch').textContent = mode === 'login' ? '管理者入口' : '返回设计师登录';
    message('');
    $('#submitButton').disabled = false;
    if (token && !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      message('链接无效，请向管理者索取完整的新链接。', true); $('#submitButton').disabled = true;
    }
    if (mode === 'register' && authOptions && (!authOptions.registrationEnabled || !invitation && authOptions.registrationMode !== 'public')) {
      message(authOptions.registrationEnabled ? '当前只接受邀请注册，请使用已有账号登录。' : '新账号注册暂时暂停，已有账号仍可登录。', true); $('#submitButton').disabled = true;
    }
  }
  async function api(path, input) {
    let response;
    try { response = await fetch(path, { method: input ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: input ? { 'Content-Type': 'application/json' } : {}, ...(input ? { body: JSON.stringify(input) } : {}) });
    } catch { throw new Error('连接失败或超时，请检查网络后重试。'); }
    let data;
    try { data = await response.json(); } catch { throw new Error('服务暂时没有返回可读取的结果，请稍后重试。'); }
    if (!response.ok) throw new Error(data.message || '连接失败，请稍后重试。');
    return data;
  }
  function enter(user) {
    localStorage.setItem('mingdan-active-account', user.id);
    location.replace('/prototype/v2.html');
  }
  function showRecovery(result) {
    registeredUser = result.user;
    $('#accountForm').hidden = true; $('#loginNotes').hidden = true; $('.auth-switch').hidden = true; $('#emailNotice').hidden = true;
    $('#formHeading').textContent = '账号已就绪'; $('#formDescription').textContent = '最后一步：保存恢复密钥，然后开始整理需求。';
    $('#savedRecoveryKey').value = result.recoveryKey; $('#recoveryPanel').hidden = false;
    $('#recoveryPanel').scrollIntoView({ block: 'nearest' }); $('#savedRecoveryKey').focus();
  }
  function switchMode(next) {
    if (submitting) return;
    mode = next; history.replaceState(null, '', `${location.pathname}${next === 'register' ? '#register' : next === 'recover' ? '#reset' : ''}`);
    $('#password').value = ''; $('#confirmPassword').value = ''; $('#recoveryKey').value = '';
    renderMode(); $('#formHeading').scrollIntoView({ block: 'nearest' }); $('#email').focus();
  }
  $('#registerSwitch').addEventListener('click', () => switchMode('register'));
  $('#recoverSwitch').addEventListener('click', () => switchMode('recover'));
  $('#recoverySaved').addEventListener('change', event => { $('#enterWorkbench').disabled = !event.target.checked; });
  $('#enterWorkbench').addEventListener('click', () => { if (registeredUser && $('#recoverySaved').checked) { $('#savedRecoveryKey').value = ''; enter(registeredUser); } });
  $('#copyRecoveryKey').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#savedRecoveryKey').value); message('恢复密钥已复制，请妥善保存。'); }
    catch { $('#savedRecoveryKey').focus(); $('#savedRecoveryKey').select(); message('请使用 Ctrl+C 或长按复制已选中的密钥。'); }
  });
  $('#modeSwitch').addEventListener('click', () => {
    switchMode(mode === 'login' ? 'owner' : 'login');
  });
  $('#accountForm').addEventListener('submit', async event => {
    event.preventDefault(); if (submitting) return;
    if (['register', 'recover'].includes(mode) && $('#password').value !== $('#confirmPassword').value) {
      message('两次密码不一致，请检查后再提交。', true); $('#confirmPassword').focus(); return;
    }
    submitting = true; $('#submitButton').disabled = true;
    $('#submitButton').setAttribute('aria-busy', 'true');
    const original = $('#submitButton').innerHTML; $('#submitButton').textContent = '正在安全连接…'; message('');
    try {
      const input = { password: $('#password').value };
      if (mode !== 'owner') input.email = $('#email').value.trim();
      if (mode === 'register' && invitation) input.token = invitation;
      if (mode === 'recover') { if (recovery) input.token = recovery; else input.recoveryKey = $('#recoveryKey').value.trim(); }
      if (mode === 'register') { input.name = $('#displayName').value.trim(); input.aiConsent = $('#aiConsent').checked; input.website = $('#website').value; }
      const result = await api(mode === 'owner' ? '/api/login' : `/api/${mode}`, input);
      $('#password').value = ''; $('#confirmPassword').value = ''; $('#recoveryKey').value = '';
      history.replaceState(null, '', location.pathname);
      if (result.recoveryKey) showRecovery(result); else enter(result.user);
    } catch (error) { message(error.message, true); }
    finally { submitting = false; $('#submitButton').disabled = false; $('#submitButton').setAttribute('aria-busy', 'false'); $('#submitButton').innerHTML = original; }
  });
  renderMode();
  window.addEventListener('hashchange', () => location.reload());
  api('/api/auth-options').then(data => { authOptions = data; if (!submitting && !registeredUser) renderMode(); }).catch(() => {});
  if (!token && mode === 'login') api('/api/me').then(data => enter(data.user)).catch(() => {});
})();
