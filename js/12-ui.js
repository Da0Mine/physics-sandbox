/* 公式菜单、设置、录制、Bug 提交、工具栏、全屏、问号气泡（原 index.html 第 16555–17300 行） */
function openFormulaMenu(){
  fmgrid.innerHTML='';
  for(var i=0;i<WHOLE_PRESETS.length;i++){
    var ps=WHOLE_PRESETS[i];
    var b=DD.createElement('button');
    b.className='fmitem';b.setAttribute('data-ix',i);
    var a=DD.createElement('span');a.className='fmname';a.innerHTML=mthHTML(ps.tex||ps.name);
    var c=DD.createElement('span');c.className='fmnote';c.textContent=ps.note;
    b.appendChild(a);b.appendChild(c);
    fmgrid.appendChild(b);
  }
  fmenu.classList.add('on');fmask.classList.add('on');
}
function closeFormulaMenu(){fmenu.classList.remove('on');fmask.classList.remove('on');}
// 设置面板（左上角工具下拉 → 设置）。PHYS_MODE 切换即时生效：空气阻力由 refreshAllPairs 每帧重刷
// （applyWAir/wAirDef 都读 PHYS_MODE），弹簧阻尼与力矩在下一帧 stepSprings 按新模式作用。
// 弹性由 applyEffRest 刷 mb.restitution：默认体没调过参不经过 applyWFrict/applyWBounc，切换时需扫场上 W 体
// 主动刷一遍，否则旧体仍是 buildMatterBody 的初值（圆为 BALL_REST）。
var smenu=document.getElementById('smenu'),smask=document.getElementById('smask'),
    sclose=document.getElementById('sclose');
function syncModeUI(){
  if(!smenu)return;
  var bs=smenu.querySelectorAll('.sbtn');
  for(var i=0;i<bs.length;i++){
    bs[i].classList.toggle('act',bs[i].getAttribute('data-mode')===PHYS_MODE);
  }
  /* 交互模式（自动/电脑版/触屏版）按钮高亮 */
  var us=smenu.querySelectorAll('.ubtn');
  for(i=0;i<us.length;i++){
    us[i].classList.toggle('act',us[i].getAttribute('data-ui')===UI_MODE);
  }
  var tip=smenu.querySelector('#uitip');
  if(tip)tip.textContent=uiTouch()?('当前：触屏版（长按=右键 · 点选后可再点放置）'):('当前：电脑版');
}
/* 交互模式切换按钮 */
function bindUIModeBtns(){
  if(!smenu)return;
  var us=smenu.querySelectorAll('.ubtn');
  for(var i=0;i<us.length;i++){
    (function(b){
      b.addEventListener('click',function(){
        setUIMode(b.getAttribute('data-ui')||'auto');
        touchClearSel();
        syncModeUI();
      });
    })(us[i]);
  }
}
function openSettings(){smenu.classList.add('on');smask.classList.add('on');syncModeUI();}
/* 关设置时把问号气泡一并收掉：气泡挂在 body 上（不在 .smenu 内），面板关了它会变成孤儿
 * （触屏路径没有 mouseleave，尤其容易漏）。 */
function closeSettings(){
  smenu.classList.remove('on');smask.classList.remove('on');
  var pop=DD.getElementById('qpop');if(pop)pop.classList.remove('on');
  var qs=smenu.querySelectorAll('.qbtn');
  for(var qi=0;qi<qs.length;qi++)qs[qi].classList.remove('on');
}

