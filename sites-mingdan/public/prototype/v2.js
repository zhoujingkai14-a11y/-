const STORAGE_KEY = `mingdan-account-${window.MingdanAccount?.id || 'signed-out'}-workspace`;
const SAMPLE_DATE = '2026-09-28';
const FIRST_MESSAGE = '客户：你好，想做一张新店开业海报，再适配朋友圈和小红书各一个尺寸。下周五给我，最好能改到满意，源文件也发我。';
const REPLY_MESSAGE = '客户：海报用 A3，朋友圈 1080×1920px，小红书 1242×1660px。2026年10月9日交初稿，包含两轮修改，源文件先不要。';
const CHANGE_MESSAGES = {
  add: '客户：再做一个公众号横版吧。',
  remove: '客户：小红书那张先不用了。',
  replace: '客户：小红书那张换成抖音版本，数量不变。',
  rework: '客户：整张海报的主视觉重新做一版。'
};
const PAGE_NAMES = ['客户消息', '核对与报价', '确认单', '变更与版本'];
const QUESTION_META = [
  {id:'delivery',title:'何时交付，是初稿还是终稿？',priority:1,source:'下周五给我'},
  {id:'revisions',title:'包含几轮修改？',priority:2,source:'最好能改到满意'},
  {id:'sourceFile',title:'源文件如何交付与计费？',priority:3,source:'源文件也发我'},
  {id:'sizes',title:'每个交付项的尺寸分别是多少？',priority:4,source:'一张海报，再适配朋友圈和小红书各一个尺寸'}
];
const CATEGORIES = {
  new_scope:'新增原约定之外的工作',
  client_change:'客户改变已约定内容',
  included_revision:'属于约定内修改',
  designer_error:'修正设计师交付错误',
  extraction_error:'修正系统理解错误',
  ambiguous:'暂时无法判断'
};
const CATEGORY_BY_TYPE = {
  add:['new_scope','included_revision','designer_error','extraction_error','ambiguous'],
  remove:['client_change','designer_error','extraction_error','ambiguous'],
  replace:['client_change','included_revision','designer_error','extraction_error','ambiguous'],
  rework:['new_scope','included_revision','designer_error','extraction_error','ambiguous']
};
const CHANGE_LABELS = {add:'新增',remove:'删除',replace:'替换',rework:'重做'};
const $ = selector => document.querySelector(selector);
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = value => value!==null&&Number.isFinite(Number(value))?`${Number(value) < 0 ? '−' : ''}¥${Math.abs(Number(value)).toLocaleString('zh-CN',{maximumFractionDigits:2})}`:'待核算';
const now = () => new Date().toLocaleString('zh-CN', {hour12:false});
const today = () => {const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`};
const newId = () => globalThis.crypto?.randomUUID?.()||`order-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function nextFriday(dateText){
  const date = new Date(`${dateText}T12:00:00`);
  const daysFromMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() + 7 - daysFromMonday + 4);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function initialState(){
  return {
    schema:3,id:newId(),title:'',clientName:'',createdAt:now(),page:0,extracted:false,inputDirty:false,analysisReviewed:false,analysis:null,
    messageDate:today(),replyDate:today(),replyText:'',proposals:[],replyIssues:[],replyHistory:[],
    replyVisible:false,replyApplied:[],chat:'',followupText:'',
    selectedVersionId:null,versions:[],confirmationEvidence:'',
    draft:{items:[],answers:{delivery:'',revisions:'',sourceFile:'',sizes:''},answerSources:{},sourceChoice:'pending',rates:{poster:null,adapt:null,sourceFile:null,rework:null}},
    change:{type:'add',category:'ambiguous',sourceText:'',targetId:'',itemName:'',quantity:null,unitPrice:null,
      refundDecision:'ask',refundManual:null,replacementDecision:'ask',replacementManual:null,
      reworkDecision:'ask',reworkManual:null,schedule:'ask',scheduleDate:''}
  };
}

function isValidOrder(order){
  const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
  const validRates=rates=>rates&&['poster','adapt','sourceFile','rework'].every(key=>rates[key]===null||typeof rates[key]==='number'&&Number.isFinite(rates[key]));
  const validAnswers=answers=>answers&&QUESTION_META.every(meta=>typeof answers[meta.id]==='string');
  const validItem=item=>item&&safeId(item.id)&&typeof item.name==='string'&&
    (typeof item.source==='string'||item.id==='sourceFile'&&item.source===undefined)&&
    (item.quantity===null||Number.isInteger(item.quantity))&&['poster','adapt','sourceFile','rework','manual'].includes(item.rate)&&
    (item.unitPrice===undefined||item.unitPrice===null||typeof item.unitPrice==='number'&&Number.isFinite(item.unitPrice));
  const validChange=change=>change&&CATEGORY_BY_TYPE[change.type]?.includes(change.category)&&
    ['ask','same','date'].includes(change.schedule)&&typeof (change.sourceText||'')==='string'&&
    (change.targetId===undefined||change.targetId===''||safeId(change.targetId))&&
    (change.quantity===undefined||change.quantity===null||Number.isInteger(change.quantity))&&
    ['unitPrice','refundManual','replacementManual','reworkManual'].every(key=>change[key]===undefined||change[key]===null||typeof change[key]==='number'&&Number.isFinite(change[key]));
  return Boolean(order&&safeId(order.id)&&typeof order.title==='string'&&typeof order.clientName==='string'&&
    typeof order.chat==='string'&&typeof order.replyText==='string'&&Number.isInteger(order.page)&&order.page>=0&&order.page<=3&&
    Array.isArray(order.versions)&&order.versions.every(version=>version&&safeId(version.id)&&Number.isInteger(version.number)&&
      ['draft','designer-reviewed','client-confirmed'].includes(version.status)&&
      Array.isArray(version.items)&&version.items.every(item=>validItem(item)&&typeof item.amount==='number'&&Number.isFinite(item.amount))&&
      validAnswers(version.answers)&&validRates(version.rates)&&Array.isArray(version.issues)&&version.issues.every(issue=>typeof issue==='string'))&&
    order.draft&&Array.isArray(order.draft.items)&&order.draft.items.every(validItem)&&validAnswers(order.draft.answers)&&validRates(order.draft.rates)&&
    ['pending','no','paid','included'].includes(order.draft.sourceChoice)&&validChange(order.change));
}

function loadWorkspace(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(saved?.schema===1&&Array.isArray(saved.orders)&&saved.orders.length&&saved.orders.every(isValidOrder))return saved;
  }catch{}
  const order=initialState();return {schema:1,activeId:order.id,orders:[order]};
}
let workspace=loadWorkspace();
let state=workspace.orders.find(order=>order.id===workspace.activeId)||workspace.orders[0];
const undoStack=[];
function persist(){
  const index=workspace.orders.findIndex(order=>order.id===state.id);
  if(index<0)workspace.orders.push(state);else workspace.orders[index]=state;
  workspace.activeId=state.id;
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(workspace))}catch{toast('浏览器无法保存草稿，请导出备份并暂时保持页面打开')}
  window.MingdanStage4?.scheduleSave();
}
let pointerActive=false;
let renderPending=false;
let renderTimer;
function scheduleRender(){
  renderPending=true;
  clearTimeout(renderTimer);
  renderTimer=setTimeout(()=>{if(!pointerActive&&renderPending){renderPending=false;if([1,3].includes(state.page)&&document.activeElement?.matches('input:not([type="checkbox"]),textarea'))refreshDraftPreview();else render()}},0);
}
document.addEventListener('pointerdown',()=>{pointerActive=true},true);
for(const eventName of ['pointerup','pointercancel'])document.addEventListener(eventName,()=>{pointerActive=false;if(renderPending)scheduleRender()},true);
function mutate(fn,{undoable=false,deferRender=false}={}){
  if(undoable){undoStack.push(clone(state));if(undoStack.length>15)undoStack.shift()}
  fn();persist();if(deferRender)scheduleRender();else render();
}
function toast(message){const element=$('#toast');element.textContent=message;element.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>element.hidden=true,3400)}
function isResolvedAnswer(value){const answer=String(value||'').trim();return Boolean(answer)&&!/待确认|未确认|不确定|还没定/.test(answer)}
function pendingQuestions(answers){return Array.isArray(state.draft.conditions)?state.draft.conditions.filter(item=>item.required&&!isResolvedAnswer(item.value)):QUESTION_META.filter(item=>!isResolvedAnswer(answers[item.id]))}
function draftQuote(){
  return MingdanEngine.calculate(state.draft.items,state.draft.rates,state.draft.sourceChoice);
}

function selectedVersion(){return state.versions.find(version=>version.id===state.selectedVersionId)||state.versions.at(-1)||null}
function latestConfirmed(){return [...state.versions].reverse().find(version=>version.status==='client-confirmed')||null}
function statusText(status){return status==='client-confirmed'?'客户已确认':status==='designer-reviewed'?'设计师已审核':'草稿'}
function statusClass(status){return status==='client-confirmed'?'badge':status==='designer-reviewed'?'badge neutral':'badge warn'}
function markStale(){state.followupText=''}
function pricingPendingCount(){return window.MingdanPricingUI?.reviewIssues().length||0}
function composeFollowup(){
  const questions=[...pendingQuestions(state.draft.answers),...(window.MingdanPricingUI?.followupQuestions()||[])].filter((item,index,list)=>list.findIndex(entry=>entry.title===item.title)===index).slice(0,3);
  const names=state.draft.items.map(item=>item.name).join('、');
  if(!questions.length)return '您好，需求和报价草稿已整理，请核对确认单中的交付内容、时间和价格。';
  if(Array.isArray(state.draft.conditions))return `您好，我先整理了${names||'您发来的需求'}。报价前还需要确认：\n${questions.map((item,index)=>`${index+1}. ${item.title}`).join('\n')}\n确认后我再提供完整报价。`;
  const date=state.analysis?.dateCandidates?.[0];
  const wording={delivery:date?`消息中的日期候选是 ${date.date}，请确认具体日期，以及交初稿还是终稿。`:'请确认具体交付日期，以及届时交初稿还是终稿。',revisions:'请确认包含几轮修改，以及每轮修改的范围。',sourceFile:'本次是否交付源文件？如果需要，交付费用需要一并确认。',sizes:'请逐项确认交付尺寸及单位。'};
  return `您好，我先整理了${names||'您发来的需求'}。报价前还需要确认：\n${questions.map((item,index)=>`${index+1}. ${wording[item.id]||item.title}`).join('\n')}\n确认后我再提供完整报价。`;
}

