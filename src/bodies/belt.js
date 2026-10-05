/* 传送带：几何、牵引与绘制 */
import Matter from 'matter-js';
import { BND_HH, mkBoundary } from './boundary.js';
import { lastDt } from '../core/loop.js';
import { clamp } from '../core/math.js';
import { BELT_SPAWN_LEN, CONV_DEF, paramV } from '../params/defs.js';
import { applyWFrict } from '../physics/material.js';
import { MW, rebuildWBody } from '../physics/matter.js';
import { cvx } from '../render/render.js';

/* 传送带两端长度手柄（与杆手柄同族，见 rodh 的 pointerdown 分派）。
 * 拖一端 ⇒ 另一端钉死（按下时锁存远端坐标，避免逐帧现取导致整体漂移）。
 * 与杆的差别只在写回：带子是整块 W 体，本地矩形 B.pts / B.hw 被多处读（drawBeltBody、手写 SAT bndHit、
 * beltFaceTouch 接触门），pts 必须随长度实时改；Matter 侧走 rebuildWBody（buildMatterBody 会复位 fixed，rebuildWBody 已兜）。
 * 长度边界 [BELT_MIN_LEN, BELT_MAX_LEN]：太短则两端滚轮（半径=hh）互相穿过，且 mkBoundary 有 BND_MIN_LEN 下限。
 * 带子是 fixed 的机器，不需要 rodLenFrozen 冻结门；但复用 grab.kind==='rodlen'，长度手柄只有一套语义。 */
export const BELT_MIN_LEN=80, BELT_MAX_LEN=1600;
export function beltEndWorld(B,i){
  var tht=B.th||0,hl=B.hw||BELT_SPAWN_LEN/2,s=(i?-1:1);
  return {x:B.x+s*Math.cos(tht)*hl,y:B.y+s*Math.sin(tht)*hl};
}
export function setBeltEnds(B,x0,y0,x1,y1,force){
  if(!B||!B.belt)return;
  var dx=x1-x0,dy=y1-y0,raw=Math.hypot(dx,dy)||1;
  var d=clamp(raw,BELT_MIN_LEN,BELT_MAX_LEN);
  var ux=dx/raw,uy=dy/raw;
  var x1c=x0+ux*d,y1c=y0+uy*d;                  // 夹到长度区间后的拖拽端
  B.x=(x0+x1c)/2;B.y=(y0+y1c)/2;B.th=Math.atan2(uy,ux);
  var hw=d/2,hh=B.hh||BELT_TH/2;
  B.len=d;B.hw=hw;
  B.pts=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];   // 本地矩形：渲染/接触三处都读它
  // 必须作废凸包缓存：bndHullLocal(B) 只在 B.hull 为空时才由 B.pts 重算，而上一行是整数组替换，
  // 旧 hull 引用的是上一批点对象 ⇒ hull 永久停在出生时的矩形，Matter 镜像与手写通道 bndHullWorld
  // 都读旧几何（带子变长了，碰撞还是原来那截）。
  B.hull=null;
  if(!MW||!B.mb)return;                          // 未就绪：镜像板留给 ensureMatter 之后
  var stale=(B._mlen==null)||(Math.abs(B._mlen-d)>2);
  if(force||stale){B._mlen=d;rebuildWBody(B,B.th);}   // 重建即按新宽度造体 + 摆到当前姿态
  else{Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th);}
}
/* 改带子角度的唯一入口：绕 pivot（默认质心）把两端一起转到 th。
 * 不能只写 B.th：带子几何真值在两端（pts / hull / Matter 镜像都从它派生），只写 th 会渲染转了碰撞没转，
 * 而 Matter 侧只在 grab.kind==='rot' 时 setAngle，松手或从参数面板改就没人跟。
 * 走 setBeltEnds 一次完成 pts 重写 + hull 作废 + 镜像重建；带长不变，不会被 [MIN,MAX] 夹到。 */
