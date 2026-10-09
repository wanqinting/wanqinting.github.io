const S={
  drawingParallax:11,
  paperParallax:2.6,
  grainParallax:4,
  textParallax:1.1,
  smoothing:.055,
  lineWidth:1.02,
  drawSpeed:.013,
  nodeRadius:1.05,
  shadowOffsetX:3.4,
  shadowOffsetY:4.4,
  shadowBlur:7,
  shadowAlpha:.11,
  secondPassAlpha:.12
};

const canvas=document.querySelector('#scene');
const ctx=canvas.getContext('2d');
const paper=document.querySelector('#paper');
const grain=document.querySelector('#grain');
const identity=document.querySelector('#identity');
const entrance=document.querySelector('#entrance');
const home=document.querySelector('#home');
const enterBtn=document.querySelector('#enterBtn');
const regenBtn=document.querySelector('#regenBtn');
const resetBtn=document.querySelector('#resetBtn');
const counterText=document.querySelector('#counterText');
const pointToast=document.querySelector('#pointToast');
const siteGuide=document.querySelector('#siteGuide');
const guideStage=document.querySelector('#guideStage');
const scrollCue=document.querySelector('.scroll-cue');
const contactJump=document.querySelector('.contact-jump');
const contactSection=document.querySelector('#contact');
const guideButtons=[...document.querySelectorAll('.guide-card')];
const sections=[...document.querySelectorAll('.expand-section')];
const backGuideButtons=[...document.querySelectorAll('[data-back-guide]')];
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;

let W=innerWidth,H=innerHeight,DPR=Math.min(devicePixelRatio||1,2);
let rawPoints=[];
let orderedPoints=[];
let allPoints=[];
let edges=[];
let progress=0;
let last=performance.now();
let homepageMode=false;
let rafId=null;
let toastTimer=null;

const pointer={x:W/2,y:H/2};
const target={x:0,y:0};
const current={x:0,y:0};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const rand=(a,b)=>Math.random()*(b-a)+a;
const edgeKey=(a,b)=>a<b?`${a}-${b}`:`${b}-${a}`;

function wake(){
  if(rafId===null){
    last=performance.now();
    rafId=requestAnimationFrame(tick);
  }
}

function resize(){
  const oldW=W,oldH=H;
  W=innerWidth;H=innerHeight;DPR=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.round(W*DPR);
  canvas.height=Math.round(H*DPR);
  canvas.style.width=W+'px';
  canvas.style.height=H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);

  if(oldW>0&&oldH>0&&(rawPoints.length||allPoints.length)){
    const sx=W/oldW,sy=H/oldH;
    rawPoints=rawPoints.map(p=>({x:p.x*sx,y:p.y*sy}));
    orderedPoints=orderedPoints.map(p=>({x:p.x*sx,y:p.y*sy}));
    allPoints=allPoints.map(p=>({x:p.x*sx,y:p.y*sy}));
  }
  wake();
}

function showToast(message,duration=650){
  clearTimeout(toastTimer);
  pointToast.textContent=message;
  pointToast.classList.add('show');
  toastTimer=setTimeout(()=>pointToast.classList.remove('show'),duration);
}

function updateUI(){
  const count=rawPoints.length;
  counterText.textContent=`${count} / 8 points`;
  resetBtn.hidden=count===0;
  regenBtn.hidden=count!==8;
}

function orderClockwise(points){
  const cx=points.reduce((s,p)=>s+p.x,0)/points.length;
  const cy=points.reduce((s,p)=>s+p.y,0)/points.length;
  const arr=points.map(p=>({x:p.x,y:p.y,angle:Math.atan2(p.y-cy,p.x-cx)})).sort((a,b)=>a.angle-b.angle);
  let top=0;
  for(let i=1;i<arr.length;i++)if(arr[i].y<arr[top].y)top=i;
  return arr.slice(top).concat(arr.slice(0,top)).map(({x,y})=>({x,y}));
}

