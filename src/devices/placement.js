/* 器件表、放置、从面板拖出、吸附提示与边中点磁吸 */
import Matter from 'matter-js';
import { BELT_SPAWN_LEN, BELT_TH, drawBeltBody, makeBelt } from '../bodies/belt.js';
import { drawRodPlank, makeRod, rodDragPinHosts, rodEndWorld, rodTryAnchor, setRodLen } from '../bodies/rod.js';
import { DD, bodies, dSub } from '../core/dom.js';
import { SPR_MID_ZONE, distToHost, hostCornerSnapPoint, hostMidSnapPoint } from './anchor.js';
import { GROUND_SPAWN_LEN, makeGround } from './ground.js';
import { drawHinge, makeHinge } from './hinge.js';
import { drawRope, makeRope } from './rope.js';
import { SPR_PAD, drawSpring, makeSpring, springMoveRig } from './spring.js';
import { grab } from '../input/pointer.js';
import { CONV_DEF } from '../params/defs.js';
import { ROD_SPAWN_LEN, ROPE_SPAWN_LEN, SPR_SPAWN_LEN } from '../params/panel.js';
import { cvx } from '../render/render.js';
import { ringGo } from '../ui/menu.js';
import { TOOL, setToolMode, toolTap } from '../ui/toolbar.js';

