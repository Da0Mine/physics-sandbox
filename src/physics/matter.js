/* Matter.js 世界的建立、建体与子步推进（stepMatter） */
import Matter from 'matter-js';
import { wakeSleepNear } from '../bodies/body.js';
import { BND_HH, bndHullLocal, bndSegs, inflateHull, segCompound } from '../bodies/boundary.js';
import { rodDragPinChain, rodDragPinHosts, rodIntegrate, rodSyncAnchors, rodXPBDVel } from '../bodies/rod.js';
import { clamp, shortAng } from '../core/math.js';
import { bodies } from '../core/world.js';
import { conDragConstrain } from '../devices/constraint.js';
import { dragPtrAxis } from '../devices/drag-lock.js';
import { midMagnetPullGhost, midMagnetPullRig } from '../devices/placement.js';
import { springAnchoredWorld, springDragPinRig, springLockedAsmOf, springSyncLocks } from '../devices/spring.js';
import { grab } from '../input/pointer.js';
import { GRAV } from '../params/defs.js';
import { bodyOfMb, bodyPid, peerKeyOf } from '../params/panel.js';
import { EL_Z, circleRestitutionFix, circleRollBodies, circleRollSnap, circleRollStep, elasticContactFix, perfectElasticMB, snapVelocities } from './contact.js';
import { WFRICT_DEF, applyWAir, applyWMul, wAirDef, wMuIdeal, wZeroAir, wfSelfFriction, wfStaticOf } from './material.js';
import { applyGivenAccel, celCenterY } from './step.js';
import { W, groundY } from '../render/render.js';
import { TOOL } from '../ui/toolbar.js';

// 圆形（球）的弹性：落地弹几下并快速收敛，不能永远弹
export const BALL_REST=0.52;      // 碰撞恢复系数（Matter 取双方 max，地面是 0）
// 出厂默认空气阻尼为 0。非零默认值是一条用户看不见的耗散通道：μ=0 时球仍会被拖停、
// e=1 时又与「完全弹性」矛盾。阻尼交给 μ / e 两个旋钮；需要时用面板「空气阻力 air」显式调。
export const BALL_AIR=0;          // 空气阻尼默认（0 = 无空气阻力）
// wair 是全局参数：面板一调，场上所有 W 体（含新生成的）同步生效。WAIR_GLOBAL 为唯一真源；
//   B.wAir 仍随体写一份（applyWAir/复制语义兼容），但读写入口都收敛到全局值。高中模式恒为 0。
// CIRCLE_SIDES：Matter 0.20 没有真圆碰撞，Bodies.circle 是多边形，边数 = ceil(clamp(min(maxSides,R),10,∞))，
//   maxSides 只能调小（R≈22 时恒为 24 边）。接触法线是面法线、偏离径向 ⇒ 每个接触带力臂 ⇒ 虚假角冲量，
//   球被自旋、平动能被抽走（凹槽里表现为越滑越低；实测转动能吸收了 ~85% 的能量损失，与本项目补偿机器无关）。
//   边数扫描（下沉量）：24 边 +8.41%、48 边 +3.79%、96 边 +2.70%。取 48：拿到 81% 的改善，SAT 代价 ~(N+M)² 只涨 4 倍。
//   边数也影响质量（面积×密度，24→48 边 +0.9%）。圆 vs 多边形的精确接触见下面的解析碰撞通道。
export const CIRCLE_SIDES=48;     // W 体「圆」的碰撞多边形边数（越大越接近真圆、虚假力矩越小、SAT 越贵）
// 拖拽悬摆的死区系数：抓点的水平力臂（抓点到质心世界偏移的 x 分量）小于
// DRAG_ROT_DEADBAND×max(hw,hh) 时为平衡区，悬空提着也不转。90px 宽方块平衡带 ±27px；提角/提侧边必转。
export const DRAG_ROT_DEADBAND=0.3;
// 墨迹厚度的唯一真源 BND_INK：物理一律用它，与渲染线宽 BND_HH*1.55 同源。
// 不要在物理里直接用 BND_HH（半厚 3.0）：碰撞体会比可见线（半厚 2.325）胖 0.675px，碰撞箱与笔画对不上。
export let BND_INK;   // 屏幕上墨迹的半厚（px）：画多粗就撞多粗
export let PEN_HW;     // 画线半厚 == 图形半厚 == 墨迹半厚
// 边界（W）速度死区（px/s）：Matter 对静置的多段复合体有 ~1px 级求解器跳变（1.2px/帧 ≈ 72px/s），
// 差分成速度后足以把压在弧上的物体顶飞，故低于此值一律当静止；真正下落/被拖动时速度远大于 120px/s。
export const W_V_DEAD=120;
/* ---- Matter 层：边界的真实刚体物理 ----
 * 手写的准静态倾倒（绕最低接触点转、力矩对平行轴惯量）能让偏心轮廓倾倒，却没有角动量：不会翻滚、
 * 不会摇到一条边上再稳住、碰撞不传递动量。因此边界体放进内嵌的 Matter.js 世界（顺序冲量求解器，
 * 带摩擦、堆叠、睡眠）。公式字母仍用自己的手写物理（场、碎裂、黑洞…），通过下方 bndHit 与边界的边碰撞；
 * t 杆以运动学静态板镜像进 Matter 世界，线条可以落在上面。
 * 重力对齐：Matter 加速度 = gravity.y*1000 px/s²，所以 2.6 对应 GRAV(2600)。 */
