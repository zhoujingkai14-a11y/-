(() => {
  'use strict';
  const scene = document.getElementById('scene');
  const steps = [...document.querySelectorAll('[data-step]')];
  const next = document.getElementById('nextButton');
  const previous = document.getElementById('previousButton');
  const labels = ['客户消息', '核对与报价', '客户确认', '变更与版本'];
  const descriptions = ['先保留原文。把不明确的要求留给双方确认。', '设计师已核对数量、交付条件与个人价格。点击回看原话。', '客户确认这份约定。点击模拟确认，查看回复后的状态。', '新增两张海报，增加 ¥800。V2 需要重新审核与确认。'];
  let index = 0, confirmed = false, animation = null;
  const icon = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
  const renderers = [
    () => `<div class="scene-heading"><h3>先听客户怎么说。</h3><span class="state wait">待整理</span></div><div class="scene-grid"><div><p class="sender">客户 · 10 月 1 日</p><blockquote class="message"><p>我们青禾咖啡下周开业，做一张开业海报，再适配朋友圈和小红书各一个尺寸。10 月 9 日给最终版，源文件也发我。最好能改到满意。</p></blockquote></div><div class="reading-note"><h4>一句话里，有几种约定？</h4><p>一张主海报、两个尺寸适配、交付日期，以及源文件要求。</p><p class="open-question">“改到满意”没有确定次数。明单会把它列为待确认，报价前先谈清楚。</p></div></div>`,
    () => `<div class="scene-heading"><h3>每一项都有来处。</h3><span class="state">设计师已核对</span></div><div class="scene-grid"><div><ul class="scope-list"><li><div><strong>开业主海报 × 1</strong><small>个人标准：¥600 / 张</small><button type="button" class="evidence-button" data-evidence="poster" aria-expanded="false">回看原话</button><p class="evidence" id="poster" hidden>“做一张开业海报”</p></div><span class="item-money">¥600</span></li><li><div><strong>尺寸适配 × 2</strong><small>个人标准：¥100 / 个</small><button type="button" class="evidence-button" data-evidence="sizes" aria-expanded="false">回看原话</button><p class="evidence" id="sizes" hidden>“再适配朋友圈和小红书各一个尺寸”</p></div><span class="item-money">¥200</span></li></ul><div class="quote-total"><span>程序按个人标准计算</span><strong>¥800</strong></div></div><div class="reading-note"><h4>先追问，再形成约定。</h4><p>示例补充回复：“包含两轮小范围修改；主海报与源文件 10 月 9 日交，适配尺寸 1080 × 1080、1080 × 1440。”</p><p>本例设计师约定源文件随主海报交付，费用已包含。</p><p class="open-question">这些是演示中双方补充确认的内容，AI 不会把它们擅自写成已知事实。</p></div></div>`,
    () => `<div class="scene-heading"><h3>客户看懂这一版。</h3><span class="state${confirmed ? '' : ' wait'}">${confirmed ? '模拟已确认' : '模拟待回复'}</span></div><div class="scene-grid"><article class="paper"><h4>青禾咖啡 · 开业视觉</h4><p class="paper-meta">确认单 V1 · 范围与报价</p><dl><div><dt>交付</dt><dd>主海报 1 张 + 适配 2 个尺寸</dd></div><div><dt>时间</dt><dd>10 月 9 日交最终版</dd></div><div><dt>修改</dt><dd>含两轮小范围修改</dd></div><div><dt>文件</dt><dd>源文件随主海报交付</dd></div></dl><div class="paper-total"><span>本版合计</span><strong>¥800</strong></div></article><div class="reply-note"><h4>${confirmed ? '这一版，留下共同的约定。' : '不必理解设计师内部的计价规则。'}</h4><p>客户看交付结果、时间、修改边界和合计。内部价目表、原始聊天和 AI 分析不在客户页面中展示。</p>${confirmed ? '<p class="reply-success">虚构客户：已核对，按这版安排。</p><p>模拟状态只存在于此展示页，刷新即可重新演示。</p><button type="button" class="quiet-button" data-action="reset-confirmation">重新演示确认</button>' : '<button type="button" class="next-button" data-action="confirm">模拟客户确认'+icon+'</button><p style="margin-top:12px">真实客户页也支持提出调整意见；回复绑定具体版本。</p>'}</div></div>`,
    () => `<div class="scene-heading"><h3>看见变化，再决定。</h3><span class="state wait">V2 草稿 · 时间待定</span></div><div class="compare"><div class="compare-side"><h4>V1 · ${confirmed ? '模拟已确认' : '原报价版本'}</h4><div class="change-row"><strong>开业主海报 × 1</strong><span>¥600</span></div><div class="change-row"><strong>尺寸适配 × 2</strong><span>¥200</span></div><div class="change-row"><strong>已包含两轮小范围修改</strong></div><div class="change-total">¥800</div></div><div class="compare-side"><h4>V2 · 新增独立交付</h4><div class="change-row"><strong>原交付范围</strong><span>¥800</span></div><div class="change-row add"><strong>新增两张店内海报</strong><span>+ ¥800</span></div><div class="change-row"><strong>沿用个人标准 ¥400 / 张</strong></div><div class="change-total">¥1,600</div></div></div><p class="compare-note">后续消息：“再加两张店内海报，各做一版新的排版。”本例按独立交付核对；原修改约定继续保留。新增交付时间还需双方另行确定，V2 此时不能发布为已审核报价。</p>`
  ];
  function render() {
    animation?.cancel();
    scene.innerHTML = renderers[index]();
    steps.forEach((button, number) => { if (number === index) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current'); });
    previous.disabled = index === 0;
    next.innerHTML = (index === 3 ? '回到客户消息' : labels[index + 1]) + icon;
    document.getElementById('sceneStatus').textContent = `第 ${index + 1} 步，共 4 步。${descriptions[index]}`;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && scene.animate) animation = scene.animate([{ opacity: .85, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  function move(to) { if (to === index) return; index = to; render(); }
  steps.forEach(button => button.addEventListener('click', () => move(Number(button.dataset.step))));
  next.addEventListener('click', () => move((index + 1) % 4));
  previous.addEventListener('click', () => move(Math.max(0, index - 1)));
  scene.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.evidence) {
      const evidence = document.getElementById(button.dataset.evidence);
      evidence.hidden = !evidence.hidden;
      button.setAttribute('aria-expanded', String(!evidence.hidden));
      button.textContent = evidence.hidden ? '回看原话' : '收起原话';
    }
    if (button.dataset.action === 'confirm' || button.dataset.action === 'reset-confirmation') {
      confirmed = button.dataset.action === 'confirm'; render();
      const replacement = scene.querySelector('[data-action]'); replacement?.focus({ preventScroll: true });
      document.getElementById('sceneStatus').textContent = confirmed ? '模拟客户已确认 V1。本页未发送真实客户回复。' : descriptions[2];
    }
  });
  if (location.protocol === 'file:') {
    for (const id of ['workbenchLink', 'closingLink']) document.getElementById(id).href = 'http://127.0.0.1:8765/prototype/v2.html';
    document.getElementById('localHint').hidden = false;
  }
  render();
})();