function polygonArea(indices,points){
  let a=0;
  for(let i=0;i<indices.length;i++){
    const p=points[indices[i]],q=points[indices[(i+1)%indices.length]];
    a+=p.x*q.y-q.x*p.y;
  }
  return a/2;
}
function cross(a,b,c){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)}
function pointInTriangle(p,a,b,c){
  const c1=cross(a,b,p),c2=cross(b,c,p),c3=cross(c,a,p);
  const neg=c1<0||c2<0||c3<0,pos=c1>0||c2>0||c3>0;
  return !(neg&&pos);
}
function triangulate(points){
  const verts=points.map((_,i)=>i),tris=[];
  const ccw=polygonArea(verts,points)>0;
  let guard=0;
  while(verts.length>3&&guard<1000){
    let ear=false;
    for(let i=0;i<verts.length;i++){
      const prev=verts[(i-1+verts.length)%verts.length],curr=verts[i],next=verts[(i+1)%verts.length];
      const A=points[prev],B=points[curr],C=points[next];
      const z=cross(A,B,C),convex=ccw?z>0:z<0;
      if(!convex)continue;
      let contains=false;
      for(const vi of verts){
        if(vi===prev||vi===curr||vi===next)continue;
        if(pointInTriangle(points[vi],A,B,C)){contains=true;break}
      }
      if(contains)continue;
      tris.push([prev,curr,next]);
      verts.splice(i,1);
      ear=true;
      break;
    }
    if(!ear)break;
    guard++;
  }
  if(verts.length===3)tris.push([verts[0],verts[1],verts[2]]);
  return tris;
}
function triArea(t,pts){
  const [i,j,k]=t;
  return Math.abs(cross(pts[i],pts[j],pts[k]))/2;
}
function pointInsideTriangle(a,b,c){
  let u=.18+Math.random()*.28;
  let v=.18+Math.random()*.28;
  const sum=u+v;
  if(sum>.72){const s=.72/sum;u*=s;v*=s}
  const w=1-u-v;
  return{x:a.x*u+b.x*v+c.x*w,y:a.y*u+b.y*v+c.y*w};
}
function subdivideTriangle(t,sourcePts,detailEdges,depth=1){
  const [i,j,k]=t;
  const p=pointInsideTriangle(sourcePts[i],sourcePts[j],sourcePts[k]);
  const idx=allPoints.length;
  allPoints.push(p);
  detailEdges.push({a:idx,b:i,kind:'detail'},{a:idx,b:j,kind:'detail'},{a:idx,b:k,kind:'detail'});
  if(depth>1){
    const options=[[idx,i,j],[idx,j,k],[idx,k,i]];
    const pick=options[Math.floor(Math.random()*options.length)];
    const q=pointInsideTriangle(allPoints[pick[0]],allPoints[pick[1]],allPoints[pick[2]]);
    const qidx=allPoints.length;
    allPoints.push(q);
    detailEdges.push({a:qidx,b:pick[0],kind:'micro'},{a:qidx,b:pick[1],kind:'micro'},{a:qidx,b:pick[2],kind:'micro'});
  }
}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function pointBounds(points){
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  return{minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)};
}
function pointSetUsable(points){
  const ordered=orderClockwise(points);
  const b=pointBounds(ordered);
  const area=Math.abs(polygonArea(ordered.map((_,i)=>i),ordered));
  return (b.maxX-b.minX)>=W*.08&&(b.maxY-b.minY)>=H*.12&&area>=W*H*.006;
}