export function setBeltAngle(B,th,pivot){
  if(!B||!B.belt)return;
  var hl=((B.len!=null)?B.len:2*(B.hw||BELT_SPAWN_LEN/2))/2;
  var px=(pivot&&pivot.x!=null)?pivot.x:B.x, py=(pivot&&pivot.y!=null)?pivot.y:B.y;
  var ux=Math.cos(th),uy=Math.sin(th);
  setBeltEnds(B,px-ux*hl,py-uy*hl,px+ux*hl,py+uy*hl,false);
}
/* ================= 传送带（器件）：表面牵引 ===================================
 * 为什么必须在这里显式加：
 *   ① 公式体没有 Matter 镜像，与 W 的接触只走 collideBodies 里 bndHit 那条手写 SAT 通道；
 *      「给静态体 setVelocity 当传送带」的技巧对它无效（实测物块 Δx=0）。
 *   ② 那条手写通道只有法向响应（穿透推出 + vn 反弹），没有切向耦合；把表面速度喂进 rvx/rvy 也带不动。
 * 模型：把对方的切向速度朝「带面速度」指数松弛（时间常数 BELT_TAU）。
 *   · 只改切向（法向留给正常冲量）⇒ 物体不会被吸进带子、也不会被弹起；
 *   · 指数松弛而非瞬间等于带速 ⇒ 保住惯性感（放上去有一段加速过程）；
 *   · μ=0 时不牵引：μ 取带子自己的 wfrict（paramV 口径），与高中模式 μ=0 同一条默认链。
 */
export const BELT_TAU=0.10;              // 秒：表面牵引的松弛时间常数（越小抓得越急）
// Matter 那条路（W-vs-W）单独的抓力时间常数，比公式体那条更紧。
// 公式体没有转动耦合，τ=BELT_TAU 即可达到带速的 ~100%。W-vs-W 时 Matter 的摩擦把带子当静止地面
// （见 beltDragMatter），每帧把接触点切向速度往 0 拉，与这里的牵引顶牛，τ 越大货越跟不上带速
// （箭头动画看起来比货跑得快；动画本身是准的：纹路相位速率 262.4px/s vs conv=260，BELT_DECO_STEP=26px）。
// 实测标定（长带 1200px，取已落在带面且加速到位的窗口，稳态 v / 带速，圆 / 方块）：
//   τ=0.02 → 96% / 94%    | τ=0.008 → 99% / 99%    | τ=0.004 → 100% / 100%
//   τ=0.002 / 0.001 → 100% / 100%
//   高速档 conv=1040（4 m/s）同样 100% / 100%，y 峰峰 ≤0.01px（不炸、不甩出、不发散）。
// 取 0.004：两种形状 × 两档带速都到 100%，且比 0.002 留余量（k=1−e^(−dt/τ)=0.985，不是把切向速度硬写成带速）。
// 不影响打滑语义：光滑带（μ=0）在两条牵引通道入口就早退。
export const BELT_GRIP_TAU=0.004;
export function beltSurfVel(B){
  if(!B||!B.conv)return null;
  var th2=B.th||0;
  return {x:Math.cos(th2)*B.conv,y:Math.sin(th2)*B.conv};   // conv 沿本体 +x（随 th 旋转）
}
export function beltTract(WB,oth,nx,ny,ov){
  if(!WB||!oth||!WB.conv||!(ov>0))return;
  if(oth.kind==='W'||oth.kind==='S'||oth.isWell||oth.bh)return;   // 这条通道里不可推动的一方
  var mu=paramV(WB,'wfrict');
  if(!(mu>0))return;                                             // 光滑带 = 打滑（与地面 μ 同义）
  var s=beltSurfVel(WB);
  var tx=-ny,ty=nx;                                              // 切向单位向量（法向转 90°）
  var vt=((oth.vx||0)-s.x)*tx+((oth.vy||0)-s.y)*ty;               // 相对带面的切向速度
  if(!vt)return;
  var k=1-Math.exp(-lastDt/BELT_TAU);
  var dv=-vt*k;
  oth.vx=(oth.vx||0)+dv*tx;
  oth.vy=(oth.vy||0)+dv*ty;
}
/* ---- Matter 自管的那条接触路（W-vs-W）也要牵引 --------------------------------
 * collideBodies 的 W 分支把 W-vs-W 直接 continue 交给 Matter，而 beltTract 只挂在 bndHit（W-vs-公式体）上；
 * Matter 侧没有「传送带速度」概念，只认 pair.friction（取双方 μ 的 min，高中模式物体 μ 默认 0 会把带子的 0.6 归零）。
 * 不要用「给静态体 setVelocity 当传送带」：在本 build 里方向是反的（带子 +260 ⇒ 球往左滚 Δx≈−137），
 * 摩擦只把接触点相对地面拉静止；且静态体的速度唤不醒睡着的球。牵引只能手写。
 * 做法：几何自算接触法向（进入时 Matter 还没算碰撞），只在上下带面这一类接触上做切向指数松弛；
 * 写入走 Matter.Body.setVelocity（velocity 属性 = 每 1/60s 的位移，真值 ×60；用 API 换算，
 * 免得与 impAt 的「子步位移」量纲混掉）。
 * 睡着的刚体会被 Matter 跳过积分，注入的速度不生效 ⇒ 必须顺手唤醒。 */