// 记录模式：从设置进入，复现问题时逐帧记录，事后读参数判断。
//  · 逐帧全场快照：每个 body 的位置/速度/角速度/角度/质量/是否固定/是否睡眠 + 有效 μ/e，外加弹簧的
//    长度/端点/ks、当前模式、GRAV、物理时间戳。物理量一律 *60 换成 px/s 与 rad/s；时间戳同时记墙钟与
//    engine.timing.timestamp（后者才是物理时间）。
//  · 环形缓冲 90 秒：bug 一般发生在复现末尾，满了丢最旧的而不是停止记录。
//  · 操作事件单独记：pointerdown/up/move（节流 40ms）/右键菜单/滚轮/键盘/面板 input，记下目标元素的
//    tag#id.class 与文字，事后能把读数与操作对上。
//  · 只读：不写任何物理量，记录不改变被测行为。
//  · 导出 = Blob 下载 + 一份写进 localStorage（下载被浏览器挡住时的退路）。
var REC={on:false,t0:0,frames:[],events:[],raf:0,lastMove:0,tickUI:0};
var REC_MAX=5400;                 // 90s @60fps
var REC_EVMAX=4000;
function recNow(){return +(performance.now()).toFixed(1);}
function recSnap(){
  var f={t:+(recNow()-REC.t0).toFixed(1),mode:(typeof PHYS_MODE!=='undefined'?PHYS_MODE:null),
         g:(typeof GRAV!=='undefined'?GRAV:null)};
  if(MW&&MW.engine)f.pt=+MW.engine.timing.timestamp.toFixed(1);
  if(typeof TOOL!=='undefined')f.tool=TOOL.mode+(TOOL.shape?('/'+TOOL.shape):'');
  f.bs=[];
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i],mb=B&&B.mb;
    /* 杆（T）/铰链（S+hinge）没有 Matter 体（mb），用自身坐标 B.x/B.y/B.th 记录，不能被 `if(!mb)continue` 跳过。 */
    var _isRod=!!(B&&(B.kind==='T'||(B.kind==='S'&&B.hinge)));
    /* 场源体 B/E/q/I 也没有 Matter 体（由场通道自己积分），同样要记（用 B.x/B.y），不能整类跳过。 */
    var _isField=!!(B&&(B.kind==='B'||B.kind==='E'||B.kind==='q'||B.kind==='I'));
    if(!mb&&!_isRod&&!_isField)continue;
    var o={i:i,k:B.kind};
    if(B.wshape)o.s=B.wshape;
    if(mb){
      o.x=+mb.position.x.toFixed(2);o.y=+mb.position.y.toFixed(2);
      o.vx=+(mb.velocity.x*60).toFixed(2);o.vy=+(mb.velocity.y*60).toFixed(2);
      o.w=+(mb.angularVelocity*60).toFixed(3);o.a=+mb.angle.toFixed(4);
      o.m=+mb.mass.toFixed(4);
      if(B.fixed)o.fx=1; if(mb.isStatic)o.st=1; if(mb.isSleeping)o.sl=1;
    }else{
      o.x=+((B.x||0)).toFixed(2);o.y=+((B.y||0)).toFixed(2);
      o.vx=+((B.vx||0)).toFixed(2);o.vy=+((B.vy||0)).toFixed(2);
      o.w=+((B.om||0)).toFixed(4);o.a=+((B.th||0)).toFixed(4);
      if(B.fixed)o.fx=1;
    }
    if(typeof wEffMu==='function')o.mu=+wEffMu(B).toFixed(4);
    if(typeof wEffE==='function')o.e=+wEffE(B).toFixed(4);
    /* W 体补记本地几何：半宽/半高、点数、降采样后的顶点串（≤24 点）。
     * 有了 pts + a（角度）+ x/y，复现时就能逐位重建当时的图形（例如判断落点是否在图形上）。 */
    if(B.pts&&B.pts.length>=2){
      var _mnx=1e9,_mxx=-1e9,_mny=1e9,_mxy=-1e9;
      for(var _q=0;_q<B.pts.length;_q++){
        var _pp=B.pts[_q];
        if(_pp[0]<_mnx)_mnx=_pp[0]; if(_pp[0]>_mxx)_mxx=_pp[0];
        if(_pp[1]<_mny)_mny=_pp[1]; if(_pp[1]>_mxy)_mxy=_pp[1];
      }
      o.hw=+((_mxx-_mnx)/2).toFixed(2);
      o.hh=+((_mxy-_mny)/2).toFixed(2);
      o.ox=+((( _mxx+_mnx)/2)-B.x).toFixed(2);
      o.oy=+((( _mxy+_mny)/2)-B.y).toFixed(2);
      o.npt=B.pts.length;
      o.cl=(B.closed?1:0);
      var _step=Math.max(1,Math.ceil(B.pts.length/24)),_out=[];
      for(_q=0;_q<B.pts.length;_q+=_step)_out.push([+B.pts[_q][0].toFixed(1),+B.pts[_q][1].toFixed(1)]);
      if(_out[_out.length-1]!==B.pts[B.pts.length-1])
        _out.push([+B.pts[B.pts.length-1][0].toFixed(1),+B.pts[B.pts.length-1][1].toFixed(1)]);
      o.pts=_out;
    }
    if(B.charge!=null)o.q=+B.charge;
    /* 杆（T）与铰链（S+hinge）的诊断字段：长度/当前长度/两端锚定状态/锚到的体序号/端点世界坐标/锚点本地偏移
     * （脱钩时 ox,oy 或 anc 会立刻暴露）。 */
    if(B.kind==='T'||(B.kind==='S'&&B.hinge)){
      o.len=(B.len!=null)?+B.len.toFixed(2):null;
      o.cur=(B.cur!=null)?+B.cur.toFixed(2):null;
      o.hinge=B.hinge?1:0;
      var _a0=B.anc&&B.anc[0], _a1=B.anc&&B.anc[1];
      o.anc=[_a0?1:0,_a1?1:0];
      o.ancI=[(_a0&&_a0.B)?bodies.indexOf(_a0.B):-1,(_a1&&_a1.B)?bodies.indexOf(_a1.B):-1];
      o.ox=[_a0?+(_a0.ox||0).toFixed(2):null,_a1?+(_a1.ox||0).toFixed(2):null];
      o.oy=[_a0?+(_a0.oy||0).toFixed(2):null,_a1?+(_a1.oy||0).toFixed(2):null];
      try{
        var _e0=(typeof rodEndWorld==='function')?rodEndWorld(B,0):null;
        var _e1=(typeof rodEndWorld==='function')?rodEndWorld(B,1):null;
        if(_e0)o.e0=[+_e0.x.toFixed(1),+_e0.y.toFixed(1)];
        if(_e1)o.e1=[+_e1.x.toFixed(1),+_e1.y.toFixed(1)];
      }catch(e2){}
    }
    f.bs.push(o);
  }
  // 弹簧也在 bodies 里（kind==='S'），没有名为 springs 的全局数组。
  // 不要写 `typeof springs!=='undefined'` 这类守卫：恒 false，会静默漏掉全部弹簧（符号不存在必须报错，不能悄悄跳过）。
  var sps=[];
  for(var q=0;q<bodies.length;q++){
    var S=bodies[q];
    if(!S||S.dead||S.kind!=='S'||!S.e0||!S.e1)continue;
    var _sp={i:q,ks:S.ks,len:+(S.len||0).toFixed(2),cur:+(S.cur||0).toFixed(2),
              th:(S.th==null?null:+(+S.th).toFixed(4)),
              dir:(S.dirLock&&S.dirLock.axis)?S.dirLock.axis:null,
              e0:[+S.e0.x.toFixed(1),+S.e0.y.toFixed(1)],
              e1:[+S.e1.x.toFixed(1),+S.e1.y.toFixed(1)]};
    /* 普通弹簧/轻绳也记锚定关系（与杆同款）：锚定标志 / 锚到的体序号 / 锚点本地偏移 / 压缩状态量。
     * 否则录屏里只有 e0/e1 坐标，无法判断哪一端锚在谁身上。 */
    var _sa0=S.anc&&S.anc[0], _sa1=S.anc&&S.anc[1];
    _sp.anc=[_sa0?1:0,_sa1?1:0];
    _sp.ancI=[(_sa0&&_sa0.B)?bodies.indexOf(_sa0.B):-1,
              (_sa1&&_sa1.B)?bodies.indexOf(_sa1.B):-1];
    _sp.ox=[_sa0?+(_sa0.ox||0).toFixed(2):null,_sa1?+(_sa1.ox||0).toFixed(2):null];
    _sp.oy=[_sa0?+(_sa0.oy||0).toFixed(2):null,_sa1?+(_sa1.oy||0).toFixed(2):null];
    if(S._capCmp)_sp.cmp=+S._capCmp.toFixed(2);      // 端帽压缩量（接触-形变状态）
    if(S.hinge)_sp.hg=1;
    sps.push(_sp);
  }
  if(sps.length)f.sp=sps;
  /* 补记自由字符（freeL，如 a/t/v/q）：字符、坐标、状态、速度、赋予型参数，便于定位其消失/瞬移/抓不动等问题。 */
  var fls=[];
  for(var q2=0;q2<freeL.length;q2++){
    var L=freeL[q2];
    if(!L||L.dead)continue;
    var lo={i:q2,ch:L.ch,st:L.state||null,
            x:+((L.wx||0)).toFixed(1),y:+((L.wy||0)).toFixed(1),
            vx:+((L.vx||0)).toFixed(1),vy:+((L.vy||0)).toFixed(1)};
    if(L.body)lo.bd=1;
    if(L.vGive!=null)lo.v=+L.vGive;
    if(L.vAng!=null)lo.va=+L.vAng;
    if(L.aGive!=null)lo.a=+L.aGive;
    if(L.aAng!=null)lo.aa=+L.aAng;
    if(L.qCharge!=null)lo.q=+L.qCharge;
    fls.push(lo);
  }
  if(fls.length)f.fl=fls;
  return f;
}
function recTick(){
  if(!REC.on)return;
  REC.frames.push(recSnap());
  while(REC.frames.length>REC_MAX)REC.frames.shift();
  if(++REC.tickUI>=20){REC.tickUI=0;recUI();}
  REC.raf=requestAnimationFrame(recTick);
}
function recEv(ty,e){
  if(!REC.on)return;
  var o={t:+(recNow()-REC.t0).toFixed(1),ty:ty},el=e&&e.target;
  if(e&&typeof e.clientX==='number'){o.x=+e.clientX.toFixed(1);o.y=+e.clientY.toFixed(1);}
  if(el&&el.tagName){
    o.el=el.tagName+(el.id?'#'+el.id:'')
        +(el.className&&typeof el.className==='string'&&el.className?'.'+el.className.split(' ')[0]:'');
    if(typeof el.textContent==='string'&&el.textContent)o.txt=el.textContent.slice(0,24);
  }
  if(e&&e.button!=null)o.btn=e.button;
  if(e&&e.key)o.key=e.key;
  REC.events.push(o);
  if(REC.events.length>REC_EVMAX)REC.events.shift();
}
function recH(ty,thr){
  return function(e){
    if(!REC.on)return;
    if(thr){var n=recNow();if(n-REC.lastMove<thr)return;REC.lastMove=n;}
    recEv(ty,e);
  };
}
var REC_H=[['pointerdown',recH('down',0),1],['pointerup',recH('up',0),1],
           ['pointermove',recH('move',40),1],['contextmenu',recH('menu',0),1],
           ['wheel',recH('wheel',0),1],['keydown',recH('key',0),1],
           ['input',recH('input',0),1],['change',recH('change',0),1]];