// 落点虚影的视觉垂度（px）：只喂给 drawRope 的第二个实参，不改 B.len、不改 makeRope。
// 放下后 B.len 严格等于跨度（ROPE_SPAWN_LEN），静置时绷直须画直线；虚影则额外加垂度，
// 走 drawRope 同一条下垂弧分支，与 chip 的波浪单线读起来是同一件东西。
// 取值注意：drawRope 用 quadraticCurveTo，控制点偏移 sag 的实际最大垂深只有 sag/2，
//   而 sag=min(slack·0.55,90) ⇒ 可见垂深 = slack·0.275。取 50 ⇒ 可见 13.75px（110px 弦的 12.5%）；
//   取 26 只有 7.15px（6.5%），看不出是绳。纯渲染参数。
export const ROPE_GHOST_SAG=50;
export let DEVICES;
export function deviceById(id){
  for(var i=0;i<DEVICES.length;i++)if(DEVICES[i].id===id)return DEVICES[i];
  return null;
}
// 唯一创建入口：面板拖出、器件模式点画布等所有入口都走这里，
// 保证「拖出来的」与「点出来的」逐字段相同。
export function placeDevice(id,cx,cy){
  var d=deviceById(id);
  if(!d)return null;
  var B=null;
  if(d.id==='spring'){
    var half=d.len/2;
    B=makeSpring(cx-half,cy,cx+half,cy);
  }else if(d.id==='rod'){
    // 轻质杆走同一个 makeRod（与 vt 拼接逐字段相同），长度以 DEVICES 表为准。
    // 改长度只走 setRodLen（只写 B.len/B.hw + refresh）。
    B=makeRod(cx,cy,0,0);
    if(B.len!==d.len)setRodLen(B,d.len);
  }else if(d.id==='belt'){
    // 传送带走 makeBelt。落点 = 质心（矩形以 cx,cy 为中心）。
    B=makeBelt(cx,cy);
  }else if(d.id==='ground'){
    // 落点 = 质心（矩形以 cx,cy 为中心），默认固定、默认水平
    B=makeGround(cx,cy,d.len);
  }else if(d.id==='hinge'){
    // 铰链的落点 = 销钉位置（两锚点都在这里，还没接任何东西）。
    B=makeHinge(cx,cy);
  }else if(d.id==='rope'){
    // 轻绳与弹簧同款 —— 以落点为中心水平摆开，长度取表（拖出来 == 参数面板里的值）。
    var rl=d.len/2;
    B=makeRope(cx-rl,cy,cx+rl,cy);
  }
  if(B){
    // 杆放下时立刻尝试连到附近物体；必须放在这个唯一创建入口里，面板拖出（endDeviceOut）与
    //   器件模式点画布（toolTap）两条入口才同时生效。springTryAnchorByHost 里的 rodTryAnchor 只处理
    //   「把物体拖到杆上」，反方向「把杆拖到物体上」需要这里扫杆自己的两个端点，否则永远连不上。
    //   弹簧/绳/铰链的落点锚定在 pointerup 的 'S' 分支（springTryAnchor）。
    if(d.id==='rod')rodTryAnchor(B);
    B.pop=1;B.orbPulse=1;ringGo(B.x,B.y);
  }   // 与 spawnWhole / copyBody 一致的落体动画
  return B;
}
// 面板拖出时跟随指针的落点虚影。不复制线圈几何：drawSpring 只读 B.e0 / B.e1 / B.len / B.anc，
// 喂一个桩对象即可画出相同线圈；anc=[null,null] ⇒ 两端不画锚点，即「还没接上」的模样。
// 同一份渲染代码保证「虚影所见 = 松手所得」。
export function drawDeviceGhost(id,cx,cy){
  var d=deviceById(id);
  if(!d)return;
  if(d.id==='spring'){
    var half=d.len/2;
    drawSpring({e0:{x:cx-half,y:cy},e1:{x:cx+half,y:cy},len:d.len,anc:[null,null]});
  }else if(d.id==='rod'){
    // 落点虚影 = drawRodPlank 喂桩对象（th=0 平放、len 取表），与 makeRod 造的杆同一份画线代码。
    drawRodPlank({x:cx,y:cy,th:0,len:d.len});
  }else if(d.id==='belt'){
    // 虚影 = drawBeltBody 喂桩对象（矩形框 + 会走的纹路），与 makeBelt 造出的带子同一套渲染。
    drawBeltBody({x:cx,y:cy,th:0,hw:d.len/2,hh:BELT_TH/2,conv:CONV_DEF,belt:true},false);
  }else if(d.id==='hinge'){
    // 虚影 = drawHinge 喂桩对象（同一份画线代码）。
    drawHinge({e0:{x:cx,y:cy},e1:{x:cx,y:cy},anc:[null,null]});
  }else if(d.id==='rope'){
    var rl2=d.len/2;
    // 虚影额外喂 ROPE_GHOST_SAG 垂度 ⇒ 画成弯曲的绳（与 chip 的波浪单线同义），而不是像杆的直线。
    //   落点、长度、锚点不变。
    drawRope({e0:{x:cx-rl2,y:cy},e1:{x:cx+rl2,y:cy},len:d.len,anc:[null,null]},ROPE_GHOST_SAG);
  }
}
// 吸附点标记（一个圈 + 一个圆心点），只在正在拖器件时出现；松手后它变成真正的锚点，标记自然消失。
// 配色用与墨色明显区分的砖红（#CE4A2C ≈ rgba(206,74,44)），表示「提示」而非实体。
export function drawSnapMarker(x,y){
  cvx.beginPath();cvx.arc(x,y,6,0,6.2832);
  cvx.strokeStyle='rgba(206,74,44,0.92)';cvx.lineWidth=1.6;cvx.stroke();
  cvx.beginPath();cvx.arc(x,y,1.9,0,6.2832);
  cvx.fillStyle='rgba(206,74,44,0.95)';cvx.fill();
}
// 器件落点虚影的两个端点（与 drawDeviceGhost 几何同源：同一张 DEVICES 表、同一个水平摆开规则）
export function devEndsLocal(id,cx,cy,len){
  if(id!=='spring'&&id!=='rope'&&id!=='rod')return null;   // 传送带/铰链没有可吸附的端点
  var h=(len||110)/2;
  return [{x:cx-h,y:cy},{x:cx+h,y:cy}];
}
/*
 * 吸附提示：把「将要连到哪里」提前画出来。覆盖器件正在被拖的两种情形：
 *   ① TOOL.devDrag（从面板拖出、还没放下）—— 用虚影端点；
 *   ② grab.kind==='body' 且抓的是器件（拖已存在的弹簧/杆）—— 用它真实的 e0/e1。
 * 候选判定与真正落锚共用同一份逻辑，「看见哪儿、就吸到哪儿」结构性成立。
 */
