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
// R74-D：设置面板（左上角工具下拉 → 设置）。PHYS_MODE 切换即时生效：
// 空气阻力由 refreshAllPairs 每帧重刷（applyWAir/wAirDef 都读 PHYS_MODE），弹簧阻尼与力矩
// 在下一帧 stepSprings 自然按新模式作用。弹性（R74-D/J）由 applyEffRest 刷 mb.restitution ——
// 默认体没调过参不经过 applyWFrict/applyWBounc，需在切换时扫场上 W 体主动刷一遍，否则旧体
// 的 mb.restitution 仍是 buildMatterBody 初值（圆 BALL_REST），refreshAllPairs 读到旧值。
var smenu=document.getElementById('smenu'),smask=document.getElementById('smask'),
    sclose=document.getElementById('sclose');
function syncModeUI(){
  if(!smenu)return;
  var bs=smenu.querySelectorAll('.sbtn');
  for(var i=0;i<bs.length;i++){
    bs[i].classList.toggle('act',bs[i].getAttribute('data-mode')===PHYS_MODE);
  }
  /* ★R131-27：交互模式（自动/电脑版/触屏版）按钮高亮 */
  var us=smenu.querySelectorAll('.ubtn');
  for(i=0;i<us.length;i++){
    us[i].classList.toggle('act',us[i].getAttribute('data-ui')===UI_MODE);
  }
  var tip=smenu.querySelector('#uitip');
  if(tip)tip.textContent=uiTouch()?('当前：触屏版（长按=右键 · 点选后可再点放置）'):('当前：电脑版');
}
/* ★R131-27：交互模式切换按钮 */
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
/* ★★R132-8：关设置时把问号气泡一并收掉 —— 气泡挂在 body（不是 .smenu 内），
 *  面板关了它还浮在屏幕上就成了孤儿（触屏路径尤其容易漏，因为它没有 mouseleave）。 */
function closeSettings(){
  smenu.classList.remove('on');smask.classList.remove('on');
  var pop=DD.getElementById('qpop');if(pop)pop.classList.remove('on');
  var qs=smenu.querySelectorAll('.qbtn');
  for(var qi=0;qi<qs.length;qi++)qs[qi].classList.remove('on');
}