function recHook(on){
  for(var i=0;i<REC_H.length;i++){
    if(on)window.addEventListener(REC_H[i][0],REC_H[i][1],true);
    else window.removeEventListener(REC_H[i][0],REC_H[i][1],true);
  }
}
var recbtn=document.getElementById('recbtn'),recnote=document.getElementById('recnote'),
    recbadge=document.getElementById('recbadge');
function recUI(){
  if(recbtn){
    recbtn.classList.toggle('on',REC.on);
    recbtn.textContent=REC.on?('停止并导出（'+Math.round((recNow()-REC.t0)/1000)+'s / '
                               +REC.frames.length+'帧）'):'开始记录';
  }
  if(recbadge)recbadge.classList.toggle('on',REC.on);
}
function recStart(){
  REC.on=true;REC.t0=recNow();REC.frames.length=0;REC.events.length=0;
  recHook(true);recEv('start',null);
  REC.raf=requestAnimationFrame(recTick);recUI();
  if(recnote)recnote.textContent='记录中……照常操作复现 bug，然后回到设置点「停止并导出」。'
                                +'（只保留最后 90 秒；右上角有红点提示）';
}
function recStop(){
  REC.on=false;recHook(false);
  if(REC.raf)cancelAnimationFrame(REC.raf);
  REC.raf=0;recEv('stop',null);recUI();
}
// payload 构建与 recDump 分开：提交到后端也要用它，但不能走 recDump（会触发下载）。两处共用 recPayload()，口径不分叉。
function recPayload(){
  var payload={v:1,kind:'sandbox-rec',savedAt:new Date().toISOString(),
    meta:{},frames:REC.frames,events:REC.events};
  ['W','H','groundY','PX_PER_M','GRAV','PHYS_MODE','SPR_KS_DEF','SPR_K_MAX','SPR_DAMP',
   'SPR_SPAWN_LEN','BALL_REST','CIRCLE_SIDES','BND_INK'].forEach(function(k){
    try{payload.meta[k]=eval(k);}catch(e){payload.meta[k]=null;}
  });
  return payload;
}
function recDump(){
  var s=JSON.stringify(recPayload());
  var name='rec_'+new Date().toISOString().replace(/[:T]/g,'-').slice(0,19)+'.json';
  try{
    var b=new Blob([s],{type:'application/json'}),a=document.createElement('a');
    a.href=URL.createObjectURL(b);a.download=name;
    document.body.appendChild(a);a.click();
    setTimeout(function(){try{URL.revokeObjectURL(a.href);}catch(e){}
                          if(a.parentNode)a.parentNode.removeChild(a);},1500);
  }catch(e){}
  try{localStorage.setItem('__LAST_REC__',s);}catch(e){}
  if(recnote)recnote.textContent='已导出 '+name+'：'+REC.frames.length+' 帧 / '
    +REC.events.length+' 个操作 / '+Math.round(s.length/1024)+' KB。文件在浏览器的下载目录里，'
    +'把它给我（或让我读 localStorage 的 __LAST_REC__）就能直接判断。';
  return {name:name,frames:REC.frames.length,events:REC.events.length,bytes:s.length};
}
if(recbtn)recbtn.addEventListener('click',function(){
  /* 停止录制后弹出提交框（openBugDlg）填写说明并提交到后端；下载降级为弹框里的「仅下载文件」备选。 */
  if(REC.on){recStop();openBugDlg();}else{recStart();}
});
window.REC=REC;window.recStart=recStart;window.recStop=recStop;window.recDump=recDump;
window.recPayload=recPayload;

