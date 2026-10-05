/* Bug 记录模式（逐帧快照 + 操作事件） */
import { rodEndWorld } from '../bodies/rod.js';
import { recbadge, recbtn, recnote } from '../core/dom.js';
import { bodies, freeL } from '../core/world.js';
import { SPR_DAMP, SPR_KS_DEF, SPR_K_MAX } from '../devices/spring.js';
import { GRAV, PX_PER_M, SPR_SPAWN_LEN } from '../params/defs.js';
import { wEffE, wEffMu } from '../physics/material.js';
import { BALL_REST, BND_INK, CIRCLE_SIDES, MW } from '../physics/matter.js';
import { H, W, groundY } from '../render/render.js';
import { openBugDlg } from './bug-report.js';
import { PHYS_MODE } from './settings.js';
import { TOOL } from './toolbar.js';

// 记录模式：从设置进入，复现问题时逐帧记录，事后读参数判断。
//  · 逐帧全场快照：每个 body 的位置/速度/角速度/角度/质量/是否固定/是否睡眠 + 有效 μ/e，外加弹簧的
//    长度/端点/ks、当前模式、GRAV、物理时间戳。物理量一律 *60 换成 px/s 与 rad/s；时间戳同时记墙钟与
//    engine.timing.timestamp（后者才是物理时间）。
//  · 环形缓冲 90 秒：bug 一般发生在复现末尾，满了丢最旧的而不是停止记录。
//  · 操作事件单独记：pointerdown/up/move（节流 40ms）/右键菜单/滚轮/键盘/面板 input，记下目标元素的
//    tag#id.class 与文字，事后能把读数与操作对上。
//  · 只读：不写任何物理量，记录不改变被测行为。
//  · 导出 = Blob 下载 + 一份写进 localStorage（下载被浏览器挡住时的退路）。
export const REC={on:false,t0:0,frames:[],events:[],raf:0,lastMove:0,tickUI:0};
export const REC_MAX=5400;                 // 90s @60fps
export const REC_EVMAX=4000;
export function recNow(){return +performance.now().toFixed(1);}
export function recSnap(){
  var f={t:+(recNow()-REC.t0).toFixed(1),mode:PHYS_MODE,
         g:GRAV};
  if(MW&&MW.engine)f.pt=+MW.engine.timing.timestamp.toFixed(1);
  f.tool=TOOL.mode+(TOOL.shape?('/'+TOOL.shape):'');
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
    o.mu=+wEffMu(B).toFixed(4);
    o.e=+wEffE(B).toFixed(4);
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
        var _e0=rodEndWorld(B,0);
        var _e1=rodEndWorld(B,1);
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
export function recTick(){
  if(!REC.on)return;
  REC.frames.push(recSnap());
  while(REC.frames.length>REC_MAX)REC.frames.shift();
  if(++REC.tickUI>=20){REC.tickUI=0;recUI();}
  REC.raf=requestAnimationFrame(recTick);
}
export function recEv(ty,e){
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
export function recH(ty,thr){
  return function(e){
    if(!REC.on)return;
    if(thr){var n=recNow();if(n-REC.lastMove<thr)return;REC.lastMove=n;}
    recEv(ty,e);
  };
}
export let REC_H;
export function recHook(on){
  for(var i=0;i<REC_H.length;i++){
    if(on)window.addEventListener(REC_H[i][0],REC_H[i][1],true);
    else window.removeEventListener(REC_H[i][0],REC_H[i][1],true);
  }
}
export function recUI(){
  if(recbtn){
    recbtn.classList.toggle('on',REC.on);
    recbtn.textContent=REC.on?('停止并导出（'+Math.round((recNow()-REC.t0)/1000)+'s / '
                               +REC.frames.length+'帧）'):'开始记录';
  }
  if(recbadge)recbadge.classList.toggle('on',REC.on);
}
export function recStart(){
  REC.on=true;REC.t0=recNow();REC.frames.length=0;REC.events.length=0;
  recHook(true);recEv('start',null);
  REC.raf=requestAnimationFrame(recTick);recUI();
  if(recnote)recnote.textContent='记录中……照常操作复现 bug，然后回到设置点「停止并导出」。'
                                +'（只保留最后 90 秒；右上角有红点提示）';
}
export function recStop(){
  REC.on=false;recHook(false);
  if(REC.raf)cancelAnimationFrame(REC.raf);
  REC.raf=0;recEv('stop',null);recUI();
}
// payload 构建与 recDump 分开：提交到后端也要用它，但不能走 recDump（会触发下载）。两处共用 recPayload()，口径不分叉。
export function recPayload(){
  var payload={v:1,kind:'sandbox-rec',savedAt:new Date().toISOString(),
    meta:{},frames:REC.frames,events:REC.events};
  payload.meta={W:W,H:H,groundY:groundY,PX_PER_M:PX_PER_M,GRAV:GRAV,PHYS_MODE:PHYS_MODE,SPR_KS_DEF:SPR_KS_DEF,
    SPR_K_MAX:SPR_K_MAX,SPR_DAMP:SPR_DAMP,SPR_SPAWN_LEN:SPR_SPAWN_LEN,BALL_REST:BALL_REST,CIRCLE_SIDES:CIRCLE_SIDES,BND_INK:BND_INK};
  return payload;
}
export function recDump(){
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

export function setupUiRecorder(){
  REC_H=[['pointerdown',recH('down',0),1],['pointerup',recH('up',0),1],
             ['pointermove',recH('move',40),1],['contextmenu',recH('menu',0),1],
             ['wheel',recH('wheel',0),1],['keydown',recH('key',0),1],
             ['input',recH('input',0),1],['change',recH('change',0),1]];
  if(recbtn)recbtn.addEventListener('click',function(){
    /* 停止录制后弹出提交框（openBugDlg）填写说明并提交到后端；下载降级为弹框里的「仅下载文件」备选。 */
    if(REC.on){recStop();openBugDlg();}else{recStart();}
  });
}