export function beltFaceTouch(WB,oth){
  var th=WB.th||0,c=Math.cos(th),s=Math.sin(th);
  var dx=oth.x-WB.x,dy=oth.y-WB.y;
  var lx=dx*c+dy*s, ly=-dx*s+dy*c;                    // 世界 → 本体（转 −th）
  var hw=WB.hw||BELT_SPAWN_LEN/2;
  if(lx<-hw||lx>hw)return null;                       // 质心不在带体横向范围内（在带子端外）
  var nyl=ly<0?-1:1;                                  // 最近的那条带面：上 / 下
  var n={x:-nyl*s,y:nyl*c};                           // 本体法向 → 世界（转 +th）
  var d=dx*n.x+dy*n.y;                                // 带心 → 对方质心，沿 n（>0 = 在那条面外侧）
  if(!(d>0))return null;
  // 支撑半径必须问 Matter 的顶点，不能用 B.rad / B.hw：Matter 体统一被 BND_INK(2.325) 膨胀过
  // （球 circleRadius=28.325 而 rad=26），按 rad 算会把已接触判成还差 4.64px 而拒掉。
  // 圆走 circleRadius（O(1)），多边形精确求 max(v·n)−center·n，与膨胀约定无关。
  if(d-beltSup(WB.mb,n)-beltSup(oth.mb,n)>2)return null;   // 够不着 → 没接触
  return n;
}
export function beltSup(mb,n){
  if(!mb)return 0;
  if(mb.circleRadius)return mb.circleRadius;
  var v=mb.vertices,mx=-1e9;
  for(var i=0;i<v.length;i++){var q=v[i].x*n.x+v[i].y*n.y;if(q>mx)mx=q;}
  return mx-(mb.position.x*n.x+mb.position.y*n.y);
}
export function beltDragMatter(WB,oth){
  if(!WB||!WB.belt||!WB.conv)return;                  // 不是带子 / 带速为 0 → 早退
  if(!oth||oth===WB||oth.kind!=='W')return;           // 只处理刚体：杆/弹簧由位姿驱动，写了也被覆盖
  if(oth.belt||oth.fixed||oth.dead||oth.isWell)return; // 别的带子 / 钉住的机器 / 陷阱：不互相拖
  var mb=oth.mb;if(!mb||mb.isStatic)return;
  if(!(paramV(WB,'wfrict')>0))return;                 // 光滑带 = 打滑（与地面 μ 同义）
  var n=beltFaceTouch(WB,oth);if(!n)return;
  var sv=beltSurfVel(WB);
  var brv=60;                                         // Matter 属性值（px/帧）→ 真值 px/s
  var tx=-n.y,ty=n.x;
  var vx=mb.velocity.x*brv, vy=mb.velocity.y*brv;
  var vt=vx*tx+vy*ty, st=sv.x*tx+sv.y*ty;             // 质心切向速度 / 带面切向速度
  // 牵引目标 = 接触点速度（不是质心速度）朝带面速度松弛。
  //   ① 只推质心会被 Matter 摩擦反噬：滑动摩擦同时给出「质心加速 + 反向自旋」，把接触点速度拉回 0，
  //      形成拔河（球只有 ~30–50px/s，带速 260）。
  //   ② 朝接触点松弛后稳态满足 v_接触 = v_带面 ⇒ 相对滑移为 0，摩擦自动归零，且该态自持。
  //   ③ 转动按刚体在接触点受冲量的真实分配（dJ 在接触点 ⇒ dv=dJ/m、dω=−dJ·R/I）：
  //      slip = v_t − ωR − s_t，令 d(slip)=ΔS ⇒ dv_t=ΔS·I/(I+mR²)、R·dω=−ΔS·(1−I/(I+mR²))。
  //      λ=mR²/I（圆盘 λ=2 ⇒ dv=ΔS/3、R·dω=−2ΔS/3）。稳态与松弛速率无关：
  //      slip→0 的唯一终点是 v=s/3、ωR=−2s/3（传送带上小球的课本稳态）。方块无滚动耦合 λ→∞ ⇒ dv=ΔS，整体以带速平移。
  var R=(oth.wshape==='circle'&&mb.circleRadius)?mb.circleRadius:0;
  var w=R?mb.angularVelocity*brv:0;
  var k=1-Math.exp(-lastDt/BELT_GRIP_TAU);
  var dvt=(st-vt)*k, nvt=vt+dvt;
  Matter.Body.setVelocity(mb,{x:(vx+dvt*tx)/brv,y:(vy+dvt*ty)/brv});
  // 为什么还要喂 ω：Matter 对 W-vs-W 的摩擦把带子当静止地面，只想把接触点速度 v_t−ωR 拉向 0。
  // 只推质心 ⇒ 注入量被摩擦转成自旋，平移拿不到；反向喂自旋更糟（摩擦把它换成反向平移，球往回滚）。
  // 正解是让注入后的状态对摩擦中立：ω 同步到以 nvt 纯滚动的 ω=nvt/R，接触点速度为 0，
  // 牵引量全部落到平移上（方块没有滚动耦合，天然中立）。
  if(R){
    var nw=nvt/R;
    Matter.Body.setAngularVelocity(mb,(w+(nw-w)*k)/brv);
  }
  oth._snap&&(oth._snap.n=0);                         // 别让 20 帧静置判据本帧就把它睡回去
  if(mb.isSleeping)Matter.Sleeping.set(mb,false);     // 睡着的体不参与积分，注了也白注
}
/* ================= 器件（DEVICES）：从面板直接拖出 =================
 * 不新造物理：每个器件复用已有的构造函数（弹簧 = makeSpring，与「把 k 和 x 拖到一起」拼出来的
 * 逐字段相同：同一默认 ks/阻尼/长度钳制，高中模式下同样拿到 auto 导轨）。器件表里每一项只需回答
 * 「给我一个落点，在那儿造一个默认尺寸的你」。
 *
 * 弹簧默认自然长度 SPR_SPAWN_LEN=110 = makeSpring 长度钳制 clamp(d,110,340) 的下限，也就是 kx 拼接
 * 实际拿到的值（两字母贴着放，间距必被夹到 110）。两条入口的物理参数 ks/bounc/mass/anc 本就相同，
 * 唯一独立差异是 len，其余（cur/hw/th/_ax/_ay/x/y）都是 len 与落点的派生量 ⇒ 默认 110 时两条入口完全一致。
 * 悬挂伸长 mg/k=2600/50=52px，对 110 是 +47% 伸长率，仍在合理范围。
 * 方向恒为水平：最常见的挂法，且是大学/高中两种模式下都合法的方向（高中只允许水平/竖直，
 * makeSpring 会自动补 auto 导轨）。放下后长度和方向都能改。
 */