let renderedPage = null;
function render(){
  const changed = renderedPage !== state.page;
  const focusedId = document.activeElement?.id;
  const opened = [...document.querySelectorAll('details[id][open]')].map(node=>node.id);
  document.querySelectorAll('[data-page]').forEach(button=>{
    const active=Number(button.dataset.page)===state.page;
    button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
  });
  const orderTitle=state.title.trim()||'未命名订单';
  $('#breadcrumb').textContent=`工作台 / ${orderTitle} / ${PAGE_NAMES[state.page]}`;
  $('#sideOrderTitle').textContent=orderTitle;
  $('#sideOrderClient').textContent=state.clientName.trim()||'未填写客户称呼';
  $('#orderSelect').innerHTML=workspace.orders.map(order=>`<option value="${esc(order.id)}" ${order.id===state.id?'selected':''}>${esc(order.title.trim()||'未命名订单')}</option>`).join('');
  $('#projectStatus').innerHTML=`<span><i class="status-dot"></i> 进行中的订单</span><span>交付 <strong>${state.page===2&&selectedVersion()?selectedVersion().items.length:state.draft.items.length}</strong> 项</span><span>版本 <strong>${state.versions.length ? 'V'+state.versions.length : '未保存'}</strong></span><span class="status-end">仅保存在此浏览器</span>`;
  $('#view').innerHTML=[renderMessages,renderReview,renderConfirmation,renderChanges][state.page]();
  if(state.page===0&&state.extracted&&state.analysis?.items?.length===0){
    $('.insight-panel h2').textContent='尚未自动识别交付项';
    $('.insight-panel>p').textContent='原文已保留；请进入第二步人工建立交付清单。';
  }
  if(state.page===1){
    for(const item of state.draft.items.filter(entry=>entry.rate==='manual')){
      const row=[...document.querySelectorAll('.req')].find(element=>element.dataset.evidenceId===item.id);
      const source=row?.querySelector('.evidence-source');if(!source)continue;
      const field=document.createElement('div');field.className='field';
      const label=document.createElement('label');label.htmlFor=`source-${item.id}`;label.textContent='对应的原话或人工沟通记录 *';
      const input=document.createElement('textarea');input.id=`source-${item.id}`;input.dataset.itemSource=item.id;input.rows=2;
      input.placeholder='复制客户原话；电话沟通可写明记录来源';input.value=item.source||'';
      field.append(label,input);source.replaceWith(field);
    }
  }
  if(state.page===2&&selectedVersion()){
    const version=selectedVersion(),sheet=$('.sheet'),meta=sheet?.querySelector('.sheet-meta');
    if(meta){
      meta.querySelector('strong').textContent=version.orderTitle||state.title||'未命名订单';
      const client=document.createElement('div');client.innerHTML='<span>客户称呼</span><strong></strong>';
      client.querySelector('strong').textContent=version.clientName||'未填写';meta.append(client);
    }
    const stamp=document.createElement('p');stamp.className='print-stamp';stamp.id='printGeneratedAt';stamp.textContent='打印或另存 PDF 时记录生成时间';sheet?.append(stamp);
  }
  window.MingdanPricingUI?.enhance();
  if(changed){
    $('#view').classList.remove('view-enter');
    void $('#view').offsetWidth;
    $('#view').classList.add('view-enter');
    if(renderedPage!==null){window.scrollTo({top:0,behavior:'instant'});$('#view').focus({preventScroll:true})}
  }else{
    opened.forEach(id=>{const node=document.getElementById(id);if(node)node.open=true});
    if(focusedId)document.getElementById(focusedId)?.focus({preventScroll:true});
  }
  renderedPage=state.page;
  window.MingdanStage4?.enhance();
}

function renderMessages(){
  const proposals=state.proposals.map(proposal=>{
    const applied=state.replyApplied.includes(proposal.id);
    return `<div class="proposal"><div class="proposal-head"><strong>${esc(proposal.label)}</strong><span class="badge warn">${applied?'已应用':proposal.certainty==='candidate'?'候选，需人工确认':'待核对'}</span></div><p class="small muted">原记录：${esc(proposal.previous||'待确认')}</p><p><strong>新回复建议：</strong>${esc(proposal.next)}</p><div class="source">“${esc(proposal.evidence)}”</div><button class="button secondary" data-apply-reply="${proposal.id}" ${applied?'disabled':''}>核对并应用</button></div>`;
  }).join('');
  const preview=state.extracted?state.draft.items.slice(0,4).map(item=>`<div class="paper-row"><span class="check-square"></span>${esc(item.name)}<small>× ${item.quantity??'待确认'}</small></div>`).join(''):'<div class="paper-row"><span class="check-square"></span>交付内容与数量<small>保留原话</small></div><div class="paper-row"><span class="check-square"></span>时间与修改范围<small>明确边界</small></div><div class="paper-row"><span class="check-square"></span>你的价格与确认记录<small>版本留存</small></div>';
  return `<section class="stage-hero" aria-labelledby="stageTitle"><div class="stage-grid" aria-hidden="true"></div><div class="stage-content"><div class="stage-kicker"><span class="stage-pulse"></span> MINGDAN / CREATIVE OPERATIONS <span class="stage-index">01 — 04</span></div><h1 id="stageTitle" class="stage-title"><span>让每一条需求</span><span>都有<span class="stage-accent">着落</span></span></h1><p>从客户的一段话开始，整理交付内容，厘清约定，再给出有依据的报价。</p><div class="stage-metrics" aria-hidden="true"><span><strong>01</strong> 读取原话</span><i></i><span><strong>02</strong> 核对范围</span><i></i><span><strong>03</strong> 留存约定</span></div></div><div class="stage-orbit" aria-hidden="true"><span class="orbit-ring"></span><span class="orbit-core">明</span></div></section>
  <div class="grid message-grid"><div class="stack">
    <section class="card order-details"><div class="card-head"><div><h2>这笔订单</h2><p class="hint">名称和客户称呼会随版本保存；切换订单请用页面顶部菜单。</p></div><span class="badge">本地保存</span></div><div class="order-fields"><div class="field"><label for="orderTitle">订单名称 *</label><input id="orderTitle" maxlength="80" value="${esc(state.title)}" placeholder="例如：春季活动主视觉"></div><div class="field"><label for="clientName">客户称呼</label><input id="clientName" maxlength="80" value="${esc(state.clientName)}" placeholder="例如：李女士"></div></div><div class="actions"><button type="button" class="button secondary" data-action="export-backup">导出全部订单备份</button><button type="button" class="button secondary" data-action="import-backup">导入备份</button></div><p class="hint" style="margin-top:10px">浏览器保留草稿；连接服务端后同步保存。备份文件可能包含客户聊天与报价，请妥善保管。</p></section>
    <section class="card composer"><div class="composer-head"><h2>客户说了什么</h2><button class="text-button" data-action="load-sample">试用示例</button></div><div class="composer-body">
      <div class="date-line"><label for="messageDate">消息日期 · 用于理解“下周五”</label><input id="messageDate" type="date" value="${esc(state.messageDate)}"></div>
      <label class="sr-only" for="chatInput">客户需求，多方对话请标明客户或设计师</label>
      <div class="message-field"><textarea id="chatInput" rows="7" placeholder="粘贴一段客户需求…&#10;多方对话请标明「客户：」「设计师：」。" aria-describedby="inputState">${esc(state.chat)}</textarea><div class="input-foot"><span id="inputState">${state.inputDirty?'文本已修改，整理后更新草稿':'支持中文海报与尺寸适配需求'}</span><span id="charCount">${state.chat.length} 字</span></div></div><p class="field-error" id="inputError" hidden></p>
      <div class="composer-actions"><span class="privacy-note">本页规则解析，无需发送消息到服务器</span><button class="button" data-action="extract">${state.extracted?'重新用规则整理':'尝试规则整理'} <span aria-hidden="true">↗</span></button></div></div>
      <details class="limits" id="parserLimits"><summary>关于识别范围与人工核对</summary><p>当前使用有限规则，尚未接入 AI。缺项、否定与冲突需人工核对；无法识别的内容可手动补充。重新整理会重建工作草稿，已保存的版本保持不变。</p></details>
    </section>
    <details class="card reply-section" id="replySection" ${state.replyVisible?'open':''}><summary><div><strong>客户有新的回复？</strong><small>逐项对照新旧内容，由你决定是否更新</small></div></summary><div class="reply-body"><div class="field"><label for="replyDate">回复日期</label><input id="replyDate" type="date" value="${esc(state.replyDate)}"></div><div class="field"><label for="replyInput">补充回复</label><textarea id="replyInput">${esc(state.replyText)}</textarea></div><button class="button secondary" data-action="parse-reply" ${state.extracted?'':'disabled'}>对照这条回复</button>${!state.extracted?'<p class="hint">先整理上方需求，再对照补充回复。</p>':''}${state.replyIssues.length?`<div class="notice" style="margin-top:12px">${state.replyIssues.map(esc).join('<br>')}</div>`:''}${proposals}${state.replyVisible&&!proposals?'<p class="muted">未找到可靠的更新项，请手动核对。</p>':''}</div></details>
  </div><aside class="stack"><section class="insight-panel"><h2>${state.extracted?'需求已落在纸上':'从聊天，到一张明白的单'}</h2><p>${state.extracted?'已整理的工作草稿，仍需你逐项核对。':'把容易遗漏的约定，放到看得见的地方。'}</p><div class="paper-preview"><div class="paper-header"><strong>明单 · 需求档案</strong><span>${state.extracted?'工作草稿':'流程示意'}</span></div>${preview||'<p class="small muted">暂未识别到交付项，可手动补充。</p>'}</div><p class="preview-note">${state.inputDirty?'输入已修改。请重新整理，再继续核对。':'每一个提取结果都保留依据，不确定的内容留给你确认。'}</p>${state.extracted&&!state.inputDirty?'<button class="button secondary full" style="margin-top:16px" data-page="1">继续核对与报价 →</button>':''}</section>
  <section class="workflow-note"><h3>一笔订单，清楚地往前走</h3><ol><li><div><strong>先核对，少漏项</strong>内容、数量、交期，都有原话可查。</div></li><li><div><strong>用你的价格，算清费用</strong>金额按价目表计算，不猜市场价。</div></li><li><div><strong>约定留底，变化可追溯</strong>保存版本，区分草稿与确认记录。</div></li></ol></section>
  ${state.extracted?`<details class="card" id="originalText"><summary>查看本次解析原文</summary><div class="chat" style="margin-top:12px">${esc(state.analysis?.text||'')}</div></details>`:''}</aside></div>`;

}