/* Bug 提交（弹框写说明 → POST 到后端）。
 * 端点契约：POST <BUG_ENDPOINT>，body = {"desc":"...","rec":{…录制 JSON…}}，
 * 返回 {"ok":true,"id":"..."} 或 {"ok":false,"err":"..."}。BUG_ENDPOINT 留空 = 只支持下载。 */
var BUG_ENDPOINT='https://sandbox-bug-api.pages.dev/submit';
var bugmask=DD.getElementById('bugmask'),bugbox=DD.getElementById('bugbox'),
    bugdesc=DD.getElementById('bugdesc'),buginfo=DD.getElementById('buginfo'),
    bugsubmit=DD.getElementById('bugsubmit'),bugdl=DD.getElementById('bugdl'),
    bugstatus=DD.getElementById('bugstatus'),bugclose=DD.getElementById('bugclose');
function openBugDlg(){
  var s='';
  try{s=JSON.stringify(recPayload());}catch(e){s='';}
  if(buginfo)buginfo.textContent='本次记录：'+REC.frames.length+' 帧 / '+REC.events.length
    +' 个操作 / '+Math.round(s.length/1024)+' KB';
  if(bugstatus)bugstatus.textContent='';
  if(bugmask)bugmask.classList.add('on');
  if(bugbox)bugbox.classList.add('on');
  if(bugdesc)bugdesc.focus();
}
function closeBugDlg(){
  if(bugmask)bugmask.classList.remove('on');
  if(bugbox)bugbox.classList.remove('on');
}
function bugSubmit(){
  var desc=(bugdesc&&bugdesc.value?bugdesc.value:'').trim();
  if(!desc){if(bugstatus)bugstatus.textContent='请先写一句说明（做了什么 / 期望 / 实际）。';return;}
  if(!BUG_ENDPOINT){if(bugstatus)bugstatus.textContent=
    '服务器地址还没配置 —— 可先点「仅下载文件」把文件发给我，等 Worker 部署好后我再把地址填上。';return;}
  var s='';
  try{s=JSON.stringify(recPayload());}catch(e){s='';}
  if(!s){if(bugstatus)bugstatus.textContent='录制内容为空，没什么可提交的。';return;}
  /* 直接拼串，不 JSON.parse 再 stringify：录制 JSON 可能有几 MB，二次编码浪费内存、放大体积。 */
  var body='{"desc":'+JSON.stringify(desc)+',"rec":'+s+'}';
  if(bugstatus)bugstatus.textContent='提交中……（'+Math.round(body.length/1024)+' KB）';
  if(bugsubmit)bugsubmit.disabled=true;
  fetch(BUG_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:body})
    .then(function(r){return r.json().catch(function(){return {ok:r.ok,err:'HTTP '+r.status};});})
    .then(function(j){
      if(bugsubmit)bugsubmit.disabled=false;
      if(j&&j.ok){if(bugstatus)bugstatus.textContent='已提交（编号 '+(j.id||'?')+'）。可以关掉这个框了，谢谢！';}
      else{if(bugstatus)bugstatus.textContent='提交失败：'+((j&&j.err)||'服务器返回异常')+'（可点「仅下载文件」）。';}
    })
    .catch(function(e){
      if(bugsubmit)bugsubmit.disabled=false;
      if(bugstatus)bugstatus.textContent='提交失败：'+((e&&e.message)||e)+'（可点「仅下载文件」）。';
    });
}
if(bugmask)bugmask.addEventListener('click',closeBugDlg);
if(bugclose)bugclose.addEventListener('click',closeBugDlg);
if(bugdl)bugdl.addEventListener('click',function(){recDump();});
if(bugsubmit)bugsubmit.addEventListener('click',bugSubmit);
window.openBugDlg=openBugDlg;window.bugSubmit=bugSubmit;window.closeBugDlg=closeBugDlg;
smask.addEventListener('click',closeSettings);
sclose.addEventListener('click',closeSettings);
/* 触屏面板把手（点按展开/收起符号面板） */
if(DD.getElementById('panelToggle')){
  DD.getElementById('panelToggle').addEventListener('click',function(ev){
    ev.stopPropagation();
    DD.body.classList.toggle('touch-panel-folded');
    /* 图标用 .ttoggle 同款 SVG，展开/收起用旋转表达 */
    var sv=DD.getElementById('panelToggle');
    if(sv)sv.classList.toggle('open',!DD.body.classList.contains('touch-panel-folded'));
  });
}
applyUIModeClasses();
window.addEventListener('resize',function(){alignPanelToggle();});
/* 全屏按钮 + 两个问号按钮的初始化。
 * fullscreenchange 是唯一的真相来源（Esc / F11 / 浏览器 UI 退出都会走它），点击只是请求，外观由这条事件统一刷新。 */