export let MW=null;
export function ensureMatter(){
  if(MW)return;
  var E=Matter.Engine.create({enableSleeping:true});
  E.gravity.y=GRAV/1000;                 // 2.6 -> 2600 px/s^2, the same pull the letters feel
  E.positionIterations=12;E.velocityIterations=8;
  var wLayer=Matter.Composite.create({label:'w'});
  Matter.Composite.add(E.world,wLayer);
  // static frame: the ground line plus two off-screen walls (a dragged-and-released line must
  // never be able to fall out of the world). Cleared W bodies go from wLayer; this frame stays.
  /* 静态框摩擦：Body.setStatic 会把 part.friction 覆写成 1，所以这里的 friction:0.6 实际不生效
   * （MW.ground.friction === 1），动摩擦 pair.friction = min(μ,1) = μ，不受截顶。
   * 但 setStatic 不动 frictionStatic（默认 0.5），配对取 min ⇒ pair.frictionStatic 恒为 0.5、与 μ 无关；
   * 低速段静摩擦咬合主导，实测 μ 从 0.3 到 1.0 滑行距离只差 1.55×（远小于 1/μ 的 3.3×），表现为调大 μ 没区别。
   * 所以静态框 frictionStatic 显式给 1，配合物体侧 wfStaticOf（只在 μ>0.6 时跟随 μ，默认手感不变）。 */
  var ground=Matter.Bodies.rectangle(W/2,groundY+400,W+400,800,{isStatic:true,friction:0.6,frictionStatic:1,label:'ground'});
  var wl=Matter.Bodies.rectangle(-300,groundY/2,600,groundY*2+800,{isStatic:true,frictionStatic:1,label:'wl'});
  var wr=Matter.Bodies.rectangle(W+300,groundY/2,600,groundY*2+800,{isStatic:true,frictionStatic:1,label:'wr'});
  /* 离屏静态顶墙 wt：与左右墙同款的挡板（不是自动回推）。W 体在 stepPhysics 里整段跳过
   * （walls(B) 的顶部夹子只对公式体生效），没有顶墙时画出的物体获得足够向上速度会飞出世界、回不来。
   * 厚度与 wl/wr 同口径（600），中心在画布上方离屏处 ⇒ 内缘 y = wtY+300；resize() 每帧按 H 同步，
   * 内缘恒 = -(BND_INK+CEL_INSET)。 */
  var wtY=celCenterY();
  var wt=Matter.Bodies.rectangle(W/2,wtY,W+400,600,{isStatic:true,frictionStatic:1,label:'wt'});
  Matter.Composite.add(E.world,[ground,wl,wr,wt]);
  MW={engine:E,wLayer:wLayer,ground:ground,wl:wl,wr:wr,wt:wt,acc:0};
  // 圆的恢复系数补偿挂在 collisionStart：这是 Pairs.update 之后、位置/速度求解器之前的唯一窗口
  // （此时 positionPrev 仍是撞击前的，改完后求解器才看到新速度）。
  Matter.Events.on(E,'collisionStart',circleRestitutionFix);
  /* 自算库仑摩擦挂在引擎的 afterUpdate 上，而不是 stepMatter 的子步循环里：直接调 Matter.Engine.update、
   * 绕开 stepMatter 的推进路径不会经过子步循环，而这些体的 mb.friction 已被置 0，就完全没有摩擦。
   * 挂在事件上保证 Matter 每推进一步都有一次自算摩擦。 */
  Matter.Events.on(E,'afterUpdate',function(){ try{wfSelfFriction(ROD_SUB_DT);}catch(e){} });
}
export function removeMatterBody(B){
  if(B.mb&&MW){Matter.Composite.remove(MW.wLayer,B.mb);}
  B.mb=null;
  /* 弹簧的端帽体随宿主一起清，否则删弹簧后留下隐形碰撞体 */
  if(B._cap){for(var ci=0;ci<2;ci++){if(B._cap[ci]&&MW){Matter.Composite.remove(MW.wLayer,B._cap[ci]);}}
    B._cap=null;}
}
export function rebuildWBody(B,thOpt){
  // 几何被编辑（弧端点手柄）后重建 Matter 复合体。buildMatterBody 会把 fixed 复位，
  // 重建前后要保持固定态（setStatic），否则一编辑就掉下去。
  // 拖端点手柄期间整条弧处于「编辑固定」态（B.editLock），重建后也要保持 static，
  // 否则每帧 arcResample -> rebuild 都会造出新的动态体，弧在拖动中往下掉。
  // thOpt = 重建完成后的目标姿态：buildMatterBody 在 th=0 下建体（bndPts 的约定），用它做原点重定位与恢复姿态。
  B._rebuildTh=(thOpt!=null)?thOpt:(B.th||0);
  var wasFixed=!!B.fixed;
  removeMatterBody(B);
  buildMatterBody(B);
  delete B._rebuildTh;
  if((wasFixed||B.editLock)&&B.mb){
    B.fixed=wasFixed;
    Matter.Body.setStatic(B.mb,true);
  }
  if(B.mb)Matter.Sleeping.set(B.mb,false);
}
/* 不要用 ω := sgn(vx)·|v|/R 之类的写法强制圆纯滚动：接触且 v 落到噪声时会把真实自旋改写成噪声值，
 * 带自旋的球一撞东西 ω 从保留 99.3% 掉到 0.2%。（高中模式的圆按质点处理，见 circleRollStep。） */
