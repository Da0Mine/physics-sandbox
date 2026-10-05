/* 轻质杆：几何、积分、锚点约束与拖拽 */
import Matter from 'matter-js';
import { BODY } from './body.js';
import { clamp, shortAng } from '../core/math.js';
import { bodies } from '../core/world.js';
import { distToHost, hostClosestPoint, hostCornerSnapPoint, hostMidSnapPoint } from '../devices/anchor.js';
import { hostIsAnvil, hostMovableByConstraint } from '../devices/constraint.js';
import { springAnchorOffset, springAnchoredWorld, springEnd, springHostPinnedByAnvil } from '../devices/spring.js';
import { grab } from '../input/pointer.js';
import { F } from '../letters/glyph.js';
import { refresh, slot } from '../letters/layout.js';
import { GRAV } from '../params/defs.js';
import { MW, ROD_SUB_DT } from '../physics/matter.js';
import { cvx } from '../render/render.js';
import { PHYS_MODE } from '../ui/settings.js';

export function makeRod(x,y,vx,vy){
  var B=BODY(x,y);
  B.kind='T';                                // t-rod: a solid draggable/rotatable plank, like the ground but movable
  B.fg=null;
  B.hasG=true;                               // weighs & falls to rest, like a real plank
  B.len=170;B.php=F*0.55;
  // 两端锚位，与弹簧同构（{B:host, ox, oy, _noRot} 由 springAnchorOffset/springAnchoredWorld 维护）。
  // null = 这一端没连上；无锚定时 rodSyncAnchors 第一行就早退。
  B.anc=[null,null];
  refresh(B);
  B.vx=vx||0;B.vy=vy||0;
  return B;
}
// 杆的质量：默认 1 kg（= 杆长 170px 的自然质量），面板 rodmass 可改。
// 手写通道的冲量份额与转动惯量 I=mL²/12 都用它。
export function rodMassOf(B){return (B&&B.rmass!=null)?B.rmass:((B&&B.len)?B.len/170:1);}
export function setRodLen(B,len){
  if(!B||B.kind!=='T')return;
  B.len=clamp(len,1,1e7);
  B._rodL=B.len;   // 目标长度的唯一真源（防棘轮）：只有有意改长度的入口写它
  B.hw=B.len/2+2;
  refresh(B);                                   // layoutField 的 T 分支重排 hw/hh
}
// 长度手柄专用：从两个端点摆一根杆（远端固定、拖拽端跟指针）。
// 与 setRodLen（质心不动、两端对称伸缩，供参数面板用）不同：这里中心与角度都随拖拽端移动。
export function setRodEnds(B,x0,y0,x1,y1){
  var dx=x1-x0,dy=y1-y0,d=Math.hypot(dx,dy)||1;
  d=clamp(d,1,1e7);
  B.x=(x0+x1)/2;B.y=(y0+y1)/2;B.th=Math.atan2(dy,dx);
  B.len=d;B.hw=d/2+2;refresh(B);
}
// 杆端点 i 的世界坐标（长度手柄定位 + 拖拽时取远端）
export function rodEndWorld(B,i){
  var tht=B.th||0,hl=(B.len||170)/2,s=(i?-1:1);
  return {x:B.x+s*Math.cos(tht)*hl,y:B.y+s*Math.sin(tht)*hl};
}
/* 端点「索引」↔ setRodEnds 入参「槽位」的唯一换算点。
 * setRodEnds(B, ax,ay, bx,by) 之后 rodEndWorld(B,0) === (bx,by)、rodEndWorld(B,1) === (ax,ay)，索引与槽位恒反：
 * setRodEnds 把 th 定成 slot0→slot1 方向，而 rodEndWorld(0) 取 +u 一侧，落在 slot1 上。
 * 有 per-end 状态 anc[i] 后，反着用会把锚点记到另一头（rodSyncAnchors 每帧对拉，最后塌成 len=1）。
 * ⇒ 凡按编号摆杆两端的地方一律走 rodPlaceEnds；setRodEnds 保持原语义，表达「哪一端被拖」的角色
 *   （slot0 = 钉死端、slot1 = 被拖端）。setBeltEnds 的长度 clamp 靠这个角色，带子无 per-end 状态，不要改它。 */
export function rodPlaceEnds(B,e0x,e0y,e1x,e1y){
  // 入参按索引：index0=(e0x,e0y)、index1=(e1x,e1y)；内部换成槽位序
  return setRodEnds(B,e1x,e1y,e0x,e0y);
}
// 长度手柄被拖时的两端（按索引）：被拖的是 grab.end，另一端钉在按下那刻锁存的 (fx,fy)。
export function rodDragEnds(B,g,px,py){
  var r=rodPlaceEnds(B, g.end?g.fx:px, g.end?g.fy:py, g.end?px:g.fx, g.end?py:g.fy);
  B._rodL=B.len;                    // 拖长度手柄 = 有意改长度
  return r;
}
// 长度手柄按住期间，这根杆的位姿归指针，与 kind==='body' 被抓住同一冻结语义。
// 单独一个谓词，供 6 处「被抓住就跳过」的门共用（漏一处就是拖长度时杆自己往下掉/被弹开）。
export function rodLenFrozen(B){
  return !!(B&&grab&&grab.kind==='rodlen'&&grab.obj===B);
}
export function tAnchor(B){
  if(B.kind)return {x:B.x,y:B.y};
  return B.massG?slot(B,B.massG):{x:B.x,y:B.y};
}
// 杆端吸附半径，与 SPR_PAD(=15) 同值。⚠ 不要命名为 ROD_PAD：文件后面已有全局 var ROD_PAD=0.5
//   （笔迹外扩余量，inkPieces/inset 在用），同作用域后写者生效 ⇒ 吸附半径变成 0.5px、杆永远连不上，且不报错。
//   新增全局常量前先 grep 同名。
export const ROD_SNAP=15;
// 双端刚性连杆每子步纠正量上限（px）。一次性把宿主瞬移几百 px 会撞穿墙/地板（Matter 的位置写入
//   不做连续碰撞检测）；封顶后剩余误差下一子步继续收 —— 240Hz 下 12px/子步 = 2880px/s，仍是「立刻绷紧」。
export const ROD_PULL_MAX=12;
export const ROD_PULL_ITERS=6;                    // 同一子步内纠正的迭代次数（每次重取锚点、各自封顶 ROD_PULL_MAX）⇒ 72px/帧收敛力。
                                         //   快拖时指针约 2000px/s=33px/帧，单次 12px/帧追不上。
export const ROD_ROT_MAX=0.02;                    // 单次迭代宿主旋转纠正上限（rad）。旋转纠正与
/* 每个宿主每子步的杆修正总预算 ROD_PULL_MAX：同一子步里一个宿主可能被好几根杆各修正一次，
 *  修正量叠加（每根最多 12px）⇒ Gauss-Seidel 迭代相互放大 ⇒ 装配发散飞出。
 *  多杆按先到先得分配，超出即按比例缩减；单杆行为不变。 */
export function rodPbdRemain(h){
  if(!h||!h.mb)return ROD_PULL_MAX;
  var _ts=(MW&&MW.engine)?MW.engine.timing.timestamp:0;
  if(h._pbdTs!==_ts){h._pbdTs=_ts;h._pbdAcc=0;}
  return Math.max(0,ROD_PULL_MAX-h._pbdAcc);
}
export function rodPbdAdd(h,amt){
  if(!h)return;
  var _ts=(MW&&MW.engine)?MW.engine.timing.timestamp:0;
  if(h._pbdTs!==_ts){h._pbdTs=_ts;h._pbdAcc=0;}
  h._pbdAcc+=amt;
}
/* ---- 轻质杆的两端连接（复用弹簧的锚定合约）--------------------------------
 * 存储/偏移量纲/旋转语义全部走上面两个既有函数：B.anc[i]={B:host,ox,oy,_noRot}；端点取法按元件分派（anyEndPoint）。
 * 已锚定的端由宿主位姿决定，另一端自由 ⇒
 *   · 单端锚定 = 绕该点的摆（光滑铰链的最小形态）；
 *   · 双端锚定 = 两宿主之间的刚性连杆。
 * 已知限制：杆端锚定是位置驱动的，不把宿主的受力反算回来 —— 把杆挂在墙上可以，用杆去撬很重的物体不行；
 *   真正的双向约束需要独立求解器。
 * 两个 anc 都是 null 时第一行就返回 false。 */