syncFullscreenUI();
['fullscreenchange','webkitfullscreenchange'].forEach(function(ev){
  DD.addEventListener(ev,function(){syncFullscreenUI();});
});
bindQBtn('qphys');
bindQBtn('quitipbtn');
setTimeout(fixPanelSlot,600);
setTimeout(fixPanelSlot,1500);
/* 设置面板每次打开都把当前生效值回填进输入框（localStorage 可能覆盖过默认值） */
smenu.addEventListener('click',function(e){
  e.stopPropagation();
  /* 交互模式按钮（自动/电脑版/触屏版） */
  var ub=e.target.closest('.ubtn');
  if(ub){setUIMode(ub.getAttribute('data-ui')||'auto');touchClearSel();syncModeUI();return;}
  var b=e.target.closest('.sbtn');if(!b)return;
  PHYS_MODE=b.getAttribute('data-mode');
  syncModeUI();
  // 切换模式后逐体调 applyWFrict 与 applyWBounc，让 μ 与 e 两条链同源刷新：
  //   · applyWFrict 管 μ 通道（高中模式默认 μ=0 只是读 PHYS_MODE 的显示值，不扫的话旧体 mb.friction 仍是 0.08），
  //     并连带刷 effRest/air；
  //   · 圆的 mb.restitution=BALL_REST 这类 e 默认必须由 applyWBounc 亲自写（它内部带 parts/pair 刷新）。
  for(var ji=0;ji<bodies.length;ji++){
    if(bodies[ji].kind!=='W')continue;
    applyWFrict(bodies[ji]);
    applyWBounc(bodies[ji]);
  }
  // 切换模式时把场上所有可动 W 体的角速度清零（两个方向都清；静态体跳过）。
  // 旧模式攒下的自旋在新模式里没有合法语义：例如大学模式攒的 ω 切到高中后没有任何衰减通道
  // （力矩通道关闭 + 锚点冻结 + 无空气阻力），物体会永远匀速转下去。
  for(var jw=0;jw<bodies.length;jw++){
    var BW2=bodies[jw];
    if(BW2.kind!=='W'||!BW2.mb||BW2.dead||BW2.mb.isStatic)continue;
    Matter.Body.setAngularVelocity(BW2.mb,0);
  }
  // 切换模式后按当前几何重算所有弹簧锚点的本地偏移：高中模式记「相对质心的世界分量」（不随自转），
  // 大学模式记「R(θ)·local」。此刻重算让端点停在原位，切换瞬间零跳变；漏掉则端点会按新约定突然跳位。
  for(var js=0;js<bodies.length;js++){
    var S78=bodies[js];
    if(S78.kind!=='S'||S78.dead)continue;
    for(var je=0;je<2;je++){if(S78.anc[je]&&S78.anc[je].B)springAnchorOffset(S78,je);}
    // 切进高中模式时给已有弹簧补上自动轴锁（高中模式没有斜弹簧）。用当前方向而不是吸到最近的轴：
    // 吸附会把端点搬动最多 |垂向分量|（近 45° 时约 len/√2），弹簧会突然跳位；用当前方向同样满足
    // 「方向不再变化」且零跳变。新画的弹簧仍走 makeSpring 的吸附路径。
    // 切回大学模式时摘掉 auto 锁（手动「固定方向」的锁是用户显式设的，不摘）。
    if(PHYS_MODE==='high'){
      if(!S78.dirLock){
        var sdx=S78.e1.x-S78.e0.x,sdy=S78.e1.y-S78.e0.y,sd=Math.hypot(sdx,sdy)||1e-6;
        S78.dirLock={mx:S78.x,my:S78.y,ux:sdx/sd,uy:sdy/sd,auto:true};
        refreshSpringGeom(S78);
      }
    }else if(S78.dirLock&&S78.dirLock.auto){
      S78.dirLock=null;
      refreshSpringGeom(S78);
    }
  }
});
/* ---- ② ③ drawing modes ---------------------------------------------------------------- */
function setToolMode(m){
  TOOL.mode=m;
  if(!m){TOOL.cont=false;TOOL.armedKey=null;}   // 解除武装时顺手清掉连续/双击状态
  // 程序化武装（测试、内部调用）也要写对 armedKey，否则下一次真实点击会被误判成
  // 「同一个按钮又点了一下」。toolTap 随后会用实际按钮的 key 覆盖它（形状行/器件行按钮有自己的 key）。
  else TOOL.armedKey=(m==='brush')?'brush':((m==='device')?('device:'+TOOL.device):('shape:'+TOOL.shape));
  cv.classList.toggle('cur-draw',!!m);
  syncToolUI();
}
// 双击进入连续绘制模式时弹提示：否则用户不知道处于连续模式，每次单击画布都落一个默认图形、叠成一串。
// 提示条 2s 自动消失。
var _fhT=null;
function flashHint(msg){
  var el=document.getElementById('fhashint');
  if(!el)return;
  el.textContent=msg;
  el.classList.add('on');
  if(_fhT)clearTimeout(_fhT);
  _fhT=setTimeout(function(){el.classList.remove('on');},2000);
}
/* 在 (x,y) 处冒一行红字代码，上浮 + 横扫 + 淡出，1.9s 后自毁。
 *  · 不用 flashHint：那是屏幕底部居中的固定条（同一时刻只有一条），语义是提示当前模式；这里要表达落点上的错误。
 *  · 元素挂在 <body> 下：canvas 画不出 DOM 文字；面板有 transform，会成为 fixed 后代的包含块（见 #qpop）。
 *  · CSS 里 pointer-events:none，不吃掉随后的手势。
 *  · 返回计数给守卫读（window.__errTipN），实现里没有测试专用分支。 */