export function refreshAllPairs(){
  if(!MW)return;
  var i,B;
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind==='W'&&B.mb){
      // ① 每帧恢复 air：只对调过 μ/e/air 的体按 applyWAir 公式重算；未调过的体恢复出厂值（wAirDef）。
      //    不要对未调过的体也套公式：默认球的 air 会被 (1−BALL_REST) 因子静默改小，滚动摩阻变小、多滑 ~50px。
      //    μ=0 极值接触清零的 air 在脱离接触的下一帧由此恢复（见 ④）。
      if(B.wFrict!=null||B.wBounc!=null||B.wAir!=null)applyWAir(B);
      else{
        B.mb.frictionAir=wAirDef(B);
        var ps7=B.mb.parts||[];
        for(var q7=0;q7<ps7.length;q7++)ps7[q7].frictionAir=wAirDef(B);
      }
      B.mb.sleepThreshold=240;                   // ①b 睡眠阈值回默认（极值对成员随后被 ⑤ 覆盖为 0）
    }
  }
  var list=MW.engine.pairs.list;
  for(i=0;i<list.length;i++){
    var pr=list[i];
    var a=pr.bodyA.parent||pr.bodyA,b=pr.bodyB.parent||pr.bodyB;
    // ② Matter 在新 pair 创建时 frictionStatic 取 max：球滚过弧/凹槽的几十个条带 part，每个新 pair 都带上对方的静摩擦，
    //    低速时逐段咬住泄能（实测 μ=0 凹槽中 pair.fs=0.6、7s 睡死）。每帧把活动对按 min/max 统一刷一遍（与 refreshWPairs 同语义）。
    pr.friction=Math.min(pr.bodyA.friction,pr.bodyB.friction);
    pr.frictionStatic=Math.min(pr.bodyA.frictionStatic,pr.bodyB.frictionStatic);
    // ⑤ μ=0 极值对的成员禁用睡眠（sleepThreshold=0 短路 Sleeping.update 的 sleepThreshold>0 守卫），脱离后 ① 恢复 240。
    //    理想无摩擦振荡本该永动；球在凹弧端点速度→0，motion 跌破 0.08 累计 240 帧就会被冻结（pairs 随之清空）。
    // 极值判据：pr.friction===0 且至少一方显式声明 μ=0（wMuIdeal）或该对配对覆盖 μ=0。不能只判 pr.friction===0：
    //    高中默认 μ=0 让全场 pr.friction 为 0，每一对都会拿到 rest=1 + 禁睡眠 + air 归零（方块落地永远弹、永不入睡）。
    // ovv 提前算：⑥ 的判据用 ovv.mu，⑦ 复用同一值。
    var ovv=pairOvPairMb(a,b);
    var idealMu=(pr.friction===0)&&(wMuIdeal(bodyOfMb(a))||wMuIdeal(bodyOfMb(b))||ovv.mu===0);
    if(idealMu){
      wZeroAir(a);wZeroAir(b);                        // ④ 极值 μ=0：空气泄能通道一并关闭
      a.sleepThreshold=0;b.sleepThreshold=0;          // ⑤ 极值对成员禁用睡眠（见上）
      // ⑥ μ=0 极值对 → 完全弹性 rest=1：离散弧面的接缝碰撞在 rest<1 时每次吸走球速度的法向投影（实测 τ≈1.2s 衰减睡死）；
      //    rest=1 时接缝碰撞变成镜面反射，微弹 ~0.04px 不可见。这是「μ=0 ⇒ 无耗散」在曲面上的延伸。
      pr.restitution=1;
      //    rest=1 后仍有 τ≈4s 的残余衰减（多接触干涉 + 位置修正不一致，Matter 固有；加密/稀疏化段数、加厚迭代均无改善，N=41 实测最优）。
      //    不要用「能量维护」（按 E=½v²+g·h 把速度补回）：与约束求解打架形成正反馈，自加速弹飞。
    }else{
      pr.restitution=Math.max(pr.bodyA.restitution,pr.bodyB.restitution);
    }
    // ⑦ 用户对该对显式设过的配对系数优先级最高，压过上面的 max/min 默认规则与 μ=0 极值语义。
    //    地面/墙是引擎常驻静态体、没有实体对象，用短键（@g/@wl/@wr）查表。
    if(ovv.mu!=null){pr.friction=ovv.mu;pr.frictionStatic=wfStaticOf(ovv.mu);}  // 静摩擦同 applyWFrict，走 wfStaticOf
    if(ovv.e!=null)pr.restitution=ovv.e;
  }
}
// 由一对 Matter 体反查配对覆盖（实体↔实体、实体↔地面/墙都走这里）
export function pairOvPairMb(ma,mb2){
  var A=bodyOfMb(ma),B=bodyOfMb(mb2);
  var ka=A?bodyPid(A):((MW&&ma)?peerKeyOf(ma):null);
  var kb=B?bodyPid(B):((MW&&mb2)?peerKeyOf(mb2):null);
  var oa=(A&&A.pOv&&kb)?A.pOv[kb]:null;
  var ob=(B&&B.pOv&&ka)?B.pOv[ka]:null;
  function pick(f){
    if(oa&&ob){
      if(oa[f]!=null&&ob[f]!=null)return (oa[f]+ob[f])/2;
      return (oa[f]!=null)?oa[f]:ob[f];
    }
    var o=oa||ob;
    return o?(o[f]!=null?o[f]:null):null;
  }
  return {e:pick('e'),mu:pick('mu')};
}
// pair.friction/frictionStatic 只在 collisionStart 时按双方算一次；这里把当前活动中涉及该体的对按新参数重算
// （动摩擦 min / 静摩擦 min / 弹性 max），贴着地面调 μ 立即生效。
export function refreshWPairs(B){
  if(!MW||!B.mb)return;
  var list=MW.engine.pairs.list;
  for(var i=0;i<list.length;i++){
    var pr=list[i];
    var a=pr.bodyA.parent||pr.bodyA,b=pr.bodyB.parent||pr.bodyB;
    if(a!==B.mb&&b!==B.mb)continue;
    pr.friction=Math.min(pr.bodyA.friction,pr.bodyB.friction);
    // 静摩擦也取 min：取 max 时单边 μ=0 无效（pair 拿到对方的 0.6，低速仍被按住）。较光滑的一面主导接触，与动摩擦一致。
    pr.frictionStatic=Math.min(pr.bodyA.frictionStatic,pr.bodyB.frictionStatic);
    pr.restitution=Math.max(pr.bodyA.restitution,pr.bodyB.restitution);
    // 用户在配对表里显式设过的系数优先
    var ovp=pairOvPairMb(a,b);
    if(ovp.mu!=null){pr.friction=ovp.mu;pr.frictionStatic=wfStaticOf(ovp.mu);}  // 静摩擦同 applyWFrict，走 wfStaticOf
    if(ovp.e!=null)pr.restitution=ovp.e;
  }
}
export function buildMatterBody(B){
  // One Matter body per boundary, built from the same geometry the strokes draw:
  //   circle           -> a disc (it rolls!)
  //   closed shape     -> its convex hull INFLATED by the stroke half-thickness, as a SOLID
  //                       polygon — real blocks, never interlocking, and the solid's face is
  //                       exactly where the visible INK ends, so ink rests on ink
  //   open pen stroke  -> a compound of one rod per segment, so an L keeps its L-ness and the
  //                       mass ends up proportional to segment length (the line integral it
  //                       replaces) for free
  ensureMatter();
  // 本函数始终在 th=0 下建体（bndPts 会按 B.th 旋转，调用方 arcResample 先把 B.th 清零）。
  // prevTh = rebuildWBody 传入的真实姿态，建完用它恢复姿态（见函数末尾 setAngle 处）。
  var prevTh=(B._rebuildTh!=null)?B._rebuildTh:(B.th||0);
  var cT=Math.cos(prevTh),sT=Math.sin(prevTh);
  // sleepThreshold 240 (default 60): a slow tip-over has tiny "motion" for a second or two —
  // at the default the engine freezes a hammer MID-TIP, parked in mid-air at 0.4 rad forever.
  // 动摩擦默认 WFRICT_DEF(0.08)、frictionStatic 0.6：滑动时阻力小（可滑一段距离再停），停下的物体仍站得稳。
  // frictionAir 出厂 0（Matter 默认 0.01），与 wAirDef 一致，避免出生第一帧就有空气阻力。
  var opts={friction:WFRICT_DEF,frictionStatic:0.6,restitution:0,slop:0.02,sleepThreshold:240,frictionAir:0};
  var mb;
  if(B.wshape==='circle'&&B.rad){
    // 圆 = 会弹的球。Matter 碰撞恢复系数取双方 max，所以只给球自己 restitution，地面/其它物体保持 0。
    // frictionAir 用 BALL_AIR：水平方向也跟着衰减，弹几下就停。
    // 用 CIRCLE_SIDES 边多边形：Matter 的 Bodies.circle 只是 polygon(min(maxSides,R) 取偶, R)，24 边时接触法线偏离径向最多 7.5°，
    // 每个接触都带力臂、给球虚假角动量（见 CIRCLE_SIDES 注释）；24→48 边把「越滑越低」从 +8.41% 压到 +3.79%。
    // circleRadius 照写：Matter 纯多边形碰撞不读它，但 Body.scale / 渲染等沿用 Matter 的「这是个圆」语义。
    var _R=B.rad+BND_INK;
    mb=(CIRCLE_SIDES>24)
      ? Matter.Bodies.polygon(B.x,B.y,CIRCLE_SIDES,_R,
          {friction:0.08,frictionStatic:0.6,restitution:BALL_REST,slop:0.02,
           frictionAir:BALL_AIR,sleepThreshold:240,circleRadius:_R})
      : Matter.Bodies.circle(B.x,B.y,_R,
          {friction:0.08,frictionStatic:0.6,restitution:BALL_REST,slop:0.02,
           frictionAir:BALL_AIR,sleepThreshold:240});
    // 「真圆」标记：解析碰撞通道（Matter.Collision.collides 的挂钩）只认 _circleR，不看 circleRadius（Matter 自己的语义，
    // 渲染/scale 也读它），免得别处造出的 Matter 圆被意外卷进通道。
    // ⚠ 必须写在本分支内部：放到分支外会把后面的 else if 链挂错。
    if(mb)mb._circleR=_R;
    // 圆的转动惯量写回物理值 I=½mR²。Matter 的 Body 工厂给所有体的惯量乘了 _inertiaScale=4（setVertices/setParts），
    // 48 边形 ≈ 圆盘 ⇒ mb.inertia = 2mR²（λ'=I/(mR²)=2.0，圆盘应为 0.5）。
    // 纯滑动→纯滚动的收敛 v_f = v₀/(1+λ')：物理圆盘丢 1/3，λ'=2 时丢 2/3（实测剩 33.7%，吻合）。
    // 改后与自定义通道口径一致：弹簧力矩通道用 Iu = rad²/2（单位质量圆盘），传带通道按 λ=mR²/I=2 推，二者都不读 mb.inertia。
    // ⚠ 只管圆；闭合形见下方 closed 分支的 /4。环（ring，48 段复合体，近薄圆环 λ'=1）口径不同，未处理。
    // 不会被冲掉：setMass/setDensity 保持 inertia/(mass/6) 比例；setStatic 走 _original 存取、不从顶点重算；产品不调 setVertices/Body.scale。
    // R 用 _R（= B.rad+BND_INK = mb.circleRadius）：实心圆盘半径就是碰撞半径。
    if(mb){Matter.Body.setInertia(mb,0.5*mb.mass*_R*_R);}
  }else if(B.wshape==='trough'||B.wshape==='tub'||B.wshape==='ring'){
    // 半凹槽/全凹槽：轮廓含内凹弧线，fromVertices 的凸包会填平凹面，所以和开链笔画一样沿轮廓每小段一个定向矩形 part 组成复合体。
    // 条带就是墨迹本身（只有线是边界），弧面由离散段近似（段间角度小，滚动平滑）。
    // 空心圆 ring 同理：凸包会把空腔填成实心圆盘。B.pts 是中线圆（shapeOutline 给），bndSegs 每段厚 2·BND_INK ⇒ 一整圈墨线，空腔敞开；
    // 摩擦配对 / 睡眠等既有机制照旧生效。
    var sg5=bndSegs(B),parts5=[];
    for(var qi5=0;qi5<sg5.length;qi5++){var s5=sg5[qi5];
      parts5.push(Matter.Bodies.rectangle(s5.x,s5.y,s5.hw*2+PEN_HW*2,s5.hh*2,
                                         {angle:s5.th,friction:0.08,frictionStatic:0.6,restitution:0,slop:0.02}));
    }
    mb=segCompound(parts5,B);
    // 给环的每个 part 标记内外壁半径，供解析碰撞通道里「环 vs 圆」分支使用。必须打在 part 上：
    // Matter 的 Detector.collisions 遇到复合体时传的是 part（从 parts[1] 起，parts[0] 是根，被跳过），根收不到调用。
    // 环心要由 part.parent 取（part.position 在中线上）。
    if(B.wshape==='ring'&&mb&&mb.parts&&mb.parts.length>1){
      var _ro=(B.rad||0)+BND_INK,_ri=(B.rad||0)-BND_INK;
      for(var ki5=1;ki5<mb.parts.length;ki5++){
        mb.parts[ki5]._ringOut=_ro;
        mb.parts[ki5]._ringIn=_ri;
      }
      mb._ringSegs=mb.parts.length-1;
    }
  }else if(B.closed){
    var hull=inflateHull(bndHullLocal(B),BND_INK),wp=[],i;
    for(i=0;i<hull.length;i++)wp.push({x:B.x+hull[i][0],y:B.y+hull[i][1]});
    mb=Matter.Bodies.fromVertices(B.x,B.y,[wp],opts,true);
    if(mb){
      // fromVertices 会把顶点集的质心搬到 (B.x,B.y)，而不是让顶点留在传入位置。中心对称形（矩形）质心与原点重合看不出，
      // 偏心形（直角三角形）碰撞体会整体漂移（实测 (+4.31,-1.33)px，墨迹扎进地面）。
      // 用与下方原点重定位相同的动作补偿回来（pts/hull/ell/arcs 一起搬）。
      var ctrF=Matter.Vertices.centre(wp),fxw=B.x-ctrF.x,fyw=B.y-ctrF.y;
      // 世界位移 -> 本地位移（乘 R(−prevTh)）。
      var fx=fxw*cT+fyw*sT,fy=-fxw*sT+fyw*cT;
      // 阈值 1e-6：Matter 的 Vertices.centre 走叉积累加，中心对称形也会有 1e-12 级残差（实测矩形质心 499.9999999999974）。
      // 不加阈值会把残差加进 B.pts，inkPointDist 从 15 变成 14.999999999999998，distToHost 与 SPR_PAD(15) 的严格小于判定被翻面。
      if(Math.abs(fx)>1e-6||Math.abs(fy)>1e-6){
        // hull2D 返回的是 B.pts 里的同一批点对象（不是拷贝），pts 与 hull 各平移一次会把同一点搬两遍
        // （直角三角形补偿翻倍、图形悬空）。按引用去重后再搬。
        var moved9=[];
        function shiftPt9(p){if(moved9.indexOf(p)>=0)return;moved9.push(p);p[0]+=fx;p[1]+=fy;}
        for(i=0;i<B.pts.length;i++)shiftPt9(B.pts[i]);
        if(B.hull)for(i=0;i<B.hull.length;i++)shiftPt9(B.hull[i]);
        if(B.ell){B.ell.lcx+=fx;B.ell.lcy+=fy;}
        if(B.arcs)for(var k9=0;k9<B.arcs.length;k9++){
          B.arcs[k9].lcx+=fx;B.arcs[k9].lcy+=fy;B.arcs[k9].lmx+=fx;B.arcs[k9].lmy+=fy;}
      }
    }
    if(!mb){ // degenerate hull (collinear stroke closed by accident): fall back to a thin box
      var sg=bndSegs(B),tot=0,cx=0,cy=0;
      for(i=0;i<sg.length;i++){tot+=sg[i].hw*2;cx+=sg[i].x*sg[i].hw*2;cy+=sg[i].y*sg[i].hw*2;}
      cx/=Math.max(1e-6,tot);cy/=Math.max(1e-6,tot);
      mb=Matter.Bodies.rectangle(cx,cy,Math.max(14,tot),PEN_HW*2,opts);   // 厚度 = 2·PEN_HW（墨迹厚度）
    }
    // 闭合笔画（方块/三角/手绘闭环）的转动惯量写回物理值：Matter 的 _inertiaScale=4 让每个体惯量 = 纯几何惯量 × 4
    // （实测方块/三角均为 4.0000 倍），翻滚角速度 ω = J·r_perp/I 只有物理值的 1/4，方块「翻不动」。
    // 用 /4 而不是显式 Vertices.inertia(...)：/4 精确等价于把 _inertiaScale 改成 1、不假设形状；fromVertices 可能产出
    // 多 part 复合体，那时 mb.vertices 是凸包，显式公式会算错。
    // ⚠ 只覆盖 closed 分支。trough/tub/ring/arc 的 segCompound 根 inertia 还漏掉平行轴项 m·d²（环里占物理惯量 99.7%），
    //   再 /4 会更偏离物理，须先补齐平行轴合成。圆已显式写成 ½mR²。
    // 不会被后续 setter 冲掉（setMass/setDensity 保持比例，setStatic 不从顶点重算）。
    if(mb)Matter.Body.setInertia(mb,mb.inertia/4);
  }else{
    // 开链笔画 / 圆弧：沿墨迹每段一个定向矩形。
    // 内部段两端各外延 PEN_HW，与邻段互搭消除 V 形接缝（否则球滚过会咯噔一下）。
    // 开链首段起点、末段终点不外延：屏幕笔端是 round cap，碰撞方头若越出端点 3px，把弧端对准地面时碰撞体先扎进地面被顶起，
    // 端点与地面裂开 ~3px 缝，球滚过被楔起「弹一下」。闭链（矩形/三角/凹槽等）首末段本就相邻，不动。
    var sg2=bndSegs(B),parts=[],open2=!B.closed,nS2=sg2.length;
    for(i=0;i<nS2;i++){
      var s=sg2[i];
      var ex0=PEN_HW,ex1=PEN_HW;                    // 沿切线向外（起点侧 / 终点侧）的外延量
      if(open2){
        if(i===0)ex0=0;                             // 起点：不外延
        if(i===nS2-1)ex1=0;                          // 终点：不外延
      }
      var boxLen=s.hw*2+ex0+ex1;
      var sh=(ex1-ex0)/2;                            // 盒子中心沿切线偏移，使不外延的那一端正好停在端点
      var bxc=s.x+Math.cos(s.th)*sh,byc=s.y+Math.sin(s.th)*sh;
      parts.push(Matter.Bodies.rectangle(bxc,byc,boxLen,s.hh*2,
                                         {angle:s.th,friction:0.08,frictionStatic:0.6,restitution:0,slop:0.02}));
    }
    mb=segCompound(parts,B);
  }
  // Re-centre OUR origin onto the matter body's centre of mass, so the per-frame pose sync is a
  // plain copy (B.x=mb.position.x, B.th=mb.angle). Created at angle 0, so the shift is pure
  // translation: the drawn picture does not move by a single pixel.
  var dxw=B.x-mb.position.x,dyw=B.y-mb.position.y;
  /* 补偿量取世界位移本身（dx=dxw）：本函数在 B.th=0 下建体，建体帧里本地系与世界系重合，世界位移即本地位移。
   * 不要按 R(−prevTh)·δw 换算：Matter 的 setAngle 绕质心旋转、渲染 drawBoundaries 绕原点 (B.x,B.y) 旋转，
   * 再加上下一轮 arcResample 用 lc 重算 pts 却不动 lc，会形成乘性递推 ρ̄_{n+1} = (I − R(−θ))·ρ̄_n（谱半径 2|sin(θ/2)|），
   * θ>60° 即发散：弧转过大角度后拖端点会抽搐、飞出屏幕（实测逐轮漂移与解析预测吻合）。取世界位移时下一轮 ρ̄=0，一步进入不动点。
   * ⚠ 前提：必须在 B.th=0 下调用（arcResample 已保证）；若调用方带非零 B.th 进来，bndPts 输出的是已旋转的世界点，
   *   这里就要改回按 prevTh 换算。 */
  var dx=dxw,dy=dyw;
  if(dx||dy){
    for(var k=0;k<B.pts.length;k++){B.pts[k][0]+=dx;B.pts[k][1]+=dy;}
    // 本地 hull 缓存也跟着搬：solidSAT（公式体↔实体的手写碰撞）读它，只搬 pts 会让手写通道错开同样的量。
    if(B.hull)for(var kh=0;kh<B.hull.length;kh++){B.hull[kh][0]+=dx;B.hull[kh][1]+=dy;}
    // 圆弧的椭圆锚点跟着本地原点平移一起补偿，否则重建后 ell 与 pts 脱节，端点手柄一拖角度就算飞。
    if(B.ell){B.ell.lcx+=dx;B.ell.lcy+=dy;}
    // 凹槽真弧元数据（圆心 + 弧中点，本地坐标）同样跟着平移。
    if(B.arcs)for(var k8=0;k8<B.arcs.length;k8++){
      B.arcs[k8].lcx+=dx;B.arcs[k8].lcy+=dy;B.arcs[k8].lmx+=dx;B.arcs[k8].lmy+=dy;
    }
  }
  B.x=mb.position.x;B.y=mb.position.y;
  // 把姿态恢复成重建前的值，并同步到 Matter。
  B.th=prevTh;
  /* setAngle 绕质心旋转，渲染 drawBoundaries 绕原点 (B.x,B.y) 旋转，两者差一个平移 T = (I − R(prevTh))·δw
   * （δw = 重建前原点到质心的世界位移 dxw/dyw）。补上 T 后 Matter 顶点与 traceWPath 画出的几何逐点重合，下一轮重建时 ρ̄ 归零。
   * 与上面的「取世界位移」缺一不可：只补 T 仍会发散。prevTh=0 时 T=0。 */
  if(prevTh){
    Matter.Body.setAngle(mb,prevTh);
    var _tqx=(1-cT)*dxw+sT*dyw,_tqy=-sT*dxw+(1-cT)*dyw;
    if(_tqx||_tqy){
      Matter.Body.setPosition(mb,{x:mb.position.x+_tqx,y:mb.position.y+_tqy});
      B.x=mb.position.x;B.y=mb.position.y;
    }
  }
  B.vx=0;B.vy=0;B.om=0;
  B.fixed=false;                  // 右键"固定"：停在原地，鼠标仍可拖动，再点取消
  mb.sleepThreshold=240;           // compound bodies do NOT inherit part options — set it here
  Matter.Composite.add(MW.wLayer,mb);
  B.mb=mb;
  B._natMass=mb.mass;              // 自然质量（按几何算），wmass 乘数以它为基准
  applyWMul(B);                    // 重建/复制后恢复用户调过的质量乘数与摩擦
}
                         // 实测标定：0.12（1s 剩 12%）太快，杠杆刚被砸起来就泄掉；0.5 以上杆像陀螺转个不停。
                         // 0.25 时轻块上升最多（257px），且仍能被当场按停。