// ★★R130 记录模式（用户原话：「在设置里面增加一个按钮，点击后进入记录模式，然后我开始复现，
//   软件也进行记录，复现完我让你去读相关记录的参数来判断」）
// 设计要点（每一条都是踩过或预防过的坑）：
//  · **逐帧全场快照**：每个 body 的位置/速度/角速度/角度/质量/是否固定/是否睡眠 + 有效 μ/e，
//    外加弹簧的长度/端点/ks、当前模式、GRAV、物理时间戳。物理量一律 *60 换成 px/s 与 rad/s
//    （MU-01），时间戳同时记墙钟与 `engine.timing.timestamp`（后者才是物理时间，§2 的老坑）。
//  · **环形缓冲 90 秒**：bug 一般发生在复现的**末尾**，所以满了就丢最旧的，而不是停止记录。
//  · **操作事件单独记**：pointerdown/up/move（节流 40ms）/右键菜单/滚轮/键盘/面板 input，
//    记下目标元素的 tag#id.class 与文字 ⇒ 事后能把「哪一帧的读数」和「用户按了什么」对上。
//  · **只读**：整个通道不写任何物理量，只是看 —— 记录模式不该改变被测行为。
//  · 导出 = Blob 下载 + 一份写进 localStorage（download 被浏览器挡住时还有退路）。
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
    /* ★★R131-47（自测发现的真因）：**杆（T）/铰链（S+hinge）没有 Matter 体（mb）**
     *  ⇒ 被这里的 `if(!mb)continue` 直接跳过 ⇒ 历次 REC 里**根本没有杆的记录**
     *  （我此前把原因归给"你没刷新页面"，是错的——是我的记录器漏了它们）。
     *  修：杆/铰链用**自身坐标**（B.x/B.y/B.th）记录，不受 mb 限制。 */
    var _isRod=!!(B&&(B.kind==='T'||(B.kind==='S'&&B.hinge)));
    /* ★R132-9ze：场源体 B/E/q/I **没有 Matter 体**（`stepPhysics` 把它们跳��、由场通道自己积分），
     *   原来这里 `if(!mb&&!_isRod)continue;` 把**整类静默跳过** ⇒ 录屏里从来看不见用户放在
     *   画布上的 q 场源体，几轮定位都被它骗了。现在：无 mb 的**场源体也要记**（用 B.x/B.y）。 */
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
    /* ★★R132-9zd（用户 2026-10-03 的录屏 `rec_2026-10-03-03-54-59.json` 让定位卡了两轮）：
     *   录屏里**只有体心 (x,y)、质量 m、形状标签 s**，**没有墨迹几何** ⇒ 我无法判断
     *   「落点到底在不在图形上」，只能反推 user's 意图（用户也强调「我并没有放偏」）。
     *   ⇒ 给 W 体补记**本地几何**：半宽/半高、点数、以及**降采样后的顶点串**（≤24 点）。
     *   有了 `pts` + `a`（角度）+ `x/y`，任何一次「把字母给谁」的复现都能在探针里
     *   **逐位重建**当时那个图形，不必再猜形状。 */
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
    /* ★★R131-43（用户：「杆链脱钩你不是有日志吗？把日志输出内容改多点不就行了」）：
     *  REC 里为**杆（T）与铰链（S+hinge）**补记诊断字段——长度/当前长度/两端锚定状态/
     *  两端锚定到的体序号/端点世界坐标/锚点本地偏移（脱钩时 ox,oy 或 anc 会立刻暴露）。 */
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
  // ★弹簧也在 `bodies` 里（kind==='S'）—— **没有**名为 springs 的全局数组。
  //   第一版写了 `typeof springs!=='undefined' && …` ⇒ 恒 false、把全部弹簧**静默**漏掉
  //   （守卫式访问在本项目反复成坑：符号不存在必须**大声**，不能悄悄跳过）。
  var sps=[];
  for(var q=0;q<bodies.length;q++){
    var S=bodies[q];
    if(!S||S.dead||S.kind!=='S'||!S.e0||!S.e1)continue;
    var _sp={i:q,ks:S.ks,len:+(S.len||0).toFixed(2),cur:+(S.cur||0).toFixed(2),
              th:(S.th==null?null:+(+S.th).toFixed(4)),
              dir:(S.dirLock&&S.dirLock.axis)?S.dirLock.axis:null,
              e0:[+S.e0.x.toFixed(1),+S.e0.y.toFixed(1)],
              e1:[+S.e1.x.toFixed(1),+S.e1.y.toFixed(1)]};
    /* ★★R131-64（补上一轮登记的**仪器缺口**）：原来只记 T（杆）与 S+hinge 的
     *  `anc/ancI/ox/oy` ⇒ **普通弹簧 / 轻绳的锚定关系在 REC 里完全不可见**。
     *  代价实测过：bug②「旋转弹簧时弹簧+方块一起抽搐飞出屏幕」三份录屏里，
     *  只能看到 e0/e1 的坐标，**无法判断哪一端锚在谁身上** ⇒ 只能靠几何反推。
     *  这里与杆同款补齐：锚定标志 / 锚到的体序号 / 锚点本地偏移 / 压缩状态量。 */
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
  /* ★★R131-50（自测发现：REC 里**完全没有自由字符**）：历次 REC 只有 bodies，而 a/t/v/q
   *  这类字符长期是**自由字符（freeL）** ⇒ 它们的消失/瞬移/抓不动全都"无据可查"。
   *  这里补记自由字符：字符、坐标、状态、速度、以及赋予型参数（便于定位相关 bug）。 */
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
// ★★R132-10n：把 payload 的构建从 recDump 里抽出来 —— 「提交到后端」也要用它，
//   但**不能**走 recDump（那个会触发下载）。两处共用同一个 recPayload()，口径不会分叉。
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
  /* ★★R132-10n（用户 2026-10-03）：「点击结束后，**不下载**那个文件，而是弹出提交框，
   *   编辑文字说明，提交就可以将 json 文件和文字说明一起提交到后端」。
   *   ⇒ 停止后走 openBugDlg()；下载降级为弹框里的「仅下载文件」备选。 */
  if(REC.on){recStop();openBugDlg();}else{recStart();}
});
window.REC=REC;window.recStart=recStart;window.recStop=recStop;window.recDump=recDump;
window.recPayload=recPayload;