function renderReview(){
  const quote=draftQuote();
  const noAutoItems=state.analysis?.items?.length===0;
  const unsupported=state.analysis?.issues?.some(issue=>issue.id==='unsupported');
  const dynamicConditions=Array.isArray(state.draft.conditions);
  const extractionWarning=dynamicConditions&&noAutoItems?`<div class="notice extraction-warning" role="status"><strong>${state.analysis?.mode==='manual'?'请依据原文建立本次交付清单。':'没有可靠的自动交付项。'}</strong><p>${state.analysis?.mode==='manual'?'当前是手动整理。原文已保留，请填写交付内容、数量、规格和自己的单价。':'请补充客户消息或手动建立清单，不会套用海报示例。'}</p></div>`:noAutoItems?`<div class="notice red extraction-warning" role="alert"><strong>这段需求没有自动整理成交付清单。</strong><p>当前规则只支持部分海报与尺寸适配表达；官网、报名 H5 等内容需要人工拆解。原文仍完整保留，下方可逐项填写交付内容、数量和自己的价格。</p><button type="button" class="button secondary" data-action="add-manual">手动建立交付项</button></div>`:
    unsupported?`<div class="notice extraction-warning" role="status"><strong>这里只识别了部分内容。</strong><p>原文含当前规则不支持的项目。请逐项对照原文补录，别把现有清单当作完整结果。</p></div>`:'';
  const audit=`<section class="card audit-card"><details id="auditDetails"><summary>解析检查记录 · ${(state.analysis?.issues||[]).length} 条提示</summary><div class="audit-body"><p class="hint">规则引擎 ${esc(state.analysis?.version||'尚未解析')}；下方提示来自原始文本，补充回复后的状态以当前字段为准。</p>${(state.analysis?.issues||[]).map(item=>`<div class="notice" style="margin-top:8px">${esc(item.message)}</div>`).join('')}${(state.analysis?.dateCandidates||[]).map(item=>`<div class="source">日期候选：${esc(item.date)} · ${esc(item.milestone||'交付阶段未明确')}<br>原话：“${esc(item.source)}”</div>`).join('')}</div></details><label class="small" style="display:flex;gap:8px;margin-top:12px"><input type="checkbox" id="analysisReviewed" ${state.analysisReviewed?'checked':''}>我已对照原文，检查漏项、数量、尺寸和计费范围</label></section>`;
  const items=state.draft.items.map((item,index)=>`<div class="req" data-evidence-id="${esc(item.id)}"><div class="req-ordinal" aria-hidden="true">${String(index+1).padStart(2,'0')} <span></span> ${item.origin==='ai'?'AI 候选':item.rate==='manual'?'人工补充':'规则提取'}</div><div class="req-head"><strong>${esc(item.name)}</strong><div class="section-tools"><span class="badge">${item.origin==='ai'?'原话待核对':item.rate==='manual'?'人工补充':'原话可核对'}</span><button class="remove-item" data-remove-item="${item.id}" aria-label="移除${esc(item.name)}">移除</button></div></div>${item.rate==='manual'?`<div class="field"><label for="source-${item.id}">对应的原话或人工沟通记录 *</label><textarea id="source-${item.id}" rows="2" data-item-source="${item.id}" placeholder="填写这项交付的客户原话或后续确认依据">${esc(item.source)}</textarea></div><div class="field"><label for="manual-${item.id}">项目单价（由你填写）</label><input id="manual-${item.id}" type="number" min="0" step="0.01" data-manual-price="${item.id}" value="${item.unitPrice??''}"></div>`:`<div class="source evidence-source">“${esc(item.source)}”</div>`}<div class="field"><label for="spec-${item.id}">规格与交付范围</label><textarea id="spec-${item.id}" rows="2" data-item-specification="${item.id}">${esc(item.specification||'')}</textarea></div><div class="two-fields"><div class="field" style="margin:0"><label for="name-${item.id}">交付名称</label><input id="name-${item.id}" data-item-name="${item.id}" value="${esc(item.name)}"></div><div class="field" style="margin:0"><label for="qty-${item.id}">数量</label><input id="qty-${item.id}" data-item-quantity="${item.id}" type="number" min="1" max="99" value="${item.quantity??''}"></div></div></div>`).join('');
  const questions=dynamicConditions?state.draft.conditions.map(condition=>`<div class="question"><div class="question-head"><span>${esc(condition.title)}${condition.required?'':' · 可选'}</span><span class="${isResolvedAnswer(condition.value)?'badge':'badge warn'}">${isResolvedAnswer(condition.value)?'已记录':'待确认'}</span></div><div class="field"><label for="title-${esc(condition.id)}">核对事项</label><input id="title-${esc(condition.id)}" data-condition-title="${esc(condition.id)}" maxlength="200" value="${esc(condition.title)}"></div><div class="source">${condition.source?`最初原话：${esc(condition.source)}`:'原文尚未明确，请与客户核对。'}${condition.editedByDesigner?' · 当前答案由设计师编辑':''}</div><div class="field"><label for="${esc(condition.id)}">核对后的答案（不适用请说明）</label><textarea id="${esc(condition.id)}" rows="2" data-condition="${esc(condition.id)}">${esc(condition.value)}</textarea></div></div>`).join(''):QUESTION_META.map(meta=>{
    const answer=state.draft.answers[meta.id],source=state.draft.answerSources[meta.id];
    return `<div class="question"><div class="question-head"><span>${esc(meta.title)}</span><span class="${isResolvedAnswer(answer)?'badge':'badge warn'}">${isResolvedAnswer(answer)?'已记录':'待确认'}</span></div><div class="source">最初原话：“${esc(state.analysis?.facts?.[meta.id]?.source||'本次原文未明确该项')}”${source?`<br>补充依据：“${esc(source)}”`:''}</div><div class="field" style="margin:8px 0 0"><label class="sr-only" for="answer-${meta.id}">${esc(meta.title)}</label><input id="answer-${meta.id}" data-answer="${meta.id}" value="${esc(answer)}" placeholder="核对客户回复后填写"></div></div>`;
  }).join('');
  const rateFields=[];
  if(state.draft.items.some(item=>item.rate==='poster'))rateFields.push(['poster','主海报']);
  if(state.draft.items.some(item=>item.rate==='adapt'))rateFields.push(['adapt','每种尺寸适配']);
  if(state.draft.sourceChoice==='paid'||/源文件/.test(state.chat))rateFields.push(['sourceFile','交付源文件']);
  const rates=rateFields.map(([key,label])=>`<div class="rate-row"><label for="rate-${key}">${label}</label><input class="inline-input" id="rate-${key}" type="number" min="0" step="0.01" data-rate="${key}" value="${state.draft.rates[key]??''}"></div>`).join('');
  const priceSettings=rates?`<details class="card price-settings" id="priceSettings"><summary>本单用到的单价 <span class="small muted">调整单价</span></summary><p class="hint">仅列出本单用到的规则单价；人工交付项请直接填写项目单价。</p><div class="divider" style="margin:12px 0"></div>${rates}</details>`:'';
  const lines=quote.lines.map(line=>`<div class="row"><span>${esc(line.name)} × ${line.quantity}</span><strong>${money(line.amount)}</strong></div>`).join('');
  const followup=state.followupText||composeFollowup();
  const sourceNote=MingdanEngine.validMoney(state.draft.rates.sourceFile)?`源文件尚未确认；若单独计费，参考价为 ${money(quote.optional)}。`:'源文件是否交付及费用仍待确认，未计入当前报价。';
  return `<h1>核对需求，再算报价</h1><p class="lead">已确认与待确认信息分开；调价只影响当前草稿，不回写已保存的版本。</p>${extractionWarning}<section class="extraction-story" aria-label="本次需求整理路径"><div class="story-step"><span class="story-number">01</span><div><strong>原话已留存</strong><small>${state.analysis?.text?.length||0} 字客户消息</small></div></div><span class="story-line" aria-hidden="true"></span><div class="story-step"><span class="story-number">02</span><div><strong>检查交付清单</strong><small>${state.draft.items.length} 项可逐条核对</small></div></div><span class="story-line" aria-hidden="true"></span><div class="story-step"><span class="story-number">03</span><div><strong>报价有依据</strong><small>${money(quote.total)} · ${pendingQuestions(state.draft.answers).length+pricingPendingCount()} 项待核对</small></div></div></section><div class="grid"><div class="stack">${audit}<section class="card"><div class="card-head"><div><h2>交付清单</h2><p class="hint">提取项可回看原话；人工补录项请填写沟通依据。</p></div><span class="badge">${state.draft.items.length} 项</span></div>${items||'<div class="empty">没有可用交付项，请人工补充。</div>'}<button class="button secondary" style="margin-top:12px" data-action="add-manual">手动补充交付项目</button>${dynamicConditions?'':`<div class="divider"></div><div class="field"><label for="sourceChoice">源文件处理方式</label><select id="sourceChoice" data-source-choice><option value="pending" ${state.draft.sourceChoice==='pending'?'selected':''}>待确认 · 仅显示为可选项</option><option value="no" ${state.draft.sourceChoice==='no'?'selected':''}>本次不交付</option><option value="paid" ${state.draft.sourceChoice==='paid'?'selected':''}>交付，按价目表单独计费</option><option value="included" ${state.draft.sourceChoice==='included'?'selected':''}>交付，费用已包含</option></select></div><p class="hint">是否交付及如何计费，请核对本次原文与后续确认。</p>`}</section><section class="card"><div class="card-head"><div><h2>${dynamicConditions?'本单需要核对的条件':noAutoItems?'常规交付条件（人工核对）':'还要问清什么'}</h2><p class="hint">${dynamicConditions?'逐项核对原话、范围、交期与验收条件；可以补充遗漏的问题。':noAutoItems?'下列是通用检查项，不是根据这段消息自动生成；不适用的项目请填写“不适用”。':'按对报价和交期的影响排序；文本只记录已核对的答案。'}</p></div><span class="${pendingQuestions(state.draft.answers).length?'badge warn':'badge'}">${pendingQuestions(state.draft.answers).length} 项待确认</span></div>${questions}${dynamicConditions?'<button type="button" class="button secondary" data-action="add-condition">补充待确认事项</button>':''}</section><section class="card"><h2>${dynamicConditions?'准备发给客户的一条消息':noAutoItems?'通用追问草稿':'准备发给客户的一条消息'}</h2><p class="hint">${dynamicConditions?'根据本单尚未明确的条件生成，可编辑后复制。':noAutoItems?'这不是根据原文生成的完整追问；请结合实际项目修改后再复制。':'优先提出最影响报价和交期的三个问题，可编辑后复制。'}</p><div class="field" style="margin-top:12px"><label class="sr-only" for="followupText">追问消息</label><textarea id="followupText" rows="6">${esc(followup)}</textarea></div><div class="actions"><button type="button" class="button secondary" data-action="regenerate-followup">按当前待确认项重写</button><button type="button" class="button" data-action="copy-followup">复制消息</button></div></section></div><aside class="stack review-rail"><section class="card"><h2>当前报价草稿</h2>${quote.errors.map(message=>`<div class="notice">${esc(message)}</div>`).join('')}${lines}<div class="total"><span>已核算条目小计</span><strong>${money(quote.total)}</strong></div>${state.draft.sourceChoice==='pending'?`<div class="notice" style="margin-top:12px">${esc(sourceNote)}</div>`:''}<p class="small muted">本报价仍有 ${pendingQuestions(state.draft.answers).length+pricingPendingCount()} 项待核对（含漏算检查）。保存为内部版本后才能进入确认流程。</p><button type="button" class="button full" data-action="save-initial">保存需求与报价版本 →</button></section>${priceSettings}<section class="card"><h2>草稿保护</h2><p class="small muted">本浏览器自动保存草稿。误改可撤销上一步草稿编辑；已确认的历史版本不会被草稿调价覆盖。</p><button type="button" class="button secondary" data-action="undo" ${undoStack.length?'':'disabled'}>撤销上一步草稿编辑</button></section></aside></div>`;
}