// SPR_SPAWN_LEN 声明在「出生尺寸常量区」（紧邻 GROUND_SPAWN_LEN、PARAM_DEFS 之前）：
// 参数表 slen.def 在字面量求值时就要拿到值（var 提升只提升声明）。不要在这里重复声明。
/* 轻质杆：走同一个 makeRod，与 vt 拼接出来的杆逐字段相同（len=170、hasG=true、php=F*0.55、
 * refresh 后 hw=len/2+2）；ROD_SPAWN_LEN=170 即 makeRod 默认，两条入口默认参数一致。
 * makeRod 造的杆 kind==='T'，已在旋转手柄白名单里（refreshHover），无需新增；
 * 两端长度手柄走 setRodLen。 */
// ROD_SPAWN_LEN 声明在「出生尺寸常量区」（理由同 SPR_SPAWN_LEN）。
/* 传送带 = 一条画出来的闭合矩形（mkBoundary closed poly）+ 两个专属字段：
 *   B.belt=true   —— 渲染/参数面板认它；
 *   B.conv (px/s) —— 带面速度，沿本体 +x（随 th 旋转），可为负（反向）。
 * 复用 W 体而不新造 kind：拖动、固定、旋转、右键参数、解散、悬浮高亮等既有机器都能直接用它
 * （新 kind 意味着每一处都要补，必然漏）。
 * 默认带速 CONV_DEF 声明在 PX_PER_M 旁边：放在这里会让参数表 convspeed 的 def 求值时拿到 undefined。
 * 物理走 beltTract（见 collideBodies 上方注释：公式体没有 Matter 镜像，唯一有效的写入点是手写 SAT 通道）。 */