export function rodSyncAnchors(B,dt){
  if(!B||B.kind!=='T'||!B.anc)return false;
  if(!B.anc[0]&&!B.anc[1])return false;
  /* 杆的连接语义：连接点相对物体表面不动，杆可绕连接点自由旋转。
   *  = 材料点锚定（本地系钉死，随宿主位姿）+ 宿主角度锁死（_rodLK ⇒ 材料点方位恒定）+ 杆自身自由旋转
   *  （PBD 旋转修正）+ 杆-杆销接（杆宿主不打锁）+ 杆无碰撞箱。 */

  // 杆自身被拖（左键抓杆身 grab.kind='body' / 长度手柄 'rodlen'）⇒ 位姿归指针，本函数整步让路，
  //   否则下面的姿态更新会和拖杆处理器互相改写（杆被拽回锚点、拖不动）。
  if(grab&&grab.obj===B&&(grab.kind==='body'||grab.kind==='rodlen'))return false;
  var w=[null,null],n=0,i;
  for(i=0;i<2;i++){
    var a=B.anc[i];if(!a)continue;
    if(!a.B||a.B.dead||bodies.indexOf(a.B)<0){B.anc[i]=null;continue;}   // 宿主没了 → 这一端自动自由
    w[i]=springAnchoredWorld(B,i);
    if(w[i])n++;
  }
  if(!n)return false;
  // ---- 双端拴住 = 两宿主之间的刚性连杆（长度守恒，不跟锚点走）----------
  // 不要把杆长反算成两锚点距离（rodPlaceEnds/setRodEnds 会写 B.len=d）：杆会退化成橡皮筋，
  //   重物一挂就悄悄变长（锚点残差恒为 0，看不出脱钩）。
  // 语义：|e1−e0| ≡ 杆长。两锚点距离 ≠ 杆长时搬可搬动的宿主去满足它：
  //   · 纠正量按 1/m 分配，铁砧端不动；
  //   · 再把两端沿轴的相对速度投影掉 —— 否则重力每子步攒一点轴向速度、PBD 又吃掉位移 ⇒ 速度无界增长，
  //     一解除锚定就弹飞；
  //   · hostMovableByConstraint 只对 W 体开（非 W 的位姿归 Matter，写了会被覆盖）；
  //   · 每子步纠正量封顶 ROD_PULL_MAX，免得瞬移把宿主撞穿墙；
  //   · 两端都搬不动（两个铁砧）时配置本身过约束，几何服从锚点。
  if(n===2){
    var h0=B.anc[0]?B.anc[0].B:null,h1=B.anc[1]?B.anc[1].B:null;
    /* 目标长度必须取 B._rodL（有意设定的长度），不能取 B.len：B.len 会被改写成当前锚距，而纠正量有封顶，
     *   快拖一次大跳只能还掉一部分，len 被写成「Lr+剩余」后下一子步 err=0、纠正不再运行 ⇒ 杆只长不缩（棘轮）。
     *   _rodL 只在「有意改长度」四处写入：makeRod 初值 / setRodLen（面板）/ rodDragEnds（长度手柄）/
     *   rodTryAnchor（落点吸附）。这里（跟锚点走）绝不写它。 */
    if(B._rodL==null||!(B._rodL>0))B._rodL=B.len||170;
    var Lr=B._rodL;
    /* 不要挂 Matter 原生 Constraint：W 体位姿由产品每帧摆放（见 hostMovableByConstraint），Matter 约束的修正
     *   会被下一帧覆盖 ⇒ 正反馈发散。因此用自研 PBD：
     *   A 姿态：杆统一走纯姿态可视化 —— 中心=锚点中点、方向=W1→W0（与 setRodEnds 同惯例）、len 恒 = _rodL。
     *     锚距≠Lr 时杆端与锚点之间如实留缺口，由下面的纠正收回，杆永远画成刚体。
     *   B 收敛：同子步内迭代 ROD_PULL_ITERS 次（每次重取锚点、各自封顶 12px）⇒ 72px/帧收敛力，
     *     单次 12px/帧追不上快拖（约 33px/帧）。 */
    function _im(h){                                   // 可搬动 ⇒ 1/m；搬不动 ⇒ 0
      /* 正被拖的宿主不参与 1/m 分配（当铁砧）：它的位姿归指针，下一帧会被整份覆盖，分给它的纠正白做、
       *   收敛速度减半。与 conDragConstrain 的分配规则一致。 */
      if(grab&&grab.kind==='body'&&grab.obj===h)return 0;
      if(!hostMovableByConstraint(h)||!h.mb)return 0;
      var m=h.mb.mass;
      return (m>0&&isFinite(m))?(1/m):0;
    }
    /* 位置相位是平动+旋转的刚体点距约束（b2DistanceJoint 同款雅可比）。锚点随宿主转，若只做平动修正，
     *   宿主一转（落地、甩动、滚转）锚点就绕质心甩，残差永远追不平（杆与体脱钩）且每子步泵进能量（抖动）。
     *     C=|p1−p0|−L，p_i=x_i+R(th_i)·r_i，r_iw=p_i−center_i（世界系）
     *     ∂C/∂x_i=∓u；∂C/∂th_i=∓(u×r_iw)
     *     K=Σ im_i + Σ iI_i·j_i²（j_i=u×r_iw）；λ=err/K
     *     Δx0=+u·λ·im0、Δx1=−u·λ·im1、Δth0=−iI0·j0·λ、Δth1=+iI1·j1·λ
     *   速度相位在接触场景保持纯平动投影：含 ω 冲量的版本在落地接触处正反馈（速度冲到 1.4e4px/s）。 */
    function _iI(h){                                   // 转动自由度的广义逆质量；搬不动/被抓 ⇒ 0
      if(grab&&grab.kind==='body'&&grab.obj===h)return 0;
      if(!hostMovableByConstraint(h)||!h.mb)return 0;
      var I=h.mb.inertia;
      return (I>0&&isFinite(I))?(1/I):0;
    }
    var im0=_im(h0),im1=_im(h1),iI0=_iI(h0),iI1=_iI(h1);
    if(im0+im1+iI0+iI1>1e-9){
      /* 本函数在 Engine.update 之前跑，h.x/h.y/h.th 还是上一子步的旧值（Matter 已积分到新位姿，产品字段帧末才回写）。
       *   按旧位姿算再用 setPosition/setAngle 绝对回写，等于每子步把角度倒回旧值而 ω 继续涨 ⇒ 落地滚动时正反馈爆炸。
       *   所以解算前先从 mb 同步一次新位姿（被抓宿主除外：它的位姿归指针，本来就是新值）。 */
      if(h0&&h0.mb&&!(grab&&grab.kind==='body'&&grab.obj===h0)){
        h0.x=h0.mb.position.x;h0.y=h0.mb.position.y;h0.th=h0.mb.angle;}
      if(h1&&h1.mb&&!(grab&&grab.kind==='body'&&grab.obj===h1)){
        h1.x=h1.mb.position.x;h1.y=h1.mb.position.y;h1.th=h1.mb.angle;}
      /* XPBD 速度重建的快照（防止杆摆越摆越低）：位置相位的 setPosition/setAngle 是纯瞬移，约束功不进速度账；
       *  速度相位清锚点径向速度时会对本子步重力刚注入的径向分量做负功 ⇒ 30° 释放 8s 衰减 99.9%。
       *  两相位都不能单独禁掉（会爆/坍）。做法：子步起始在此快照，Engine.update 之后用
       *  「完整子步位移（修正+积分）/dt」反推速度（rodXPBDVel），切向动能完整保留、与重力功自洽。
       *  不要只补 ω 不补 v（长杆静置自爬），也不要用 v+=修正量/dt（会被速度相位清掉，无效）。
       *  快照只在 dt>0（正常子步）记；static/被抓宿主不记（位姿不归约束）。 */
      var _touching=function(mb){                          // 该 mb 是否处于任何活动接触对中
        if(!mb)return true;                                // 拿不准按有接触（保守 ⇒ 纯平动）
        var pl=(MW&&MW.engine)?MW.engine.pairs.list:null;
        if(!pl)return true;
        for(var i=0;i<pl.length;i++){var pp=pl[i];
          if(pp.isActive&&(pp.bodyA===mb||pp.bodyB===mb))return true;}
        return false;};
      var _free=!_touching(h0&&h0.mb)&&!_touching(h1&&h1.mb);   // 两端都悬空 ⇒ 允许 ω 模
      /* 松手冷却 80 子步（20 帧）：松手瞬间的回弹修正会被速度重建误读成速度而反向飞出，冷却期内不重建。 */
      if(grab&&grab.kind==='body')B._grabCool=80;
      else if(B._grabCool>0)B._grabCool--;
      if(dt>0&&_free&&!(grab&&grab.kind==='body')&&!(B._grabCool>0)){
        /* 抓着任何 body 时整帧不重建：conDragConstrain/rodDragPinHosts 会把装配另一端逐子步重钉到杆端，
         *  重钉位移不是物理速度，被误读会把摆锤甩飞。 */
        /* 只对简单体（parts==1）宿主记快照：复合体（墨迹链）上 Engine 角度积分与位置相位 setAngle 的口径差
         *  会让重建系统性注能（实测拖拽松手爆到 17263px/s），复合体完全豁免。 */
        B._xps=[];
        B._xpsFree=true;
        if(h0&&h0.mb&&!h0.mb.isStatic&&h0.mb.parts.length===1&&!(grab&&grab.kind==='body'&&grab.obj===h0))
          B._xps.push([h0,h0.mb.position.x,h0.mb.position.y,h0.mb.angle]);
        if(h1&&h1.mb&&!h1.mb.isStatic&&h1.mb.parts.length===1&&!(grab&&grab.kind==='body'&&grab.obj===h1))
          B._xps.push([h1,h1.mb.position.x,h1.mb.position.y,h1.mb.angle]);
      }
      for(var it=0;it<ROD_PULL_ITERS;it++){
        var p0=springAnchoredWorld(B,0),p1=springAnchoredWorld(B,1);
        var ax=p1.x-p0.x,ay=p1.y-p0.y,ad=Math.hypot(ax,ay)||1e-6;
        var ux=ax/ad,uy=ay/ad,err=ad-Lr;
        if(Math.abs(err)<=0.05)break;
        var j0=0,j1=0,r0l=1,r1l=1;
        /* 高中模式圆 = 质点（circleRollStep 强制 ω≡0），不许用 setAngle 绕过它去转圆 ⇒ 高中圆宿主 j=0；
         *   多边形和大学模式全形状照常参与旋转修正。 */
        var _hsC0=(PHYS_MODE==='high'&&h0&&h0.wshape==='circle'),
            _hsC1=(PHYS_MODE==='high'&&h1&&h1.wshape==='circle');
        /* 角度锁死的宿主（_rodLK）不参与旋转修正 */
        if(h0&&h0._rodLK)_hsC0=true;
        if(h1&&h1._rodLK)_hsC1=true;
        if(h0&&h0.mb){var r0x=p0.x-h0.x,r0y=p0.y-h0.y;r0l=Math.max(1,Math.hypot(r0x,r0y));
          if(!_hsC0)j0=ux*r0y-uy*r0x;}
        if(h1&&h1.mb){var r1x=p1.x-h1.x,r1y=p1.y-h1.y;r1l=Math.max(1,Math.hypot(r1x,r1y));
          if(!_hsC1)j1=ux*r1y-uy*r1x;}
        var K=im0+im1+iI0*j0*j0+iI1*j1*j1;
        if(!(K>1e-9))break;
        var lam=err/K;
        var c0=lam*im0,c1=lam*im1;
        var _cap=(PHYS_MODE==='high')?4:ROD_PULL_MAX;
        if(Math.abs(c0)>_cap)c0=(c0>0?1:-1)*_cap;
        if(Math.abs(c1)>_cap)c1=(c1>0?1:-1)*_cap;
        var w0=(iI0>0&&j0)?(-iI0*j0*lam):0,w1=(iI1>0&&j1)?(iI1*j1*lam):0;
        // 旋转分量封顶：|Δth| ≤ ROD_ROT_MAX（保险丝）且锚点位移 ≤ ROD_PULL_MAX（与平移同口径）
        if(w0){if(Math.abs(w0)>ROD_ROT_MAX)w0=(w0>0?1:-1)*ROD_ROT_MAX;
          if(Math.abs(w0)*r0l>ROD_PULL_MAX)w0=(w0>0?1:-1)*ROD_PULL_MAX/r0l;}
        if(w1){if(Math.abs(w1)>ROD_ROT_MAX)w1=(w1>0?1:-1)*ROD_ROT_MAX;
          if(Math.abs(w1)*r1l>ROD_PULL_MAX)w1=(w1>0?1:-1)*ROD_PULL_MAX/r1l;}
        if((c0||w0)&&h0){
          if(grab&&grab.kind==='body'&&(grab.obj===h0||grab.obj===h1)&&!(grab.obj===h0)){   // h1 正被拖 ⇒ h0 只留缓慢牵引（理由见 h1 分支）
            var _cap0=0.5;
            if(Math.abs(c0)>_cap0)c0=(c0>0?1:-1)*_cap0;
            if(w0)w0*=0.15;
          }
          /* 不要把 w0 清零（与 h1 侧对称）：旋转修正是位置约束 C=|p1−p0|−L 的组成部分（∂C/∂θ_i=±(u×r_iw)），
           *  砍掉它 ⇒ 位置误差全压给平移 ⇒ 大偏差时 λ 被 _cap 截断 ⇒ 非保守修正 ⇒ 泵能。 */
          if(h0&&h0.mb&&h0.kind==='W'&&!h0.mb.isStatic){   // 锚定 W 体单步位置修正上限 0.45px/子步（理由见 h1 分支）
            var _c0max=0.45;if(c0>_c0max)c0=_c0max;if(c0<-_c0max)c0=-_c0max;
          }
          var am0=Math.hypot(c0,(w0||0)*r0l),rem0=rodPbdRemain(h0);   // 每宿主每子步修正总预算（rodPbdRemain）
          if(am0>rem0&&am0>1e-9){var kk0=rem0/am0;c0*=kk0;if(w0)w0*=kk0;am0=rem0;}
          rodPbdAdd(h0,am0);
          h0.x+=ux*c0;h0.y+=uy*c0;if(w0)h0.th=(h0.th||0)+w0;
          if(h0.mb&&MW){Matter.Body.setPosition(h0.mb,{x:h0.x,y:h0.y});
            if(w0)Matter.Body.setAngle(h0.mb,h0.th);
            Matter.Sleeping.set(h0.mb,false);}}
        if((c1||w1)&&h1){
          /* 一端宿主正被指针拖 ⇒ 另一端不再被位置相位硬搬（只留 ≤0.5px/子步的缓慢牵引），让重力主导：
           *  拖墙时被吊物体绕锚点摆，而不是被瞬间拖到杆端上方倒悬。 */
          if(grab&&grab.kind==='body'&&(grab.obj===h0||grab.obj===h1)&&!(grab.obj===h1)){
            var _cap1=0.5;
            if(Math.abs(c1)>_cap1)c1=(c1>0?1:-1)*_cap1;
            if(w1)w1*=0.15;
          }
          /* 不要把 w1 清零：旋转是位置约束的一部分（p_i=x_i+R(θ_i)·r_i ⇒ ∂C/∂θ_i 必须参与），否则位置误差全压给平移
           *  ⇒ 大偏差时 λ 被 _cap 截断 ⇒ 非保守修正 ⇒ 系统凭空获得动能。PBD 旋转相位本身就能给出正确的复摆动力学。
           *  双摆 600 帧实测（总能量正漂）：w1=0 + rodHingeTorque 为 +1.14 且翻圈；不清零、停用力矩为 +0.0002，
           *  姿态正确（受力侧下沉）；真复摆 30° 释放单调收敛到竖直。 */
          /* 锚定 W 体的单步位置修正上限 0.45px/子步：位置相位把物体搬运到杆端是非物理通道，搬太快会凭空抬高物体、
           *  注入能量（松手后能量暴涨数倍）。 */
          if(h1&&h1.mb&&h1.kind==='W'&&!h1.mb.isStatic){
            var _c1max=0.45;if(c1>_c1max)c1=_c1max;if(c1<-_c1max)c1=-_c1max;
          }
          var am1=Math.hypot(c1,(w1||0)*r1l),rem1=rodPbdRemain(h1);   // 每宿主每子步修正总预算（rodPbdRemain）
          if(am1>rem1&&am1>1e-9){var kk1=rem1/am1;c1*=kk1;if(w1)w1*=kk1;am1=rem1;}
          rodPbdAdd(h1,am1);
          h1.x-=ux*c1;h1.y-=uy*c1;if(w1)h1.th=(h1.th||0)+w1;
          if(h1.mb&&MW){Matter.Body.setPosition(h1.mb,{x:h1.x,y:h1.y});
            if(w1)Matter.Body.setAngle(h1.mb,h1.th);
            Matter.Sleeping.set(h1.mb,false);}}
      }
      /* 不要在这里加「速度继承 v+=Δx/dt」：实测无效且有害 ——
       *   ① 位置相位 err≤0.05 早退时继承量趋零；② 真有修正量时，沿杆方向的速度分量会被下方轴向相对速度投影正确砍掉；
       *   ③ 快拖时修正封顶 12px ⇒ 继承速度可达 2880px/s，给松手弹射新开一条注能路径。 */
      var p0=springAnchoredWorld(B,0),p1=springAnchoredWorld(B,1);
      var ax=p1.x-p0.x,ay=p1.y-p0.y,ad=Math.hypot(ax,ay)||1e-6;
      var ux=ax/ad,uy=ay/ad;
      // 轴向相对速度投影：Ċ=0，按 1/m 分配回两端（PBD 的标准收尾，跑一次）。双模门控：
      //   · 两端宿主均无活动接触（自由摆动/悬空）⇒ Ċ 计入锚点的 ω×r（见下）。只用纯平动时，杆力作用在偏离质心
      //     的锚点上使宿主自转、而速度相位不管 ω ⇒ 自由摆越荡越高直到翻顶（能量泵）。
      //   · 任一端有接触 ⇒ 纯平动投影：接触场景带 ω×r 耦合会在落地处正反馈（速度冲到 1.4e4 px/s）。
      //   高中圆宿主 ω≡0 ⇒ j=0，自动退化为纯平动。
      var p0=springAnchoredWorld(B,0),p1=springAnchoredWorld(B,1);
      var ax=p1.x-p0.x,ay=p1.y-p0.y,ad=Math.hypot(ax,ay)||1e-6;
      var ux=ax/ad,uy=ay/ad;
      var v0x=h0?(h0.mb?h0.mb.velocity.x*60:(h0.vx||0)):0;
      var v0y=h0?(h0.mb?h0.mb.velocity.y*60:(h0.vy||0)):0;
      var v1x=h1?(h1.mb?h1.mb.velocity.x*60:(h1.vx||0)):0;
      var v1y=h1?(h1.mb?h1.mb.velocity.y*60:(h1.vy||0)):0;
      var vr=(v1x-v0x)*ux+(v1y-v0y)*uy;
      var _hsV0=(PHYS_MODE==='high'&&h0&&h0.wshape==='circle'), // 高中圆 ω≡0（同位置相位的质点门）
          _hsV1=(PHYS_MODE==='high'&&h1&&h1.wshape==='circle');
      if(_free&&(iI0>0||iI1>0)){
        /* 自由摆分支：Ċ 用锚点真实速度（含宿主自转贡献 ω×r），冲量只走平动 ——
         *   Ċ=u·v1−u·v0−ω1·j1+ω0·j0（2D：u·(ω×r)=−ω·j，j=ux·ry−uy·rx）
         *   K=im0+im1+iI0·j0²+iI1·j1²；λ=−Ċ/K；v0 += −u·λ·im0、v1 += +u·λ·im1。
         *   不要把 ω 写回（setAngularVelocity，b2DistanceJoint 全套）：它与位置相位每子步的 Δth 瞬移打架，泵得更猛；
         *   只把 ω 计入 Ċ、冲量只给平动时摆动有界。旋转速度误差留给位置相位收敛。
         *   j=0（高中圆/锚点共线）时退化为纯平动版。 */
        var om0=h0&&h0.mb?h0.mb.angularVelocity*60:0,     // 属性×60 = rad/s
            om1=h1&&h1.mb?h1.mb.angularVelocity*60:0;
        var jv0=0,jv1=0;
        if(h0&&h0.mb&&!_hsV0){var r0vx=p0.x-h0.x,r0vy=p0.y-h0.y;jv0=ux*r0vy-uy*r0vx;}
        if(h1&&h1.mb&&!_hsV1){var r1vx=p1.x-h1.x,r1vy=p1.y-h1.y;jv1=ux*r1vy-uy*r1vx;}
        var cd=vr-om1*jv1+om0*jv0;                        // = Ċ（混合量纲，只作比值用）
        var Kv=im0+im1+iI0*jv0*jv0+iI1*jv1*jv1;
        if(Kv>1e-9){
          var lv=-cd/Kv;
          if(im0>0&&h0&&h0.mb)Matter.Body.setVelocity(h0.mb,{x:(v0x-ux*lv*im0)/60,y:(v0y-uy*lv*im0)/60});
          if(im1>0&&h1&&h1.mb)Matter.Body.setVelocity(h1.mb,{x:(v1x+ux*lv*im1)/60,y:(v1y+uy*lv*im1)/60});
        }
      }else if(vr){
        /* 有接触：纯平动投影 */
        var tt=im0+im1;
        if(tt>1e-9){
          if(im0>0&&h0&&h0.mb)Matter.Body.setVelocity(h0.mb,{x:(v0x+ux*vr*im0/tt)/60,y:(v0y+uy*vr*im0/tt)/60});
          if(im1>0&&h1&&h1.mb)Matter.Body.setVelocity(h1.mb,{x:(v1x-ux*vr*im1/tt)/60,y:(v1y-uy*vr*im1/tt)/60});
        }
      }
    }
    // 姿态可视化（统一路径，tt>0 / tt=0 都走这里）：只摆姿态、绝不写 len
    // （轻质杆不可伸长，锚距≠Lr 的缺口如实保留）
    var p0=springAnchoredWorld(B,0),p1=springAnchoredWorld(B,1);
    B.x=(p0.x+p1.x)/2;B.y=(p0.y+p1.y)/2;
    /* th 连续化（禁止 atan2 的 ±π 跳变）：th 是累积角，跳变 ~2π 会被当成一次真实转动。 */
    B.th=(B.th||0)+shortAng(Math.atan2(p0.y-p1.y,p0.x-p1.x)-(B.th||0));
    B.len=Lr;B.hw=Lr/2+2;
    return true;
  }
  // ---- 单端拴住 = 绕该点的铰链（光滑铰链的最小形态）-----------
  // 必须绕锚点转，不能只把锚端平移回去：平移版保持自由端不动，两端距离每子步被重力拉长且从不回缩（杆自己变长）。
  // 绕锚点转动是刚性运动 ⇒ 两端距离恒等于 B.len，长度守恒由构造保证。
  var k=w[0]?0:1,t=1-k;
  // 残差判据必须是「锚定端离锚点的偏移」，不是「自由端离半径 L 圆的径向误差」：
  //   后者对切向平移在一阶上不变，却会带着锚定端一起漂 ⇒ 修正永不触发、误差偷偷累积。
  var pk=rodEndWorld(B,k);
  if(Math.abs(pk.x-w[k].x)<0.05&&Math.abs(pk.y-w[k].y)<0.05)return false;   // 已满足 ⇒ 不折腾
  var L=B.len||170,e=rodEndWorld(B,t);
  var dx=e.x-w[k].x,dy=e.y-w[k].y,dd=Math.hypot(dx,dy);
  if(!dd||dd<1e-6){dx=Math.cos(B.th||0)*L;dy=Math.sin(B.th||0)*L;dd=L||1;}
  var nx=w[k].x+dx/dd*L,ny=w[k].y+dy/dd*L;      // 自由端投到「以锚点为心、半径 L」的圆上
  rodPlaceEnds(B, k?nx:w[k].x, k?ny:w[k].y, k?w[k].x:nx, k?w[k].y:ny);
  // ---- 铰链的速度投影 ------------------------------------------------------
  // 只投影位置不够：重力每子步给 vy 加一点，投影又吃掉位移 ⇒ vy 无界增长，解除锚定时整根杆以累积速度弹射。
  // 绕定点转动的刚体，形心速度必须垂直于 (形心−锚点)：
  //   ω = (r×v)/|r|²，然后 v := ω ẑ×r。径向分量丢掉，切向（摆动）不动。
  if(dt>0&&isFinite(dt)){
    var rx=B.x-w[k].x,ry=B.y-w[k].y,rl2=rx*rx+ry*ry;
    if(rl2>1e-6){
      var om=(rx*(B.vy||0)-ry*(B.vx||0))/rl2;
      B.vx=-om*ry;B.vy=om*rx;B.om=om;
    }
  }
  return true;
}
/* 杆宿主的 XPBD 速度重建（配合 rodSyncAnchors 里的快照，防止摆动漏能）。
 * 必须在每子步 Matter.Engine.update 之后调用：完整子步位移 = 快照 → 积分后位置（含约束修正 + 重力积分）；
 * 若在积分前反推就只剩修正量，等于每子步把速度清零（摆动变成蠕动）。
 * v = Δx/dt_sub（Matter 口径 ×(1/60)/(1/240)=×4），ω 同理；切向动能完整保留、与重力功自洽。
 * 门控：_xpsFree（两端无活动接触）才重建，接触场景不变；睡眠宿主不唤醒（保住静止冻结）；
 * 被抓端不碰（位姿归指针）；高中圆 ω≡0（_hsV 门）不写 ω。 */