function renderConfirmation(){
  const version=selectedVersion();
  if(!version)return `<h1>每一次确认，都留有依据。</h1><p class="lead">先保存一版需求和报价，再核对发给客户的内容。</p><div class="empty">尚无报价版本。<div style="margin-top:14px"><button type="button" class="button" data-page="${state.extracted?1:0}">${state.extracted?'前往核对与报价':'从客户消息开始'}</button></div></div>`;
  const issues=version.issues||[];
  const answers=version.conditions?version.conditions.map(item=>({label:item.title,value:item.value})):QUESTION_META.map(meta=>({label:meta.title,value:version.answers[meta.id]}));
  const conditionRows=answers.map(item=>`<div class="row"><span>${esc(item.label)}</span><strong>${esc(item.value||'待确认')}</strong></div>`).join('');
  const items=version.items.map(item=>`<li>${esc(item.name)} × ${item.quantity} · ${money(item.amount)}${item.specification?`<p class="small muted">${esc(item.specification)}</p>`:''}</li>`).join('');
  const adjustments=(version.feeAdjustments||[]).map(item=>`<div class="row"><span>${esc(item.label)}</span><strong>${money(item.amount)}</strong></div>`).join('');
  const status=statusText(version.status);
  const savedRateNote=version.items.some(item=>item.rate==='adapt')
    ?`保存时的尺寸适配单价为 ${money(version.rates.adapt)}。`
    :'每项交付及对应金额均按保存时的内容留存。';
  return `<div class="actions page-action"><button class="button secondary" data-action="print">打印确认单</button><span class="small muted">仅打印右侧单据 · 保留当前状态</span></div><h1>确认单 · 版本 ${version.number}</h1><p class="lead">这张单据读取保存时的需求、答案和价目表。后续改草稿不会改变它。</p><div class="grid"><div class="stack"><section class="card"><div class="card-head"><div><h2>审核与客户确认</h2><p class="hint">只有待确认项处理完毕，才能标记设计师审核。</p></div><span class="${statusClass(version.status)}">${status}</span></div>${issues.length?`<div class="notice">暂不能审核：${issues.map(esc).join('；')}。</div>`:`<div class="notice good">${version.status==='draft'?'保存版本中的事项已核对，可以进行设计师审核。':version.status==='client-confirmed'?'设计师审核已完成，客户已确认本版。':version.share?.status==='changes_requested'?'设计师审核已完成，客户提出了调整，请核对后保存新版本。':'设计师审核已完成，等待客户核对与回复。'}</div>`}${version.status==='draft'?`<div class="actions" style="margin-top:15px"><button type="button" class="button secondary" data-action="review-version" ${issues.length?'disabled':''}>标记设计师已审核</button></div>`:''}<div class="divider"></div><div class="field"><label for="confirmationEvidence">客户确认记录</label><textarea id="confirmationEvidence" rows="3" placeholder="例如：微信 2026-09-29 15:40，客户回复“清单和价格确认”">${esc(state.confirmationEvidence)}</textarea></div><p class="hint">请根据实际沟通记录填写。这里只记录人工确认，不核验聊天真伪。</p><div class="actions" style="margin-top:13px"><button type="button" class="button" data-action="confirm-version" ${version.status!=='designer-reviewed'||!state.confirmationEvidence.trim()?'disabled':''}>记录客户已确认</button></div>${version.status==='client-confirmed'?`<div class="notice good" style="margin-top:13px">确认记录：${esc(version.confirmationEvidence)}<br>记录时间：${esc(version.confirmedAt)}</div>`:''}</section><section class="card"><h2>报价版本如何保护旧单</h2><p class="small muted">本版本总额 ${money(version.total)}。${savedRateNote}后续修改当前草稿不会改变这里的价格。</p><div class="actions"><button type="button" class="button secondary" data-page="1">查看当前工作草稿</button><button type="button" class="button secondary" data-page="3" ${!latestConfirmed()?'disabled':''}>处理后续变更</button></div></section></div><aside class="sheet"><div class="sheet-title"><div><div class="eyebrow">MINGDAN / ORDER BRIEF</div><h2>需求与报价确认单</h2></div><span class="${statusClass(version.status)}">${status}</span></div><div class="sheet-meta"><div><span>订单</span><strong>${esc(version.orderTitle||'未命名订单')}</strong></div><div><span>版本</span><strong>V${version.number} · ${esc(version.createdAt)}</strong></div><div><span>报价合计</span><strong>${money(version.total)}</strong></div><div><span>文档性质</span><strong>${version.kind==='change'?'变更后确认单':'首次报价确认单'}</strong></div></div><h3>最终交付清单</h3><ul class="sheet-list">${items}</ul>${adjustments?`<div class="divider"></div><h3>已完成工作及费用调整</h3>${adjustments}`:''}${version.change?`<div class="divider"></div><h3>本次变更</h3><p class="small">${esc(version.change.description)}</p><p class="small">费用调整 ${money(version.change.delta)}；交期影响：${esc(version.change.scheduleText)}</p><div class="source">客户原话：“${esc(version.change.source)}”</div>`:''}<div class="divider"></div><h3>已记录的交付条件</h3>${conditionRows}${version.status==='client-confirmed'?`<div class="notice good stage4-client-record" style="margin-top:14px">客户确认记录：${esc(version.confirmationEvidence)}</div>`:''}<p class="tiny muted" style="margin-top:18px">仅展示人工记录的确认状态；不提供电子签署或真实性核验。</p></aside></div>`;
}

