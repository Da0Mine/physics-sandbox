/* 光滑铰链 */
import Matter from 'matter-js';
import { BODY } from '../bodies/body.js';
import { shortAng } from '../core/math.js';
import { conProj, conPull } from './constraint.js';
import { CON_DRAG_STEP } from './rope.js';
import { refreshSpringGeom, springAnchoredWorld, springSyncEnds } from './spring.js';
import { grab } from '../input/pointer.js';
import { MW } from '../physics/matter.js';
import { cvx } from '../render/render.js';

export const HINGE_FOLD_STEP=0.08;   // 限位回转每子步限步（rad），防传送瞬滑（见 hingeFoldLimit）
export const HINGE_FOLD_DMAX=2;      // 闭合门：两端距离超过此值视作「未钉合成销」，限位跳过
// 光滑铰链：长度恒 0（两锚点重合）。不设 ks/damp —— 它是约束不是弹簧。
export function makeHinge(cx,cy){
  var B=BODY(cx,cy);
  B.kind='S';
  B.hinge=true;
  B.e0={x:cx,y:cy};B.e1={x:cx,y:cy};
  B.anc=[null,null];
  B.len=0;
  B.bounc=0;
  refreshSpringGeom(B);
  return B;
}
// 光滑铰链：双边约束 —— 两锚点必须重合；固定铰链开关（hfix）开启时有折角限位。
// 二维投影用世界轴 x̂/ŷ 各做一遍：d≈0 时「分离方向」退化，世界轴不退化。
// ---- 绕销展开：把互埋的两个宿主绕销转开（纯旋转 ⇒ 销不动）----
// 为什么必须是绕销旋转而不是平移：
//   Matter 子步能把互埋的宿主顶出去（穿透 26.6px → 0.006px），但随后 conPull 把它平移回销上（d=0），
//   同时把角重新插进对方 ⇒ 帧末（用户所见）穿透 26.6px。平移只能二选一：回销则穿透、让 Matter 顶出则 d≈30px。
//   绕销纯旋转同时满足两者：销是旋转中心，旋转不破坏销，又能把插进去的角转出来
//   （实测穿透 31.47 → 0.288px、销误差 0、帧边界抖动 0）。
// 算法（三步，缺一不可）：
//   ① 方向：0.004rad 小步探测，只取使深度变小的方向；两个方向都不改善 ⇒ 放弃（也挡住面贴面静置这类接触）。
//   ② 步长：牛顿式 Δθ = depth / R，R 取可动宿主的最远顶点到销的距离（不是接触点距离）。
//      绕销转 Δθ 时最深点沿 MTV 法线移动 ≤ R·Δθ ⇒ 用 R 必然欠转、单调收敛（每步剩 (1−r_true/R)·depth，
//      5~6 步进 0.15px）。用接触点距离可能过转：转过头后深度为 0、判收敛，过转量被永久留下，
//      逐帧累积成凭空自转（实测 157 帧累积到 −π/2）。
//      也不能用倍增大步长搜索：销在碰撞面上、边与对方面近共线时可行角窗极窄
//      （|θ| ≤ atan(BND_INK/半边长)，约 2°），大步长会跨过这条缝。
//   ③ 非弹性挡块：方向定下后掐掉继续往互埋方向转的角速度（同 hingeKillOutwardTangential），否则下一帧又转进去。
// 守卫（都不能省）：
//   · 只对两个 W 宿主做：字母刚体没有 Matter 体、杆是运动学镜像、弹簧/绳另有语义；
//   · 只在两者真的会互相碰撞时做（同组豁免见 springSyncGroups）；
//   · hfix（固定铰链=刚接）开启时跳过：相对姿态归 hingeFoldLimit 管，再叠展开就是两个写者互相追打。
// 进入阈值 HINGE_UF_EPS 的标定（W 体碰撞几何 = 墨迹中线外扩 BND_INK=2.325px，两墨线相切时深度即 4.65px）：
//   下端 = 合法邻接构型的天然残差：墨线留 4px 空隙时碰撞体天生重叠 0.65~0.97px。
//     阈值低于它（如 0.15px）会把近贴着的宿主当穿透，展开变成反向角弹簧把铰链焊死
//     （载荷自由转动跨度 171° → 2.6°、双击解不开、拖一个另一个不跟）。
//   上端 = 真互埋规模：用户场景 26.6~36.6px；铰链强制对压时 Matter 自己也能到 4.4px（不处理则 θ 抖 6.6°/帧并缓慢嵌入）。
//   取 2.0px：对下端 0.97px 留 2.06× 余量，对上端 4.4px 留 2.2× 余量。
//   不要取 5px（按 2·BND_INK）：残差停在 Matter 挤压平衡 4.417px，恰好坐在门口，展开时进时出，
//     帧边界 |Δθ| 劣化到 0.1147rad（6.6°/帧）。
export const HINGE_UF_EPS=2.0;        // 进入阈值（px）：见上面的两端夹逼
// 退出阈值（修到什么程度）必须与进入阈值分开：混成一个常量时，为压低残差会把进入门也压到
// 合法邻接残差（0.65~0.97px）以下而误伤自由转动。分开后合法接触进不来，真互埋（4.4~36.6px）
// 进来后牛顿步仍把残差收到亚像素（≈0.18px）。
export const HINGE_UF_DONE=0.2;       // 迭代停止阈值（px）
export const HINGE_UF_PROBE=0.004;    // 方向探测步长（rad）
export const HINGE_UF_MAXDTH=0.35;    // 牛顿单步限幅（rad）
export const HINGE_UF_IT=14;          // 牛顿迭代上限（欠转 ⇒ 需要多几步；实测 5~6 步收敛）
export function hingePairCollision(a,b){
  if(!a||!b)return null;
  if(typeof Matter==='undefined'||!Matter.Collision||!Matter.Collision.collides)return null;
  try{var c=Matter.Collision.collides(a,b);return (c&&c.collided&&c.depth>0)?c:null;}catch(e){return null;}
}
export function hingePairDepth(a,b){var c=hingePairCollision(a,b);return c?c.depth:0;}
export function hingeHostsCanCollide(h0,h1){
  var a=h0&&h0.mb,b=h1&&h1.mb;
  if(!a||!b)return false;
  try{
    if(Matter.Detector&&Matter.Detector.canCollide)
      return !!Matter.Detector.canCollide(a.collisionFilter,b.collisionFilter);
  }catch(e){}
  return true;
}
// 宿主顶点里离销最远的距离（即上面 ② 里的 R：取上界才能保证欠转）
export function hingeMaxVertexRadius(mb,px,py){
  if(!mb||!mb.vertices||!mb.vertices.length)return 0;
  var r=0,i,v,dd;
  for(i=0;i<mb.vertices.length;i++){
    v=mb.vertices[i];
    dd=Math.hypot(v.x-px,v.y-py);
    if(dd>r)r=dd;
  }
  return r;
}
export function hingeContactUnfold(B,h0,h1,dPre){
  if(!B||!h0||!h1)return 0;
  if(h0.kind!=='W'||h1.kind!=='W')return 0;                 // 守卫：只认两个 W 宿主
  if(B.param&&B.param.hfix)return 0;                        // 守卫：固定铰链开着时归 hingeFoldLimit 管
  var a=h0.mb,b=h1.mb;
  if(!a||!b)return 0;
  if(a.isStatic&&b.isStatic)return 0;
  if(!hingeHostsCanCollide(h0,h1))return 0;
  var d0=hingePairDepth(a,b);
  if(!(d0>HINGE_UF_EPS))return 0;
  /* 只在深度确实被本帧 conPull 的平移增大时才展开（dPre = conPull 之前的深度）。
   * 本函数的职责是还掉 conPull 平移回销时插进去的角；若只看绝对深度，两个宿主重力下静置压合
   * （深度天生 > HINGE_UF_EPS，那是支撑而非干涉）也会被每帧转开、重力又压回 ⇒ 极限环（来回卡）。
   * 静置压合时 conPull 不平移 ⇒ d0≈dPre ⇒ 不展开；真互埋（拖拽/初始构型）时 d0>dPre ⇒ 照旧处理。
   * 0.5px 余量留给求解器帧间噪声。 */
  if(dPre!=null&&!(d0>dPre+0.5))return 0;
  var i0=a.isStatic?0:(a.inverseMass||0),i1=b.isStatic?0:(b.inverseMass||0);
  var Wm=i0+i1;
  if(!(Wm>0))return 0;
  // 宿主位姿回写：springAnchoredWorld 读的是产品字段 h.th，而 Matter.Body.rotate 只改 mb.angle。
  //   漏掉 ⇒ 随后的 springSyncEnds 用过期角度重算锚点而发散。
  if(h0.mb){h0.x=a.position.x;h0.y=a.position.y;h0.th=a.angle;}
  if(h1.mb){h1.x=b.position.x;h1.y=b.position.y;h1.th=b.angle;}
  var px=(B.e0.x+B.e1.x)/2,py=(B.e0.y+B.e1.y)/2;             // 销（conPull 之后两端已重合）
  var rot=function(s){
    if(i0)Matter.Body.rotate(a,-s*i0/Wm,{x:px,y:py});
    if(i1)Matter.Body.rotate(b, s*i1/Wm,{x:px,y:py});
  };
  // ① 方向探测
  rot(HINGE_UF_PROBE);  var dp=hingePairDepth(a,b); rot(-HINGE_UF_PROBE);
  rot(-HINGE_UF_PROBE); var dm=hingePairDepth(a,b); rot(HINGE_UF_PROBE);
  var sgn=0;
  if(dp<d0)sgn=1; else if(dm<d0)sgn=-1; else return 0;
  // ② 欠转牛顿步：Δθ = depth / R（R = 可动宿主最远顶点到销的距离，按 1/m 加权）
  var Rsum=(i0?hingeMaxVertexRadius(a,px,py)*i0:0)+(i1?hingeMaxVertexRadius(b,px,py)*i1:0);
  var R=Rsum/Wm;
  if(!(R>1))R=Math.max(1,Wm>0?(1/Wm):1);
  var applied=0,last=d0,ok=false;
  for(var it=0;it<HINGE_UF_IT;it++){
    var c=hingePairCollision(a,b);
    if(!c||!(c.depth>HINGE_UF_DONE)){ok=true;break;}         // 退出阈值（≠ 进入阈值，见常量注释）
    var dth=c.depth/R; if(dth>HINGE_UF_MAXDTH)dth=HINGE_UF_MAXDTH;
    var before=c.depth;
    rot(sgn*dth); applied+=dth;
    var nd=hingePairDepth(a,b);
    if(!(nd>HINGE_UF_DONE)){ok=true;break;}
    if(!(nd<before-1e-9))break;                              // 不再改善 ⇒ 这条方向解不出来
    last=nd;
  }
  if(applied>0&&!(ok||last<d0-1e-9)){                         // 净效果没变好 ⇒ 整笔撤销，不留半吊子姿态
    rot(-sgn*applied); applied=0;
    if(h0.mb){h0.x=a.position.x;h0.y=a.position.y;h0.th=a.angle;}
    if(h1.mb){h1.x=b.position.x;h1.y=b.position.y;h1.th=b.angle;}
    return 0;
  }
  if(h0.mb){h0.x=a.position.x;h0.y=a.position.y;h0.th=a.angle;}
  if(h1.mb){h1.x=b.position.x;h1.y=b.position.y;h1.th=b.angle;}
  // ③ 非弹性挡块（a 被转 −s·i0/W、b 被转 +s·i1/W ⇒ 两者的「互埋方向」符号相反）
  if(i1&&(b.angularVelocity||0)*sgn<0)Matter.Body.setAngularVelocity(b,0);
  if(i0&&(a.angularVelocity||0)*sgn>0)Matter.Body.setAngularVelocity(a,0);
  return applied;
}
/* 用真正的 Matter.Constraint 当铰链销。Matter 文档：revolute/pin joint 设 length: 0 和高 stiffness
 * （0.7 以上），不稳定时降低 stiffness 和/或提高 engine.constraintIterations。
 * 关键在求解器跑在哪里：Constraint 跑在 Matter 自己的求解循环里（Gauss-Seidel、constraintIterations 次迭代、
 * 直接改 position/positionPrev），与碰撞解算同一轮迭代，天然不打架。产品级 hingeSolve
 * （conPull 平移 + hingeContactUnfold 绕销转）跑在 Matter 循环之外、每帧才补一次，与碰撞/重力互相追打
 * 形成自维持极限环；入口类守卫（dPre / 销孔门 / 退出阈值 / 跳过 conPull）都无法根治。
 * 只在双端都锚上、且至少一端可动时挂。 */