export function rodXPBDVel(RODS){
  for(var i=0;i<RODS.length;i++){
    var B=RODS[i];
    if(!B||B.dead||!B._xps)continue;
    var xps=B._xps;B._xps=null;
    if(!B._xpsFree)continue;
    for(var k=0;k<xps.length;k++){
      var h=xps[k][0];
      if(!h||h.dead||!h.mb||h.mb.isSleeping)continue;
      if(grab&&grab.kind==='body'&&grab.obj===h)continue;
      var q=(1/60)/ROD_SUB_DT;
      Matter.Body.setVelocity(h.mb,{x:(h.mb.position.x-xps[k][1])*q,
                                    y:(h.mb.position.y-xps[k][2])*q});
      /* ω 重建只对简单体（parts==1）开放：复合体（墨迹链）上 Engine 的 angle 积分与位置相位 setAngle 的口径差
       *  会使 Δθ 系统性偏大 ⇒ ω 越写越大。复合体只重建平动。 */
      /* 铰接体（_hinged）与被独立铰链钉住的宿主（_hconOn）的 ω 不参与重建：这类体位置几乎不动、Δθ≈0，
       *  每子步用 ω=Δθ/dt 覆盖会抹掉重力力矩的增量，物体无法绕固定点按力矩旋转（复摆/跷跷板不动）。
       *  它们的旋转动力学归 Matter 积分 + rodHingeTorque。 */
      if(h.mb.parts.length===1&&!(PHYS_MODE==='high'&&h.wshape==='circle')&&!h._rodLK&&!h._hinged&&!h._hconOn)
        {
          var _om=(h.mb.angle-xps[k][3])*q;
          /* ω 重建钳位（rad/帧）：位移里含位置相位的非物理搬运，不钳会把转动能量放大注入。 */
          if(_om>0.2)_om=0.2;if(_om<-0.2)_om=-0.2;
          Matter.Body.setAngularVelocity(h.mb,_om);
        }
    }
  }
}
export function rodDragPinHosts(B,relax){
  if(!B||B.kind!=='T'||!B.anc)return false;
  var _rl=(relax==null)?1:(+relax||0);
  var any=false;
  /* 静态端（铁砧）必须把杆拉回来，而不是 continue 放着不管：否则指针把杆整体带走时，静态端的杆端直接离开锚点（脱钩）。
   * 做法：静态端绕锚点转动 —— 把杆摆成「静态端精确落在锚点上、另一端仍在半径 len 的圆上」的唯一解
   * （与 rodSyncAnchors 单端分支同一几何），拖动期杆端始终在锚点上。只改位置，不动速度（避免与 Matter 积分打架）。
   * 顺序：先处理静态端（决定杆的位姿），再处理可动端（把宿主搬到杆端），反了会被可动端的写入覆盖。 */
  for(var i=0;i<2;i++){
    var a=B.anc[i];if(!a||!a.B)continue;
    var h=a.B;
    if(h.dead||bodies.indexOf(h)<0){B.anc[i]=null;continue;}   // 宿主没了 ⇒ 这一端自动自由
    if(!hostIsAnvil(h)&&!springHostPinnedByAnvil(h,B))continue; // 可动端在下面第二趟处理
    var w=springAnchoredWorld(B,i),q=rodEndWorld(B,i);
    if(!w||!q)continue;
    if(Math.abs(q.x-w.x)<0.05&&Math.abs(q.y-w.y)<0.05)continue; // 已在锚点上 ⇒ 零开销
    // 自由端（另一端）：保持它相对锚点的方向，把距离投到半径 len 的圆上（与 rodSyncAnchors 单端分支同一几何）。
    var o=1-i,e=rodEndWorld(B,o),L=B.len||170;
    var dx=e.x-w.x,dy=e.y-w.y,dd=Math.hypot(dx,dy);
    if(!dd||dd<1e-6){dx=Math.cos(B.th||0)*L;dy=Math.sin(B.th||0)*L;dd=L||1;}
    var nx=w.x+dx/dd*L,ny=w.y+dy/dd*L;
    rodPlaceEnds(B, i?nx:w.x, i?ny:w.y, i?w.x:nx, i?w.y:ny);
    any=true;
  }
  for(var j=0;j<2;j++){
    var a2=B.anc[j];if(!a2||!a2.B)continue;
    var h2=a2.B;
    if(h2.dead||bodies.indexOf(h2)<0)continue;
    if(hostIsAnvil(h2)||springHostPinnedByAnvil(h2,B))continue;  // 铁砧不动（已在第一趟处理）
    var q2=rodEndWorld(B,j),w2=springAnchoredWorld(B,j);
    if(!q2||!w2)continue;
    var dx2=q2.x-w2.x,dy2=q2.y-w2.y;
    if(!dx2&&!dy2)continue;
    h2.x+=dx2*_rl;h2.y+=dy2*_rl;      // relax<1 时只搬一部分（链解用）
    if(h2.mb&&MW){
      Matter.Body.setPosition(h2.mb,{x:h2.x,y:h2.y});
      Matter.Body.setVelocity(h2.mb,{x:0,y:0});
      Matter.Body.setAngularVelocity(h2.mb,0);
      Matter.Sleeping.set(h2.mb,false);
    }
    any=true;
  }
  return any;
}
/* 多杆链的拖动：拖的不是杆时，链上其它杆没有求解者。rodDragPinHosts(R) 是几何精确解（幂等），但只在
 *  被拖的是杆时调用；拖物体时相邻杆只靠 rodSyncAnchors 的逐步投影（每子步修正有上限）去追，追不上 ⇒ 杆端与
 *  物体分离，再往外一环更没人解。
 *  做法：从被拖体出发沿杆 BFS，逐根调用同一个几何解；只有被拖体本身临时当铁砧（_dragPin），中间宿主保持可动
 *  ⇒ 反复扫几遍即 Gauss-Seidel，多根杆交替投影收敛到两圆交点（若存在）。
 *  逐子步调用（指针停住时也必须继续收敛）。只改位置、清宿主速度，不注入动能。 */