/* ★★R132-10n：Bug 提交（弹框写说明 → POST 到后端）。
   端点契约：POST <BUG_ENDPOINT>，body = {"desc":"...","rec":{…录制 JSON…}}，
   返回 {"ok":true,"id":"..."} 或 {"ok":false,"err":"..."}。
   ★部署好 Cloudflare Worker 后，把它的地址填进 BUG_ENDPOINT（留空 = 只支持下载）。 */
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
  /* ★直接拼串而**不** JSON.parse 再 stringify —— 录制 JSON 可能有几 MB，
   *   double-encode 既浪费内存也白白放大体积。 */
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
/* ★R131-27b：触屏面板把手（点按展开/收起符号面板） */
if(DD.getElementById('panelToggle')){
  DD.getElementById('panelToggle').addEventListener('click',function(ev){
    ev.stopPropagation();
    DD.body.classList.toggle('touch-panel-folded');
    /* ★R131-29：图标用 .ttoggle 同款 SVG——展开/收起用旋转表达（不再换文字） */
    var sv=DD.getElementById('panelToggle');
    if(sv)sv.classList.toggle('open',!DD.body.classList.contains('touch-panel-folded'));
  });
}
applyUIModeClasses();
window.addEventListener('resize',function(){alignPanelToggle();});
/* ★★R132-8：全屏按钮 + 两个问号按钮的初始化。
 *  `fullscreenchange` 是**唯一**的真相来源（Esc / F11 / 浏览器 UI 退出都会走它），
 *  点击只是「请求」，外观由这条事件统一刷 —— 避免「按 Esc 退出后按钮还显示退出全屏」。 */