/* 「哪两端参与吸附提示」的唯一判定，标记与磁吸共用（各处各写一份会口径不一：
 * 轻绳不出标记、杆看见却不吸）。返回 {ends, anc, skip} 或 null。
 * hinge 排除：两锚点恒重合，且落锚要经 hingeSurfacePoint 挪到碰撞面上，
 * 标记点与最终锚点会差一个 BND_INK。 */
export function devSnapEnds(B){
  if(!B||B.dead)return null;
  if(B.kind==='S'&&!B.hinge&&B.e0&&B.e1)
    return {ends:[{x:B.e0.x,y:B.e0.y},{x:B.e1.x,y:B.e1.y}],anc:B.anc,skip:B,owner:B};
  if(B.kind==='T')
    return {ends:[rodEndWorld(B,0),rodEndWorld(B,1)],anc:B.anc,skip:B,owner:B};
  return null;
}
/* 拖动期的边中点磁吸位移。渐进拉法：位移 = 残差 × (1 − d/SPR_MID_ZONE)。
 *   d→0 时系数→1 ⇒ 收敛锁死（无需「吸住」状态，纯位置投影、幂等）；
 *   d=SPR_MID_ZONE 时系数=0 ⇒ 进入作用圈时连续、不瞬移（硬阈值会在边界跳变）。返回 {dx,dy,d} 或 null。 */
/* 统一吸附候选：质心 / 角 / 边中点，渐进拉法、作用于未锚定端、红点提示均与中点吸附相同。
 *   ① 质心（仅轻质杆 T；端点在质心带内 dc ≤ 0.7×半径）
 *   ② 角（独立铰链与杆都参与；hostCornerSnapPoint）
 *   ③ 边中点（杆参与；独立铰链不参与）
 * 角与边中点按「离端点更近」胜出，同距时才按「角 > 中点」定序。不要写成角短路：
 *   宿主 60×40 时角与边中点只相距 30px，而 CORNER_ZONE=26、SPR_MID_ZONE=30 作用圈必然重叠，
 *   拖到下边中点旁 6px 也会被判成角（端点停在离中点 10.8px 处）。
 * 质心带仍短路优先（插到中心就是要锚中心），它与角/中点几何上互斥。 */
export function snapPickCandidate(ex,ey,skip,B){
  var hit=null,bd=SPR_PAD,i,h,dd;
  for(i=0;i<bodies.length;i++){
    h=bodies[i];
    if(h.dead||h===skip||h.kind!=='W')continue;
    dd=distToHost(h,ex,ey);
    var _dc=Math.hypot(ex-h.x,ey-h.y);
    var _rad=(h.wshape==='circle'&&h.rad)?h.rad:Math.min(h.hw||30,h.hh||24);
    var inside=(_dc<_rad);
    if(dd<bd||inside){bd=inside?0:dd;hit=h;}
  }
  if(!hit)return null;
  var isRod=!!(B&&B.kind==='T');
  var isHinge=!!(B&&B.kind==='S'&&B.hinge);
  /* ① 质心（仅杆）—— 与 springAnchorOffset 的质心带同口径（0.7×半径）。保留短路：带内点离角
   * 必然 > 0.3×半径，短边宿主也不会与角/中点重叠。 */
  if(isRod){
    var _cr=(hit.wshape==='circle'&&hit.rad)?hit.rad:Math.min(hit.hw||30,hit.hh||24);
    if(Math.hypot(ex-hit.x,ey-hit.y)<=_cr*0.7)
      return {q:{x:hit.x,y:hit.y},hit:hit,d:Math.hypot(ex-hit.x,ey-hit.y)};
  }
  /* ② 角 与 ③ 边中点：各自算距离，最近的胜（角短路会在短边宿主上抢走中点）。
   * 独立铰链不参与边中点。 */
  var qc=hostCornerSnapPoint(hit,ex,ey);
  var qm=isHinge?null:hostMidSnapPoint(hit,ex,ey);
  if(qc&&qm){
    var dc=Math.hypot(ex-qc.x,ey-qc.y),dm=Math.hypot(ex-qm.x,ey-qm.y);
    /* 同距（含浮点几乎相等）时才让角优先。 */
    return (dc<=dm)?{q:qc,hit:hit,d:dc}:{q:qm,hit:hit,d:dm};
  }
  if(qc)return {q:qc,hit:hit,d:Math.hypot(ex-qc.x,ey-qc.y)};
  if(qm)return {q:qm,hit:hit,d:Math.hypot(ex-qm.x,ey-qm.y)};
  return null;
}
export function midMagnetDelta(ex,ey,skip,owner){
  var _ow=(owner!==undefined)?owner:(grab?grab.obj:null);
  var c=snapPickCandidate(ex,ey,skip,_ow);
  if(!c)return null;
  var dx=c.q.x-ex,dy=c.q.y-ey,d=Math.hypot(dx,dy);
  if(d<0.05)return null;
  var k=1-Math.min(1,d/SPR_MID_ZONE);
  if(k<=0)return null;
  return {dx:dx*k,dy:dy*k,d:d};
}
/* 对正被抓着的元件做磁吸（逐子步调用，见 stepMatter 子步循环）。
 * 杆：先搬杆自己 → 再 rodDragPinHosts 把已锚宿主钉回杆端（顺序不能反）；
 * S 族：交给 springMoveRig（搬两端 + 所有非铁砧宿主，并清速度 ⇒ 不攒松手弹飞的动能）。
 * 只搬自由端（已锚端位置由宿主决定，抢它就是过约束）。 */