export const ROD_CHAIN_ITERS=10;      // 每子步的 Gauss-Seidel 扫几遍
export const ROD_CHAIN_RELAX=0.5;
export const ROD_CHAIN_MAXLINK=12;    // 链上最多处理多少根杆（防病态数据打环）
/* 把杆的姿态立即按当前锚点重算（只摆姿态：不改宿主、不写 _rodL、不碰速度）。
 * 杆的 B.x/B.th 是姿态缓存，只在 rodSyncAnchors 末尾更新；rodDragPinChain 在它之后跑 ⇒ 杆姿态滞后一个子步，
 * 拖拽中表现为杆与物体恒定分离 8~10px（此时两锚点距离其实已等于杆长）。
 * 而且 rodDragPinHosts 的 pass1 用 |rodEndWorld − springAnchoredWorld| 当残差，姿态滞后会让它去「修」没坏的
 * 东西（绕锚点重摆整根杆），与 pass2 搬宿主互相追打。本函数只补缓存一致性，不解约束。
 *   双端：中心=锚点中点、方向=w1→w0（与 rodSyncAnchors 的姿态段一致）；
 *   单端：绕锚点转动把锚定端摆回锚点（与单端铰链分支同一几何）。
 * 纯位置写入，无随机、无时间依赖。 */