function errTip(x,y,msg){
  var el=DD.createElement('div');
  el.className='errtip';
  el.textContent=msg||'Error';
  el.style.left=Math.round(x)+'px';
  el.style.top=Math.round(y)+'px';
  DD.body.appendChild(el);
  el.classList.add('go');           // 新元素首帧即带动画 ⇒ 不需要强制 reflow
  window.__errTipN=(window.__errTipN||0)+1;
  setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el);},1900);
  return el;
}
/* 光速 v 落到普通物体/公式上 ⇒ 拒绝赋予：有静止质量的物体不可能被加速到光速。
 * v 不并入、被弹开（同 bossRepel 手感），落点冒一行 error。只拦 vLight，普通 v 照旧走 giveFromLetter。
 * 调用点必须排在 bossTryPlace 之后：½mv² 的召唤通道要先有机会接住它。 */
function vLightReject(B,d){
  var x=(d&&d.wx!=null)?d.wx:((pointer&&pointer.x!=null)?pointer.x:(B?B.x:0));
  var y=(d&&d.wy!=null)?d.wy:((pointer&&pointer.y!=null)?pointer.y:(B?B.y:0));
  var ux=x-(B?B.x:0),uy=y-(B?B.y:0),L=Math.hypot(ux,uy);
  if(!(L>1)){ux=0;uy=-1;L=1;}
  ux/=L;uy/=L;
  /* 弹开：给 v 一个远离物体的初速度 + 略上抛（同 bossRepel） */
  d.state='free';d.cat=1;d.pop=1;d.massless=false;
  d.wx=x;d.wy=y;
  d.vx=ux*1500;d.vy=uy*1500-360;
  if(freeL.indexOf(d)<0)freeL.push(d);
  placeLetter(d);
  burstParticles(x,y,14,0.7);
  if(B)ringGo(B.x,B.y);
  shake(4,0.22);
  /* 文案只有 'Error'，不加前缀、原因或其他说明（用户明确要求，不要自行添加）。 */
  errTip(x,y,'Error');
  return true;
}
// 单击 = 画一次；双击 = 连续；再单击 = 取消。供 brush / shape 两类按钮共用。
// key 标识哪一个按钮，mode 是要进入的工具模式，extra 交给调用方做下拉框等副作用。
function toolTap(key,mode,extra){
  var now=performance.now();
  if(TOOL.mode&&TOOL.armedKey===key){
    if(now-TOOL.lastTap<=TOOL_DBL_MS){
      TOOL.cont=true;   // 双击 -> 升级为连续绘制
      // 进连续模式立刻弹提示。器件是点一下放一个，没有拖出尺寸这一步，提示文案不同。
      flashHint((mode==='brush')?'连续模式·一直画，再点按钮取消'
                :((mode==='device')?'连续模式·每点一次放一个器件，再点按钮取消'
                                   :'连续模式·每次拖出形状，单击不落体'));
    }   // 双击 -> 升级为连续绘制
    else{setToolMode(null);}                            // 再点一下（隔开） -> 取消
  }else{
    TOOL.cont=false;                                    // 单击 -> 只画一次
    if(extra)extra();
    setToolMode(mode);
    TOOL.armedKey=key;
  }
  TOOL.lastTap=now;
  syncToolUI();   // 双击升级为连续时只改了 cont，没有走 setToolMode，得自己刷按钮上的 ∞ 角标
}
function syncToolUI(){
  var brush=tRow.querySelector('[data-tool="brush"]'),shp=tRow.querySelector('[data-tool="shape"]');
  if(brush)brush.classList.toggle('act',TOOL.mode==='brush');
  if(shp)shp.classList.toggle('act',TOOL.mode==='shape');
  if(brush)brush.classList.toggle('cont',TOOL.mode==='brush'&&TOOL.cont);
  if(shp)shp.classList.toggle('cont',TOOL.mode==='shape'&&TOOL.cont);
  var subs=tSub.querySelectorAll('.tbtn');
  for(var i=0;i<subs.length;i++){
    var on=(TOOL.mode==='shape'&&subs[i].getAttribute('data-shape')===TOOL.shape);
    subs[i].classList.toggle('act',on);
    subs[i].classList.toggle('cont',on&&TOOL.cont);
  }
  // 器件按钮与器件 chip：与上面形状那两段对应（行按钮高亮 + 选中的 chip 高亮）。
  var dev=tRow.querySelector('[data-tool="device"]');
  if(dev)dev.classList.toggle('act',TOOL.mode==='device');
  if(dev)dev.classList.toggle('cont',TOOL.mode==='device'&&TOOL.cont);
  var dsubs=dSub.querySelectorAll('.tbtn');
  for(var j=0;j<dsubs.length;j++){
    var onD=(TOOL.mode==='device'&&dsubs[j].getAttribute('data-device')===TOOL.device);
    dsubs[j].classList.toggle('act',onD);
    dsubs[j].classList.toggle('cont',onD&&TOOL.cont);
  }
}
function setToolsOpen(v){
  TOOL.open=v;
  tRow.classList.toggle('on',v);
  tToggle.classList.toggle('open',v);
  if(!v){tSub.classList.remove('on');dSub.classList.remove('on');setToolMode(null);}
  syncToolUI();
}
tToggle.addEventListener('click',function(e){e.stopPropagation();setToolsOpen(!TOOL.open);});
tRow.addEventListener('click',function(e){
  e.stopPropagation();
  var b=e.target.closest('.tbtn');if(!b)return;
  var t=b.getAttribute('data-tool');
  if(t==='formula'){closeToolsSoft();openFormulaMenu();}
  else if(t==='settings'){closeToolsSoft();openSettings();}
  else if(t==='brush'){tSub.classList.remove('on');dSub.classList.remove('on');toolTap('brush','brush');}
  else if(t==='shape'){
    // 行按钮有自己的 key：它和下面的形状 chip 是不同的按钮，不能算成「同一按钮点两下」
    toolTap('shaperow:'+TOOL.shape,'shape');
    tSub.classList.toggle('on',TOOL.mode==='shape');   // 取消时自动收起，武装时展开
    dSub.classList.remove('on');                       // 两行子面板互斥，不叠着开
  }
  else if(t==='device'){
    // 与形状行同构：行按钮用自己的 key，展开自己那一行器件。
    toolTap('devrow:'+TOOL.device,'device');
    dSub.classList.toggle('on',TOOL.mode==='device');
    tSub.classList.remove('on');
  }
  else if(t==='fullscreen'){toggleFullscreen();}
});
/* 浏览器全屏（Fullscreen API）。三处必须处理，否则在不同浏览器上会点了没反应：
 *  ① 前缀：Safari 老版本只有 webkitRequestFullscreen；取实际存在的那个再调（调不存在的属性会抛 TypeError）。
 *  ② 返回值是 Promise：被拒绝时（非用户手势、iframe 没给 allow="fullscreen"）会抛未捕获异常 ⇒ 必须 .catch()。
 *  ③ 状态同步：Esc / F11 / 浏览器 UI 也能退出全屏，监听 fullscreenchange（含 webkit 前缀）反过来刷新按钮外观。 */
