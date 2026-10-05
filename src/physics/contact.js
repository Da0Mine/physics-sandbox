/* 完全弹性接触守卫与圆的滚动摩擦 */
import Matter from 'matter-js';
import { EL_Z, bodies } from '../core/dom.js';
import { grab } from '../input/pointer.js';
import { GRAV } from '../params/defs.js';
import { wEffE, wEffMu, wMuIdeal } from './material.js';
import { MW } from './matter.js';
import { PHYS_MODE } from '../ui/settings.js';

/* ---- 完全弹性接触的能量守恒守卫（elasticContactFix）----
 * Matter 的迭代求解器无法精确复现 e=1：纯垂直弹跳（air=0、rest=1）逐次出/入射速度比平均 0.966，
 * 每跳丢 ~3.4% 速度，偶尔倒赚 0.14%（手绘开链因此越翻越快）。损耗在求解器内部，无法关掉：
 *   Resolver.solveVelocity 中 Z=(1+restitution)*normalVelocity*Y 累加进 normalImpulse，累积器被钳到 ≤0；
 *   法向速度 U < −2·timeScale 时走投机冲量分支、累积器重置为 0；4 子步 × 1/240s（timeScale=0.25）一拍内多次分叉。
 * 所以在应用层显式守恒：每子步前记录求解器视角的速度（position−positionPrev；solveVelocity 只读写
 * positionPrev/anglePrev，不读 velocity），子步后对声明弹性 ≥1 的活动接触，把接触点法向相对速度恢复成入射值的镜像；
 * 切向交给 Matter 摩擦。恢复值等于入射值 ⇒ 不丢能也不注能。
 * 安全门（避免永久微弹）：
 *   · 只在 vr0<0（在接近）且 vr1>0（求解器已弹开）时动作；静置接触两条件都不满足，不碰。
 *   · 门限用用户声明值 wEffE(B)≥1，不用 pair.restitution：后者被「μ=0 极值对 → rest=1」覆写过，
 *     按它开门会让 μ=0 的方块落地永远弹跳。
 *   · μ=0 的体走 EL_Z 名单进同一机制，但额外要求双方均非地面/墙：场上曲面（凹槽/圆弧）上的滑动接触守恒，
 *     μ=0 方块落地面维持衰减弹跳。
 *   · 冲量按接触点算（含 r×n 角向项），开链翻滚也能正确约束到角动量。 */