export const ROD_SUB_DT=1/240;    // 杆的积分/约束步长（秒）——与 stepMatter 的 240Hz 子步一致
export function stepMatter(dt){
  if(!MW)return;
  var i,B,anyW=false;
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind==='W'&&!B.dead&&B.mb)anyW=true;
  }
  // 本帧的杆清单。早退条件要带上 RODS：场上没有 W 体时杆也要能被积分（被字母撞、被黑洞推）。
  var RODS=[];
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind==='T'&&!B.dead)RODS.push(B);
  }
  // 本帧的「圆」清单（模式化摩擦：高中=质点不自转 / 大学=纯滚动+滚阻）。
  var CB=circleRollBodies();
  if(!anyW&&!RODS.length){MW.acc=0;return;}
  // gravity is read EVERY frame, not baked in at engine creation: tests (and anything else)
  // may set GRAV=0 after the engine already exists; a value captured at creation would never update.
  MW.engine.gravity.y=GRAV/1000;
  // 杆的镜像同步不在这里做，必须逐 240Hz 子步做（一帧一同步 = 41px 的位移台阶，方块会被没有 CCD 的求解器穿过去）。
  // a boundary being dragged: the pointer owns the pose, matter only records zero velocity
  // 拖拽悬摆：提着物体的一个角拖时，物体按质量分布转到质心垂在抓点正下方。三重门全过才转——
  //   ① 悬空：贴地拖永不转（G.y+半宽 < groundY-8）；
  //   ② 力臂：抓点世界 x 偏移 |glx·c-gly·s| > DRAG_ROT_DEADBAND×max(hw,hh) —— 抓点在质心
  //      正上方的竖直中带里是「平衡区」，普通拖动不转；
  //   ③ 非方向锁装配宿主 / 非 fixed：装配体的姿态归弹簧管，悬摆不抢。
  // 平衡角：质心垂在抓点正下方 = 本地偏移的世界方向朝正上，thEq = -π/2 - atan2(gly,glx)。
  // 用临界阻尼式逼近（不模拟摆动，到位即停不过头），抓点离质心越远转得越干脆。
  // 抓点始终钉在指针上：转完用当前 th 反解质心位置（世界偏移 = R(th)·(glx,gly)）。
  if(grab.kind==='body'&&grab.obj&&grab.obj.kind==='W'&&grab.obj.mb){
    var G=grab.obj;
    var hw66=G.hw||30,hh66=G.hh||24,half66=Math.max(hw66,hh66);
    var glx66=grab.glx||0,gly66=grab.gly||0;
    var c66=Math.cos(G.th||0),s66=Math.sin(G.th||0);
    var air66=(G.y+half66)<groundY-8;
    var lever66=Math.abs(glx66*c66-gly66*s66);
    var canRot66=air66&&lever66>DRAG_ROT_DEADBAND*half66&&!G.fixed&&!G._lockRot&&!springLockedAsmOf(G);
    if(canRot66){
      var rl66=Math.sqrt(glx66*glx66+gly66*gly66);
      var thEq66=-Math.PI/2-Math.atan2(gly66,glx66);
      var k66=Math.min(10,Math.max(4,4+6*rl66/half66));
      G.th=(G.th||0)+shortAng(thEq66-(G.th||0))*Math.min(1,k66*dt);
      c66=Math.cos(G.th);s66=Math.sin(G.th);
    }
    var ox66=glx66*c66-gly66*s66,oy66=glx66*s66+gly66*c66;
    // 被导轨拴住的装配体只能沿轴拖（与 pointermove 共用 dragPtrAxis()）。
    // 这里是每帧执行的权威摆放（跑在 pointermove 之后），漏改它轴锁就完全失效。
    var p66=dragPtrAxis();
    G.x=clamp(p66.x-ox66,-hw66*0.6,W+hw66*0.6);
    G.y=clamp(p66.y-oy66,-hh66*0.6,groundY+hh66*0.9);
    // 轻绳/铰链约束也必须施加在这里（每帧的权威摆放）：否则指针目标会覆盖上一帧 conPull 的修正，
    // 箱子绕销轴自转而抓点钉在指针上，销轴端的锚点被甩出去（实测偏差长到 143px）。分配规则见 conDragConstrain。
    var pj66=conDragConstrain(G);
    if(pj66){G.x=pj66.x;G.y=pj66.y;}
    /* 被拖体上连着杆时再跑一遍投影（Gauss-Seidel 第二趟）：投影沿锚点连线搬另一端，搬动又改变连线方向与本地偏移，
     * 单趟在快拖时收不干净（残差 13~18px），加一趟即收敛到亚像素。只在确实连着杆时才加，绳/铰链行为不变。 */
    var _hasRod=false;
    for(var _k=0;_k<bodies.length;_k++){var _b2=bodies[_k];
      if(_b2&&!_b2.dead&&_b2.kind==='T'&&_b2.anc&&
         ((_b2.anc[0]&&_b2.anc[0].B===G)||(_b2.anc[1]&&_b2.anc[1].B===G))){_hasRod=true;break;}}
    if(_hasRod){var pj2=conDragConstrain(G);if(pj2){G.x=pj2.x;G.y=pj2.y;}}
    G.om=0;
    Matter.Body.setPosition(G.mb,{x:G.x,y:G.y});
    Matter.Body.setAngle(G.mb,G.th||0);
    Matter.Body.setVelocity(G.mb,{x:0,y:0});
    Matter.Body.setAngularVelocity(G.mb,0);
    Matter.Sleeping.set(G.mb,false);
    /* 被拖的是支撑体时，唤醒压在它上面的睡眠体，否则把地面拖走后球会悬在空中。 */
    if(G.mb&&(G.mb.isStatic||G.fixed))
      wakeSleepNear(G.x,G.y,(G.hw||0)+(G.hh||0)+80);
    /* 拖拽摆放之后立刻把连在被拖体上的杆摆正，否则杆位姿要等下一子步的 rodSyncAnchors 才更新，
     * 拖动期出现一帧滞后。只处理连在被拖体上的杆，不全场扫。 */
    for(var _ri=0;_ri<bodies.length;_ri++){
      var _rb=bodies[_ri];
      if(!_rb||_rb.dead||_rb.kind!=='T'||!_rb.anc)continue;
      var _hA=_rb.anc[0]?_rb.anc[0].B:null,_hB=_rb.anc[1]?_rb.anc[1].B:null;
      if(_hA!==G&&_hB!==G)continue;
      try{rodSyncAnchors(_rb,0);}catch(e){}
      if(_rb.mb){Matter.Body.setPosition(_rb.mb,{x:_rb.x,y:_rb.y});Matter.Body.setAngle(_rb.mb,_rb.th||0);}
    }
  }
  // 固定的边界正被旋转手柄拖动：角度由指针决定，Matter 只跟着转（静止体 setAngle 合法）
  if(grab.kind==='rot'&&grab.obj&&grab.obj.kind==='W'&&grab.obj.mb){
    var RB56=grab.obj;
    Matter.Body.setAngle(RB56.mb,RB56.th||0);
    Matter.Body.setAngularVelocity(RB56.mb,0);
    Matter.Sleeping.set(RB56.mb,false);
  }
  // fixed 1/60 steps on an accumulator, so matter runs in real time on any refresh rate.
  // Each 1/60 step is internally 4 sub-steps of 240 Hz: matter has NO continuous collision
  // detection, and a stroke that has fallen 440px moves 25px per 1/60 step — clean through
  // a 4px rod mirror. Sub-stepping brings the fastest fall down to 6.4px/substep, inside the
  // ~9px contact band (stroke half-thickness 7 + rod half-thickness 2).
  // 方向锁宿主的角速度必须在积分前清零：只在引擎步进之后（stepSprings）清，碰撞注入的角速度
  // 会在子步里真的转过一大截（实测 av=2 一帧转 1.9rad）。步进内的残余由下一次清零兜住。
  springSyncLocks();
  MW.acc+=dt;
  var n=0;
  // 本帧声明 e≥1 的体（没有则整套守卫不进快照、不进修正）
  var EL=perfectElasticMB(),PRE={};
  while(MW.acc>=1/60&&n<4){
    for(var s4=0;s4<4;s4++){
      // 子步前存求解器视角速度 → 子步 → 把 e≥1 接触的接触点法向相对速度还原成入射镜像。
      // 逐子步做：每个子步是一次独立的接触求解，逐子步纠正误差才不累积。μ=0 极值体（EL_Z）同样适用。
      if(EL.length||EL_Z.length)snapVelocities(PRE);
      // 杆按 1/240 子步积分（杆没有 Matter 体，位姿只在 x/y/th 上）。
      if(RODS.length){
        for(var r4=0;r4<RODS.length;r4++){
          var R4=RODS[r4];
          R4._xps=null;   // 杆被抓住时 rodIntegrate 早退不产快照 ⇒ 先清上一子步的残留
          // dt 单位是秒（vx/vy 是 px/s、om 是 rad/s），不是 Matter 的毫秒。
          // 传 1000/240 会让积分放大 1000 倍、耗散瞬间归零。
          rodIntegrate(R4,ROD_SUB_DT);
        }
      }
      if(CB)circleRollSnap(CB);        // 必须在 Engine.update 之前（量的是接近速度）
      /* a 赋予的持续加速度逐子步施力，且必须紧挨 Engine.update 之前：Matter 每次 update 结束清 force，
       * 每帧只施一次只剩 1/4（见 applyGivenAccel）。 */
      applyGivenAccel(ROD_SUB_DT);
      Matter.Engine.update(MW.engine,1000/240);
      /* 杆宿主全量 XPBD 速度重建，必须在积分之后（完整子步位移 = rodSyncAnchors 快照 → 现位置），
       * 修轻杆摆动越摆越低，见 rodXPBDVel。 */
      if(RODS.length)rodXPBDVel(RODS);
      // 拖动中的轻质杆 = 拖整个装配体。必须逐子步、且在求解之后：宿主在子步里被重力带下去，
      // 只在 pointermove 里跟随的话指针一停就断开（见 rodDragPinHosts）。只对正被抓着的杆调用。
      if(grab.kind==='body'&&grab.obj&&grab.obj.kind==='T'&&!grab.obj.dead)
        rodDragPinHosts(grab.obj);
      /* 拖的是物体时，沿杆链把整条装配体一起解，否则多杆链会分离（见 rodDragPinChain）。 */
      if(grab.kind==='body'&&grab.obj&&!grab.obj.dead)rodDragPinChain(grab.obj);
      // S 族（弹簧/绳/铰链）同理（见 springDragPinRig）：逐子步、求解之后、只对正被抓着的体。
      if(grab.kind==='body'&&grab.obj&&grab.obj.kind==='S'&&!grab.obj.dead)
        springDragPinRig(grab.obj);
      // 边中点磁吸：拖到边中点附近时吸附过去。必须放在上面两条「跟指针」之后，顺序反了会被 pin 覆盖。
      // 逐子步、纯位置投影、幂等。
      if(grab.kind==='body'&&grab.obj&&!grab.obj.dead)midMagnetPullRig(grab.obj);
      /* 不要对被抓 W 体逐子步重钉：实测会让铰链拖拽的另一端逐帧爆震（位移 5.6→82.3px）。
       * 杆钟摆衰减的病根在 conDragConstrain 的帧级清速度，不在这里。 */
      // 从面板拖出、还没放下的虚影也要吸，否则虚影停在旁边、松手却跳到中点。
      if(TOOL&&TOOL.devDrag)midMagnetPullGhost();
      // 高中模式没有任何逐子步「写 ω」的通道（不强制纯滚动）。
      // 圆的模式化摩擦：逐子步，放在求解之后、e≥1 修正之前。滑移归位要赶在下一子步前，
      // 否则求解器会把它当真实滑移吃掉平动（表现为撞墙后速度骤降）。
      if(CB)circleRollStep(CB,ROD_SUB_DT);
      if(EL.length||EL_Z.length)elasticContactFix(PRE,EL);
    }
    MW.acc-=1/60;n++;
  }
  if(n===4)MW.acc=0;
  // 步进后全量刷新活动碰撞对：① frictionStatic 每帧刷成 min（Matter 新 pair 默认取 max，球在 μ=0 凹槽里
  // 滚动会被逐段静摩擦咬死）；② 极值接触对（有效 μ=0 或 e≥1）双方 frictionAir 归零；③ 非极值体按公式恢复。
  // 幂等，与 applyWFrict 的手动刷新不冲突。
  if(n>0)refreshAllPairs();
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind!=='W'||!B.mb)continue;
    B.x=B.mb.position.x;B.y=B.mb.position.y;B.th=B.mb.angle;
    // 「安定后自动吸附地面」已移除，这里只维护 _snapped 标记（被抓住时清零）。
    if(grab.kind==='body'&&grab.obj===B)B._snapped=false;
    else if(!B.fixed&&!B._snapped&&!B.dead){
      var vs7=B.mb.velocity;
      if(vs7.x*vs7.x+vs7.y*vs7.y<0.25){          // <0.5px/子步（120px/s）≈ 已安定
        /* 不要恢复每帧安定吸附：近地的弧会每帧重吸一次、位姿被反复回写，造成卡顿。 */
        B._snapped=true;   // 只留「别再试」的标记，不再做任何吸附
      }
    }
    // ---- 边界速度：用位姿差分，不用 Matter 的 velocity ----
    //  ① 静止接触里 Matter 会保留非零 velocity（靠每帧 positionImpulse 抵消位移）：静置的弧 mb.velocity.y
    //     恒约 2.6（≈156px/s），位置却不动，也进不了休眠。
    //  ② 把它当墙速喂给 bndHit / collideBodies，压在上面的物体每帧都被反弹一次，永久微弹。
    //  ③ 差分也有噪声：多段复合体静置时 Matter 有 1px 级求解器跳变（约每 15 帧上跳 1.2px 再落回），
    //     差出 ±72px/s 的假速度 → 亚像素运动按静止处理（死区）。边界是没有惯性、只能被拖动的铁砧，
    //     数值抖动不该传给压在上面的物体。
    if(B._px===undefined){B._px=B.x;B._py=B.y;B._pth=B.th;}
    var invdt=1/Math.max(1e-4,dt);
    var rvx=(B.x-B._px)*invdt,rvy=(B.y-B._py)*invdt;
    // vx/vy = 对外语义的「边界真实速度」（位姿差分），渲染以外的读取者（黑洞吸力累加、
    // 调试探针、验证脚本）都看它；rvx/rvy = 接触计算专用，多一层亚像素死区（见下）。
    B.vx=rvx;B.vy=rvy;
    B.rvx=(Math.abs(rvx)<W_V_DEAD)?0:rvx;
    B.rvy=(Math.abs(rvy)<W_V_DEAD)?0:rvy;
    B._px=B.x;B._py=B.y;B._pth=B.th;
    // ④ 静置检测：每 20 帧（约 0.33s）比一次快照，净位姿变化 < 1.6px 就让它睡。Matter 自己睡不着
    //    （①的幻影 velocity 让 motion 永远高于门限）；压在上面的物体会通过 Sleeping.afterCollisions
    //    反复唤醒它，所以必须能重复入睡。
    //    按净位移判而不是逐帧：多段复合体静置时会周期性上跳 1.2px 再落回，逐帧判永远攒不满静置帧数。
    //    同时看转角：绕质心原地倾倒时质心净位移接近 0，只看位移会把正在倒的物体冻在倾斜半空。
    // ⑤ 还要看窗口内的最大偏离（excursion）：弹跳体一起一落，净位移几乎为 0 却走了 ~27px，
    //    只看净位移会把它睡死在半空、永不苏醒。「净位移小」≠「没在动」。
    //    excursion 阈值复用 1.6px：静置跳变 ~1.2px 在门内，弹跳体是 20px 量级，差一个数量级。
    if(!B.mb.isStatic&&!(grab.kind==='body'&&grab.obj===B)){
      if(!B._snap)B._snap={x:B.x,y:B.y,th:B.th,n:0,ex:0};
      if(B._snap.ex===undefined)B._snap.ex=0;
      var exd=Math.abs(B.x-B._snap.x)+Math.abs(B.y-B._snap.y)+Math.abs(B.th-B._snap.th)*60;
      if(exd>B._snap.ex)B._snap.ex=exd;
      if(++B._snap.n>=20){
        var nd=Math.abs(B.x-B._snap.x)+Math.abs(B.y-B._snap.y)+Math.abs(B.th-B._snap.th)*60;
        if(nd<1.6&&B._snap.ex<1.6&&!B.mb.isSleeping)Matter.Sleeping.set(B.mb,true);
        B._snap={x:B.x,y:B.y,th:B.th,n:0,ex:0};
      }
    }else if(B._snap)B._snap.n=0;
    // 圆形是真实刚体：滚动角速度回传（松开时带着转）；形状/线保持 0 即可
    if(B.wshape==='circle'&&B.rad){B.om=B.mb.angularVelocity;}
    if(grab.kind==='body'&&grab.obj===B){B.vx=0;B.vy=0;B.rvx=0;B.rvy=0;B._px=B.x;B._py=B.y;}
  }
  // W 体回写之后把双端锚定的杆再摆一次姿态：杆位姿在子步内（Engine.update 之前）摆，W 体随后还会被积分，
  // 杆姿态恒滞后一帧（自由落体时实测 gap=17.1px，恰好一帧位移，看起来杆和体脱钩）。
  // 这里只摆姿态（setPosition/setAngle 不带速度），求解器口径仍以子步内那次为准；单端锚定杆由 rodSyncAnchors 自算。
  if(n>0&&RODS.length){
    for(var rq=0;rq<RODS.length;rq++){
      var RQ=RODS[rq];
      if(!RQ||RQ.dead||!RQ.anc||!RQ.anc[0]||!RQ.anc[1])continue;
      if(grab&&grab.obj===RQ&&(grab.kind==='body'||grab.kind==='rodlen'))continue;
      if(RQ.anc[0].B&&!RQ.anc[0].B.dead&&RQ.anc[1].B&&!RQ.anc[1].B.dead&&
         bodies.indexOf(RQ.anc[0].B)>=0&&bodies.indexOf(RQ.anc[1].B)>=0){
        var q0=springAnchoredWorld(RQ,0),q1=springAnchoredWorld(RQ,1);
        if(q0&&q1){
          RQ.x=(q0.x+q1.x)/2;RQ.y=(q0.y+q1.y)/2;
          RQ.th=(RQ.th||0)+shortAng(Math.atan2(q0.y-q1.y,q0.x-q1.x)-(RQ.th||0));  // shortAng 保持角度连续
          RQ.hw=RQ.len/2+2;
          if(MW&&RQ.mb){Matter.Body.setPosition(RQ.mb,{x:RQ.x,y:RQ.y});Matter.Body.setAngle(RQ.mb,RQ.th||0);}
        }
      }
    }
  }
}

export function setupPhysicsMatter(){
  BND_INK=BND_HH*1.55/2;
  PEN_HW=BND_INK;
}
