(() => {
  'use strict';
  const studio=document.getElementById('heroStudio');
  if(!studio)return;
  const paper=studio.querySelector('.hero-document'), prior=document.getElementById('heroPrior');
  const retained=document.getElementById('heroRetained');
  const laterState=document.getElementById('heroLaterState');
  const addition=document.getElementById('heroAddition'), version=document.getElementById('heroVersion');
  const total=document.getElementById('heroTotal'), condition=document.getElementById('heroCondition');
  const narrative=document.getElementById('heroNarrative'), cursor=studio.querySelector('.studio-cursor');
  const traces=[...studio.querySelectorAll('.evidence-trace')], snippets=[...studio.querySelectorAll('.source-snippet')];
  const frame=studio.querySelector('.artboard-frame'), motion=matchMedia('(prefers-reduced-motion: reduce)');
  const playbackSeconds=4.8;
  let time=12, playing=false, frameId=0, last=0, seen=false, visible=false, phase='';
  const clamp=n=>Math.max(0,Math.min(1,n));
  const progress=(start,duration)=>{const p=clamp((time-start)/duration);return p===1?1:1-2**(-10*p);};
  function draw(){
    const layout=progress(.45,1.1), form=progress(2.2,2.3), change=progress(8.2,1.7);
    const nextPhase=time<2.2?'source':time<8.2?'quote':'version';
    if(nextPhase!==phase){
      phase=nextPhase;studio.dataset.phase=phase;
      const changed=phase==='version';prior.hidden=!changed;retained.hidden=!changed;addition.hidden=!changed;
      laterState.textContent=changed?'已追加':'待追加';
      version.textContent='需求与报价草稿 '+(changed?'V2':'V1');
      total.textContent=changed?'¥1,600':'¥800';
      condition.textContent=changed?'新增交付时间仍待双方确认。':'修改次数与源文件条件仍待核对。';
      narrative.textContent=phase==='source'?'沿着原话，找到每项交付。':changed?'保留 V1，新增交付形成 V2 草稿。':'原话有来处，报价有依据。';
    }
    frame.style.opacity=String(.3+.35*layout);
    snippets.forEach((snippet,i)=>{snippet.style.transform=`translateY(${(1-progress(.55+i*.15,1.2))*8}px)`;});
    paper.style.transform=`translate(${(1-form)*14}px,${(1-form)*-12-change*9}px) rotate(${(1-form)*1.4}deg)`;
    if(phase==='version'&&innerWidth<=480){
      const bounds=studio.getBoundingClientRect(), source=snippets[2].getBoundingClientRect();
      const row=addition.getBoundingClientRect(), documentBounds=paper.getBoundingClientRect();
      const x1=(source.right-bounds.left)*600/bounds.width, y1=(source.bottom-bounds.top)*520/bounds.height;
      const x2=(documentBounds.right-bounds.left)*600/bounds.width, y2=(row.top+row.height/2-bounds.top)*520/bounds.height;
      studio.querySelector('.mobile-evidence-traces [data-later]').setAttribute('d',`M${x1} ${y1}C596 ${y1} 596 ${y2} ${x2} ${y2}`);
    }
    traces.forEach((trace,i)=>{
      const later=trace.hasAttribute('data-later'), length=trace.getTotalLength();
      const p=clamp((time-(later?8.2:1.1+i%3*.2))/(later?1.7:2.2));
      trace.style.strokeDasharray=String(length);trace.style.strokeDashoffset=String(length*(1-p));
      trace.style.opacity=String(later?(time<8.2?0:.9):(time<4.8?.9:.3));
    });
    const cursorVisible=time>.4&&time<4.5&&!motion.matches&&studio.dataset.pointerActive!=='true';
    cursor.style.opacity=cursorVisible?'1':'0';
    cursor.style.transform=`translate(${50+150*progress(.5,3)}px,${120+145*progress(.5,3)}px)`;
    studio.dataset.frameTime=time.toFixed(2);
  }
  function finish(){playing=false;cancelAnimationFrame(frameId);time=12;draw();}
  function tick(now){if(!playing)return;time=Math.min(12,time+Math.max(0,now-last)/1000*12/playbackSeconds);last=now;draw();if(time>=12)finish();else frameId=requestAnimationFrame(tick);}
  function start(){if(motion.matches)return;time=0;playing=true;last=performance.now();draw();frameId=requestAnimationFrame(tick);}
  function startOnce(){if(seen||!visible||document.hidden||motion.matches)return;seen=true;start();}
  window.addEventListener('resize',draw);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){if(playing)finish();}else startOnce();});
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible){if(playing)finish();}else startOnce();},{threshold:.25}).observe(studio);
  motion.addEventListener('change',finish);
  draw();

  const intro=studio.closest('.intro'), surface=document.body;
  const pointerInput=matchMedia('(hover: hover) and (pointer: fine) and (min-width: 761px)');
  const anchors=[...studio.querySelectorAll('.anchor-handles rect')].map(node=>({node,x:Number(node.getAttribute('x'))+4,y:Number(node.getAttribute('y'))+4}));
  const current={x:0,y:0,light:0,spotX:300,spotY:260}, target={...current};
  let pointerFrame=0, pointerLast=0, studioWidth=600, studioHeight=520;
  function paintPointer(){
    surface.style.setProperty('--glass-x',(-current.x*12).toFixed(2)+'px');
    surface.style.setProperty('--glass-y',(-current.y*8).toFixed(2)+'px');
    studio.style.setProperty('--studio-x',(current.x*5).toFixed(2)+'px');
    studio.style.setProperty('--studio-y',(current.y*3).toFixed(2)+'px');
    studio.style.setProperty('--studio-rx',(-current.y*1.6).toFixed(2)+'deg');
    studio.style.setProperty('--studio-ry',(current.x*2.4).toFixed(2)+'deg');
    studio.style.setProperty('--paper-x',(current.x*4).toFixed(2)+'px');
    studio.style.setProperty('--paper-y',(current.y*2).toFixed(2)+'px');
    studio.style.setProperty('--sources-x',(-current.x*3).toFixed(2)+'px');
    studio.style.setProperty('--sources-y',(-current.y*2).toFixed(2)+'px');
    studio.style.setProperty('--pointer-x',(current.spotX/600*studioWidth).toFixed(2)+'px');
    studio.style.setProperty('--pointer-y',(current.spotY/520*studioHeight).toFixed(2)+'px');
    studio.style.setProperty('--pointer-light',current.light.toFixed(3));
    anchors.forEach(({node,x,y})=>{
      const near=clamp(1-Math.hypot(current.spotX-x,current.spotY-y)/125)*current.light;
      node.style.strokeWidth=String(1+near*1.5);
      node.style.fill=near>.12?'#62e1c1':'#08121a';
      node.style.fillOpacity=String(near>.12?.3+near*.5:1);
    });
  }
  function updatePointer(now){
    const amount=1-Math.exp(-Math.min(64,now-pointerLast)/95);pointerLast=now;
    let remaining=0;
    for(const key of Object.keys(current)){
      current[key]+=(target[key]-current[key])*amount;
      remaining=Math.max(remaining,Math.abs(target[key]-current[key])/(key.startsWith('spot')?600:1));
    }
    if(remaining<.001){Object.assign(current,target);pointerFrame=0;delete surface.dataset.pointerMotion;}
    paintPointer();
    if(pointerFrame)pointerFrame=requestAnimationFrame(updatePointer);
  }
  function schedulePointer(){if(pointerFrame)return;surface.dataset.pointerMotion='true';pointerLast=performance.now();pointerFrame=requestAnimationFrame(updatePointer);}
  function resetPointer(immediate=false){
    target.x=target.y=target.light=0;delete studio.dataset.pointerActive;
    if(immediate){cancelAnimationFrame(pointerFrame);pointerFrame=0;Object.assign(current,target);delete surface.dataset.pointerMotion;paintPointer();}
    else schedulePointer();
  }
  intro.addEventListener('pointermove',event=>{
    if(event.pointerType!=='mouse'||!pointerInput.matches||motion.matches||document.hidden)return;
    const area=intro.getBoundingClientRect(), bounds=studio.getBoundingClientRect();
    studioWidth=studio.offsetWidth;studioHeight=studio.offsetHeight;
    target.x=clamp((event.clientX-area.left)/area.width)*2-1;
    target.y=clamp((event.clientY-area.top)/area.height)*2-1;
    target.spotX=clamp((event.clientX-bounds.left)/bounds.width)*600;
    target.spotY=clamp((event.clientY-bounds.top)/bounds.height)*520;
    target.light=event.clientX>=bounds.left&&event.clientX<=bounds.right&&event.clientY>=bounds.top&&event.clientY<=bounds.bottom?1:.18;
    studio.dataset.pointerActive='true';cursor.style.opacity='0';schedulePointer();
  },{passive:true});
  intro.addEventListener('pointerleave',()=>resetPointer());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)resetPointer(true);});
  new IntersectionObserver(entries=>{if(!entries[0].isIntersecting)resetPointer(true);}).observe(intro);
  pointerInput.addEventListener('change',()=>resetPointer(true));
  motion.addEventListener('change',()=>resetPointer(true));
})();