export function midMagnetPullRig(B){
  if(!B||B.dead)return false;
  var ep=devSnapEnds(B);
  if(!ep)return false;
  for(var j=0;j<2;j++){
    if(ep.anc&&ep.anc[j])continue;
    var e=ep.ends[j];if(!e)continue;
    var m=midMagnetDelta(e.x,e.y,B,B);
    if(!m)continue;
    if(B.kind==='T'){
      B.x+=m.dx;B.y+=m.dy;
      rodDragPinHosts(B);
      if(B.mb){Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th||0);}
    }else{
      springMoveRig(B,m.dx,m.dy);
    }
    return true;
  }
  return false;
}
/* 对从面板拖出、还没放下的虚影做磁吸（同款判定、同款拉法）。
 * 虚影位置在 TOOL.devDrag.x/y —— 搬它，落点（placeDevice 用的坐标）自然吸到目标，与松手后的锚点一致。 */
export function midMagnetPullGhost(){
  if(!TOOL||!TOOL.devDrag||!TOOL.devDrag.moved||!TOOL.devDrag.id)
    return false;
  var d=deviceById(TOOL.devDrag.id);
  var ends=devEndsLocal(TOOL.devDrag.id,TOOL.devDrag.x,TOOL.devDrag.y,d?d.len:110);
  if(!ends)return false;
  /* 给候选一个器件身份（杆 = T、铰链 = S+hinge），否则统一候选拿不到类型，虚影磁吸失效。 */
  var _ghostOwner=(TOOL.devDrag.id==='rod')?{kind:'T'}:((TOOL.devDrag.id==='hinge')?{kind:'S',hinge:true}:null);
  for(var j=0;j<2;j++){
    var m=midMagnetDelta(ends[j].x,ends[j].y,null,_ghostOwner);
    if(!m)continue;
    TOOL.devDrag.x+=m.dx;TOOL.devDrag.y+=m.dy;
    return true;
  }
  return false;
}
export function drawDeviceSnapHints(){
  var pairs=[];
  if(TOOL&&TOOL.devDrag&&TOOL.devDrag.moved&&TOOL.devDrag.id){
    var d=deviceById(TOOL.devDrag.id);
    var ends=devEndsLocal(TOOL.devDrag.id,TOOL.devDrag.x,TOOL.devDrag.y,d?d.len:110);
    if(ends)pairs.push({ends:ends,anc:null});
  }else if(grab&&grab.kind==='body'&&grab.obj){
    // 用 devSnapEnds（与磁吸/落锚同一份判定）：绳的两端 e0/e1 与弹簧同构，同样参与提示。
    var pe=devSnapEnds(grab.obj);
    if(pe)pairs.push(pe);
  }
  for(var k=0;k<pairs.length;k++){
    var P=pairs[k];
    for(var j=0;j<2;j++){
      if(P.anc&&P.anc[j])continue;              // 这一端已经拴住了 ⇒ 不再提示
      var e=P.ends[j];if(!e)continue;
      /* 红点也走同一个统一候选（红点 = 将要吸附的位置，二者不分叉） */
      var c=snapPickCandidate(e.x,e.y,P.skip,(P&&P.owner)?P.owner:(grab?grab.obj:null));
      if(c)drawSnapMarker(c.q.x,c.q.y);
    }
  }
}
/* ---- ④ 器件行：从面板拖出 / 点选 --------------------------------------------- */
// 同一按钮挂两种手势，靠按下之后指针有没有动区分（阈值 6px；finishShapeDrag 的 12px 是
// 「算不算拖出尺寸」，语义不同，别混用）：
//   · 没动 -> 交给 toolTap：单击武装 / 双击连续 / 再点取消
//   · 动了 -> 拖出：画布上在指针处画落点虚影（drawDeviceGhost），在画布上松手 = 放下一个；丢回面板/菜单 = 取消。
// 这里不挂 click：pointerdown 里 preventDefault 后部分浏览器不再派发兼容鼠标事件，
// 而 click 与 pointerup 并存又会点一下放两个。状态机全部收在 pointerdown（这里）/ pointermove / pointerup（DD 上）三处。
export const DEV_PANEL_MIN=6;
export function startDeviceOut(e,btn){
  TOOL.devDrag={id:btn.getAttribute('data-device'),x:e.clientX,y:e.clientY,
                sx:e.clientX,sy:e.clientY,moved:false,over:false};
  // 捕获指针：拖出面板之后 pointerup 仍回到这里（鼠标本来也会冒泡到 DD，捕获只是更稳，
  // 且拖到窗口边缘松手也不会丢事件）。
  try{if(dSub.setPointerCapture)dSub.setPointerCapture(e.pointerId);}catch(_e){}
}
export function moveDeviceOut(e){
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
export function endDeviceOut(){
  var d=TOOL.devDrag;TOOL.devDrag=null;
  if(!d)return;
  if(!d.moved){deviceTap(d.id);return;}   // 没拖动 = 就是点了一下按钮
  if(!d.over)return;                      // 丢回面板/菜单 = 取消
  // 与「器件模式下点画布」同一条收尾：放下一个就解除武装（除非双击进了连续模式）。
  // 否则拖出一个后仍武装着，用户再点画布想取消却又落下一个，违反「单击画布 = 只放一次」。
  var B=placeDevice(d.id,d.x,d.y);
  if(B&&!TOOL.cont)setToolMode(null);
}
export function deviceTap(id){
  toolTap('device:'+id,'device',function(){TOOL.device=id;});
  syncDeviceSub();
}
// 器件行只在「器件模式武装中」展开（与形状行同一条规则，由 syncDeviceSub 单点控制）。
export function syncDeviceSub(){dSub.classList.toggle('on',TOOL.mode==='device');}

export function setupDevicesPlacement1(){
  DEVICES=[
    {id:'spring',name:'弹簧',len:SPR_SPAWN_LEN},
    {id:'rod',name:'轻质杆',len:ROD_SPAWN_LEN},
    {id:'belt',name:'传送带',len:BELT_SPAWN_LEN},
    {id:'ground',name:'地面/墙面',len:GROUND_SPAWN_LEN},
    {id:'hinge',name:'光滑铰链',len:0},
    {id:'rope',name:'轻绳',len:ROPE_SPAWN_LEN}
  ];
}

export function setupDevicesPlacement2(){
  dSub.addEventListener('pointerdown',function(e){
    if(e.button!==0)return;
    var b=e.target.closest('.tbtn');if(!b)return;
    e.preventDefault();e.stopPropagation();   // 画布与工具行都不该看到这一次按下
    startDeviceOut(e,b);
  });
}