export function rodResyncRodPose(B){
  if(!B||B.dead||B.kind!=='T'||!B.anc)return false;
  var h0=B.anc[0]?B.anc[0].B:null,h1=B.anc[1]?B.anc[1].B:null;
  if(h0&&(h0.dead||bodies.indexOf(h0)<0))h0=null;
  if(h1&&(h1.dead||bodies.indexOf(h1)<0))h1=null;
  var w0=h0?springAnchoredWorld(B,0):null,w1=h1?springAnchoredWorld(B,1):null;
  if(!w0&&!w1)return false;
  if(w0&&w1){
    var Lr=(B._rodL>0)?B._rodL:(B.len||170);
    if(!(Lr>0))return false;
    B.x=(w0.x+w1.x)/2;B.y=(w0.y+w1.y)/2;
    B.th=(B.th||0)+shortAng(Math.atan2(w0.y-w1.y,w0.x-w1.x)-(B.th||0));
    B.len=Lr;B.hw=Lr/2+2;
  }else{
    var k=w0?0:1,t=1-k,w=w0||w1;
    var L=(B.len>0)?B.len:170,e=rodEndWorld(B,t);
    var dx=e.x-w.x,dy=e.y-w.y,dd=Math.hypot(dx,dy);
    if(!dd||dd<1e-6){dx=Math.cos(B.th||0)*L;dy=Math.sin(B.th||0)*L;dd=L||1;}
    rodPlaceEnds(B,k?w.x+dx/dd*L:w.x,k?w.y+dy/dd*L:w.y,
                   k?w.x:w.x+dx/dd*L,k?w.y:w.y+dy/dd*L);
  }
  /* 杆当前无 Matter 镜像板（B.mb 恒 null），姿态只在 B.x/B.y/B.th 里；下面的同步仅在镜像板存在时生效。 */
  if(MW&&B.mb){Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th);}
  return true;
}
export function rodDragPinChain(seed){
  if(!seed||seed.dead)return false;
  if(!grab||grab.kind!=='body'||!grab.obj)return false;
  var rods=[],i;
  for(i=0;i<bodies.length;i++){
    var R=bodies[i];
    if(!R||R.dead||R.kind!=='T'||!R.anc)continue;
    if(grab.obj===R)continue;                       // 被拖的就是这根杆 ⇒ 上面那条通道已经解过
    if(!R.anc[0]&&!R.anc[1])continue;
    rods.push(R);
  }
  if(!rods.length)return false;
  /* 链的传播图必须经过宿主：杆-杆不互锚（rodTryAnchor 里 `if(h.kind==='T')continue`），两根杆只会共享宿主。
   *      杆1.anc = [墙W, A]      杆2.anc = [A, B]      被拖的是杆2
   *  只沿「某根杆的另一端宿主」推进的话，从杆2 出发永远走不到杆1，链解对它空转；而 rodSyncAnchors(杆1) 每子步
   *  收回的量又被 rodDragPinHosts(杆2) 精确搬回，A 被卡死、杆1 被拉长到两倍。
   *  所以把 seed 的宿主也当作 BFS 起点，共享宿主的另一根杆就会被收进链。 */
  var pullSet=[seed];                               // 「被拖侧」集合 = {被拖体} ∪ {被拖体的宿主}
  if(seed.anc)for(i=0;i<2;i++){
    var sa=seed.anc[i];
    if(sa&&sa.B&&!sa.B.dead&&bodies.indexOf(sa.B)>=0&&pullSet.indexOf(sa.B)<0)pullSet.push(sa.B);
  }
  var any=false;
  seed._dragPin=true;
  try{
    for(var it=0;it<ROD_CHAIN_ITERS;it++){
      var seen=[seed],q=[seed],guard=0;
      for(i=0;i<pullSet.length;i++){                // 宿主入队（链的第一环）
        if(seen.indexOf(pullSet[i])<0){seen.push(pullSet[i]);q.push(pullSet[i]);}
      }
      while(q.length&&guard++<ROD_CHAIN_MAXLINK){
        var h=q.shift();
        for(i=0;i<rods.length;i++){
          var r=rods[i];
          if(r.dead)continue;
          var a0=r.anc[0],a1=r.anc[1],o=null;
          if(a0&&a0.B===h)o=(a1&&a1.B)?a1.B:null;
          else if(a1&&a1.B===h)o=(a0&&a0.B)?a0.B:null;
          else continue;
          /* 链解只用几何精确解 rodDragPinHosts，不要再叠加 rodSyncAnchors：单用它时稳态残差更大（每子步修正上限太小，
           *  且会搬动被拖体），两路叠加又会互相追打。够不着时由下面「被拖体参与位移分配」把 seed 拉回可达域。 */
          /* 先按当前锚点重算杆姿态，再解约束：rodDragPinHosts 的 pass1 以杆端残差为输入，而 B.x/B.th 是上一子步的
           *  陈旧缓存（见 rodResyncRodPose）。必须在解约束之前，一次即可（后面每轮 BFS 会再进来）。 */
          rodResyncRodPose(r);
          if(rodDragPinHosts(r,ROD_CHAIN_RELAX))any=true;
          /* 不要在链解里给产品自管位姿的 W 体写角度（例如用宿主小转动吃掉残差的切向分量）：实测不稳定，
           *  同一代码两次运行给出 0.1px 与 120px，按住不动时会突然崩开。 */
          if(o&&!o.dead&&bodies.indexOf(o)>=0&&seen.indexOf(o)<0){seen.push(o);q.push(o);}
        }
      }
      /* 约束够不着时被拖的那一端也参与位移分配（与绳 conPull 的 allowGrab 同一语义）⇒ 拖不动，但不分离。
       *  每轮扫完链后，若被拖侧仍有残差，就把相应宿主往回搬（×relax）：
       *    · 几何可达 ⇒ 残差收敛到 0 ⇒ 一句都不动 ⇒ 完全跟手；
       *    · 几何不可达 / 只平移不旋转造成的折中残差 ⇒ 被拖体被链拉住 ⇒ 不分离。
       *  pointermove 按绝对指针写位置，chain 按约束往回拉，两者拉锯的稳定解就是「物体停在可达边界上」。 */
      for(i=0;i<rods.length;i++){
        var rs=rods[i];
        if(rs.dead)continue;
        /* 判据：哪一端锚在被拖侧。被拖侧 = seed 自己或 seed 的宿主（拖杆2 时被拖侧 = {杆2, A, B}，杆1 的 A 端在其中）。 */
        var b0=rs.anc[0],b1=rs.anc[1];
        var i0=(b0&&b0.B&&pullSet.indexOf(b0.B)>=0)?0:-1;
        var i1=(b1&&b1.B&&pullSet.indexOf(b1.B)>=0)?1:-1;
        /* 两端都在被拖侧 ⇒ 该杆对「拖不动」没有发言权，跳过。 */
        if(i0>=0&&i1>=0)continue;
        var si=(i0>=0)?0:((i1>=0)?1:-1);
        if(si<0)continue;
        /* 判据必须是纯几何的（两端锚点距离 vs 杆长），不能看杆端残差：rodDragPinHosts 的 pass1 会把铁砧端
         *  （含 seed，因 _dragPin）精确摆到锚点上 ⇒ seed 那一端残差恒为 0，永远触发不了。 */
        var wsA=springAnchoredWorld(rs,si),wsB=springAnchoredWorld(rs,1-si);
        if(!wsA||!wsB)continue;
        var vx=wsB.x-wsA.x,vy=wsB.y-wsA.y,dAB=Math.hypot(vx,vy);
        var over=dAB-(rs.len||170);
        /* 双向：over>0 = 拉太开（拉回）；over<0 = 链被压扁（两圆不相交）⇒ 推远到「锚距 = 杆长」。刚性杆两向都要收。 */
        /* over 不能堆到 seed 上：seed 正被指针拖，rodDragPinHosts 每子步把 seed 精确摆回钉位，会把修正整份冲掉。
         *  与 ropeSolve/conPull 的 allowGrab 同一语义：多余量由可动的一侧吸收，钉在指针下的一侧只能「拖不动」。
         *  ⇒ over 施加在被拖侧的远端（seed 的另一端宿主，如 B）；那一端也不可动时才退回移动 seed。 */
        if(Math.abs(over)<=0.5)continue;   // 已经等于杆长 ⇒ 一句都不动（保住跟手）
        if(dAB<1e-6)continue;
        var _mvx=vx/dAB*over*ROD_CHAIN_RELAX, _mvy=vy/dAB*over*ROD_CHAIN_RELAX;
        /* 被拖侧的远端：从 pullSet 里找不是指针拖着的那个，优先选未被拖的 seed 宿主（B）。 */
        var far=null,k2;
        for(k2=0;k2<pullSet.length;k2++){
          var c2=pullSet[k2];
          if(!c2||c2===seed||c2.dead)continue;
          if(hostIsAnvil(c2))continue;
          if(hostMovableByConstraint(c2)){far=c2;break;}
          if(!far&&c2.mb&&!c2.mb.isStatic)far=c2;
        }
        if(far){
          far.x+=_mvx;far.y+=_mvy;
          if(far.mb&&MW){
            Matter.Body.setPosition(far.mb,{x:far.x,y:far.y});
            Matter.Body.setVelocity(far.mb,{x:0,y:0});
            Matter.Body.setAngularVelocity(far.mb,0);
            Matter.Sleeping.set(far.mb,false);
          }
        }else{
          seed.x+=_mvx;seed.y+=_mvy;     // 远端也挪不动 ⇒ 退回移动 seed
          if(seed.mb&&MW)Matter.Body.setPosition(seed.mb,{x:seed.x,y:seed.y});
        }
        any=true;
      }
    }
  }finally{ seed._dragPin=false; }   // 标志必须在任何出口都清掉（否则这个体以后永远当铁砧）
  return any;
}
// 拖杆松手 → 两端各自的 ROD_SNAP 内若压着别的物体就拴上（判定点 = 两个端点本身，
// 与 springTryAnchor 同一规格：杆身中段压到什么都不算，那只是支撑不是锚）。
export function rodTryAnchor(B){
  if(!B||B.kind!=='T'||B.dead||!B.anc)return;
  for(var i=0;i<2;i++){
    if(B.anc[i])continue;                        // 已拴住的保持原样（不抢不换）
    var e=rodEndWorld(B,i),bd=ROD_SNAP,hit=null;
    for(var j=0;j<bodies.length;j++){
      var h=bodies[j];
      if(h===B||h.dead)continue;
      if(grab.kind==='body'&&grab.obj===h)continue;   // 正在被拖的东西不算「固定物」
      // 杆端不许锚到铰链器件上：铰链是连接件不是刚体，且它可能正拴着这根杆自己
      //   ⇒ 成环（杆→铰链→杆）、过约束。
      if(h.kind==='S'&&h.hinge)continue;
      // 与 springTryAnchor / springTryAnchorByHost 同款守卫：本端已通过铰链连着候选宿主 ⇒ 不许再直接锚
      //   （铰链+直锚 = 过约束互推爬行）。拖杆松手时自由端正贴着铰链另一端的宿主，没有这条必中。
      var hin3=false;
      for(var hq=0;hq<bodies.length;hq++){
        var H3=bodies[hq];
        if(H3===B||H3.dead||H3.kind!=='S'||!H3.hinge||!H3.anc)continue;
        var t0=H3.anc[0],t1=H3.anc[1];
        if(t0&&t1&&((t0.B===B&&t1.B===h)||(t0.B===h&&t1.B===B))){hin3=true;break;}
      }
      if(hin3)continue;
      /* 候选宿主是杆 ⇒ 跳过（杆-杆不建立锚定关系，直接连接会卡顿）。 */
      if(h.kind==='T')continue;
      var dd=distToHost(h,e.x,e.y);
      if(dd<bd){bd=dd;hit=h;}
      /* 杆端可以插进物体内部，而表面判定（distToHost<15）在内部永远不命中 ⇒ 端点进入物体内也视为命中：
       *  深插到质心带 ⇒ 锚质心，浅插 ⇒ 锚最近表面点（由 springAnchorOffset 分流）。 */
      var _dcin=Math.hypot(e.x-h.x,e.y-h.y);
      /* 内部判定用最小半轴：用 max 的话细长条（横墙 hw=100/hh=12）会把旁边大片虚空判成内部（杆被固定在墙下虚空）。 */
      var _rin=(h.wshape==='circle'&&h.rad)?h.rad:Math.min(h.hw||30,h.hh||24);
      var _din=_dcin-_rin;                       // <0 = 端点在物体内部
      if(_din<0&&bd>_din){bd=_din;hit=h;}
    }
    if(!hit)continue;
    // 先把端点吸到宿主表面再记偏移（顺序不能反：偏移必须按吸附后的端点算，否则第一帧被拉回）。
    // 下面必须走 rodPlaceEnds（索引序）：参数按编号写（index i = q、index 1-i = o），直接喂 setRodEnds
    // 会塞进反的槽位 ⇒ 锚点记到另一头（见 rodPlaceEnds 注释）。
    /* 端点在物体内部时不收到表面：杆端插进内部说明用户在往质心插，先收到表面会把端点拉出来，质心判定永远轮不到。
     *  保留内部位置，交给 springAnchorOffset 的质心带判定（dc≤0.7rad）。 */
    var _dcIn=Math.hypot(e.x-hit.x,e.y-hit.y);
    var _rIn=(hit.wshape==='circle'&&hit.rad)?hit.rad:Math.min(hit.hw||30,hit.hh||24);   // min 半轴（同上）
    /* 内部浅插暂不收到最近表面点（之前的实现引发过 JS 异常）：内部落点交给 springAnchorOffset 分流
     *  （质心带内 = 质心，带外 = 表面最近点）。 */
    if(_dcIn<_rIn){
      B.anc[i]={B:hit};springAnchorOffset(B,i);
    }else{
    /* 杆的吸附优先级：角 > 边中点 > 表面点 */
    var q=hostCornerSnapPoint(hit,e.x,e.y)||hostMidSnapPoint(hit,e.x,e.y)||hostClosestPoint(hit,e.x,e.y),o=rodEndWorld(B,1-i);
    if(q){rodPlaceEnds(B, i?o.x:q.x, i?o.y:q.y, i?q.x:o.x, i?q.y:o.y);
      B._rodL=B.len;}                 // 吸附挪了端点 = 有意改长度
    B.anc[i]={B:hit};springAnchorOffset(B,i);
    }
  }
}
export const ROD_HINGE_DAMP=0.985;  // 铰接摩擦（0.985 ⇒ 摆动 2~3 次后停下；1=永不衰减）
/* 杆铰接重力力矩开关（三态，默认 1）。rodHingeTorque 按另一端类型分流：
 *   另一端自由      ⇒ 不施力矩；
 *   另一端动态体    ⇒ 施「对端载荷重量」的力矩；
 *   另一端静态/铁砧 ⇒ 施 τ = r×m·g —— 真枢轴（悬在墙上的复摆），重力把物体拉回最低势能点。
 *   =1 默认：只对铁砧端施力矩，姿态按 |r|·m·g/I 的时间尺度摆回最低点；自由端/动态端不施。
 *   =0 全停：姿态只剩 PBD 位置相位的旋转修正（被 ROD_ROT_MAX=0.02 rad/次封顶），慢但守恒；
 *      实测 60° 释放要约 10s 才回到最低点。作为保守回退位。
 *   =2 全开（含动态端力矩）：会注能（+1.14×KE峰），仅供对照。
 * 只加铁砧端不会注能：注能链条是「对动态/自由端施力矩 ⇒ ω 被推到钳位 9 rad/s ⇒ 锚点绕质心飞 ⇒
 * 位置相位大搬运 ⇒ rodXPBDVel 把瞬移当速度」。铁砧端宿主是被约束方，位移量级 |r|·θ̇·dt 远小于
 * ROD_PULL_MAX，不触发大搬运（实测正漂 ≤0.05）。 */