function generateFromRawPoints(){
  orderedPoints=orderClockwise(rawPoints);
  allPoints=orderedPoints.map(p=>({x:p.x,y:p.y}));
  const n=orderedPoints.length;
  const outline=[];
  for(let i=0;i<n;i++)outline.push({a:i,b:(i+1)%n,kind:'outline'});
  const boundarySet=new Set(outline.map(e=>edgeKey(e.a,e.b)));
  let tris=triangulate(orderedPoints);
  if(tris.length<n-2){
    tris=[];
    for(let i=1;i<n-1;i++)tris.push([0,i,i+1]);
  }
  const diagMap=new Map();
  for(const t of tris){
    for(const [a,b] of [[t[0],t[1]],[t[1],t[2]],[t[2],t[0]]]){
      const k=edgeKey(a,b);
      if(boundarySet.has(k))continue;
      if(!diagMap.has(k))diagMap.set(k,{a,b,len:distance(orderedPoints[a],orderedPoints[b]),kind:'internal'});
    }
  }
  let diag=[...diagMap.values()].sort((a,b)=>b.len-a.len);
  const removeCount=Math.min(2,Math.max(1,Math.floor(diag.length*.18)));
  for(let r=0;r<removeCount&&diag.length>2;r++)diag.splice(Math.floor(Math.random()*Math.min(4,diag.length)),1);
  const detail=[];
  const ranked=tris.map(t=>({t,area:triArea(t,orderedPoints)})).sort((a,b)=>b.area-a.area);
  ranked.slice(0,Math.min(4,ranked.length)).forEach((item,index)=>subdivideTriangle(item.t,orderedPoints,detail,index<2?2:1));
  const extra=[];
  for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){
    if(Math.abs(i-j)===n-1)continue;
    const k=edgeKey(i,j);
    if(boundarySet.has(k)||diag.some(e=>edgeKey(e.a,e.b)===k))continue;
    const dx=Math.abs(orderedPoints[i].x-orderedPoints[j].x),dy=Math.abs(orderedPoints[i].y-orderedPoints[j].y);
    const dist=Math.hypot(dx,dy);
    if(dist<W*.12)continue;
    extra.push({a:i,b:j,dist,score:dist+Math.abs(dx-dy*.55)*.25+rand(-40,40)});
  }
  extra.sort((a,b)=>a.score-b.score);
  const tension=extra.slice(0,Math.min(2,extra.length)).map(e=>({a:e.a,b:e.b,kind:'tension'}));
  diag.sort((a,b)=>a.len-b.len);
  edges=[...outline,...diag,...detail,...tension];
  progress=reduced?edges.length:0;
  updateUI();
  wake();
}

function resetAll(){
  rawPoints=[];orderedPoints=[];allPoints=[];edges=[];progress=0;
  updateUI();
  wake();
}

function drawLine(a,b,t=1){
  const ex=a.x+(b.x-a.x)*t,ey=a.y+(b.y-a.y)*t;
  ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(ex,ey);ctx.stroke();
}

function drawPlacementState(){
  ctx.save();
  ctx.translate(current.x,current.y);
  if(rawPoints.length<8){
    ctx.beginPath();ctx.arc(pointer.x-current.x,pointer.y-current.y,5.5,0,Math.PI*2);
    ctx.strokeStyle='rgba(47,43,38,.24)';ctx.lineWidth=1;ctx.stroke();
    ctx.beginPath();ctx.arc(pointer.x-current.x,pointer.y-current.y,1.4,0,Math.PI*2);
    ctx.fillStyle='rgba(47,43,38,.42)';ctx.fill();
  }
  rawPoints.forEach((p,idx)=>{
    ctx.beginPath();ctx.arc(p.x,p.y,3.1,0,Math.PI*2);
    ctx.fillStyle='rgba(47,43,38,.48)';ctx.fill();
    ctx.fillStyle='rgba(47,43,38,.52)';ctx.font='11px Inter, sans-serif';
    ctx.fillText(String(idx+1),p.x+8,p.y-7);
  });
  if(rawPoints.length>=3&&rawPoints.length<8){
    const temp=orderClockwise(rawPoints);
    ctx.beginPath();ctx.moveTo(temp[0].x,temp[0].y);
    for(let i=1;i<temp.length;i++)ctx.lineTo(temp[i].x,temp[i].y);
    ctx.closePath();ctx.strokeStyle='rgba(47,43,38,.10)';ctx.lineWidth=1;ctx.setLineDash([3,7]);ctx.stroke();ctx.setLineDash([]);
  }
  ctx.restore();
}