syncFullscreenUI();
['fullscreenchange','webkitfullscreenchange'].forEach(function(ev){
  DD.addEventListener(ev,function(){syncFullscreenUI();});
});
bindQBtn('qphys');
bindQBtn('quitipbtn');
/* 设置面板关闭 / 点遮罩 ⇒ 气泡一起收（它挂在 body 上，不跟着面板走） */
setTimeout(fixPanelSlot,600);
setTimeout(fixPanelSlot,1500);
/* ★R132-9t：设置面板每次打开都把**当前生效值**回填进输入框（localStorage 覆盖过默认值） */
smenu.addEventListener('click',function(e){
  e.stopPropagation();
  /* ★R131-27：交互模式按钮（自动/电脑版/触屏版） */
  var ub=e.target.closest('.ubtn');
  if(ub){setUIMode(ub.getAttribute('data-ui')||'auto');touchClearSel();syncModeUI();return;}
  var b=e.target.closest('.sbtn');if(!b)return;
  PHYS_MODE=b.getAttribute('data-mode');
  syncModeUI();
  // R74-D/J：切换模式后扫场上 W 体重刷 mb.restitution（effRest 读 PHYS_MODE）
  // R76：改成调 applyWFrict —— 高中模式的**默认 μ=0** 同样只是「读 PHYS_MODE 的显示值」，
  //   不主动扫一遍的话场上旧体的 mb.friction 还是 0.08（applyWFrict 内部会连带刷 effRest/air）。
  // R89（用户⑥）：**还必须**逐体调 applyWBounc —— 旧版只调 applyWFrict，e 链只被
  //   applyWFrict 的连带调用覆盖；applyWFrict 现在对未调过的体在大学模式也真写默认，
  //   但它**只管 μ 通道**；圆的 mb.restitution=BALL_REST 这类 e 默认必须 applyWBounc 亲自写
  //   （且 applyWBounc 内部带 parts/pair 刷新）。两个都调 = μ 与 e 两条链在切换时全部同源。
  for(var ji=0;ji<bodies.length;ji++){
    if(bodies[ji].kind!=='W')continue;
    applyWFrict(bodies[ji]);
    applyWBounc(bodies[ji]);
  }
  // ★R118（用户：「这个问题（大学摇晃 → 切高中）这样修吧，如果切换模式的话，就把转动量强制归零」）：
  //   切换模式的那一刻把场上所有**可动** W 体的角速度清零。
  //   为什么（_diag_r116i.py 实测）：大学摇晃攒下的 ω，切到高中后**没有任何衰减通道**
  //   （力矩通道被 springForceOn 的 px=null 掐掉 + 锚点被 _noRot 冻结 + 无空气阻力）
  //   ⇒ 方形带着切换时刻的 ω 永远匀速转下去（实测 Δθ=+200°、dEdge 漂移 17.3px）。
  //   切模式 = 换一套物理定律，旧模式攒下的自旋在新模式里没有合法语义 ⇒ 用户拍板归零。
  //   两个方向都清（uni→high / high→uni 同一个处理器）；静态体跳过（isStatic 的 ω 本就无意义）。
  for(var jw=0;jw<bodies.length;jw++){
    var BW2=bodies[jw];
    if(BW2.kind!=='W'||!BW2.mb||BW2.dead||BW2.mb.isStatic)continue;
    Matter.Body.setAngularVelocity(BW2.mb,0);
  }
  // R77（用户④ 配套）：切换模式后**按当前几何重算**所有弹簧锚点的本地偏移 —— 高中模式记的是
  //   「相对质心的世界分量」（不随自转），大学模式记的是「R(θ)·local」。就在此刻重算，新约定下
  //   算出来的偏移恰好让端点停在它现在所在的位置 ⇒ 切换瞬间零跳变，之后才按新约定跟随。
  //   漏了这一步的后果：球已经滚到某个角度时切模式，端点会按新约定突然跳到另一个位置。
  for(var js=0;js<bodies.length;js++){
    var S78=bodies[js];
    if(S78.kind!=='S'||S78.dead)continue;
    for(var je=0;je<2;je++){if(S78.anc[je]&&S78.anc[je].B)springAnchorOffset(S78,je);}
    // R83：切进高中模式时给**已有**弹簧补上自动轴锁，让「没有斜弹簧」立刻对全场生效。
    //   用**当前**方向而不是「吸到最近的轴」：吸附要把端点搬动最多 |垂向分量|（近 45° 时可到
    //   len/√2 ≈ 200px），画面上一根弹簧会突然跳位；而用户要的是「方向从此不再变化」，
    //   用当前方向同样满足，且零跳变。**新画**的弹簧仍走 makeSpring 的吸附路径。
    //   切回大学模式时把 auto 锁摘掉（手动「固定方向」的锁不摘 —— 那是用户显式设的）。
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
// R69（用户「一路过去的图形重复」）：双击进入连续绘制模式时弹提示，让用户有感知。
// 之前只有按钮角上一个细小的 ∞ 角标，绝大多数人看不到 —— 于是在连续模式里每次单击画布
// 都落一个默认图形、还不解除武装，一路点过去就叠成一串。提示条 2s 自动消失。
var _fhT=null;
function flashHint(msg){
  var el=document.getElementById('fhashint');
  if(!el)return;
  el.textContent=msg;
  el.classList.add('on');
  if(_fhT)clearTimeout(_fhT);
  _fhT=setTimeout(function(){el.classList.remove('on');},2000);
}
/* ★★R132-9（用户：「在放置处弹出一个 error 的错误提示（上浮显示，上浮消失，就好像一行
 *  代码划过一样）」）：**在 (x,y) 处**冒一行红字代码，上浮 + 横扫 + 淡出，1.9s 后自毁。
 *  · 为什么不用 `flashHint`：那是**屏幕底部居中**的固定条（同一时刻只能有一条），
 *    语义是「提示当前模式」；用户要的是**发生在落点上的错误**（位置会说话：错在哪里）。
 *  · 元素挂在 `<body>` 下（不是画布、不是面板）—— 画布是 canvas 画不出 DOM 文字，
 *    面板有 transform 会变成 fixed 后代的包含块（R132-8 踩过，见 `#qpop` 那条注释）。
 *  · `pointer-events:none`（CSS 里）⇒ 它浮在落点上也不会吃掉随后的手势。
 *  · 返回计数给守卫读（`window.__errTipN`），实现里不做任何"只有测试才走"的分支。 */
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
/* ★★R132-9：**光速 v 落到普通物体/公式上 ⇒ 拒绝赋予**。
 *  物理：有静止质量的物体不可能被加速到光速（相对论）—— 所以这次「赋予」被当成一次
 *  **运行时异常**抛出来：v 不并入、被弹开（走 bossRepel 同款手感），落点冒一行 error。
 *  ★只拦 `vLight`。普通 v（几 m/s）照旧走 giveFromLetter 赋予速度，一根毛都不动。
 *  ★调用点必须排在 `bossTryPlace` **之后** —— ½mv² 那条召唤通道要先有机会接住它。 */
function vLightReject(B,d){
  var x=(d&&d.wx!=null)?d.wx:((pointer&&pointer.x!=null)?pointer.x:(B?B.x:0));
  var y=(d&&d.wy!=null)?d.wy:((pointer&&pointer.y!=null)?pointer.y:(B?B.y:0));
  var ux=x-(B?B.x:0),uy=y-(B?B.y:0),L=Math.hypot(ux,uy);
  if(!(L>1)){ux=0;uy=-1;L=1;}
  ux/=L;uy/=L;
  /* 弹开：把这个 v 从物体上**推开**（与 bossRepel 同一套手感：一个初速度 + 略上抛） */
  d.state='free';d.cat=1;d.pop=1;d.massless=false;
  d.wx=x;d.wy=y;
  d.vx=ux*1500;d.vy=uy*1500-360;
  if(freeL.indexOf(d)<0)freeL.push(d);
  placeLetter(d);
  burstParticles(x,y,14,0.7);
  if(B)ringGo(B.x,B.y);
  shake(4,0.22);
  /* ★R132-9b（用户 2026-10-01：「落点也不需要冒红字 ▌ Error: 物体不能达到光速 c，
   *  只需要 Error 就行（对于上面文字的添加你不要自作主张）」）：
   *  ⇒ 文案**只有 `Error` 三个字母**，不加前缀竖条、不加原因、不加任何补充说明。
   *  **不要再自作主张往这里加文案。** */
  errTip(x,y,'Error');
  return true;
}
// R57（用户 #1）：单击 = 画一次；双击 = 连续；再单击 = 取消。供 brush / shape 两类按钮共用。
// key 标识「哪一个按钮」，mode 是要进入的工具模式，extra 交给调用方做下拉框等副作用。
function toolTap(key,mode,extra){
  var now=performance.now();
  if(TOOL.mode&&TOOL.armedKey===key){
    if(now-TOOL.lastTap<=TOOL_DBL_MS){
      TOOL.cont=true;   // 双击 -> 升级为连续绘制
      // R69：进连续模式立刻弹提示——之前只有按钮角上一个 ∞ 角标，用户毫无感知，
      // 一路单击画布就叠出一串重复图形（用户的 bug）。现在明确告诉「连续模式已开启」。
      // R96：器件是「点一下放一个」，没有「拖出尺寸」这一步，所以它的提示不能说「单击不落体」。
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
  // R96：器件按钮与器件 chip —— 与上面形状那两段逐条对应（行按钮高亮 + 选中的那一个 chip 高亮）。
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
    dSub.classList.remove('on');                       // R96：两行子面板互斥，不叠着开
  }
  else if(t==='device'){
    // R96：与形状行同构 —— 行按钮用自己的 key，展开自己那一行器件。
    toolTap('devrow:'+TOOL.device,'device');
    dSub.classList.toggle('on',TOOL.mode==='device');
    tSub.classList.remove('on');
  }
  else if(t==='fullscreen'){toggleFullscreen();}
});
/* ★★R132-8（用户 2026-10-01：「在左边下拉框里面设置按钮的右边增加一个按钮，进入全屏，
 *  点击后用来进入浏览器全屏显示的功能」）。
 *  用 Fullscreen API（`requestFullscreen` / `exitFullscreen`）。
 *  ★三处必须处理，否则在不同浏览器上会「点了没反应」：
 *   ① 前缀：Safari 老版本只有 `webkitRequestFullscreen`；用 `el.requestFullscreen||el.webkitRequestFullscreen`
 *      取**实际存在**的那个再调（直接调不存在的属性会抛 TypeError）。
 *   ② 返回值是 Promise：某些浏览器（新版 Chromium）**拒绝**时会抛未捕获异常（典型场景：不是
 *      用户手势、或 iframe 里没给 `allow="fullscreen"`）⇒ 必须 `.catch()` 吞掉，否则控制台报错。
 *   ③ 状态同步：全屏可以由 **Esc / F11 / 浏览器 UI** 退出，那不是我们点的 ⇒ 监听
 *      `fullscreenchange`（含 webkit 前缀）**反过来**刷新按钮外观，而不是只在点击时切。 */
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
/* 按钮外观 = 当前**真实**全屏态（四角外扩=进全屏 / 四角内收=退全屏） */
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
/* ★★R132-8：问号按钮的两条显示路径 —— 桌面 hover / 触屏 click（用户原话分得明白）。
 *  气泡定位用**按钮自身的 rect**（面板随屏幕高度居中，写死坐标在手机上必然错位）。 */
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
/* ---- ④ 器件行（R96）：从面板**拖出** / 点选 --------------------------------------------- */
// 同一个按钮上挂两种手势，靠「按下之后指针有没有动」区分（阈值 6px；finishShapeDrag 那个 12px
// 是「算不算拖出尺寸」，语义不同，别混用）：
//   · 没动   -> 交给 toolTap：单击武装 / 双击连续 / 再点取消（与画笔、预设物体同一套手感）
//   · 动了   -> 进入拖出：指针到哪，画布上就在哪画一个落点虚影（drawDeviceGhost），
//               在画布上松手 = 放下一个；丢回面板/菜单上 = 取消，什么都不生成。
// ★ 这里**不挂 click**：pointerdown 里做了 preventDefault 之后，部分浏览器不再派发兼容鼠标事件，
//   而「click + pointerup」两条路并存又会出现「点一下放两个」。状态机全部收在
//   pointerdown（这里）/ pointermove / pointerup（DD 上那两处）三处。
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
  // 「松手会不会放下」= 指针底下不是面板/菜单（这些浮层都盖在画布上）。用 elementFromPoint
  // 而不是「在不在某个矩形里」，正是 R60c 那条教训：透明容器照样挡事件，矩形判断会漏。
  var el=DD.elementFromPoint(d.x,d.y);
  d.over=!!el&&!el.closest('#tools,#pbox,#menu,#smenu,#fmenu');
}
function endDeviceOut(){
  var d=TOOL.devDrag;TOOL.devDrag=null;
  if(!d)return;
  if(!d.moved){deviceTap(d.id);return;}   // 没拖动 = 就是点了一下按钮
  if(!d.over)return;                      // 丢回面板/菜单 = 取消
  // R96：与「器件模式下点画布」走**同一条收尾**：放下一个就解除武装（除非双击进了连续模式）。
  // 少了这一句的后果实测过（_probe_r96.py C2）：从面板拖出一个之后仍然武装着，用户接着点一下
  // 画布想取消选择，却又落下第二个弹簧 —— 与 R57「单击画布 = 只放一次」的契约不一致。
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
  // R57（用户 #1）：单击画一次 / 双击连续 / 再单击取消。换成**另一个**形状则直接切过去。
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