function categoryOptions(type){return CATEGORY_BY_TYPE[type].map(id=>`<option value="${id}" ${state.change.category===id?'selected':''}>${CATEGORIES[id]}</option>`).join('')}
function deriveChange(){
  const base=latestConfirmed();if(!base)return null;
  const change=state.change,items=clone(base.items),issues=[];
  const feeAdjustments=clone(base.feeAdjustments||[]);
  const source=(change.sourceText||'').trim();
  const target=items.find(item=>item.id===change.targetId);
  const zeroReason=['included_revision','designer_error','extraction_error'].includes(change.category);
  let delta=0,description='',feeExplanation='';
  if(!source)issues.push('请填写客户本次变更的原话');
  if(change.category==='ambiguous')issues.push('变更原因尚未判断');
  if(change.type==='add'){
    const name=(change.itemName||'').trim(),quantity=Number(change.quantity);
    if(!name)issues.push('请填写新增交付的名称');
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>99)issues.push('新增交付数量须为 1—99 的整数');
    if(!zeroReason&&change.unitPrice===null)issues.push('新增交付单价尚未填写');
    else if(!zeroReason&&!MingdanEngine.validMoney(change.unitPrice))issues.push('无效金额：新增交付单价须为非负金额，最多两位小数');
    delta=zeroReason?0:name&&Number.isSafeInteger(quantity)&&quantity>0&&quantity<=99&&MingdanEngine.validMoney(change.unitPrice)?Math.round(quantity*Math.round(change.unitPrice*100))/100:0;
    if(name&&Number.isSafeInteger(quantity)&&quantity>0&&quantity<=99)items.push({id:`change-add-${base.number}`,name,quantity,rate:'manual',unitPrice:change.unitPrice,source,amount:delta,...(change.pricingBasis?{pricingBasis:clone(change.pricingBasis)}:{})});
    description=name?`新增 ${name} × ${Number.isSafeInteger(quantity)&&quantity>0?quantity:'待确认'}`:'新增交付范围待填写';
    feeExplanation=zeroReason?'按约定内修改或纠错处理，不新增费用':'使用设计师填写的本次单价计算';
  }
  if(change.type==='remove'){
    const index=items.findIndex(item=>item.id===change.targetId);
    const removedAmount=index>=0?Number(items[index].amount):0;
    if(index>=0)items.splice(index,1);else issues.push('请选择要取消的原交付项');
    description=target?`取消 ${target.name}，最终交付清单已移除该项`:'取消交付项待选择';
    if(zeroReason){delta=-removedAmount;feeExplanation='纠正原范围或系统理解错误，移除对应费用'}
    else if(change.refundDecision==='keep'){delta=0;feeExplanation='保留已完成工作的原约定费用'}
    else if(change.refundDecision==='full'){delta=-removedAmount;feeExplanation='经人工选择，扣除未开展的尺寸适配费用'}
    else if(change.refundDecision==='manual'){
      if(change.refundManual===null)issues.push('协商扣减金额尚未填写');
      else if(!MingdanEngine.validMoney(change.refundManual)||change.refundManual>removedAmount)issues.push('无效金额：扣减金额须为非负数且不超过原项目金额');
      delta=MingdanEngine.validMoney(change.refundManual)?-Math.min(removedAmount,change.refundManual):0;
      feeExplanation='按双方协商的金额调整';
    }
    else{issues.push('取消交付后的费用尚未协商');feeExplanation='费用待协商，暂按 0 展示'}
    if(target&&removedAmount+delta>0)feeAdjustments.push({label:`${target.name} 已开展的工作，不再交付`,amount:removedAmount+delta});
  }
  if(change.type==='replace'){
    const name=(change.itemName||'').trim(),quantity=Number(change.quantity);
    if(!target)issues.push('请选择要替换的原交付项');
    if(!name)issues.push('请填写替换后的交付名称');
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>99)issues.push('替换后数量须为 1—99 的整数');
    if(target&&name&&Number.isSafeInteger(quantity)&&quantity>0&&quantity<=99){target.name=name;target.quantity=quantity;target.source=source;target.rate='manual';target.unitPrice=null;delete target.amountCents}
    description=target&&name?`将 ${base.items.find(item=>item.id===target.id).name} 替换为 ${name}`:'替换范围待填写';
    if(zeroReason){delta=0;feeExplanation='按约定内修改或纠错处理，不另计费'}
    else if(change.replacementDecision==='same'){delta=0;feeExplanation='人工确认工作量相当，无差价'}
    else if(change.replacementDecision==='adjust'){
      if(change.replacementManual===null)issues.push('替换差价尚未填写');
      else if(!MingdanEngine.validMoney(change.replacementManual,true))issues.push('无效金额：替换差价最多两位小数');
      delta=MingdanEngine.validMoney(change.replacementManual,true)?change.replacementManual:0;
      feeExplanation='人工确认工作量差异，按填写金额调整';
    }
    else{issues.push('替换后的工作量与费用尚未确认');feeExplanation='差价待确认，暂按 0 展示'}
    if(target&&delta)feeAdjustments.push({label:'交付替换工作量调整',amount:delta});
  }
  if(change.type==='rework'){
    if(!target)issues.push('请选择要重做的原交付项');
    description=target?`${target.name} 重做；原交付项仍保留`:'重做范围待选择';
    if(zeroReason){delta=0;feeExplanation='属于约定内修改或纠错，不自动计费'}
    else if(change.reworkDecision==='included'){delta=0;feeExplanation='设计师决定计入原约定范围'}
    else if(change.reworkDecision==='charge'){
      if(change.reworkManual===null)issues.push('重做费用尚未填写');
      else if(!MingdanEngine.validMoney(change.reworkManual))issues.push('无效金额：重做金额须为非负数，最多两位小数');
      delta=MingdanEngine.validMoney(change.reworkManual)?change.reworkManual:0;
      feeExplanation='设计师核对范围后手动计入重做费用';
      if(target)items.push({id:`rework-${base.number}`,name:`${target.name} 重做`,quantity:1,rate:'manual',unitPrice:delta,source,amount:delta});
    }
    else{issues.push('重做是否超出约定范围尚未确认');feeExplanation='重做费用待判断，暂按 0 展示'}
  }
  let scheduleText='';
  if(change.schedule==='same')scheduleText='设计师判断不影响原交期';
  else if(change.schedule==='date'&&change.scheduleDate) scheduleText=`已另行确认交付日期 ${change.scheduleDate}`;
  else{scheduleText='需与客户重新确认交期';issues.push('交期影响尚未确认')}
  if(base.total+delta<0)issues.push('调整后总额不能为负数');
  const total=(Math.round(base.total*100)+Math.round(delta*100))/100;
  issues.push(...(window.MingdanPricingUI?.changeIssues()||[]));
  return {base,items,feeAdjustments,delta,total,description,feeExplanation,scheduleText,issues,source};
}

function renderChangeControls(){
  const change=state.change,zeroReason=['included_revision','designer_error','extraction_error'].includes(change.category);
  const target=latestConfirmed()?.items.find(item=>item.id===change.targetId);
  const targetSelect=change.type==='add'?'':`<div class="field"><label for="changeTarget">${change.type==='remove'?'取消':change.type==='replace'?'替换':'重做'}哪个交付项？</label><select id="changeTarget" data-change-field="targetId"><option value="">请选择原交付项</option>${latestConfirmed().items.map(item=>`<option value="${esc(item.id)}" ${item.id===change.targetId?'selected':''}>${esc(item.name)} × ${item.quantity} · ${money(item.amount)}</option>`).join('')}</select></div>`;
  if(change.type==='add')return `<div class="order-fields"><div class="field"><label for="changeItemName">新增交付名称</label><input id="changeItemName" data-change-field="itemName" value="${esc(change.itemName||'')}" placeholder="例如：公众号横版"></div><div class="field"><label for="changeQuantity">数量</label><input id="changeQuantity" data-change-field="quantity" type="number" min="1" max="99" step="1" value="${change.quantity??''}"></div></div><div class="field"><label for="changeUnitPrice">本次单价（元）</label><input id="changeUnitPrice" data-change-field="unitPrice" type="number" min="0" step="0.01" value="${change.unitPrice??''}" ${zeroReason?'disabled':''}></div><p class="hint">新增范围由你填写单价；约定内修改或纠错不会自动加价。</p>`;
  if(change.type==='remove')return `${targetSelect}<div class="field"><label for="refundDecision">取消交付后的费用处理</label><select id="refundDecision" data-change-field="refundDecision" ${zeroReason?'disabled':''}><option value="ask" ${change.refundDecision==='ask'?'selected':''}>待协商，暂不扣费</option><option value="keep" ${change.refundDecision==='keep'?'selected':''}>已完成工作，保留原费用</option><option value="full" ${change.refundDecision==='full'?'selected':''}>未开展，扣除该项费用</option><option value="manual" ${change.refundDecision==='manual'?'selected':''}>按协商金额调整</option></select></div>${change.refundDecision==='manual'&&!zeroReason?`<div class="field"><label for="refundManual">扣减金额（最多 ${money(target?.amount??0)}）</label><input id="refundManual" data-change-field="refundManual" type="number" min="0" max="${target?.amount??0}" step="0.01" value="${change.refundManual??''}"></div>`:''}`;
  if(change.type==='replace')return `${targetSelect}<div class="order-fields"><div class="field"><label for="changeItemName">替换后的交付名称</label><input id="changeItemName" data-change-field="itemName" value="${esc(change.itemName||'')}"></div><div class="field"><label for="changeQuantity">替换后数量</label><input id="changeQuantity" data-change-field="quantity" type="number" min="1" max="99" step="1" value="${change.quantity??''}"></div></div><div class="field"><label for="replacementDecision">替换后的工作量</label><select id="replacementDecision" data-change-field="replacementDecision" ${zeroReason?'disabled':''}><option value="ask" ${change.replacementDecision==='ask'?'selected':''}>继续追问，暂不确定差价</option><option value="same" ${change.replacementDecision==='same'?'selected':''}>范围内替换，无差价</option><option value="adjust" ${change.replacementDecision==='adjust'?'selected':''}>调整费用</option></select></div>${change.replacementDecision==='adjust'&&!zeroReason?`<div class="field"><label for="replacementManual">费用变化（负数为减价）</label><input id="replacementManual" data-change-field="replacementManual" type="number" step="0.01" value="${change.replacementManual??''}"></div>`:''}`;
  return `${targetSelect}<div class="field"><label for="reworkDecision">重做如何计入</label><select id="reworkDecision" data-change-field="reworkDecision" ${zeroReason?'disabled':''}><option value="ask" ${change.reworkDecision==='ask'?'selected':''}>先核对原约定，暂不定价</option><option value="included" ${change.reworkDecision==='included'?'selected':''}>计入原约定范围，费用为 0</option><option value="charge" ${change.reworkDecision==='charge'?'selected':''}>超出原范围，手动填写费用</option></select></div>${change.reworkDecision==='charge'&&!zeroReason?`<div class="field"><label for="reworkManual">本次重做费用</label><input id="reworkManual" data-change-field="reworkManual" type="number" min="0" step="0.01" value="${change.reworkManual??''}"></div>`:''}`;
}