// BELT_SPAWN_LEN 声明在「出生尺寸常量区」（理由同 SPR_SPAWN_LEN）。
// BELT_TH（带子厚度）不属于出生尺寸、也不进参数表，留在这里。
export const BELT_TH=20;
export function makeBelt(cx,cy){
  var hl=BELT_SPAWN_LEN/2,ht=BELT_TH/2;
  var B=mkBoundary([[cx-hl,cy-ht],[cx+hl,cy-ht],[cx+hl,cy+ht],[cx-hl,cy+ht]],
                   {shape:'poly',closed:true});
  if(!B)return null;
  B.belt=true;
  B.conv=CONV_DEF;
  B.fixed=true;                                   // 传送带是钉在地上的机器，不是会掉的东西
  if(B.mb){Matter.Body.setStatic(B.mb,true);Matter.Sleeping.set(B.mb,false);}
  // 带面自带摩擦 μ=0.6（器件属性，不是世界默认）：否则高中模式「默认 μ 全 0」下传送带一放就完全打滑，
  // 用户会以为器件坏了。显式写进 B.wFrict ⇒ 参数面板读数即物理生效值；想打滑就把 μ 拖到 0。
  B.wFrict=0.6;applyWFrict(B);
  return B;
}
/* 传送带外观：带体 + 两端滚轮 + 会走的纹路。
 * 与 drawBoundaries 的通用描线互斥（调用处直接 continue），否则矩形框会被画两遍并盖掉滚轮。
 * 纹路相位 _bph 在渲染里累加（每条带子每帧恰好一次）：改带速时纹路不跳变
 * （若用「墙钟 × 当前速度」算相位，一改速度纹路会瞬移一大截）。
 *
 * 外形按参考图量测：两端圆的描边中心半径 = 带面半厚，滚轮与上下带面内切、占满整个高度，
 * 滚轮外缘 = 总宽端点。即「体育场形（上下切线 + 两端半圆帽）」+ 两端两个闭合整圆。
 * 全部按 hh 归一：滚轮半径 r=hh、圆心 ±(hw-hh)、外缘落在 ±hw，与物理矩形（mkBoundary 的 hw/hh）
 * 宽度方向对齐，看到的端头就是能拖/能挡的端头。
 * 注：物理碰撞体仍是矩形（两端直角），圆角只在外观上；对 20px 厚的带子差异在 BND_INK 量级内。
 * 方向由人字纹颜色表达（青绿=正转朝右，赭=反转朝左）；滚轮与带面统一用墨色。 */