export const ROD_HINGE_TORQUE=1;
/* 复摆重力力矩：Matter 的重力只作用于质心、不产生力矩 ⇒ 锚定物体永远不会因重力绕锚点摆动。
 * 显式补 τ = r×F（r=锚点→质心，F=(0, m·g)），物体像复摆一样绕固定点摆到稳定姿态。
 * 对哪些端施加由 ROD_HINGE_TORQUE 控制（见常量处）。 */
export function rodHingeTorque(dt){
  if(!MW||!MW.engine)return;
  for(var i=0;i<bodies.length;i++){
    var R=bodies[i];
    /* 杆(T)与铰链器件(S+hinge)都纳入处理。 */
    var _isHingeRod=(R.kind==='S'&&R.hinge);
    if((R.kind!=='T'&&!_isHingeRod)||R.dead||!R.anc)continue;
    for(var e=0;e<2;e++){
      var a=R.anc[e];if(!a||!a.B||a.B.dead)continue;
      var h=a.B;
      if(h.kind==='T'||!h.mb||h.mb.isStatic)continue;
      if(R._rodAngleLock)continue;      // 固定角度 ⇒ 不施加力矩（姿态跟着杆）
      /* 两端都锚在动态体时不施力矩：两个宿主各自被施加方向相反的重力力矩，会互相打架振荡（抽搐），
       * 此时姿态交给 PBD 约束。只有杆的另一端是静态体时才是真正的悬挂/复摆场景。 */
      var _other=(e===0)?R.anc[1]:R.anc[0];
      var _oB=_other?_other.B:null;
      /* 物理前提：τ = rx·m·g 描述的是物体绕固定枢轴摆动，只有另一端是静态/铁砧（墙、地面、fixed 体）时成立。
       *  · 另一端自由：杆是轻质连杆，对物体几乎没有影响；施力矩等于凭空把杆端当枢轴，表现为连接的那一侧
       *    被扭起来。必须不施。
       *  · 另一端是动态体：整条链的动力学由 rodSyncAnchors 的 PBD/XPBD 约束负责；两端各施一次绕自己锚点的
       *    重力力矩是重复计入（重力已在 Matter 积分里），且两侧方向相反 ⇒ 互相打架、成为能量泵。
       * 注能机制：rodSyncAnchors 位置相位对 W 宿主的旋转修正归零（wN=0）时，姿态完全由本函数驱动，
       * ω 被推到钳位 0.15 rad/帧 ⇒ 锚点绕质心高速飞 ⇒ 位置相位每子步把宿主搬 100+px ⇒ rodXPBDVel 用
       * 「子步位移 / dt」反推速度，瞬移被当成真实速度 ⇒ 动能爆炸。PBD 的位置+旋转相位本身就能给出复摆动力学。 */
      var _other=(e===0)?R.anc[1]:R.anc[0];
      var _oB=_other?_other.B:null;
      /* ROD_HINGE_TORQUE 三态分派（见常量处注释）：
       *   0 ⇒ 全停（姿态归 PBD，慢但守恒）
       *   1 ⇒ 只对铁砧端（默认，复摆动力学）
       *   2 ⇒ 全开（含动态端；会注能，仅对照用） */
      var _tqMode=(ROD_HINGE_TORQUE===true)?2:(+ROD_HINGE_TORQUE||0);
      if(!_tqMode)continue;
      var _oAnvil=(_oB&&((_oB.mb&&_oB.mb.isStatic)||_oB.fixed));
      var _oDyn=(_oB&&_oB.mb&&!_oB.mb.isStatic&&_oB.kind==='W');
      if(!_oAnvil&&!_oDyn)continue;      // 另一端自由（或已死）⇒ 不是枢轴，不施力矩
      if(_tqMode<2&&_oDyn)continue;      // 默认模式只对铁砧端（真枢轴）施力矩
      /* 多杆链守卫：τ=(C−M)×m·g 的前提是「一个连杆接到固定枢轴」（单摆/复摆）。宿主同时被 ≥2 根连杆锚住时，
       * 约束是多个锚点同时满足各杆长，动力学由 PBD 负责；再补单摆重力力矩会压掉多杆链的自然下沉
       * （实测 墙—杆1—A—杆2—B：无守卫时 A 转角 +0.005，加守卫 +0.505，与 τ=0 对照逐位一致）。
       * 链锚数 = 满足 R.anc[e].B===h 且 R.anc[1−e].B 是在场活体的 (R,e) 个数：=1 照旧施力矩，≥2 不施。
       * 只作用于铁砧端分支；mode 2 的动态端分支不变。 */
      if(_oAnvil&&!_oDyn){
        var _nL=0;
        for(var _ri=0;_ri<bodies.length;_ri++){
          var _RR=bodies[_ri];
          if(_RR.kind!=='T'||_RR.dead||!_RR.anc)continue;
          for(var _re=0;_re<2;_re++){
            var _ra=_RR.anc[_re];if(!_ra||_ra.B!==h)continue;
            var _rb=_RR.anc[1-_re];
            if(_rb&&_rb.B&&!_rb.B.dead)_nL++;
          }
        }
        if(_nL>1)continue;
      }
      var _tw=1.0;
      if(_oDyn){
        /* 两端都动态（刚性连杆）：见下「继电器载荷力矩」，不再用本体的 m·g。 */
        var _rel=Math.abs((h.mb.angularVelocity||0)-(_oB.mb.angularVelocity||0));
        _tw/=(1+6*_rel);
      }
      var p=springAnchoredWorld(R,e);
      var rx=h.x-p.x;                               // rx = C.x − M.x（锚点 → 质心）
      var m=h.mb.mass||1;
      /* 另一端动态时，物体受到的力矩来自对端载荷的重量（杆传力，两端严格等大反向），
       * 两边力矩成为一对作用反作用。τ = r' × F，r' = 锚点 − 质心 = (−rx, −ry)，F = (0, m_对端·g)
       * ⇒ τ_z = (−rx)·(m_对端·g)。 */
      var tau, _mA=(h.mb.mass||1);
      /* 两段力矩的力臂方向相反，不要共用一个符号（Matter：y 向下、θ 顺时针为正 ⇒ τ_z = r_x·F_y − r_y·F_x）：
       *  ① 铁砧端（真枢轴）= 复摆：重力作用于宿主质心，力臂 r = C − M ⇒ τ = +rx·m·g。
       *     自检：C 在 M 右侧（rx>0）⇒ 重力绕 M 顺时针 ⇒ τ>0。
       *  ② 动态端 = 杆传力：对端载荷重量沿杆传来，作用点在锚点，力臂 r = M − C ⇒ τ = −rx·m_对端·g。
       * 若铁砧端误用 −rx，力矩会把物体推向 θ=π（质心在锚点正上方，非稳定平衡），60° 释放后冲到 180° 附近
       * 卡住、ω 顶在钳位，看起来像铰链摩擦极大、半天不回最低点。
       * 标定（60° 释放，|r|=40，I_cm=8557.7）：τ=+rx 用 I_cm 首达 |θ|<0.15 只需 10 帧；用 I_pivot 16 帧且
       * 杆端残差更大；τ=0 或反号需 609 帧。取 I_cm 口径。
       * 注意：rodSyncAnchors 的位置相位是纯瞬移（setAngle/setPosition），PE 变而 KE 不变，
       * 总能量漂移不能作为这里物理正确性的判据。 */
      var tau, _mA=(h.mb.mass||1);
      if(_oDyn){
        var _mo=(_oB.mb.mass||1);
        tau=(-rx)*(_mo*GRAV)*_tw;                  // 杆传力：r = M − C ⇒ τ = −rx·m_对端·g
      }else{
        tau=rx*(m*GRAV)*_tw;                     // 复摆重力力矩：τ = (C−M)×m·g = +rx·m·g
      }
      /* ---- 锚点/质量自由端的兜底：另一端自由时上面已 continue，不会走到这 ---- */
      /* 不用 mb.torque（Matter 内部口径与 px/s² 不匹配，实测会爆到 1e9 度）。按实测标定直接改角速度：
       * ω 单位 = rad/帧，Δω = (τ/I)·dt²（dt=1/60s）。 */
      var I=h.mb.inertia||1;
      var dw=(tau/I)*(1/60)*(1/60);
      if(isFinite(dw)){
        /* 角速度钳位 ±0.15 rad/帧（≈9 rad/s）。注意单位是 rad/帧：±8 这种量级（≈480 rad/s）等于没钳，
         * 铰链物体会被力矩抽得疯狂抖动。 */
        var _w=(h.mb.angularVelocity||0)+dw;
        if(_w>0.15)_w=0.15;if(_w<-0.15)_w=-0.15;
        Matter.Body.setAngularVelocity(h.mb,_w);
      }
    }
  }
}
/* 杆/铰链相连的两个宿主放进同一负碰撞组（Matter group<0 同组永不碰撞），可以互相重叠，
 * 消除接触-分离的边界抖动。每帧先清零再按当前连接设置 ⇒ 解除连接后自动恢复可碰撞。 */