function renderVersionStory(result){
  const before=new Map(result.base.items.map(item=>[item.id,item]));
  const after=new Map(result.items.map(item=>[item.id,item]));
  const differences=[...new Set([...before.keys(),...after.keys()])].flatMap((id,index)=>{
    const oldItem=before.get(id),newItem=after.get(id);
    if(oldItem&&newItem&&oldItem.name===newItem.name&&oldItem.quantity===newItem.quantity&&oldItem.amount===newItem.amount)return [];
    const kind=!oldItem?'added':!newItem?'removed':'changed';
    const label=kind==='added'?'新增交付':kind==='removed'?'取消交付':'内容变化';
    return [`<div class="comparison-row ${kind}" style="--row-index:${index}"><span class="comparison-tag">${label}</span><div class="comparison-before">${oldItem?`<strong>${esc(oldItem.name)} × ${oldItem.quantity}</strong><small>${money(oldItem.amount)}</small>`:'<span class="comparison-blank">原版本无此项</span>'}</div><span class="comparison-arrow" aria-hidden="true">→</span><div class="comparison-after">${newItem?`<strong>${esc(newItem.name)} × ${newItem.quantity}</strong><small>${money(newItem.amount)}</small>`:'<span class="comparison-blank">新版本不交付</span>'}</div></div>`];
  });
  if(!differences.length&&state.change.type==='rework'){
    const poster=before.get(state.change.targetId);
    const pending=result.issues.length>0;
    const outcome=pending?'重做范围与费用待判断':'计入原约定修改范围';
    differences.push(`<div class="comparison-row ${pending?'pending':'changed'}" style="--row-index:0"><span class="comparison-tag">${pending?'待核对':'范围已确认'}</span><div class="comparison-before"><strong>${esc(poster?.name||'待选择的交付项')}</strong><small>原交付项保留</small></div><span class="comparison-arrow" aria-hidden="true">→</span><div class="comparison-after"><strong>${esc(poster?.name||'交付项')} 重做</strong><small>${outcome}</small></div></div>`);
  }
  const unchanged=result.base.items.filter(oldItem=>{
    const current=after.get(oldItem.id);
    return current&&oldItem.name===current.name&&oldItem.quantity===current.quantity&&oldItem.amount===current.amount;
  }).length;
  const signature=[state.change.type,state.change.category,state.change.targetId,state.change.itemName,state.change.quantity,state.change.unitPrice,state.change.refundDecision,state.change.replacementDecision,state.change.reworkDecision,state.change.schedule,state.change.scheduleDate,result.delta,result.total].join('|');
  return `<section class="comparison-story" data-signature="${esc(signature)}" aria-label="版本变化对照"><div class="comparison-top"><div><span class="comparison-kicker">VERSION TRACE / V${result.base.number} → 草稿</span><h2>这次变更，落在了哪里</h2><p>左侧是已确认版本，右侧是当前变更草稿。高亮变化项与待判断范围。</p></div><button type="button" class="comparison-replay" data-action="replay-comparison" aria-label="重播版本变化动画">↻ 重播变化</button></div><div class="comparison-labels"><span>V${result.base.number} · 已确认</span><span>本次变更草稿</span></div><div class="comparison-rows">${differences.join('')||'<p class="comparison-empty">交付项目没有变化；请继续核对费用和交期。</p>'}</div>${unchanged?`<p class="comparison-unchanged">另有 ${unchanged} 项交付保持不变</p>`:''}<div class="comparison-totals"><div><span>原约定</span><strong>${money(result.base.total)}</strong></div><span class="comparison-total-arrow" aria-hidden="true">→</span><div><span>费用变化</span><strong class="${result.delta?'delta-active':''}">${result.delta>0?'+':''}${money(result.delta)}</strong></div><span class="comparison-total-arrow" aria-hidden="true">=</span><div><span>当前草稿</span><strong>${money(result.total)}</strong></div></div><p class="comparison-note">${result.issues.length?'仍有待确认事项；金额只是内部草稿。':'费用与交期处理方式已填写；保存后形成新版本。'}</p></section>`;
}

function renderChanges(){
  const base=latestConfirmed();
  const history=state.versions.map(version=>`<div class="version ${state.selectedVersionId===version.id?'selected':''}"><div class="version-top"><div><strong>V${version.number} · ${version.kind==='change'?'变更后':'首次报价'}</strong><br><small>${esc(version.createdAt)}</small></div><span class="${statusClass(version.status)}">${statusText(version.status)}</span></div><div class="row"><span>保存的总价</span><strong>${money(version.total)}</strong></div><button type="button" class="text-button" data-select-version="${version.id}">查看这个版本</button></div>`).join('');
  if(!base)return `<h1>变更与版本</h1><p class="lead">先完成首次报价的设计师审核与客户确认，才有明确的变更比较基准。</p><div class="grid"><div class="empty">尚无客户已确认的版本。<div style="margin-top:14px"><button type="button" class="button" data-page="${state.versions.length?2:state.extracted?1:0}">${state.versions.length?'前往确认单':'继续整理订单'}</button></div></div><aside class="card"><h2>已保存版本</h2>${history||'<p class="muted">暂无版本。</p>'}</aside></div>`;
  const result=deriveChange(),change=state.change;
  const typeButtons=Object.entries(CHANGE_LABELS).map(([id,label])=>`<button type="button" data-change-type="${id}" class="${change.type===id?'active':''}">${label}</button>`).join('');
  const finalItems=result.items.map(item=>`<li>${esc(item.name)} × ${item.quantity}</li>`).join('');
  return `<h1>客户改了什么，这一单怎么变</h1><p class="lead">先区分原因，再决定范围、费用和交期。下方始终按最近的客户已确认版本比较。</p>${renderVersionStory(result)}<div class="grid"><div class="stack"><section class="card"><div class="card-head"><div><h2>客户的新消息</h2><p class="hint">基准：V${base.number} · ${money(base.total)} · ${statusText(base.status)}</p></div><span class="badge">人工录入原话</span></div><div class="field"><label for="changeSource">客户本次变更的原话 *</label><textarea id="changeSource" rows="3" placeholder="粘贴客户提出这次变更的原话">${esc(change.sourceText||'')}</textarea></div><div class="choice-grid">${typeButtons}</div><div class="field" style="margin-top:14px"><label for="changeCategory">这次变化属于什么情况？</label><select id="changeCategory" data-change-field="category">${categoryOptions(change.type)}</select></div><p class="inline-help">变更类型和费用归因由设计师依据原约定判断。</p><div class="divider"></div>${renderChangeControls()}<div class="divider"></div><div class="field"><label for="scheduleDecision">对交期的影响</label><select id="scheduleDecision" data-change-field="schedule"><option value="ask" ${change.schedule==='ask'?'selected':''}>需要和客户重新确认</option><option value="same" ${change.schedule==='same'?'selected':''}>人工判断不影响交期</option><option value="date" ${change.schedule==='date'?'selected':''}>已确认新的交付日期</option></select></div>${change.schedule==='date'?`<div class="field"><label for="scheduleDate">新的交付日期</label><input id="scheduleDate" type="date" data-change-field="scheduleDate" value="${esc(change.scheduleDate)}"></div>`:''}</section><section class="card" id="changeSummaryPanel"><div class="card-head"><div><h2>变更说明卡</h2><p class="hint">可供设计师核对后，用于与客户沟通。</p></div><span class="${result.issues.length?'badge warn':'badge'}">${result.issues.length?'待确认':'可审核'}</span></div><p><strong>${esc(result.description)}</strong></p><p class="small muted">${esc(result.feeExplanation)}。交期：${esc(result.scheduleText)}。</p>${result.issues.length?`<div class="notice" style="margin-top:13px">待处理：${result.issues.map(esc).join('；')}。可保存内部草稿，暂不能标记已审核。</div>`:'<div class="notice good" style="margin-top:13px">范围、费用和交期处理方式已经填写，可保存新版本。</div>'}<div class="actions" style="margin-top:15px"><button type="button" class="button" data-action="save-change">保存变更版本 →</button><button type="button" class="button secondary" data-action="undo" ${undoStack.length?'':'disabled'}>撤销草稿编辑</button></div></section><section class="card" id="changeFinalPanel"><h2>变更后的最终交付</h2><p class="hint">确认单会只列最终应交内容；取消的项目留在变更摘要中。</p><ul class="sheet-list">${finalItems}</ul></section></div><aside class="stack"><section class="card"><h2>报价版本</h2><p class="hint">保存需求、条件、价格和原话。之后改价不会覆盖旧版。</p>${history}</section><section class="card"><h2>分类示例</h2><p class="small muted">新增工作可能加价；约定内修改、设计师纠错和系统误读不自动加价。判断不清时先标记待协商。</p></section></aside></div>`;
}

function saveInitialVersion(){
  const quote=draftQuote();
  if(!state.title.trim()){toast('请先填写订单名称');state.page=0;persist();render();$('#orderTitle')?.focus();return}
  if(state.draft.items.some(item=>item.quantity!==null&&item.quantity<1)){toast('交付数量至少为 1；取消交付请移除该项目');return}
  const issues=pendingQuestions(state.draft.answers).map(item=>item.title);
  if(state.draft.conditions?.some(item=>!item.title.trim()||item.title==='补充问题（请填写）')){toast('请填写补充核对事项的名称');return}
  for(const item of state.draft.items.filter(entry=>entry.rate==='manual')){
    if(!item.name.trim()||item.name==='手动项目')issues.push('手动交付项名称尚未填写');
    if(!item.source.trim())issues.push(`${item.name||'手动交付项'}缺少原话或人工沟通记录`);
  }
  issues.push(...quote.errors);
  issues.push(...(window.MingdanPricingUI?.reviewIssues()||[]));
  if(!state.analysisReviewed)issues.push('尚未完成人工核对解析结果');
  if(state.inputDirty){toast('输入已改动，请重新解析后再保存');return}
  if(!quote.lines.some(item=>item.id!=='sourceFile')){toast('没有有效的交付项目，不能保存空报价');return}
  const sourceAnswer=state.draft.answers.sourceFile;
  if(state.draft.sourceChoice==='paid'&&/不需要|不要|不交付/.test(sourceAnswer))issues.push('源文件答案与计费选项冲突');
  if(state.draft.sourceChoice==='no'&&/需要|要交付|需交付/.test(sourceAnswer)&&!/不需要|不要|不交付/.test(sourceAnswer))issues.push('源文件答案与交付选项冲突');
  if(!Array.isArray(state.draft.conditions)&&state.draft.sourceChoice==='pending'&&!issues.some(item=>item.includes('源文件')))issues.push('源文件交付与计费尚未确认');
  const number=state.versions.length+1;
  const version={
    id:`version-${Date.now()}-${number}`,number,kind:'initial',status:'draft',createdAt:now(),
    orderTitle:state.title.trim(),clientName:state.clientName.trim(),
    sourceText:state.analysis?.text||'',messageDate:state.messageDate,parserVersion:state.analysis?.version,
    sourceMessages:[{text:state.analysis?.text||'',date:state.messageDate},...clone(state.replyHistory||[])],
    items:clone(quote.lines),answers:clone(state.draft.answers),answerSources:clone(state.draft.answerSources),
    ...(Array.isArray(state.draft.conditions)?{conditions:clone(state.draft.conditions)}:{}),
    rates:clone(state.draft.rates),sourceChoice:state.draft.sourceChoice,total:quote.total,
    ...(window.MingdanPricingUI?{pricingReview:window.MingdanPricingUI.snapshotReview()}:{}),
    optional:quote.optional,issues,change:null,feeAdjustments:[],confirmationEvidence:'',confirmedAt:''
  };
  state.versions.push(version);
  state.selectedVersionId=version.id;
  state.confirmationEvidence='';
  state.page=2;
  undoStack.length=0;
  persist();render();toast(`V${number} 已保存，旧版本不会被后续编辑覆盖`);
}