function geometryTransform(){
  if(!homepageMode||!allPoints.length)return{scale:1,tx:current.x,ty:current.y};
  const b=pointBounds(allPoints);
  const bw=Math.max(1,b.maxX-b.minX),bh=Math.max(1,b.maxY-b.minY);
  const targetW=Math.min(W*.26,310),targetH=Math.min(H*.43,430);
  const scale=Math.min(targetW/bw,targetH/bh,1.2);
  const sourceCX=(b.minX+b.maxX)/2,sourceCY=(b.minY+b.maxY)/2;
  const targetCX=W<760?W*.80:W*.84,targetCY=W<760?H*.22:H*.34;
  return{scale,tx:targetCX-sourceCX*scale,ty:targetCY-sourceCY*scale};
}

function drawLineShadow(){
  if(!edges.length)return;
  const done=Math.floor(progress),part=progress-done,reveal=clamp(progress/edges.length,0,1),t=geometryTransform();
  ctx.save();ctx.translate(t.tx+S.shadowOffsetX,t.ty+S.shadowOffsetY);ctx.scale(t.scale,t.scale);
  ctx.strokeStyle=`rgba(47,43,38,${S.shadowAlpha*reveal})`;
  ctx.lineWidth=(S.lineWidth+.52)/t.scale;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.shadowColor=`rgba(47,43,38,${S.shadowAlpha*.9*reveal})`;ctx.shadowBlur=S.shadowBlur/t.scale;
  for(let i=0;i<Math.min(done,edges.length);i++){const e=edges[i];drawLine(allPoints[e.a],allPoints[e.b])}
  if(done<edges.length){const e=edges[done];drawLine(allPoints[e.a],allPoints[e.b],part)}
  ctx.restore();
}

