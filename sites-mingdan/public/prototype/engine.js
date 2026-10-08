(function(root){
  'use strict';
  const VERSION='rules-1.0';
  const NUMBER='[0-9零一二两三四五六七八九十百]+';
  const PLATFORMS=[['moments','朋友圈'],['redbook','小红书'],['public','公众号'],['douyin','抖音']];
  function number(value){
    if(/^\d+$/.test(value))return Number(value);
    const map={零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
    if(value==='十')return 10;
    if(/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(value)){const parts=value.split('十');return (parts[0]?map[parts[0]]:1)*10+(parts[1]?map[parts[1]]:0)}
    return value.length===1&&value in map?map[value]:null;
  }
  function validDate(year,month,day){const d=new Date(Date.UTC(year,month-1,day));return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day}
  function dateString(date){return date.toISOString().slice(0,10)}
  function clauses(text){
    const rows=[];let offset=0;
    for(const line of text.split('\n')){
      const role=line.match(/^\s*([^：:]{1,12})[：:]/)?.[1]?.trim();
      const ignored=role&&/设计师|客服|乙方|助手|系统|assistant|system|^我$/i.test(role);
      for(const match of line.matchAll(/[^，,。；;！？!?]+/g)){
        const raw=match[0],trimmed=raw.trim();if(!trimmed)continue;
        const start=offset+match.index+raw.indexOf(trimmed);
        rows.push({text:trimmed,start,end:start+trimmed.length,ignored:Boolean(ignored)});
      }
      offset+=line.length+1;
    }
    return rows;
  }
  function analyze(input,options={}){
    const text=String(input||'');const issues=[],items=[],facts={},dateCandidates=[];
    const issue=(id,message)=>{if(!issues.some(x=>x.id===id))issues.push({id,message})};
    const result=()=>({version:VERSION,text,items,facts,issues,dateCandidates});
    if(!text.trim()){issue('empty','没有输入客户需求。');return result()}
    if(text.length>20000){issue('too-long','文本超过 20000 字，请分批处理；本次未提取。');return result()}
    const rows=clauses(text),active=rows.filter(row=>!row.ignored);
    if(rows.some(row=>row.ignored))issue('speaker','已跳过设计师／助手发言；请核对说话人，提议不等于客户同意。');
    const unsupportedProject=/(?:网站|官网|网页|H5|小程序|落地页|报名页)/i.test(text);
    if(unsupportedProject)issue('unsupported','包含网站、H5 等复杂项目，整段暂不自动拆分交付项；请根据原文建立清单，避免将页面素材误作独立订单。');
    const uncertain=value=>/是否|要不要|如果|假如|可能|考虑|不一定|大概|左右|不是不要|并非不|不能不|不是不|没有说不|或者|也许/.test(value);
    const negative=value=>/不要|不用|不需要|不做|不含|不提供|不交付|取消|去掉|无需/.test(value);
    const fact=(key,value,row,certainty='explicit')=>{
      const next={value,source:text.slice(row.start,row.end),start:row.start,end:row.end,certainty};
      if(facts[key]&&facts[key].value!==value){delete facts[key];issue(`conflict-${key}`,`发现 ${key==='sourceFile'?'源文件':key==='delivery'?'交期':key==='revisions'?'修改轮次':'尺寸'} 的不同说法，请人工确认。`);return}
      if(!issues.some(x=>x.id===`conflict-${key}`))facts[key]=next;
    };
    function count(row,target,multiple=false){
      const value=row.text;
      if(uncertain(value)||/最多|至少|不超过|不少于|最少|不多于|\d+[.．]\d+/.test(value)||new RegExp(`${NUMBER}\\s*(?:[-~至到或])\\s*${NUMBER}`).test(value))return null;
      let match;
      if(multiple){match=value.match(new RegExp(`各\\s*(${NUMBER})\\s*(?:张|款|个|份|种|版)`));return match?number(match[1]):null}
      const position=value.indexOf(target),before=value.slice(0,position),after=value.slice(position+target.length);
      match=before.match(new RegExp(`(${NUMBER})\\s*(?:张|款|个|份|种|版)\\s*(?:新店|开业|活动|主视觉|主|宣传|招聘|促销|节日)*$`))||after.match(new RegExp(`^\\s*(?:各|要|做)?\\s*(${NUMBER})\\s*(?:张|款|个|份|种|版)`))||value.match(new RegExp(`各\\s*(${NUMBER})\\s*(?:张|款|个|份|种|版)`));
      return match?number(match[1]):null;
    }
    function item(id,name,rate,row,quantity){
      const previous=items.find(entry=>entry.id===id);
      if(previous){
        if(previous.quantity!==quantity){previous.quantity=null;issue(`count-${id}`,`${name}出现多个数量或说法，不能自动相加。`)}
        return;
      }
      if(quantity===null)issue(`count-${id}`,`${name}的数量不明确，请填写数量。`);
      if(quantity!==null&&(!Number.isSafeInteger(quantity)||quantity<1||quantity>99)){quantity=null;issue(`count-${id}`,`${name}数量超出支持范围，请核对。`)}
      items.push({id,name,rate,quantity,source:text.slice(row.start,row.end),start:row.start,end:row.end});
    }
    for(const row of active){
      const value=row.text;
      if(/忽略.*(?:指令|规则)|system prompt|ignore.*instructions/i.test(value)){issue('instruction','输入含类似指令的文字，只作为客户文本保留，不改变计价规则。');continue}
      if(/logo|标志|视频|建模|网站|官网|网页|H5|小程序|落地页|报名页|画册|插画/i.test(value))issue('unsupported','存在当前规则不支持的交付类型，请手动补充项目及价格。');
      if(uncertain(value)&&/海报|适配|尺寸/.test(value)){issue('conditional','存在条件、估计或选择性要求，请确认后再计入。');continue}
      const specificationOnly=/\bA[0-6]\b|\d{2,5}\s*[×x*]\s*\d{2,5}/i.test(value)&&!/做|适配|新增|设计|制作|需要/.test(value);
      if(!negative(value)&&!specificationOnly&&!unsupportedProject){
        if(/海报/.test(value)&&!/(?:修改|重做|调整|改成|改为|改到)/.test(value))item('poster','主海报','poster',row,count(row,'海报'));
        const platforms=PLATFORMS.filter(([,name])=>value.includes(name));
        if(/适配|尺寸|横版|竖版/.test(value))for(const [id,name] of platforms)item(id,`${name}尺寸适配`,'adapt',row,count(row,name,platforms.length>1));
      }else if(negative(value)&&/海报|适配|朋友圈|小红书|公众号|抖音/.test(value))issue('excluded','文本含取消或不需要的交付内容，已保留原文，未自动加入。');
      if(/源文件/.test(value)){
        if(uncertain(value))issue('source-uncertain','源文件需求不明确，不能自动计费。');
        else if(negative(value))fact('sourceFile','本次不交付源文件',row);
        else if(/要|给|发|交付|提供|包含/.test(value))fact('sourceFile','客户要求源文件，计费方式待确认',row);
      }
      if(/改到满意|无限|不限.*(?:修改|轮)|随便改/.test(value))issue('unlimited','修改上限不明确，需要约定轮次。');
      else if(!uncertain(value)&&!negative(value)){
        const match=value.match(new RegExp(`(${NUMBER})\\s*轮(?:修改)?`));
        if(match){const n=number(match[1]);if(n!==null&&n<=99)fact('revisions',`包含 ${n} 轮修改`,row)}
      }
      const milestone=/初稿/.test(value)?'初稿':/终稿|定稿|最终稿/.test(value)?'终稿':null;
      const dateParts=(options.messageDate||'').split('-').map(Number);
      const base=/^\d{4}-\d{2}-\d{2}$/.test(options.messageDate||'')&&validDate(...dateParts)?new Date(`${options.messageDate}T00:00:00Z`):null;
      if([...value.matchAll(/\d{4}[年\/-]\d{1,2}[月\/-]\d{1,2}日?|\d{1,2}月\d{1,2}日/g)].length>1){issue('conflict-delivery','同一句包含多个日期，请明确每个日期对应的交付节点。');delete facts.delivery;continue}
      let candidate=null,certainty='explicit';
      const absolute=value.match(/(\d{4})[年\/-](\d{1,2})[月\/-](\d{1,2})日?/);
      const short=!absolute&&value.match(/(\d{1,2})月(\d{1,2})日/);
      if(absolute||short){
        const year=absolute?Number(absolute[1]):base?.getUTCFullYear();
        const month=Number(absolute?absolute[2]:short[1]),day=Number(absolute?absolute[3]:short[2]);
        if(year&&validDate(year,month,day)){candidate=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;if(short)certainty='candidate'}
        else issue('invalid-date','日期无效或缺少可用年份，请核对消息日期。');
      }else if(/明天|后天|(?:下周|本周|这周|周|星期)[一二三四五六日天]/.test(value)){
        certainty='candidate';
        if(!base||Number.isNaN(base.valueOf()))issue('date-base','相对日期缺少有效的消息日期，不能推算。');
        else{
          const date=new Date(base),weekday=value.match(/(下周|本周|这周|周|星期)([一二三四五六日天])/);
          if(/后天/.test(value))date.setUTCDate(date.getUTCDate()+2);
          else if(/明天/.test(value))date.setUTCDate(date.getUTCDate()+1);
          else if(weekday){const target='一二三四五六日'.indexOf(weekday[2]==='天'?'日':weekday[2]);const current=(date.getUTCDay()+6)%7;date.setUTCDate(date.getUTCDate()-current+target+(weekday[1]==='下周'?7:0))}
          candidate=dateString(date);
        }
      }
      if(candidate){
        dateCandidates.push({date:candidate,milestone,source:text.slice(row.start,row.end),certainty});
        if(negative(value)||uncertain(value)){issue('date-negation','日期处于否定或不确定语句中，未当作承诺。');continue}
        if(!milestone)issue('date-milestone','有日期但未说清交初稿还是终稿。');
        else fact('delivery',`${candidate} 交${milestone}`,row,certainty);
      }
    }
    const sizeRows=active.filter(row=>/\bA[0-6]\b|\d{2,5}\s*[×x*]\s*\d{2,5}/i.test(row.text));
    const expected=options.expectedItems||items;
    if(sizeRows.length){
      const joined=sizeRows.map(row=>row.text).join('；');
      const covered=expected.length>0&&expected.every(entry=>{
        const name=entry.rate==='poster'?'海报':entry.name.replace(/尺寸适配/g,'');
        return sizeRows.some(row=>row.text.includes(name)||(expected.length===1));
      });
      const unitsComplete=sizeRows.every(row=>[...row.text.matchAll(/\d{2,5}\s*[×x*]\s*\d{2,5}\s*(px|像素|mm|毫米|cm|厘米)?/ig)].every(match=>Boolean(match[1])));
      if(covered&&unitsComplete){const start=sizeRows[0].start,end=sizeRows.at(-1).end;fact('sizes',joined,{start,end})}
      else issue('sizes','尺寸未覆盖所有交付项，或缺少单位，请逐项核对。');
    }
    if(!items.length&&!options.reply)issue('no-items','未识别到可报价的交付项目，请手动补充；不会套用示例清单。');
    return result();
  }
  function calculate(items,rates,sourceChoice){
    const lines=[],errors=[];
    for(const item of items){
      const quantity=item.quantity;
      if(!Number.isInteger(quantity)||quantity<0||quantity>99){errors.push(`${item.name||'未命名项目'}：数量须为 0—99 的整数`);continue}
      if(quantity===0)continue;
      const price=item.rate==='manual'?item.unitPrice:rates[item.rate];
      if(typeof price!=='number'||!Number.isFinite(price)||price<0||price>1000000||Math.abs(price*100-Math.round(price*100))>0.000001){errors.push(`${item.name}：单价须为有效金额，最多两位小数`);continue}
      const amountCents=quantity*Math.round(price*100);
      lines.push({...item,amountCents,amount:amountCents/100});
    }
    const sourceRate=rates.sourceFile;
    const validSource=typeof sourceRate==='number'&&Number.isFinite(sourceRate)&&sourceRate>=0&&sourceRate<=1000000&&Math.abs(sourceRate*100-Math.round(sourceRate*100))<0.000001;
    if(sourceChoice==='paid'&&!validSource)errors.push('源文件单价无效');
    if(sourceChoice==='paid'&&validSource)lines.push({id:'sourceFile',name:'交付源文件',quantity:1,rate:'sourceFile',amountCents:Math.round(sourceRate*100),amount:sourceRate});
    if(sourceChoice==='included')lines.push({id:'sourceFile',name:'交付源文件（费用已包含）',quantity:1,rate:'sourceFile',amountCents:0,amount:0});
    const totalCents=lines.reduce((sum,item)=>sum+item.amountCents,0);
    return {lines,total:totalCents/100,totalCents,optional:sourceChoice==='pending'&&validSource?sourceRate:0,errors};
  }
  function validMoney(value,allowNegative=false){return typeof value==='number'&&Number.isFinite(value)&&(allowNegative||value>=0)&&Math.abs(value)<=1000000&&Math.abs(value*100-Math.round(value*100))<0.000001}
  root.MingdanEngine={VERSION,analyze,calculate,number,validMoney};
})(globalThis);