function saveChangeVersion(){
  const result=deriveChange();if(!result){toast('请先确认首次报价');return}
  if(result.issues.some(message=>message.startsWith('无效金额'))){toast('请先修正无效金额，再保存版本');return}
  const number=state.versions.length+1;
  const answers=clone(result.base.answers);
  const answerSources=clone(result.base.answerSources);
  let conditions=result.base.conditions?clone(result.base.conditions):null;
  const adopted=state.change.pricingSuggestion;
  if(adopted?.questions.length){
    conditions ||= QUESTION_META.map(item=>({...item,value:answers[item.id]||'',source:answerSources[item.id]||'',required:true}));
    adopted.questions.forEach((title,index)=>conditions.push({id:`change-advice-${Date.now()}-${index}`,kind:'other',title,value:adopted.answers[index]||'',source:result.source,required:true,priority:2,editedByDesigner:true}));
    if(conditions.length>39){toast('交付条件过多，请先合并原有条件后再保存变更。');return}
  }
  if(conditions){
    const originalScope=conditions.find(item=>item.kind==='scope'&&item.id!=='current-change-scope');
    if(originalScope)originalScope.title='原约定范围（本版调整见变更说明）';
    const currentScope=conditions.find(item=>item.id==='current-change-scope');
    const scopeRecord={id:'current-change-scope',kind:'scope',title:'本次变更后的最终交付',value:result.items.map(item=>`${item.name} × ${item.quantity}`).join('；')+'。其他范围约定与本次变更说明一并核对。',source:result.source,required:true,priority:1,editedByDesigner:true};
    if(currentScope)Object.assign(currentScope,scopeRecord);else conditions.push(scopeRecord);
  }
  if(conditions&&state.change.schedule==='date'){const delivery=conditions.find(item=>item.kind==='delivery');if(delivery){delivery.value=result.scheduleText;delivery.source=result.source}}
  if(!conditions&&state.change.schedule==='date'&&state.change.scheduleDate){
    const milestone=answers.delivery.match(/交(初稿|终稿)/)?.[1];
    answers.delivery=milestone?`${state.change.scheduleDate} 交${milestone}`:`${state.change.scheduleDate}，交付阶段待确认`;
    if(!milestone)result.issues.push('变更后的交付阶段仍需确认');
    answerSources.delivery='设计师记录的本次变更交期（请核对客户回复）';
  }
  const version={
    id:`version-${Date.now()}-${number}`,number,kind:'change',status:'draft',createdAt:now(),
    orderTitle:state.title.trim(),clientName:state.clientName.trim(),
    sourceText:result.base.sourceText||'',messageDate:result.base.messageDate||'',parserVersion:result.base.parserVersion||'',
    sourceMessages:[...clone(result.base.sourceMessages||[]),{text:result.source,date:''}],
    items:clone(result.items),feeAdjustments:clone(result.feeAdjustments),answers,answerSources,
    ...(conditions?{conditions}:{}),
    rates:clone(result.base.rates),sourceChoice:result.base.sourceChoice,total:result.total,
    optional:0,issues:clone(result.issues),confirmationEvidence:'',confirmedAt:'',
    change:{baseVersion:result.base.number,type:state.change.type,category:state.change.category,
      description:result.description,feeExplanation:result.feeExplanation,delta:result.delta,
      scheduleText:result.scheduleText,source:result.source,...(state.change.pricingSuggestion?{pricingSuggestion:clone(state.change.pricingSuggestion)}:{})}
  };
  state.versions.push(version);
  state.selectedVersionId=version.id;
  state.confirmationEvidence='';
  state.page=2;
  undoStack.length=0;
  persist();render();toast(`变更版本 V${number} 已保存`);
}

function applyReply(id){
  const proposal=state.proposals.find(item=>item.id===id);
  if(!proposal||state.replyApplied.includes(id))return;
  mutate(()=>{
    state.draft.answers[id]=proposal.next;
    state.draft.answerSources[id]=proposal.evidence;
    state.replyHistory=state.replyHistory||[];
    if(!state.replyHistory.some(message=>message.text===state.replyText&&message.date===state.replyDate))state.replyHistory.push({text:state.replyText,date:state.replyDate});
    if(id==='sourceFile')state.draft.sourceChoice=proposal.next.includes('不交付')?'no':'pending';
    state.replyApplied.push(id);
    state.analysisReviewed=false;
    markStale();
  },{undoable:true});
  toast('已应用这条回复，请重新核对当前草稿');
}

function resetChange(type){
  return {type,category:'ambiguous',sourceText:state.change?.sourceText||'',targetId:'',itemName:'',quantity:null,unitPrice:null,
    refundDecision:'ask',refundManual:null,replacementDecision:'ask',replacementManual:null,
    reworkDecision:'ask',reworkManual:null,schedule:'ask',scheduleDate:''};
}