function drawGeometry(){
  if(!edges.length)return;
  const done=Math.floor(progress),part=progress-done,t=geometryTransform();
  ctx.save();ctx.translate(t.tx,t.ty);ctx.scale(t.scale,t.scale);
  ctx.strokeStyle='rgba(47,43,38,.82)';ctx.fillStyle='rgba(47,43,38,.34)';ctx.lineWidth=S.lineWidth/t.scale;ctx.lineCap='round';ctx.lineJoin='round';
  for(let i=0;i<Math.min(done,edges.length);i++){
    const e=edges[i],a=allPoints[e.a],b=allPoints[e.b];drawLine(a,b);
    ctx.save();ctx.globalAlpha=S.secondPassAlpha;ctx.translate(.35/t.scale,-.2/t.scale);drawLine(a,b);ctx.restore();
  }
  if(done<edges.length){const e=edges[done];drawLine(allPoints[e.a],allPoints[e.b],part)}
  const reveal=clamp(progress/edges.length,0,1);ctx.globalAlpha=.25*reveal;
  for(let i=0;i<allPoints.length;i++){
    const p=allPoints[i];ctx.beginPath();ctx.arc(p.x,p.y,(i<8?S.nodeRadius:.8)/t.scale,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}

function updateParallax(){
  if(homepageMode||reduced){target.x=0;target.y=0}else{
    target.x=(clamp(pointer.x/W,0,1)*2-1)*S.drawingParallax;
    target.y=(clamp(pointer.y/H,0,1)*2-1)*S.drawingParallax;
  }
  current.x=lerp(current.x,target.x,S.smoothing);current.y=lerp(current.y,target.y,S.smoothing);
  const px=S.drawingParallax?current.x/S.drawingParallax:0,py=S.drawingParallax?current.y/S.drawingParallax:0;
  paper.style.transform=`translate3d(${-px*S.paperParallax}px,${-py*S.paperParallax}px,0)`;
  grain.style.transform=`translate3d(${px*S.grainParallax}px,${py*S.grainParallax}px,0)`;
  if(identity)identity.style.transform=`translate3d(${px*S.textParallax}px,${py*S.textParallax}px,0)`;
}

function tick(now){
  rafId=null;
  const dt=Math.min(32,now-last);last=now;
  updateParallax();
  if(edges.length&&progress<edges.length)progress=Math.min(edges.length,progress+dt*S.drawSpeed);
  ctx.clearRect(0,0,W,H);
  if(!homepageMode&&rawPoints.length<8)drawPlacementState();
  drawLineShadow();drawGeometry();
  const stillDrawing=edges.length&&progress<edges.length;
  const stillMoving=Math.abs(current.x-target.x)>.025||Math.abs(current.y-target.y)>.025;
  if(stillDrawing||stillMoving)rafId=requestAnimationFrame(tick);
}

function openHome({instant=false}={}){
  homepageMode=true;
  entrance.classList.add('hide');
  entrance.setAttribute('aria-hidden','true');
  entrance.inert=true;
  document.body.classList.add('home-open');
  home.inert=false;
  home.setAttribute('aria-hidden','false');
  if(instant){home.classList.add('show')}else setTimeout(()=>home.classList.add('show'),reduced?0:100);
  pointToast.classList.remove('show');
  wake();
}

canvas.addEventListener('click',e=>{
  if(homepageMode||rawPoints.length>=8)return;
  const rect=canvas.getBoundingClientRect();
  const candidate={x:e.clientX-rect.left,y:e.clientY-rect.top};
  const minGap=Math.max(22,Math.min(W,H)*.026);
  if(rawPoints.some(p=>distance(p,candidate)<minGap)){
    showToast('A little farther apart',760);return;
  }
  const next=[...rawPoints,candidate];
  if(next.length===8&&!pointSetUsable(next)){
    showToast('Spread the last point farther out',950);return;
  }
  rawPoints.push(candidate);
  updateUI();
  showToast(`Point ${rawPoints.length} / 8`,520);
  if(rawPoints.length===8)generateFromRawPoints();else wake();
});
canvas.addEventListener('pointermove',e=>{pointer.x=e.clientX;pointer.y=e.clientY;wake()},{passive:true});
canvas.addEventListener('pointerleave',()=>{pointer.x=W/2;pointer.y=H/2;wake()});
let resizeRaf=null;
addEventListener('resize',()=>{
  if(resizeRaf!==null)return;
  resizeRaf=requestAnimationFrame(()=>{resizeRaf=null;resize()});
},{passive:true});
regenBtn.addEventListener('click',()=>{if(rawPoints.length===8)generateFromRawPoints()});
resetBtn.addEventListener('click',resetAll);
enterBtn.addEventListener('click',()=>openHome());

const validSections=new Set(['about','research','projects','notes']);
const homeTargets=new Set(['guideStage','contact']);
let scrollRaf=null;
let locationSyncQueued=false;

function hashTarget(){
  try{return decodeURIComponent(location.hash.slice(1))}catch{return location.hash.slice(1)}
}

function currentHashSection(){
  const name=hashTarget();
  return validSections.has(name)?name:null;
}

function cancelScrollAnimation(){
  if(scrollRaf!==null){cancelAnimationFrame(scrollRaf);scrollRaf=null}
}

function animateScrollTo(targetY,{duration=680,onDone}={}){
  cancelScrollAnimation();
  const maxY=Math.max(0,document.documentElement.scrollHeight-innerHeight);
  const end=clamp(targetY,0,maxY);

  if(reduced||duration<=0||Math.abs(end-scrollY)<2){
    scrollTo(0,end);
    if(onDone)onDone();
    return;
  }

  const start=scrollY;
  const distanceY=end-start;
  const startTime=performance.now();
  const ease=t=>1-Math.pow(1-t,3);

  const step=now=>{
    const t=clamp((now-startTime)/duration,0,1);
    scrollTo(0,start+distanceY*ease(t));
    if(t<1){scrollRaf=requestAnimationFrame(step)}else{
      scrollRaf=null;
      if(onDone)onDone();
    }
  };
  scrollRaf=requestAnimationFrame(step);
}

function elementTop(element){
  return Math.round(element.getBoundingClientRect().top+scrollY);
}

function closeSections({updateHistory=false}={}){
  sections.forEach(section=>{
    section.classList.remove('is-open');
    section.setAttribute('aria-hidden','true');
    section.inert=true;
    section.hidden=true;
  });
  guideButtons.forEach(btn=>btn.setAttribute('aria-expanded','false'));
  if(updateHistory)history.pushState(null,'',location.pathname+location.search);
}

function openSection(name,{updateHistory=true,follow=true,behavior='smooth'}={}){
  if(!validSections.has(name))return;
  const targetSection=document.getElementById(name);
  const alreadyOpen=targetSection.classList.contains('is-open');

  if(alreadyOpen){
    if(follow)animateScrollTo(elementTop(targetSection),{duration:behavior==='auto'?0:680});
    return;
  }

  closeSections();
  targetSection.hidden=false;
  targetSection.inert=false;
  targetSection.setAttribute('aria-hidden','false');
  targetSection.classList.add('is-open');

  const button=guideButtons.find(btn=>btn.dataset.section===name);
  if(button)button.setAttribute('aria-expanded','true');
  if(updateHistory)history.pushState(null,'',`#${name}`);

  if(follow){
    requestAnimationFrame(()=>{
      animateScrollTo(elementTop(targetSection),{duration:behavior==='auto'?0:700});
    });
  }
}

function goToGuide({updateHistory=true,closeAfter=true}={}){
  if(updateHistory)history.pushState(null,'','#guideStage');
  animateScrollTo(elementTop(guideStage),{
    duration:700,
    onDone:()=>{if(closeAfter)closeSections()}
  });
}

function syncFromLocation({initial=false}={}){
  const target=hashTarget();
  const sectionName=validSections.has(target)?target:null;

  if(sectionName){
    if(!homepageMode)openHome({instant:true});
    openSection(sectionName,{updateHistory:false,follow:false});
    requestAnimationFrame(()=>animateScrollTo(elementTop(document.getElementById(sectionName)),{duration:initial?0:620}));
    return;
  }

  if(homeTargets.has(target)){
    if(!homepageMode)openHome({instant:true});

    if(target==='guideStage'&&sections.some(section=>section.classList.contains('is-open'))){
      requestAnimationFrame(()=>{
        animateScrollTo(elementTop(guideStage),{
          duration:initial?0:620,
          onDone:()=>closeSections()
        });
      });
    }else{
      closeSections();
      const element=target==='contact'?contactSection:guideStage;
      requestAnimationFrame(()=>animateScrollTo(elementTop(element),{duration:initial?0:620}));
    }
    return;
  }

  if(homepageMode)closeSections();
}

function queueLocationSync(){
  if(locationSyncQueued)return;
  locationSyncQueued=true;
  requestAnimationFrame(()=>{
    locationSyncQueued=false;
    syncFromLocation();
  });
}

guideButtons.forEach(btn=>btn.addEventListener('click',()=>openSection(btn.dataset.section)));

backGuideButtons.forEach(btn=>btn.addEventListener('click',()=>goToGuide()));

scrollCue.addEventListener('click',event=>{
  event.preventDefault();
  goToGuide({closeAfter:false});
});

contactJump.addEventListener('click',event=>{
  event.preventDefault();
  history.pushState(null,'','#contact');
  animateScrollTo(elementTop(contactSection),{duration:760});
});

['wheel','touchstart'].forEach(type=>addEventListener(type,cancelScrollAnimation,{passive:true}));
addEventListener('popstate',queueLocationSync);
addEventListener('hashchange',queueLocationSync);

updateUI();
resize();
const initialTarget=hashTarget();
if(validSections.has(initialTarget)||homeTargets.has(initialTarget))syncFromLocation({initial:true});else wake();