export function rodSyncNoCollide(){
  var i;
  for(i=0;i<bodies.length;i++)if(bodies[i]._rcg){bodies[i]._rcg=0;
    if(bodies[i].mb)bodies[i].mb.collisionFilter.group=0;}
  for(i=0;i<bodies.length;i++){
    var R=bodies[i];
    /* 铰链器件在实现上是 S 体 + hinge 标记（不是 T），这里把 T（杆）与 S+hinge 一并纳入。 */
    if((R.kind!=='T'&&!(R.kind==='S'&&R.hinge))||R.dead||!R.anc)continue;
    var h0=R.anc[0]?R.anc[0].B:null, h1=R.anc[1]?R.anc[1].B:null;
    if(!h0||!h1||h0===h1||h0.dead||h1.dead)continue;
    if(h0.kind!=='W'||h1.kind!=='W')continue;        // 只处理物体-物体（墙/地面等静态体本来就不动）
    /* 静态宿主（用户画的地面/墙/挡板，kind 'W' + fixed）不进负组：它们是场景边界。把边界也设成同组，
     * 连着的动态体就能穿过它（实测方块被按进地面 23.6px 并抖动）。互不碰撞只留给两个动态体；
     * 不许穿透交给碰撞求解器（静态体质量无穷大，本来就推不动）。 */
    if((h0.mb&&h0.mb.isStatic)||(h1.mb&&h1.mb.isStatic))continue;
    var g=-(1000+((R._rid||(R._rid=Math.floor(Math.random()*50000)))%50000));
    h0._rcg=g;h1._rcg=g;
    if(h0.mb&&MW)h0.mb.collisionFilter.group=g;
    if(h1.mb&&MW)h1.mb.collisionFilter.group=g;
  }
}
export function rodSyncLocks(){
  var i,e,B;
  for(i=0;i<bodies.length;i++){if(bodies[i]._rodLK)bodies[i]._rodLK=false;if(bodies[i]._hinged)bodies[i]._hinged=false;}
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind!=='T'||B.dead||!B.anc)continue;
    for(e=0;e<2;e++){
      var a=B.anc[e];
      if(!a||!a.B||a.B.dead||!a.B.mb||a.B.mb.isStatic)continue;
      /* 杆宿主不打锁：杆是约束体不是刚体，杆-杆销接时每根杆都要能绕连接点自由转动
       * （锁死第一段会让混沌摆抽搐）。只有 W 体宿主才可能锁角度。 */
      if(a.B.kind==='T')continue;
      /* 不锁宿主角度：铰接物体按质量分布绕连接点摆动才是正确的复摆物理，
       * 静止平衡 = 质心在连接点正下方；锁死会让「静止到最低点」的自然行为消失。 */
      /* 杆开启「固定角度」⇒ 宿主锁死自转（姿态跟着杆走，连接点仍不动）。 */
      if(B._rodAngleLock)a.B._rodLK=true;
      a.B._hinged=!B._rodAngleLock;   // 固定角度时恢复 ω 重建（随杆同步）
      /* 铰接角速度阻尼：ROD_HINGE_DAMP<1 时每帧按比例衰减 ω（铰接摩擦），=1 时无阻尼、姿态完全交给物理。
       * 阻尼过强会压死重力力矩驱动的复摆转动。 */
      if(ROD_HINGE_DAMP<1&&a.B.mb&&a.B.mb.angularVelocity){
        Matter.Body.setAngularVelocity(a.B.mb,a.B.mb.angularVelocity*ROD_HINGE_DAMP);
      }
      if(ROD_HINGE_DAMP<1&&a.B.om)a.B.om*=ROD_HINGE_DAMP;
    }
  }
}
/* 杆的唯一画线函数（render 的 T 分支与器件落点虚影共用）。
 * 只读 {x,y,th,len} ⇒ 真杆或桩对象画出逐像素相同的木板线，
 * 保证「虚影所见 = 松手所得」（与 drawSpring 同一手法，见 drawDeviceGhost）。 */