document.addEventListener('click',async event=>{
  const pageButton=event.target.closest('[data-page]');
  if(pageButton){
    const page=Number(pageButton.dataset.page);
    if(page===1&&state.inputDirty){toast('输入已改变，请重新解析');return}
    if(page===1&&!state.extracted){toast('请先整理客户消息');return}
    state.page=page;persist();render();return;
  }
  const removeButton=event.target.closest('[data-remove-item]');
  if(removeButton){mutate(()=>{state.draft.items=state.draft.items.filter(item=>item.id!==removeButton.dataset.removeItem);state.analysisReviewed=false;markStale()},{undoable:true});toast('已移除交付项，可在草稿保护中撤销');return}
  const applyButton=event.target.closest('[data-apply-reply]');
  if(applyButton){applyReply(applyButton.dataset.applyReply);return}
  const typeButton=event.target.closest('[data-change-type]');
  if(typeButton){mutate(()=>{state.change=resetChange(typeButton.dataset.changeType)},{undoable:true});return}
  const versionButton=event.target.closest('[data-select-version]');
  if(versionButton){const version=state.versions.find(item=>item.id===versionButton.dataset.selectVersion);if(version){state.selectedVersionId=version.id;state.confirmationEvidence=version.confirmationEvidence||'';state.page=2;persist();render()}return}
  const action=event.target.closest('[data-action]')?.dataset.action;
  if(!action)return;
  if(action==='new-order'){
    state=initialState();workspace.orders.push(state);undoStack.length=0;renderedPage=null;persist();render();$('#orderTitle')?.focus();toast('已新建空白订单');return;
  }
  if(action==='export-backup'){
    const backup={kind:'mingdan-backup',schema:1,exportedAt:now(),orders:workspace.orders,...(workspace.catalogue?{catalogue:workspace.catalogue}:{})};
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`mingdan-backup-${today()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('已导出全部订单备份');return;
  }
  if(action==='import-backup'){$('#backupFile').click();return}
  if(action==='undo'){
    const previous=undoStack.pop();if(!previous)return;
    state=previous;persist();render();toast('已撤销上一步草稿编辑');return;
  }
  if(action==='extract'){
    if(!state.chat.trim()){const field=$('#chatInput');field.setAttribute('aria-invalid','true');$('#inputError').textContent='请先输入客户需求，再开始整理。';$('#inputError').hidden=false;field.focus();return}
    const inputRect=$('#chatInput')?.getBoundingClientRect();
    const sourceRect=inputRect&&inputRect.bottom>0&&inputRect.top<window.innerHeight?inputRect:event.target.closest('[data-action]')?.getBoundingClientRect();
    const analysis=MingdanEngine.analyze(state.chat,{messageDate:state.messageDate});
    mutate(()=>{
      state.analysis=analysis;state.extracted=true;state.inputDirty=false;state.analysisReviewed=false;
      state.draft.items=clone(analysis.items);state.draft.answers={delivery:'',revisions:'',sourceFile:'',sizes:''};state.draft.answerSources={};state.draft.sourceChoice='pending';
      for(const [id,fact] of Object.entries(analysis.facts)){
        state.draft.answerSources[id]=fact.source;
        if(fact.certainty==='explicit'&&!(id==='sourceFile'&&fact.value.includes('待确认')))state.draft.answers[id]=fact.value;
      }
      if(analysis.facts.sourceFile?.value.includes('不交付'))state.draft.sourceChoice='no';
      state.replyApplied=[];state.replyHistory=[];state.proposals=[];state.followupText='';state.page=1;
    },{undoable:true});
    window.dispatchEvent(new CustomEvent('mingdan:extracted',{detail:{sourceRect:sourceRect?{left:sourceRect.left,top:sourceRect.top,width:sourceRect.width,height:sourceRect.height}:null,sourceText:analysis.items[0]?.source||'',targetId:analysis.items[0]?.id||null}}));
    toast(!analysis.items.length?'未自动识别交付项，请在第二步人工建立清单':analysis.issues.some(issue=>issue.id==='unsupported')?'仅识别了部分项目，请核对并补录其余内容':'已按当前输入生成草稿，请核对缺项和不确定信息');return;
  }
  if(action==='load-sample'){
    if(state.versions.length||(state.chat.trim()&&state.chat!==FIRST_MESSAGE)){toast('当前订单已有内容，请新建空白订单后再试用示例');return}
    mutate(()=>{state.title=state.title||'新店开业视觉';state.clientName=state.clientName||'示例客户';state.chat=FIRST_MESSAGE;state.messageDate=SAMPLE_DATE;state.replyText=REPLY_MESSAGE;state.replyDate='2026-09-29';state.draft.rates={poster:500,adapt:100,sourceFile:150,rework:300};state.inputDirty=true},{undoable:true});return;
  }
  if(action==='parse-reply'){
    const result=MingdanEngine.analyze(state.replyText,{messageDate:state.replyDate,expectedItems:state.draft.items,reply:true});
    mutate(()=>{
      state.replyVisible=true;state.replyApplied=[];state.replyIssues=result.issues.filter(item=>!item.id.startsWith('count-')).map(item=>item.message);
      state.proposals=Object.entries(result.facts).map(([id,fact])=>({id,label:QUESTION_META.find(meta=>meta.id===id)?.title||id,next:fact.value,previous:state.draft.answers[id],evidence:fact.source,certainty:fact.certainty}));
      if(/新增|追加|再做|取消|换成|重做/.test(state.replyText))state.replyIssues.push('回复可能改变交付范围，请到变更页人工处理；这里不会自动加减项目。');
    });return;
  }
  if(action==='add-manual'){mutate(()=>{state.draft.items.push({id:'manual-'+Date.now(),name:'手动项目',quantity:null,unitPrice:null,rate:'manual',source:''});state.analysisReviewed=false},{undoable:true});return}
  if(action==='show-reply'){mutate(()=>{state.replyVisible=true});return}
  if(action==='regenerate-followup'){mutate(()=>{state.followupText=composeFollowup()});toast('已按当前待确认项生成');return}
  if(action==='copy-followup'){
    const field=$('#followupText');const value=field.value;
    try{await navigator.clipboard.writeText(value);toast('追问消息已复制')}
    catch{field.focus();field.select();const success=document.execCommand('copy');toast(success?'追问消息已复制':'已选中文本，可手动复制')}
    return;
  }
  if(action==='print'){$('#printGeneratedAt').textContent=`生成时间：${now()}`;window.print();return}
  if(action==='save-initial'){saveInitialVersion();return}
  if(action==='save-change'){saveChangeVersion();return}
  if(action==='replay-comparison'){window.dispatchEvent(new Event('mingdan:replay-comparison'));return}
  if(action==='review-version'){
    const version=selectedVersion();if(!version||version.status!=='draft'||version.issues.length)return;
    version.status='designer-reviewed';undoStack.length=0;persist();render();toast('已记录设计师审核');return;
  }
  if(action==='confirm-version'){
    const version=selectedVersion();if(!version||version.status!=='designer-reviewed'||!state.confirmationEvidence.trim())return;
    if(version.share){toast('请由客户通过确认页面提交，或另存新版本');return}
    version.status='client-confirmed';version.confirmationMode='manual';version.confirmationEvidence=state.confirmationEvidence.trim();version.confirmedAt=now();
    undoStack.length=0;persist();render();toast('已记录客户确认凭据');return;
  }
});

function invalidateReply(){
  state.proposals=[];state.replyApplied=[];state.replyVisible=false;
  document.querySelectorAll('[data-apply-reply]').forEach(button=>{button.disabled=true;button.textContent='回复已修改，请重新分析'});
}
function refreshDraftPreview(){
  window.MingdanPricingUI?.refresh();
  if(state.page===3){
    const result=deriveChange();if(!result)return;
    const story=$('.comparison-story');if(story)story.outerHTML=renderVersionStory(result);
    const summary=$('#changeSummaryPanel');
    if(summary){const paragraphs=summary.querySelectorAll(':scope>p');paragraphs[0].textContent=result.description;paragraphs[1].textContent=`${result.feeExplanation}。交期：${result.scheduleText}。`;const badge=summary.querySelector('.card-head .badge');badge.className=result.issues.length?'badge warn':'badge';badge.textContent=result.issues.length?'待确认':'可审核';const notice=summary.querySelector('.notice');notice.className=result.issues.length?'notice':'notice good';notice.textContent=result.issues.length?'待处理：'+result.issues.join('；')+'。可保存内部草稿，暂不能标记已审核。':'范围、费用和交期处理方式已经填写，可保存新版本。'}
    const final=$('#changeFinalPanel ul');if(final)final.innerHTML=result.items.map(item=>`<li>${esc(item.name)} × ${item.quantity}</li>`).join('');
    return;
  }
  if(state.page!==1)return;
  const quote=draftQuote(),pending=pendingQuestions(state.draft.answers).length+pricingPendingCount();
  const panel=$('.review-rail>.card');
  if(panel)panel.innerHTML=`<h2>当前报价草稿</h2>${quote.errors.map(message=>`<div class="notice">${esc(message)}</div>`).join('')}${quote.lines.map(line=>`<div class="row"><span>${esc(line.name)} × ${line.quantity}</span><strong>${money(line.amount)}</strong></div>`).join('')}<div class="total"><span>已核算条目小计</span><strong>${money(quote.total)}</strong></div><p class="small muted">本报价仍有 ${pending} 项待核对（含漏算检查）。保存为内部版本后才能进入确认流程。</p><button type="button" class="button full" data-action="save-initial">保存需求与报价版本 →</button>`;
  const story=$('.story-step:last-child small');if(story)story.textContent=`${money(quote.total)} · ${pending} 项待核对`;
  for(const item of state.draft.items){const row=document.querySelector(`[data-evidence-id="${item.id}"] .req-head strong`);if(row)row.textContent=item.name}
  for(const condition of state.draft.conditions||[]){const row=document.getElementById(condition.id)?.closest('.question');if(row){const badge=row.querySelector('.question-head .badge');badge.className=isResolvedAnswer(condition.value)?'badge':'badge warn';badge.textContent=isResolvedAnswer(condition.value)?'已记录':'待确认';row.querySelector('.question-head span').textContent=condition.title}}
}
let editingElement=null;
function commitDraftField(target){
  const data=target.dataset;
  if(!(data.conditionTitle||data.condition||data.itemSpecification||data.manualPrice||data.itemName||data.itemSource||data.itemQuantity||data.answer||data.rate||target.hasAttribute('data-source-choice')||data.changeField))return false;
  if(editingElement!==target){undoStack.push(clone(state));if(undoStack.length>15)undoStack.shift();editingElement=target}
  if(data.conditionTitle)state.draft.conditions.find(item=>item.id===data.conditionTitle).title=target.value.trim();
  if(data.condition){const item=state.draft.conditions.find(item=>item.id===data.condition);item.value=target.value.trim();item.editedByDesigner=true}
  if(data.itemSpecification)state.draft.items.find(item=>item.id===data.itemSpecification).specification=target.value;
  if(data.manualPrice)state.draft.items.find(item=>item.id===data.manualPrice).unitPrice=target.value===''?null:Number(target.value);
  if(data.itemName)state.draft.items.find(item=>item.id===data.itemName).name=target.value;
  if(data.itemSource)state.draft.items.find(item=>item.id===data.itemSource).source=target.value;
  if(data.itemQuantity)state.draft.items.find(item=>item.id===data.itemQuantity).quantity=target.value===''?null:Number(target.value);
  if(data.answer){state.draft.answers[data.answer]=target.value.trim();state.draft.answerSources[data.answer]='设计师人工记录（请核对客户原话）'}
  if(data.rate)state.draft.rates[data.rate]=target.value===''?null:Number(target.value);
  if(target.hasAttribute('data-source-choice'))state.draft.sourceChoice=target.value;
  if(data.changeField){
    state.change[data.changeField]=['quantity','unitPrice','refundManual','replacementManual','reworkManual'].includes(data.changeField)?(target.value===''?null:Number(target.value)):target.value;
    if(state.change.pricingSuggestion){state.change.pricingSuggestion.reviewed=false;const review=$('#changeAdviceReviewed');if(review)review.checked=false}
  }
  state.analysisReviewed=false;markStale();persist();refreshDraftPreview();
  const checkbox=$('#analysisReviewed');if(checkbox)checkbox.checked=false;
  return true;
}
document.addEventListener('focusout',event=>{if(editingElement===event.target){editingElement=null;scheduleRender()}});
document.addEventListener('input',event=>{
  if(commitDraftField(event.target))return;
  if(event.target.id==='orderTitle'||event.target.id==='clientName'){
    state[event.target.id==='orderTitle'?'title':'clientName']=event.target.value;persist();
    const label=state.title.trim()||'未命名订单';
    $('#sideOrderTitle').textContent=label;$('#sideOrderClient').textContent=state.clientName.trim()||'未填写客户称呼';
    $('#orderSelect').selectedOptions[0].textContent=label;
    $('#breadcrumb').textContent=`工作台 / ${label} / ${PAGE_NAMES[state.page]}`;
  }
  if(event.target.id==='chatInput'){state.chat=event.target.value;state.inputDirty=true;state.analysisReviewed=false;persist();$('#charCount').textContent=state.chat.length+' 字';$('#inputState').textContent='文本已修改，整理后更新草稿';$('#inputError').hidden=true;event.target.removeAttribute('aria-invalid')}
  if(event.target.id==='replyInput'){state.replyText=event.target.value;invalidateReply();persist()}
  if(event.target.id==='messageDate'){state.messageDate=event.target.value;state.inputDirty=true;persist()}
  if(event.target.id==='replyDate'){state.replyDate=event.target.value;invalidateReply();persist()}
  if(event.target.id==='followupText'){state.followupText=event.target.value;persist()}
  if(event.target.id==='changeSource'){state.change.sourceText=event.target.value;persist();refreshDraftPreview()}
  if(event.target.id==='confirmationEvidence'){
    state.confirmationEvidence=event.target.value;persist();
    const button=$('[data-action="confirm-version"]');if(button)button.disabled=Boolean(selectedVersion()?.share)||selectedVersion()?.status!=='designer-reviewed'||!state.confirmationEvidence.trim();
  }
});

document.addEventListener('change',event=>{
  const target=event.target;
  if(target.id==='orderSelect'){
    const order=workspace.orders.find(item=>item.id===target.value);if(!order)return;
    state=order;undoStack.length=0;renderedPage=null;persist();render();return;
  }
  if(target.id==='changeSource'){scheduleRender();return}
  if(target.id==='analysisReviewed'){state.analysisReviewed=target.checked;persist();return}
  if(target.tagName==='SELECT')commitDraftField(target);
  if(target.dataset.conditionTitle||target.dataset.condition||target.dataset.itemSpecification||target.dataset.manualPrice||target.dataset.itemName||target.dataset.itemSource||target.dataset.itemQuantity||target.dataset.answer||target.dataset.rate||target.hasAttribute('data-source-choice')||target.dataset.changeField)scheduleRender();
});

$('#backupFile').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  if(file.size>5_000_000){toast('备份超过 5 MB，未导入');return}
  try{
    const backup=JSON.parse(await file.text());
    if(backup?.kind!=='mingdan-backup'||backup.schema!==1||!Array.isArray(backup.orders)||backup.orders.length<1||backup.orders.length>100)throw Error('格式不符合明单备份');
    const imported=backup.orders.map(raw=>{
      if(!isValidOrder(raw))throw Error('订单数据不完整');
      const order={...initialState(),...raw,id:newId(),page:[0,1,2,3].includes(raw.page)?raw.page:0,change:{...initialState().change,...raw.change}};
      for(const version of order.versions){delete version.share;if(version.status==='client-confirmed')version.confirmationMode='manual'}
      return order;
    });
    window.MingdanPricingUI?.importCatalogue(backup.catalogue,imported);
    workspace.orders.push(...imported);state=imported[0];undoStack.length=0;renderedPage=null;persist();render();
    toast(`已导入 ${imported.length} 笔订单，原有订单保留`);
  }catch(error){toast(`导入失败：${error.message}`)}
});

render();