function fsElement(){
  return DD.fullscreenElement||DD.webkitFullscreenElement||null;
}
function fsSupported(){
  var el=DD.documentElement||DD.body;
  return !!(el&&(el.requestFullscreen||el.webkitRequestFullscreen));
}
function toggleFullscreen(){
  var el=DD.documentElement||DD.body;
  if(!el)return false;
  try{
    if(fsElement()){
      var ex=DD.exitFullscreen||DD.webkitExitFullscreen;
      if(ex){var r1=ex.call(DD);if(r1&&r1.catch)r1.catch(function(){});}
    }else{
      var rq=el.requestFullscreen||el.webkitRequestFullscreen;
      if(rq){var r2=rq.call(el);if(r2&&r2.catch)r2.catch(function(){});}
    }
  }catch(e){return false;}
  syncFullscreenUI();
  return true;
}
/* 按钮外观 = 当前真实全屏态（四角外扩=进全屏 / 四角内收=退全屏） */
function syncFullscreenUI(){
  var b=DD.getElementById('fsbtn'),ic=DD.getElementById('fsicon');
  if(!b)return;
  var on=!!fsElement();
  b.title=on?'退出全屏':'全屏';
  b.classList.toggle('act',on);
  if(ic){
    ic.innerHTML=on
      ? '<path d="M9 4v5H4"/><path d="M20 9h-5V4"/><path d="M15 20v-5h5"/><path d="M4 15h5v5"/>'
      : '<path d="M4 9V4h5"/><path d="M15 4h5v5"/><path d="M20 15v5h-5"/><path d="M9 20H4v-5"/>';
  }
}
/* 问号按钮的两条显示路径：桌面 hover / 触屏 click。
 * 气泡定位用按钮自身的 rect（面板随屏幕高度居中，写死坐标在手机上会错位）。 */