export const BELT_DECO_STEP=26;
export function drawBeltBody(B,hov){
  if(!B||!B.belt)return;
  var hw=B.hw||BELT_SPAWN_LEN/2,hh=B.hh||BELT_TH/2;
  B._bph=((B._bph||0)+(B.conv||0)*lastDt)%BELT_DECO_STEP;
  var ph=B._bph;if(ph<0)ph+=BELT_DECO_STEP;
  var r=hh,ex=Math.max(1,hw-r);          // 滚轮半径 / 滚轮圆心偏移（外缘 = ±hw）
  var ink=hov?'rgba(28,58,92,1)':'rgba(38,34,28,1)';
  var fwd=(B.conv||0)>0;
  cvx.save();
  cvx.translate(B.x,B.y);cvx.rotate(B.th||0);
  cvx.lineJoin='round';cvx.lineCap='round';
  // ① 带体：上下切线 + 两端半圆帽（体育场形），铺底 + 描边。arc 的起点正好接在 lineTo
  //    落点上，不会多出一条弦。
  cvx.beginPath();
  cvx.moveTo(-ex,-hh);cvx.lineTo(ex,-hh);
  cvx.arc(ex,0,r,-Math.PI/2,Math.PI/2,false);
  cvx.lineTo(-ex,hh);
  cvx.arc(-ex,0,r,Math.PI/2,Math.PI*1.5,false);
  cvx.closePath();
  cvx.fillStyle=hov?'rgba(96,182,255,0.16)':'rgba(38,34,28,0.10)';
  cvx.fill();
  cvx.lineWidth=BND_HH*1.55;
  cvx.strokeStyle=ink;
  cvx.stroke();
  // ② 两个滚轮：整圆。必须拆成两条独立子路径（先 stroke 再 beginPath）：
  //   同一条 path 里的两个 arc，canvas 会按规范把上一子路径终点 (-ex+r,0) 与下一个起点 (ex-r,0)
  //   自动连一条直线，即带子中间那条多余的水平线。这条连线 JS 钩子看不到（没有 lineTo），无法靠拦截调用检测。
  cvx.beginPath();
  cvx.arc(-ex,0,r,0,6.2832);
  cvx.lineWidth=BND_HH*1.15;
  cvx.stroke();
  cvx.beginPath();
  cvx.arc(ex,0,r,0,6.2832);
  cvx.lineWidth=BND_HH*1.15;
  cvx.stroke();
  // ③ 会走的人字纹：只铺在两滚轮**之间的平带面**上（不压到圆上），颜色 = 方向
  cvx.beginPath();
  var d=fwd?5:-5,y0=-hh+4,y1=hh-4,ym=(y0+y1)/2;
  for(var x=-ex+ph;x<ex;x+=BELT_DECO_STEP){
    if(x<=-ex+2||x>=ex-2)continue;
    cvx.moveTo(x-d,y0);cvx.lineTo(x,ym);cvx.lineTo(x-d,y1);
  }
  cvx.strokeStyle=fwd?'rgba(62,124,116,0.95)':'rgba(178,110,60,0.95)';
  cvx.lineWidth=2;cvx.stroke();
  cvx.restore();
}