/* stiffness 取 1：0.7 实测会留下 0.0064rad（0.37°）的残余抖动；length 为 0 时需要 stiffness 1。
 * constraintIterations 用 HINGE_CON_ITER（Matter 默认值 2）。 */
export const HINGE_CON_STIFF=1;
export const HINGE_CON_ITER=2;   // 回到默认迭代数
export function hingeConstraintDrop(B){
  /* 解绑时把宿主标记一起清掉（否则那个体会永远豁免 ω 重建）。 */
  if(B&&B._hconH){for(var qi=0;qi<B._hconH.length;qi++){if(B._hconH[qi])B._hconH[qi]._hconOn=false;}B._hconH=null;}
  if(B&&B._hcon){
    try{Matter.Composite.remove(MW.engine.world,B._hcon);}catch(e){}
    B._hcon=null;
  }
}
export function hingeConstraintSync(B,h0,h1){
  if(MW&&MW.engine&&MW.engine.constraintIterations!==HINGE_CON_ITER)
    MW.engine.constraintIterations=HINGE_CON_ITER;
  if(!B){return null;}
  var a=h0&&h0.mb,b=h1&&h1.mb;
  if(!a||!b||(a.isStatic&&b.isStatic)){hingeConstraintDrop(B);return null;}
  /* 拖拽期让 Constraint 退场：拖拽期位姿权威在 conDragConstrain，再挂 Constraint 等于给同一位姿
   * 加第三个写者 ⇒ 「拖一个另一个跟走」间歇性失败（约 1/3）。静态构型不受影响。 */
  if(grab&&grab.kind==='body'&&grab.obj&&(grab.obj===h0||grab.obj===h1)){hingeConstraintDrop(B);return null;}
  var w0=springAnchoredWorld(B,0),w1=springAnchoredWorld(B,1);
  if(!w0||!w1){hingeConstraintDrop(B);return null;}
  var pa={x:w0.x-h0.x,y:w0.y-h0.y},pb={x:w1.x-h1.x,y:w1.y-h1.y};
  var C=B._hcon;
  if(!C){
    /* 给两个宿主打「被独立铰链钉住」标记，供下面 velocity 重建豁免用
     * （否则被铰链钉住的板几乎不转：5s 只转 0.0085rad）。 */
    h0._hconOn=true;h1._hconOn=true;B._hconH=[h0,h1];
    C=Matter.Constraint.create({bodyA:a,pointA:pa,bodyB:b,pointB:pb,
                                length:0,stiffness:HINGE_CON_STIFF,damping:0.1});
    Matter.Composite.add(MW.engine.world,C);
    B._hcon=C;
  }else{
    C.bodyA=a;C.bodyB=b;C.pointA=pa;C.pointB=pb;C.length=0;C.stiffness=HINGE_CON_STIFF;
    h0._hconOn=true;h1._hconOn=true;B._hconH=[h0,h1];
  }
  return C;
}
export function hingeSolve(B,dt,h0,h1){
  /* 铰链不再双端都锚上时必须摘掉真 Constraint：宿主被删/失效时 springSyncEnds 把 anc[i] 清成 null，
   * 本函数第一行就 return ⇒ hingeConstraintSync（唯一摘除点）永远跑不到，
   * 那条 Matter.Constraint 会留在世界里把两个体隐形地永久钉住。 */
  if(!h0||!h1){hingeConstraintDrop(B);return;}
  var e0=B.e0,e1=B.e1;
  // 铰链是销钉，两锚点必须重合 —— 硬约束。拖拽端 + 铁砧时 conPull 原本无解（w0=w1=0），d 会涨到
  //   368px、drawHinge 画出两条长臂；因此让拖拽端按 1/m 参与位移分配（只开位置通道，见 conMov）。
  var _hingeDPre=hingePairDepth(h0&&h0.mb,h1&&h1.mb);   // conPull 平移之前的深度（供 hingeContactUnfold 判断）
  /* 同步真 Constraint：双端锚上且至少一端可动时挂上；挂不了（只锚一端 / 两端都是铁砧）时摘除，走原行为。 */
  var _hCon=hingeConstraintSync(B,h0,h1);
  /* conPull 照常跑：真 Constraint 与 conPull 的目标相同（两锚点重合），不会打架；
   * 关掉 conPull 反而破坏依赖其行为的既有场景。 */
  conPull(h0,e0.x,e0.y,h1,e1.x,e1.y,0,CON_DRAG_STEP,true);      // 目标 = 0（两锚点重合）
  // 上面「平移回销」的代价是把互埋的角重新插进对方（穿透 0.006 → 26.657px）；
  //   立刻用绕销旋转还掉 —— 旋转不破坏销，却正好把角转出来。
  springSyncEnds(B);                 // 让 e0/e1 落在平移后的真实锚点上（= 销），展开要绕它转
  /* unfold 也照常跑（反直觉）：让它让位反而导致间歇性失败；照常跑则稳定且穿透很小。
   * 原先的极限环是 unfold 与产品级 conPull 抢位姿；现在销由 Matter 求解循环托住，unfold 不再自激。 */
  hingeContactUnfold(B,h0,h1,_hingeDPre);
  conProj(h0,e0.x,e0.y,h1,e1.x,e1.y,1,0,false);
  conProj(h0,e0.x,e0.y,h1,e1.x,e1.y,0,1,false);
  hingeFoldLimit(B,h0,h1);                                // 折角限位
  springSyncEnds(B);
}
// 不要加「卡死门」（两宿主互埋 >1.5px 时让位给 Matter 接触）：它是冗余的；楔死的真因是
//   springSyncGroups 曾把铰链两宿主放进同一个互不碰撞组，修正后接触解算自己就能顶住折叠穿透。
// ---- 折角限位 ----
// 折角 fold = atan2(销→宿主1中心) − atan2(销→宿主0中心)。在两端都锚上那一刻捕获基准
// （springTryAnchor / springTryAnchorByHost），限位判相对基准的偏差 |Δfold|。
// 越限时把两个宿主绕销转回去（不动销本身 ⇒ 位置约束不被破坏）：
//   a0 = −exc·i0/W、a1 = +exc·i1/W（i = 可动体的反质量，static 为 0）
//   ⇒ Δfold = a1 − a0 = exc·(i0+i1)/W = exc 精确归位，重的一侧转得少、铁砧不转。
export function hingeCaptureFold(B){
  if(!B.anc[0]||!B.anc[1]||!B.anc[0].B||!B.anc[1].B){B._hFold0=null;return;}
  var h0=B.anc[0].B,h1=B.anc[1].B;
  var px=(B.e0.x+B.e1.x)/2,py=(B.e0.y+B.e1.y)/2;
  B._hFold0=Math.atan2(h1.y-py,h1.x-px)-Math.atan2(h0.y-py,h0.x-px);
}
export function hingeRotateAboutPin(h,ang,px,py){
  if(!ang||!h.mb||h.mb.isStatic)return;
  Matter.Body.rotate(h.mb,ang,{x:px,y:py});
  h.x=h.mb.position.x;h.y=h.mb.position.y;      // 同帧后续求解/渲染读的是字段
  h.th=(h.th||0)+ang;
}
// 非弹性挡块：限位只回转位置不处理速度时，宿主带着残余切向速度（~110px/s）下一帧又冲出限位，
//   位置修正与速度互斗，把锚点拽滑（销→心距 26→10.1）。把「继续往超限方向转」的切向分量消掉
//   （像碰到止动销）。sign=+1 管 fold 增方向（h1 侧），−1 管 fold 减方向（h0 侧，fold=ang1−ang0）。
export function hingeKillOutwardTangential(h,px,py,sign){
  if(!h||!h.mb||h.mb.isStatic)return;
  var rx=h.x-px,ry=h.y-py,r=Math.hypot(rx,ry);
  if(!(r>1e-3))return;
  var tx=-ry/r,ty=rx/r;                          // ang 增大方向的切向单位向量
  var v=h.mb.velocity||{x:0,y:0};
  var vt=v.x*tx+v.y*ty;
  if(!(vt*sign>0))return;                        // 不是往超限方向 ⇒ 不动
  Matter.Body.setVelocity(h.mb,{x:v.x-tx*vt,y:v.y-ty*vt});
}
export function hingeFoldLimit(B,h0,h1){
  // 由固定铰链开关驱动：关闭（默认）= 完全光滑，相对转动不受限，直接返回；
  //   开启 = 刚接，lim 取 0 ⇒ 折角冻结在基准构型，两侧绕销转回 + 掐掉继续超限的切向速度。
  var fixed=!!(B.param&&B.param.hfix);
  if(!fixed)return;
  var hl=0;
  var lim=hl*Math.PI/180;
  if(lim>=Math.PI*0.999)return;                 // 180° = 不限位（完全光滑）
  // 闭合门：铰链还没钉合成销（两端分开）时「销→两宿主中心的折角」没有物理意义；按拉伸构型捕获的基准
  //   会与 conPull 的回收打架而不收敛（实测两端卡在 d=28.6）。所以 d>HINGE_FOLD_DMAX 时跳过限位并作废基准，
  //   等真正闭合时按闭合构型重新捕获。
  var d0=Math.hypot(B.e1.x-B.e0.x,B.e1.y-B.e0.y);
  if(d0>HINGE_FOLD_DMAX){B._hFold0=null;return;}
  if(B._hFold0==null)hingeCaptureFold(B);
  if(B._hFold0==null)return;                    // 退化解（宿主中心压在销上）⇒ 放弃限位
  var px=(B.e0.x+B.e1.x)/2,py=(B.e0.y+B.e1.y)/2;
  var f=Math.atan2(h1.y-py,h1.x-px)-Math.atan2(h0.y-py,h0.x-px);
  var d=shortAng(f-B._hFold0);
  var over=Math.abs(d)-lim;
  if(!(over>0.001))return;
  var exc=-((d>0)?1:-1)*over;
  // 按子步限步渐进（同 conPull 的 CON_MAXSTEP）：大角度一步转回等于传送，锚点会瞬滑
  //   （销→心距 26 → 14.8）。每步最多转 HINGE_FOLD_STEP，大偏差几帧内收敛。
  var step=HINGE_FOLD_STEP;
  if(exc>step)exc=step;else if(exc<-step)exc=-step;
  var i0=(h0.mb&&!h0.mb.isStatic)?1/(h0.mass||1):0;
  var i1=(h1.mb&&!h1.mb.isStatic)?1/(h1.mass||1):0;
  var W=i0+i1;
  if(!(W>0))return;                             // 两端都是铁砧：限位没意义
  hingeRotateAboutPin(h0,-exc*i0/W,px,py);
  hingeRotateAboutPin(h1, exc*i1/W,px,py);
  // 非弹性挡块：消掉「继续超限」的切向速度（见 hingeKillOutwardTangential 注释）
  hingeKillOutwardTangential(h1,px,py,1);
  hingeKillOutwardTangential(h0,px,py,-1);
}
// 光滑铰链：一个销钉（实心小圆 + 外圈）；两锚点还没重合时用两条细臂连到各自锚点，
// 让「谁连在哪儿」看得见。有一端没锚时，自由端的 e 是上一帧的陈迹（没人再同步），
// 销心取有锚端的位置（e0 同步自宿主，是唯一可靠的坐标）。
export function drawHinge(B){
  var x0=B.e0.x,y0=B.e0.y,x1=B.e1.x,y1=B.e1.y;
  var cx=(x0+x1)/2,cy=(y0+y1)/2;
  var col='rgba(38,34,28,0.85)';
  // 细臂只在至少有一端还没锚上时画：两端都锚住时语义是「两锚点重合」，画面上 d>1.5 只可能是求解滞后
  //   或宿主被顶开的瞬态，画成长臂会被读成「铰链脱开还拖着一根线」。半连接状态才需要臂交代销还挂在哪个点。
  //   不要反过来收紧成「双锚才画」：anc=[null,null] 的桩对象（虚影）会画不出臂。
  var bothAnc=!!(B.anc&&B.anc[0]&&B.anc[1]);
  if(!bothAnc&&Math.hypot(x1-x0,y1-y0)>1.5){
    cvx.strokeStyle=col;cvx.lineWidth=1.4;cvx.lineCap='round';
    cvx.beginPath();cvx.moveTo(x0,y0);cvx.lineTo(cx,cy);cvx.lineTo(x1,y1);cvx.stroke();
  }
  cvx.beginPath();cvx.arc(cx,cy,4.6,0,6.2832);cvx.fillStyle=col;cvx.fill();
  cvx.beginPath();cvx.arc(cx,cy,7.2,0,6.2832);
  cvx.strokeStyle=col;cvx.lineWidth=1.5;cvx.stroke();
}