var QPOP_TEXT={
  qphys:'<b>高中模式</b><br>① 弹簧不算力矩（拉任何部位效果相同）<br>'
      + '② 不算弹簧阻尼<br>③ 不算空气阻力<br>④ 默认弹性系数全为 0<br>'
      + '⑤ 默认摩擦系数为 0<br>⑥ 弹簧只有水平与竖直两个方向（画出来即吸附到最近的轴）',
  quitipbtn:'<b>交互模式</b><br>· <b>自动</b>：按设备自动判断（有触摸屏就用触屏版）<br>'
      + '· <b>电脑版</b>：鼠标操作（右键弹参数菜单）<br>'
      + '· <b>触屏版</b>：手指操作（长按 = 右键菜单 · 点选符号后再点画布放置 · 点画布拖动）'
};
function qpopShow(btn){
  var pop=DD.getElementById('qpop');
  if(!pop||!btn)return;
  var txt=QPOP_TEXT[btn.id];
  if(!txt)return;
  btn.classList.add('on');
  pop.innerHTML=txt;
  pop.classList.add('on');
  /* 先显形再量尺寸（display:none 时量不到宽高 ⇒ 右侧夹取会失效） */
  var r=btn.getBoundingClientRect(),pr=pop.getBoundingClientRect();
  var left=r.right+10;
  if(left+pr.width>window.innerWidth-8)left=Math.max(8,r.left-pr.width-10);   // 右边放不下 ⇒ 翻到左侧
  var top=r.top;
  if(top+pr.height>window.innerHeight-8)top=Math.max(8,window.innerHeight-8-pr.height);
  pop.style.left=left.toFixed(1)+'px';
  pop.style.top=top.toFixed(1)+'px';
}
function qpopHide(btn){
  var pop=DD.getElementById('qpop');
  if(pop)pop.classList.remove('on');
  if(btn)btn.classList.remove('on');
}
function bindQBtn(id){
  var b=DD.getElementById(id);
  if(!b)return;
  /* 桌面：悬浮显示 / 移出隐藏。触屏：click 切换（`uiTouch()` 那条路上 click 照样会来，
   *  hover 事件则根本不产生 ⇒ 两条路径天然互不干扰）。 */
  b.addEventListener('mouseenter',function(){if(!uiTouch())qpopShow(b);});
  b.addEventListener('mouseleave',function(){if(!uiTouch())qpopHide(b);});
  b.addEventListener('click',function(e){
    e.stopPropagation();
    if(!uiTouch())return;                       // 桌面走 hover，click 不再重复切换
    var pop=DD.getElementById('qpop');
    if(pop&&pop.classList.contains('on'))qpopHide(b);else qpopShow(b);
  });
}
/* ---- ④ 器件行：从面板拖出 / 点选 --------------------------------------------- */
// 同一按钮挂两种手势，靠按下之后指针有没有动区分（阈值 6px；finishShapeDrag 的 12px 是
// 「算不算拖出尺寸」，语义不同，别混用）：
//   · 没动 -> 交给 toolTap：单击武装 / 双击连续 / 再点取消
//   · 动了 -> 拖出：画布上在指针处画落点虚影（drawDeviceGhost），在画布上松手 = 放下一个；丢回面板/菜单 = 取消。
// 这里不挂 click：pointerdown 里 preventDefault 后部分浏览器不再派发兼容鼠标事件，
// 而 click 与 pointerup 并存又会点一下放两个。状态机全部收在 pointerdown（这里）/ pointermove / pointerup（DD 上）三处。
var DEV_PANEL_MIN=6;
function startDeviceOut(e,btn){
  TOOL.devDrag={id:btn.getAttribute('data-device'),x:e.clientX,y:e.clientY,
                sx:e.clientX,sy:e.clientY,moved:false,over:false};
  // 捕获指针：拖出面板之后 pointerup 仍回到这里（鼠标本来也会冒泡到 DD，捕获只是更稳，
  // 且拖到窗口边缘松手也不会丢事件）。
  try{if(dSub.setPointerCapture)dSub.setPointerCapture(e.pointerId);}catch(_e){}
}
function moveDeviceOut(e){
  var d=TOOL.devDrag;
  if(!d)return;
  d.x=e.clientX;d.y=e.clientY;
  if(Math.abs(d.x-d.sx)>DEV_PANEL_MIN||Math.abs(d.y-d.sy)>DEV_PANEL_MIN)d.moved=true;
  if(!d.moved){d.over=false;return;}
  // 「松手会不会放下」= 指针底下不是面板/菜单（这些浮层盖在画布上）。
  // 用 elementFromPoint 而不是矩形判断：透明容器照样挡事件，矩形判断会漏。
  var el=DD.elementFromPoint(d.x,d.y);
  d.over=!!el&&!el.closest('#tools,#pbox,#menu,#smenu,#fmenu');
}
function endDeviceOut(){
  var d=TOOL.devDrag;TOOL.devDrag=null;
  if(!d)return;
  if(!d.moved){deviceTap(d.id);return;}   // 没拖动 = 就是点了一下按钮
  if(!d.over)return;                      // 丢回面板/菜单 = 取消
  // 与「器件模式下点画布」同一条收尾：放下一个就解除武装（除非双击进了连续模式）。
  // 否则拖出一个后仍武装着，用户再点画布想取消却又落下一个，违反「单击画布 = 只放一次」。
  var B=placeDevice(d.id,d.x,d.y);
  if(B&&!TOOL.cont)setToolMode(null);
}
function deviceTap(id){
  toolTap('device:'+id,'device',function(){TOOL.device=id;});
  syncDeviceSub();
}
// 器件行只在「器件模式武装中」展开（与形状行同一条规则，由 syncDeviceSub 单点控制）。
function syncDeviceSub(){dSub.classList.toggle('on',TOOL.mode==='device');}
dSub.addEventListener('pointerdown',function(e){
  if(e.button!==0)return;
  var b=e.target.closest('.tbtn');if(!b)return;
  e.preventDefault();e.stopPropagation();   // 画布与工具行都不该看到这一次按下
  startDeviceOut(e,b);
});
tSub.addEventListener('click',function(e){
  e.stopPropagation();
  var b=e.target.closest('.tbtn');if(!b)return;
  var sh=b.getAttribute('data-shape');
  // 单击画一次 / 双击连续 / 再单击取消。换成另一个形状则直接切过去。
  toolTap('shape:'+sh,'shape',function(){TOOL.shape=sh;});
});
// opening the formula menu leaves the row up (so you can pick another tool right after), but
// the active DRAWING mode is dropped — the menu takes over the canvas.
function closeToolsSoft(){setToolMode(null);tSub.classList.remove('on');dSub.classList.remove('on');}
fmgrid.addEventListener('click',function(e){
  var b=e.target.closest('.fmitem');if(!b)return;
  var ps=WHOLE_PRESETS[+b.getAttribute('data-ix')];
  var B=spawnWhole(ps,W/2,H/2);          // 正中央
  closeFormulaMenu();
  if(B)ringGo(B.x,B.y);
});
fmclose.addEventListener('click',closeFormulaMenu);
fmask.addEventListener('click',closeFormulaMenu);
DD.addEventListener('keydown',function(e){
  if(e.key==='Escape'){closeFormulaMenu();setToolsOpen(false);}
});