export function drawRodPlank(B){
  var tht=B.th||0,cth=Math.cos(tht),sth=Math.sin(tht),hl=(B.len||170)/2;
  var x1=B.x-cth*hl,y1=B.y-sth*hl,x2=B.x+cth*hl,y2=B.y+sth*hl;
  cvx.strokeStyle='rgba(38,34,28,0.85)';
  cvx.lineWidth=3;
  cvx.lineCap='round';
  cvx.beginPath();cvx.moveTo(x1,y1);cvx.lineTo(x2,y2);cvx.stroke();
  // 已连接的端点画铰链销（实心点 + 外圈，与 drawHinge 的销同款）：
  // 连接处的语义就是铰链（杆绕它转、双击它解除）。
  if(B.anc){
    cvx.fillStyle='rgba(38,34,28,0.85)';
    cvx.strokeStyle='rgba(38,34,28,0.85)';
    for(var a=0;a<2;a++){
      if(!B.anc[a])continue;
      // 按索引取端点：索引 0 = +u 侧（B.x+cth*hl），与 rodEndWorld 的 s=(i?-1:1) 一致。
      // 不要复用上面的 x1/x2（x1 = B.x−cth*hl 是索引 1 端），否则销会画到另一端。
      var ex0=B.x+cth*hl,ey0=B.y+sth*hl,ex1=B.x-cth*hl,ey1=B.y-sth*hl;
      var ax2=a?ex1:ex0,ay2=a?ey1:ey0;
      cvx.beginPath();cvx.arc(ax2,ay2,4.6,0,6.2832);cvx.fill();
      cvx.beginPath();cvx.arc(ax2,ay2,7.2,0,6.2832);cvx.lineWidth=1.5;cvx.stroke();
    }
  }
}
/* 杆端吸附预览红点：未锚定的杆端（或独立铰链端）靠近可吸附位置时在吸附点画红点，
 * 与边界中点吸附的红点反馈同款。 */
export let ROD_SNAP_PREVIEW=null;
export function rodSnapPreviewScan(){
  ROD_SNAP_PREVIEW=null;
  /* 拖拽中也扫描，松手前就显示红点。 */
  var _skipRod=(grab&&grab.kind&&(grab.obj&&grab.obj.kind==='T'))?grab.obj:null;
  for(var i=0;i<bodies.length;i++){
    var R=bodies[i];
    /* 纳入独立铰链器件（S+hinge）。 */
    var _isHingeRod=!!(R&&R.kind==='S'&&R.hinge);
    if((R.kind!=='T'&&!_isHingeRod)||R.dead||!R.anc)continue;
    for(var e=0;e<2;e++){
      if(R.anc[e])continue;
      /* _skipRod 当前不用于过滤：被拖的那一端正是要显示红点的那端。 */
      var p=_isHingeRod?springEnd(R,e):rodEndWorld(R,e);
      if(!p)continue;
      for(var j=0;j<bodies.length;j++){
        var h=bodies[j];
        if(h===R||h.dead||h.kind!=='W')continue;
        /* 已锚定到该宿主的不再显示预览（否则松手后红点残留、与铰链重叠）。 */
        var _anchoredHere=false;
        for(var _ae=0;_ae<2;_ae++){ if(R.anc[_ae]&&R.anc[_ae].B===h){_anchoredHere=true;break;} }
        if(_anchoredHere)continue;
        /* 吸附点优先级：质心（仅轻质杆）> 角 > 边中点（独立铰链不吸中点）> 表面点。 */
        var qc0=hostCornerSnapPoint(h,p.x,p.y);
        var qm0=_isHingeRod?null:hostMidSnapPoint(h,p.x,p.y);
        var _snapPt=null;
        /* 质心判定与 springAnchorOffset 的质心吸附同口径（dc ≤ 0.7×半径 ⇒ 锚质心），红点画在物体质心。 */
        var _crad=(h.wshape==='circle'&&h.rad)?h.rad:Math.min(h.hw||30,h.hh||24);
        var _dc0=Math.hypot(p.x-h.x,p.y-h.y);
        /* 质心红点只给轻质杆(T)；独立铰链只吸角，也不给中点红点。 */
        var _isRodPrev=!!(R&&R.kind==='T');
        var _isHingePrev=!!(R&&R.kind==='S'&&R.hinge);
        var _cen0=(_isRodPrev&&_dc0<=_crad*0.7)?{x:h.x,y:h.y}:null;
        if(_cen0)_snapPt=_cen0;
        else if(qc0)_snapPt=qc0;
        else if(qm0&&!_isHingePrev)_snapPt=qm0;
        else{
          var dd=distToHost(h,p.x,p.y);
          /* 表面吸附阈值 26px（15px 太小：球外 20px 就没红点），与角吸附的感受量级一致。 */
          if(dd<26||dd<0)_snapPt=hostClosestPoint(h,p.x,p.y);
        }
        if(_snapPt){
          /* 预览点 = 吸附目标点（质心/角/边中点/表面点，属于物体、不随杆动）。 */
          ROD_SNAP_PREVIEW={x:_snapPt.x,y:_snapPt.y,mid:!!qm0,tx:_snapPt.x,ty:_snapPt.y};
          return;
        }
        var dc=Math.hypot(p.x-h.x,p.y-h.y);
        var rin=(h.wshape==='circle'&&h.rad)?h.rad:Math.min(h.hw||30,h.hh||24);
        if(dc<rin){ROD_SNAP_PREVIEW={x:p.x,y:p.y};return;}
      }
    }
  }
}
export const ROD_VKEEP=0.25;      // 每秒保留比例（指数耗散）：0.25 ⇒ 1s 后剩 25%。
// 杆的运动学积分（阶段①）：vx/vy/om → x/y/th + 耗散，dt 恒为子步 1/240 秒。
// 锚点约束在 rodSyncAnchors 里；杆没有 Matter 体，位姿只在 B.x/B.y/B.th。
/* 已锚定端不响应「拖端点改长度」：否则会干扰双击解除吸附。 */
export function rodEndLenDragAllowed(B,i){
  if(!B||B.kind!=='T'||!B.anc)return true;
  return !B.anc[i];           // 该端已锚定 ⇒ 不允许拖端点改长度
}
export function rodIntegrate(B,dt){
  /* 不要在这里用 `!B.mb` 早退：杆的 B.mb 恒为 null，早退会连带跳过 rodSyncAnchors 的约束链
   * （PBD/回位/重建），松手后杆端回不到锚点（实测残差 237px）。 */
  if(B.dead)return false;
  if(grab&&grab.kind==='body'&&grab.obj===B)return false;   // 被抓住时姿态归指针，别抢
  if(rodLenFrozen(B))return false;                    // 拖长度手柄时同上
  // 锚点约束（位置投影 + 铰链速度投影）必须放在积分之后，这个顺序是契约：
  //   放之前，帧边界若落在「只积分不投影」的那一步，锚定端会被带走 v·dt（实测 1.7px 抖动）；
  //   放之后，每个子步结束时锚定端都精确落在锚点上。
  // 也不要用「sync 成功就 return false」跳过积分：先积分再投影（PBD 标准顺序），
  // 「宿主在动、杆速度为 0」的帧才会被投影搬走。
  if(B._lockRot)B.om=0;                              // 方向锁宿主：角速度保持 0（与 springSyncLocks 一致）
  var vx=B.vx||0,vy=B.vy||0,om=B.om||0;
  if(!vx&&!vy&&!om){rodSyncAnchors(B,dt);return false;}   // 静止的杆零开销（大多数帧都是这条）
  B.th=(B.th||0)+om*dt;
  B.x+=vx*dt;B.y+=vy*dt;
  // ---- 护栏③：耗散 ----
  // 杆是「轻质杆」= 无质量，不受重力（stepPhysics 的重力语句用 B.kind!=='T' 排除了杆）。
  // 杆悬在空中是正确行为，不要当成重力失效去修。杆与 W 体的区别在于谁积分：W 归 Matter，杆归 rodIntegrate。
  // 除了杆端锚点（rodSyncAnchors 的铰链投影）外杆没有持续支撑约束，冲量进来只能靠这里耗散。
  // 用与 dt 无关的指数衰减而不是逐帧乘常数：子步是 240Hz，逐帧乘会把「1 秒」变成 1/240 秒。
  var kd=Math.pow(ROD_VKEEP,dt);
  B.vx*=kd;B.vy*=kd;B.om*=kd;
  if(Math.abs(B.vx)<0.5)B.vx=0;
  if(Math.abs(B.vy)<0.5)B.vy=0;
  if(Math.abs(B.om)<0.002)B.om=0;
  // 积分之后再解锚点约束（顺序原因见函数开头）
  rodSyncAnchors(B,dt);
  return true;
}