export const VR_EPS=0.002;
// 逐点镜像的目标应是求解器看到的入射速度，但 snapVelocities 的快照在 Engine.update 之前抓，
// 缺本子步的重力增量（Body.update 中 Δv = g.y·g.scale·dt²）；位置求解器（12 次迭代）把物体顶出穿透时
// 还有一份同量级的亏损。倍数为实测标定（圆 r=36、g=2.6、dt=1000/240）：每跳高度损失 1×→1.4%、2×→0.30%、
// 2.5×→0.05%、3×→净增益 +0.3%。只依赖重力 × 子步 dt²，与质量/半径/弹性无关。设 0 即关闭补偿（纯逐点镜像）。
export const ECF_GRAV_COMP=2.5;
// EL_Z 速度恢复目标的重力补偿倍数。不要取 1.0：1× 虽与 budgetClean 的记账口径一致，但 s0 是恢复目标
// （无接触时应有速率），1× 让目标偏低、补偿不足。实测（确定性 4×240Hz、6s 平均能量）：1.0 → 漂移 -6.0%
// （圆在凹槽里越滑越低），1.25 → -0.9%。此参数直接决定可感行为，改动须重新测漂移。
export const ECF_Z_GCOMP=1.25;
export function substepGravityDelta(){
  if(!MW||!MW.engine||!MW.engine.gravity)return 0;
  var dt=1000/240;                    // 与 stepMatter 的子步完全一致
  return MW.engine.gravity.y*MW.engine.gravity.scale*dt*dt;
}
export function perfectElasticMB(){
  var out=[];
  EL_Z.length=0;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.dead||!B.mb)continue;
    if(wEffE(B)>=0.999)out.push(B.mb);
    else if(wMuIdeal(B))EL_Z.push(B.mb);   // 只收显式 μ=0 的体（高中默认 μ=0 不算，见 wMuIdeal）
                                           // ⚠ 必须是 else if：e≥1 与显式 μ=0 同时成立时只能进 EL，否则两条补偿通道各处理一遍。
  }
  return out;
}
export function snapVelocities(pre){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i],b=B.mb;
    if(!b||B.dead||b.isStatic)continue;
    var e=pre[b.id];
    if(!e)e=pre[b.id]=[0,0,0];
    e[0]=b.position.x-b.positionPrev.x;      // 求解器视角的线速度
    e[1]=b.position.y-b.positionPrev.y;
    e[2]=b.angle-b.anglePrev;                // 求解器视角的角速度
  }
}
export function impAt(b,dvx,dvy,dw){
  // 冲量同时写 velocity 与 positionPrev/anglePrev：Matter 用后者做积分与求解，
  // 前者是 Engine.update 末尾 _bodiesUpdateVelocities 同步出来的对外读数 —— 两边都改才自洽。
  b.velocity.x+=dvx;b.velocity.y+=dvy;b.angularVelocity+=dw;
  b.positionPrev.x-=dvx;b.positionPrev.y-=dvy;b.anglePrev-=dw;
}
// 圆的慢速撞击恢复补偿（circleRestitutionFix）。
// 根因（对照 Matter 0.20 Resolver.solveVelocity）：Z=(1+e)·U·Y 不判接近/分离，每轮都算：
//   · 快分支 U<u（u=-_restingThresh·l=-2×0.25=-0.5px/子步 = -120px/s）：normalImpulse=0，一次性全量反弹，干净；
//   · 慢分支（|U|<120px/s）：ni+=Z; ni>0⇒ni=0; Z=ni-ni_prev，没有分离判定，反弹后 U 反号、累加器往回吐，反弹被追回。
//   velocityIterations=8 ⇒ v→(−e)^8·v₀≈0.0054·v₀：80px/s 撞击后只剩 0.63px/s，球当场睡死（快球会弹、慢球急刹）。
// 修法：在 collisionStart（Pairs.update 之后、求解器之前）自己施加标准弹性冲量 j=−(1+e)·Un/(iA+iB)，
//   再把该 pair 本步 restitution 置 0 ⇒ 求解器看到「已在分离 + 累加器为 0」，无追回，e 精确兑现。
//   置 0 只影响本步：Pairs.update 每步从两个体重算 pair.restitution。
// 四条门控收窄作用面，缺一不可：
//   ① 只对 W 圆（wshape==='circle'）；② 高中 e=0 / e≥0.98（EL 有自己的补偿）跳过；
//   ③ 只修慢速撞击（8..120px/s），快分支本来就对，保既有标定；
//   ④ |Un| ≥ 0.5·|vRel|（正面撞）：沿曲面滚动换段的小法向分量（100px/s 滚过 5° 折角 ⇒ Un≈8.7px/s）不算碰撞，否则球面一路小跳。
export const REST_FIX_HZ=240;        // 子步频率（1/s），与 stepMatter / substepGravityDelta 一致
export const REST_FIX_VMAX=118;      // px/s：Matter 快分支门限 120 之下留 2px/s 余量
export const REST_FIX_VMIN=8;        // px/s：低于此按静置处理（球贴地/贴壁的常态）
export const REST_FIX_COS=0.5;       // |Un|/|vRel| 下限：正面撞击才算
export function circleRestitutionFix(ev){
  if(!MW||!MW.engine||PHYS_MODE==='high')return;
  if(typeof window!=='undefined'&&window.__L&&window.__L.restFix===false)return;  // 探针 A/B 开关
  var list=(ev&&ev.pairs)||(MW.engine.pairs&&MW.engine.pairs.collisionStart);
  if(!list||!list.length)return;
  for(var pi=0;pi<list.length;pi++){
    var pr=list[pi];
    if(!pr||pr.isSensor||!pr.collision)continue;
    var col=pr.collision,n=col.normal;
    if(!n)continue;
    var mA=col.parentA||col.bodyA,mB=col.parentB||col.bodyB;
    if(!mA||!mB)continue;
    var BA=null,BB=null,Bc=null,i;
    for(i=0;i<bodies.length;i++){
      var X=bodies[i];
      if(!X||X.dead||!X.mb)continue;
      if(X.mb===mA)BA=X;else if(X.mb===mB)BB=X;
    }
    if(BA&&BA.kind==='W'&&BA.wshape==='circle')Bc=BA;
    else if(BB&&BB.kind==='W'&&BB.wshape==='circle')Bc=BB;
    if(!Bc||Bc.dead)continue;
    if(grab&&grab.kind==='body'&&(grab.obj===BA||grab.obj===BB))continue;
    var e=wEffE(Bc);
    if(!(e>0)||e>=0.98)continue;                    // 高中 0 / EL(e≈1) 走各自的既有通道
    var vax=mA.position.x-mA.positionPrev.x,vay=mA.position.y-mA.positionPrev.y,
        vbx=mB.position.x-mB.positionPrev.x,vby=mB.position.y-mB.positionPrev.y;
    var rx=vax-vbx,ry=vay-vby;                      // 接触点相对速度（px/子步）
    var Un=n.x*rx+n.y*ry;                           // <0 = 正在接近
    var spd=-Un*REST_FIX_HZ;                        // px/s
    if(spd<REST_FIX_VMIN||spd>REST_FIX_VMAX)continue;
    var vm=Math.sqrt(rx*rx+ry*ry);
    if(vm<=0||(-Un)<REST_FIX_COS*vm)continue;
    var ia=(mA.isStatic||mA.isSleeping)?0:mA.inverseMass;
    var ib=(mB.isStatic||mB.isSleeping)?0:mB.inverseMass;
    var den=ia+ib;
    if(!(den>0))continue;
    var j=-(1+e)*Un/den;                            // >0（Un<0）
    if(ia>0)impAt(mA,j*n.x*ia,j*n.y*ia,0);
    if(ib>0)impAt(mB,-j*n.x*ib,-j*n.y*ib,0);
    pr.restitution=0;                               // 本步求解器不再加自己的 e ⇒ 无 clawback
  }
}
// 圆的模式化摩擦（circleRollStep）：
//   高中：圆 = 质点，不自转（ω≡0）。触地点滑移恒等于平动速度，Matter 的 μ 通道全程按整体滑动摩擦作用（匀减速 a≈μg）。
//   大学：圆 = 刚体纯滚动（不打滑）：μ 是滚动阻力系数（a=μ_r·g，匀减速停下）；撞击造成的接触点滑移由本函数处理，
//         不靠 Matter 的库仑摩擦（它会啃平动）。
// 为什么需要（大学，R=72.325px，λ'=0.5 实测）：球以 500px/s 纯滚动撞右墙，反弹把 vx 翻成 −260（e=0.52），
//   墙接触点在腰部、力矩≈0，ω 几乎不变 ⇒ 触地点滑移 −757px/s，动摩擦 12 帧把平动啃到 −8px/s（解析 (2vx+ωR)/3），
//   反弹后只走 53px，表现为「先很快、一小段后骤降」。纯滚动语义下反弹是整体运动状态的反转，ω 必须跟着 v 走。
// 逐子步执行（与 elasticContactFix 同级）：碰撞注入的速度突变必须在下一子步前归位，否则被求解器当滑移啃掉。
//   ① 高中：ω 归零；② 倒着滚 ⇒ ω 跟随 v，平动不改；④ 滚动阻力 a=μ_r·g 沿切向反对滚动，ω 同步。
// ⚠ 单位：impAt 的实参是「每子步位移」口径（写进 positionPrev/anglePrev），mb.velocity / angularVelocity 是「每 1/60s」口径；
//   下次 Body.update 用 (position−positionPrev)×correction 重算速度，correction = _baseDelta/子步delta = 4，
//   所以 impAt(dv) 的持久效果是 Δvelocity = 4·dv。本函数的速度口径增量写进 impAt 前一律除以 SUBSC，
//   漏了就逐子步 ×(−3) 发散（ω 涨到 1e18）。circleRestitutionFix 的 Un 取自 position−positionPrev，本就是位移口径。
export const ROLL_BACK_SLIP_ABS=15; // px/s：|滑移| 下限（慢速撞击也要管：34px/s 撞击的滑移仅 52px/s）
export const ROLL_BACK_SLIP_REL=0.2;// 相对下限：|滑移| > 0.2·|v|（尺度无关）
export const ROLL_RESIST_G=1;        // 滚阻标定：a = μ_r·g × 本系数（1 = 直接把 μ 当滚动阻力系数）
export const ROLL_SUP_NY=0.3;        // 主接触必须「够像支撑面」：|n_y| ≥ 0.3（≈ 倾斜 ≤72.5°）
export function circleRollBodies(){
  if(!MW)return null;
  var out=null;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B||B.dead||B.kind!=='W'||!B.mb||B.wshape!=='circle'||!B.rad)continue;
    if(B.mb.isStatic||B.fixed||B.mb.isSleeping)continue;
    if(grab&&grab.kind==='body'&&grab.obj===B)continue;
    (out||(out=[])).push(B);
  }
  return out;
}
// 子步前的平动速度快照，供 circleRollStep 度量本子步速度突变。
// 必须在 Engine.update 之前取（更新后已是碰撞后的速度，量不出接近速度）。
export function circleRollSnap(list){
  if(!list)return;
  for(var i=0;i<list.length;i++){
    var B=list[i];
    if(!B||!B.mb)continue;
    var p=B._crPrev||(B._crPrev={x:0,y:0});
    p.x=B.mb.velocity.x;p.y=B.mb.velocity.y;
  }
}
export function circleRollStep(list,dt){
  if(!list||!MW||!MW.engine)return;
  // 速度口径 → impAt（每子步位移）口径 的换算比（见函数上方「口径」注释）
  var SUBSC=(Matter.Common&&Matter.Common._baseDelta>0&&dt>0)
    ?(Matter.Common._baseDelta/(dt*1000)):1;
  if(!(SUBSC>0.1)&&!(SUBSC<-0.1))SUBSC=1;
  var pl=MW.engine.pairs.list,pln=pl.length,i,k;
  for(i=0;i<list.length;i++){
    var B=list[i],mb=B.mb,R=mb.circleRadius||0;
    if(!(R>0)||mb.isStatic||mb.isSleeping)continue;
    // ① 高中：圆是质点，不自转（ω≡0）；摩擦由 Matter 的 μ 通道按整体摩擦负责（滑移 = 平动速度 ⇒ 匀减速）。
    if(PHYS_MODE==='high'){
      if(mb.angularVelocity!==0)impAt(mb,0,0,-mb.angularVelocity/SUBSC);
      continue;
    }
    // 主接触 = 法向最「竖直」的那一对（最像地面的支撑）—— 地面+墙同时接触时取地面。
    var best=-1,ptx=0,pty=0,pnx=0,pny=0,pca=0,pcb=0,PO=null,PSt=false;
    for(k=0;k<pln;k++){
      var p2=pl[k];
      if(!p2.isActive||p2.isSensor||!p2.collision)continue;
      var a2=p2.bodyA,b2=p2.bodyB;
      if(a2!==mb&&b2!==mb)continue;
      var sp=p2.collision.supports;
      if(!sp||!sp.length)continue;
      var P=sp[0],rx=P.x-mb.position.x,ry=P.y-mb.position.y;
      var rl=Math.sqrt(rx*rx+ry*ry);
      if(rl<1e-6)continue;
      var nx2=rx/rl,ny2=ry/rl;
      if(Math.abs(ny2)<=best)continue;
      PO=(a2===mb)?b2:a2;PSt=!!(PO.isStatic||PO.isSleeping);
      best=Math.abs(ny2);pnx=nx2;pny=ny2;ptx=-ny2;pty=nx2;  // t = n 逆时针 90°
      pca=rx*pty-ry*ptx;                            // (r_A × t)_z（圆 ⇒ = R）
      pcb=(P.x-PO.position.x)*pty-(P.y-PO.position.y)*ptx;
    }
    // 主接触必须够像支撑面（|n_y| ≥ ROLL_SUP_NY）：撞墙时球被撞得微微离地，地面对可能不活跃，主接触落到墙上；
    // 墙接触点在腰部、切向竖直 ⇒ 无滑移目标 ω≈0，会把自旋整条归零、抹掉「倒着滚」特征，反弹后仍被摩擦啃掉 39%。竖直墙 |n_y|≈0，被排除。
    if(best<ROLL_SUP_NY||!PO)continue;
    // 本体的有效 μ（读数与物理同源）
    var mu=wEffMu(B);
    // 摩擦存在性闸门：pair.friction = min(A,B)，任一方为 0 就没有摩擦维持纯滚动。没有摩擦却强行不打滑 = 凭空注入转动能
    // （实测自旋峰值 0.13→0.66、12s 高度下沉 +3%→+12%）。μ_pair=0 时让位给「滑」，这正是光滑面的物理语义。
    var muP=Math.min(mu,(PO&&typeof PO.friction==='number')?PO.friction:mu);
    // 对方在接触点的速度（睡眠/静态体 = 0）
    var ovx=PSt?0:PO.velocity.x,ovy=PSt?0:PO.velocity.y,ow=PSt?0:PO.angularVelocity;
    // 无滑移目标 ω（纯滚动应有的自旋）与当前接触点滑移
    var wt=((ovx-mb.velocity.x)*ptx+(ovy-mb.velocity.y)*pty+ow*pcb)/pca;
    var slip=(mb.velocity.x-ovx)*ptx+(mb.velocity.y-ovy)*pty+mb.angularVelocity*pca-ow*pcb;
    // 判据 = 球在「倒着滚」（目标 ω 与实际 ω 反号）且滑移超过阈值：撞墙反弹的特征——平动被翻向，墙接触点在腰部、力矩≈0，ω 不动。
    // 不要用事件型判据：
    //   · 「滑移 > 固定阈值」：慢速撞击（34px/s ⇒ 滑移仅 52px/s）会漏掉；
    //   · 「本子步切向速度突变 > 阈值」：撞墙那一子步地面接触常不活跃，主接触落到墙上，切向投影≈0，漏判；
    //   · 「每子步施加静摩擦冲量消滑移」：与 Matter 在手绘复合体上的多接触约束打架，虚假自旋峰值 0.44→0.77。
    // 状态型判据：稳态（含笔画上的虚假自旋）自旋与平动同号，不触发；触发后 ω 写到无滑移值、滑移归零，自限。
    // 稳态滑移交给 Matter 的摩擦（它本身会把滑→滚收敛到纯滚动），这里只管撞击。
    // 滑移阈值必须尺度无关：max(ROLL_BACK_SLIP_ABS, ROLL_BACK_SLIP_REL·|v|)；写死 90px/s 时慢速撞击漏判，反弹速度被摩擦啃光。
    if(muP>0){
      var spd=Math.sqrt(mb.velocity.x*mb.velocity.x+mb.velocity.y*mb.velocity.y)*60;
      var thr=Math.max(ROLL_BACK_SLIP_ABS,ROLL_BACK_SLIP_REL*spd);
      if(wt*mb.angularVelocity<0&&Math.abs(slip*60)>thr){
        // ② 倒着滚：ω 跟随 v，平动（碰撞刚给的）不改，只把 ω 重算到纯滚动值
        impAt(mb,0,0,(wt-mb.angularVelocity)/SUBSC);
      }
    }
    // ④ 滚动阻力 a = μ_r·g：沿切向反对滚动，ω 同步（保住纯滚动 ⇒ 球匀减速自然停下）。
    //    只写球、不写对方 —— 滚阻是变形耗散，不是接触力对；写对方会把下面的板凭空推走。
    if(mu>0&&Math.abs(pca)>1e-9){   // mu 已在本函数上方算过（同为 wEffMu 口径）
      var vr=(mb.velocity.x-ovx)*ptx+(mb.velocity.y-ovy)*pty-ow*pcb;   // 球心相对接触面的切向速度
      var dv=mu*GRAV*dt/60*ROLL_RESIST_G;                              // px/s² → velocity 口径
      if(dv>Math.abs(vr))dv=Math.abs(vr);                              // 不许冲过零
      if(dv>0){
        var sg=-(vr>0?1:-1)*dv;
        impAt(mb,sg*ptx/SUBSC,sg*pty/SUBSC,-sg/(pca*SUBSC));
      }
    }
  }
}
export function elasticContactFix(pre,EL){
  // 守恒预算：多对同时接触时（手绘开链贴地的常态，每条贴地段与地面各成一对）逐点镜像会累加超调——
  // 每个点的补入都 ≤ 它自己的入射量，但 N 个接触共享同一份入射动能，加起来会超过它（实测越弹越高、飞出屏幕顶）。
  // 所以本子步允许注入的动能上限 = 子步前总动能 KE0；预算耗尽就按精确公式截断成部分反射
  // （N 点同时全镜像是超定的，部分反射才是一致解）。下一子步重计预算；单接触时 s 恒为 1，等同逐点镜像。
  // 先补本子步重力增量，让 vr0 与求解器实际看到的一致（见 ECF_GRAV_COMP）。pre 里只有动态体（snapVelocities 跳过 isStatic），
  // 双方都动态时增量为共模、在 vr0 中抵消；一边静态时正是求解器多看到的那一份。
  // EL_Z（μ=0 体）走速度大小恢复路径，需要清洁预算：下落阶段重力注能会让 budget=KE0−KEcur 偏紧（KEcur 含 1× 重力增益），
  // 清洁口径把 μ=0 球凹槽滚动 7s 衰减从 -27% 拉到 -1.18%。raw = 未加重力补偿的快照；gravGain = 本子步真实重力动能增量（1×）。
  var KE0=0,KEcur=0,i5,b5,KE0raw=0,gravGain=0,gdS2=0,raw=null;
  if(EL_Z.length){
    gdS2=substepGravityDelta();
    raw={};
    for(var gk0 in pre)raw[gk0]=[pre[gk0][0],pre[gk0][1],pre[gk0][2]];
  }
  if(ECF_GRAV_COMP>0){
    var gd=ECF_GRAV_COMP*substepGravityDelta();
    if(gd!==0){for(var gk in pre)pre[gk][1]+=gd;}
  }
  for(i5=0;i5<bodies.length;i5++){
    b5=bodies[i5].mb;
    if(!b5||b5.dead||b5.isStatic)continue;
    var e5=pre[b5.id];
    if(e5)KE0+=0.5*b5.mass*(e5[0]*e5[0]+e5[1]*e5[1])+0.5*b5.inertia*e5[2]*e5[2];
    if(raw){
      var er=raw[b5.id];
      if(er){
        KE0raw+=0.5*b5.mass*(er[0]*er[0]+er[1]*er[1])+0.5*b5.inertia*er[2]*er[2];
        gravGain+=0.5*b5.mass*(2*er[1]*gdS2+gdS2*gdS2);
      }
    }
    var vx5=b5.position.x-b5.positionPrev.x,vy5=b5.position.y-b5.positionPrev.y,
        w5=b5.angle-b5.anglePrev;
    KEcur+=0.5*b5.mass*(vx5*vx5+vy5*vy5)+0.5*b5.inertia*w5*w5;
  }
  var budget=KE0-KEcur;                  // 还允许注入多少动能（负 = 已经超额，只许再减）
  var budgetClean=raw?KE0raw-KEcur+gravGain:budget;   // 清洁口径：真实求解器损耗
  var inZDone={};                        // 每子步每体只处理一次（凹槽多段同时接触时防过度修正）
  var list=MW.engine.pairs.list;
  for(var i=0;i<list.length;i++){
    var pr=list[i];
    if(!pr.isActive||pr.isSensor)continue;
    var col=pr.collision,A=col.parentA,B=col.parentB;
    var inEL=EL.indexOf(A)>=0||EL.indexOf(B)>=0;   // 用户声明 e≥1 的体
    var inZ=EL_Z.indexOf(A)>=0||EL_Z.indexOf(B)>=0; // μ=0 极值体
    if(!inEL&&!inZ)continue;
    // μ=0 极值体（EL_Z）不查 pair.restitution（⑥ 置 1 在帧末才执行，子步内看到的仍是出厂值），名单本身就是判据。
    // 地面/墙门：μ=0 方块落地面保持衰减弹跳，只有场上物体之间的曲面接触才补偿。
    if(inEL&&pr.restitution<0.999)continue;        // EL 场景：求解器子步内真按 e≥1 解（原语义）
    if(!inEL&&(A===MW.ground||A===MW.wl||A===MW.wr||A===MW.wt||B===MW.ground||B===MW.wl||B===MW.wr||B===MW.wt))continue;
    // 贴合滑动接触的 vr 只有 ~0.01 量级（VR_EPS=0.002 会把它们全当「没在接近」）——
    // EL_Z 场景放宽到 0.0005，让双接触接缝处的微干涉也能被预算机制精确补偿。
    var eps=inZ?0.0005:VR_EPS;
    // 字段名：Matter 0.20 求解器读的是 pair.contacts / pair.contactCount，activeContacts 是旧版命名。
    var cts=pr.contacts||pr.activeContacts;
    var ct=cts&&cts.length?cts[0]:null;
    if(!ct)continue;
    var n=col.normal,v=ct.vertex;
    var rAx=v.x-A.position.x,rAy=v.y-A.position.y;
    var rBx=v.x-B.position.x,rBy=v.y-B.position.y;
    var pA=pre[A.id]||[0,0,0],pB=pre[B.id]||[0,0,0];
    var vr0=n.x*((pA[0]-rAy*pA[2])-(pB[0]-rBy*pB[2]))
           +n.y*((pA[1]+rAx*pA[2])-(pB[1]+rBx*pB[2])); // 子步前接触点法向相对速度
    // μ=0 滑动接触的 vr0≈0（贴着表面滑），但曲面分段的方向离散仍每子步杀速；用「接近」门会挡掉大部分 inZ 接触
    // （实测 85%，补偿只覆盖 ~20%）。所以 inZ 路径改用速度本身判静置（见下方 s0 门），EL 镜面路径保留「接近」门。
    if(vr0>=-eps&&!inZ)continue;                         // 不在接近 → 不管（仅 EL 镜面路径）
    var aAx=A.position.x-A.positionPrev.x,aAy=A.position.y-A.positionPrev.y,aAa=A.angle-A.anglePrev;
    var bBx=B.position.x-B.positionPrev.x,bBy=B.position.y-B.positionPrev.y,bBa=B.angle-B.anglePrev;
    var vr1=n.x*((aAx-rAy*aAa)-(bBx-rBy*bBa))
           +n.y*((aAy+rAx*aAa)-(bBy+rBx*bBa));         // 子步后
    if(inZ){
      // ---- EL_Z：每体总速率恢复（受预算限制）+ 棘轮钳制，弹跳/滑动一视同仁 ----
      // budgetClean = KE0raw − KEcur + gravGain，gravGain 恰为本子步重力动能增量 ½m(2·vy·gdS2+gdS2²)，
      //   ⇒ budgetClean = 无摩擦时应有动能 − 实际动能 = 能量亏损。求解器对 μ=0 体只应移除法向重力分量
      //   （法向力对刚体面不做功），但 Baumgarte 位置修正会额外吃掉切向能量，表现为 budgetClean>0，恢复即可。
      // 不按「是否弹跳」设门：凹槽里的球始终在滑动，带弹跳门时补偿从不触发。dKE>0 时受预算限制恢复，dKE<0 时钳制。
      // 方向沿求解器后速度 (qx,qy) 缩放（方向已由求解器处理），只补幅度；inZDone 防凹槽多段同时处理同一体导致累加超调。
      // 静置门：s0 < 2·gdS2 跳过（只受重力压在面上，无真实运动）。
      // 已知限制（未修）：曲面上仍慢速漏能（实测 9s 摆幅 弧 −33%、凹槽 −61%），预算几乎总在 ~1e-12 被掐断。
      //   恢复目标是自由落体速度幅度 s0=|v_raw+(0,gdS2)|，在斜坡/凹面上重力有切向分量、自由落体速度大于约束速度，
      //   过度补偿与求解器损耗互相抵消。去掉预算门全额恢复无净收益（在夹具抖动带内），且预算是不变式，不要去掉。
      //   正解方向：恢复目标改成切向速度（求解器对 μ=0 的切向冲量与法向无关），法向交给 rest=1 的求解器。
      var bodies2=[];
      if(!A.isStatic)bodies2.push(A);
      if(!B.isStatic)bodies2.push(B);
      for(var bi=0;bi<bodies2.length;bi++){
        var bd=bodies2[bi],pe=raw[bd.id]||[0,0,0];
        if(inZDone[bd.id])continue;
        var pvx=pe[0],pvy=pe[1]+ECF_Z_GCOMP*gdS2;
        var s0sq=pvx*pvx+pvy*pvy;
        if(s0sq<gdS2*gdS2*4)continue;             // 静置: s0≈gdS2 → 跳过
        var qx=bd.position.x-bd.positionPrev.x,qy=bd.position.y-bd.positionPrev.y;
        var s1sq=qx*qx+qy*qy;
        if(s1sq<1e-18)continue;
        var s0=Math.sqrt(s0sq),s1=Math.sqrt(s1sq);
        var KE0b=0.5*bd.mass*s0sq;
        var KE1b=0.5*bd.mass*s1sq;
        var dKE=KE0b-KE1b;
        if(Math.abs(dKE)<1e-12)continue;
        inZDone[bd.id]=true;
        if(dKE>0){
          // 能量减少：受预算限制恢复（弹跳/滑动均恢复，budgetClean 已扣除重力分量）。曲面漏能的已知限制见上方注释。
          var cap=Math.max(0,budgetClean);
          if(cap<=1e-12)continue;
          var tf=Math.min(1,cap/dKE);
          var sf=Math.sqrt(KE0b/KE1b);
          var es=1+tf*(sf-1);
          budget-=tf*dKE;budgetClean-=tf*dKE;
          impAt(bd,qx*(es-1),qy*(es-1),0);
        }else{
          // 能量增加(棘轮):钳制到 s0(不限预算,增预算)
          var sf2=Math.sqrt(KE0b/KE1b);
          budget-=dKE;budgetClean-=dKE;
          impAt(bd,qx*(sf2-1),qy*(sf2-1),0);
        }
      }
      continue;
    }
    if(vr1<=eps)continue;                                // 求解器没把它弹开（静置/仍在压入）→ 不管
    var d=(-vr0)-vr1;                                    // 目标 = 入射值的镜像（完美反射）
    if(Math.abs(d)<eps)continue;
    var ima=A.isStatic?0:A.inverseMass,imb=B.isStatic?0:B.inverseMass;
    var iia=A.isStatic?0:A.inverseInertia,iib=B.isStatic?0:B.inverseInertia;
    var X=rAx*n.y-rAy*n.x,Q=rBx*n.y-rBy*n.x;            // cross(r,n)
    var K=ima+imb+iia*X*X+iib*Q*Q;                      // 接触点法向有效质量倒数
    if(K<=1e-12)continue;
    var J=d/K;
    // 守恒预算：施满 J 的精确动能增量 dke=(vr0²−vr1²)/2K；超出预算就求部分系数
    // s（ΔKE(s·J)=budget 的正根，s∈(0,1) = 部分反射），冲量按 s·J 施加。
    var dke=(vr0*vr0-vr1*vr1)/(2*K);
    if(dke>budget){
      if(budget<=1e-12)continue;         // 预算耗尽：这一子步不再注入，只保留求解器自己的结果
      var sB=(-vr1+Math.sqrt(vr1*vr1+2*budget*K))/d;   // s·d·(2vr1+s·d)/2K = budget 的正根
      if(!(sB>0&&sB<1))continue;
      J*=sB;
      dke=sB*d*(2*vr1+sB*d)/(2*K);
    }
    budget-=dke;                         // 负 dke（削超额）会反过来把预算加回来 —— 与 KEcur 一致
    impAt(A, n.x*J*ima, n.y*J*ima, iia*J*X);
    impAt(B,-n.x*J*imb,-n.y*J*imb,-iib*J*Q);
  }
}
