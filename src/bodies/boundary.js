/* 画出来的物体（W 体）：轮廓、凸包、圆弧编辑、手写碰撞检测 */
import Matter from 'matter-js';
import { app } from '../state.js';
import { drawBeltBody } from './belt.js';
import { BODY } from './body.js';
import { lastDt } from '../core/loop.js';
import { hull2D, shortAng } from '../core/math.js';
import { bodies } from '../core/world.js';
import { drawGroundBody } from '../devices/ground.js';
import { F } from '../letters/glyph.js';
import { BND_INK, buildMatterBody, rebuildWBody } from '../physics/matter.js';
import { cvx, groundY } from '../render/render.js';

// ============================================================================ 圆环折线段数
// 圆环的墨线就是它的碰撞几何（一圈 N 根定向矩形，见 shapeOutline('ring')），N 边形半径在内切 R 与
// 外接 R/cos(π/N) 之间摆动，峰峰 = R·(1/cos(π/N) − 1) ≈ R·(π/N)²/2，与半径成正比，大圆环会看出折线
// （R=300、N=48 时实测 0.61px，弦长 39px）。实心「圆」渲染走真弧，不受影响。
// 不用「渲染画真圆、碰撞仍用折线」：画出来的线必须就是实体；加细折线同时改善渲染与物理。
// 做法：段数按半径自适应，把半径偏差钉在 OUTLINE_PP_MAX 以下。
//   · MIN=48 且精确返回：R ≤ 2·PP_MAX·(48/π)² = PP_MAX·466.7（PP_MAX=0.30 时 R≤140）时就是 48 段，
//     与固定 CIRCLE_SIDES=48 完全一致。
//   · MAX=256：R≈3984 撞上限（画布画不到）。实测 R=141→49、300→71、1000→129、2000→182，偏差 0.290~0.298px。
//   · 不要对结果取奇数（n|1）：48|1=49，会推翻下限保护。闭链处处等价，奇偶无关紧要。
// 测量注意：用相位折叠测非圆度时，折叠周期必须取页面上的实际 N（写死 48 边会把 N=71 的分面平均掉，
//   给出假通过）；实心圆的 B.pts 只供碰撞、渲染走真弧，理论偏差为 0。
export const OUTLINE_PP_MAX=0.30;   // 可接受的半径偏差峰峰（px）—— 4.65px 墨线宽的 6.5%，亚像素
export const OUTLINE_MIN_SIDES=48;  // 下限 = CIRCLE_SIDES；精确判等返回，小圆行为与固定 48 边一致
export const OUTLINE_MAX_SIDES=256; // 上限：parts ≤ 257
export function outlineSides(R){
  // N ≥ π·sqrt(R/(2·PP_MAX)) 由 R(π/N)²/2 ≤ PP_MAX 反解
  R=Math.max(1,isFinite(R)?R:1);
  var n=Math.ceil(Math.PI*Math.sqrt(R/(2*OUTLINE_PP_MAX)));
  if(!(n>0))n=OUTLINE_MIN_SIDES;
  if(n<=OUTLINE_MIN_SIDES)return OUTLINE_MIN_SIDES;   // 小圆：精确 48
  if(n>OUTLINE_MAX_SIDES)n=OUTLINE_MAX_SIDES;
  return n;
}
// Extra clearance for a PLANK contact (rod vs body), applied along the contact normal.
// The plank is DRAWN as a 3px line (half-thickness 1.5) but COLLIDES as a 4px plank
// (half-thickness 2), which already buys 0.5px; ROD_PAD adds ~1px so the ink ends up about
// 1px outside the drawn edge — visually touching, never overlapping. It is deliberately much
// smaller than BOX_PAD: at 45 deg a per-axis pad is multiplied by sqrt(2) at the contact
// corner, which is what used to leave a 25px-looking hole under a tilted rod.
export const ROD_PAD=0.5;
export const BND_HH=3.0;         // 基础常量（历史名）；墨迹线宽 = BND_HH*1.55
export const BND_MIN_LEN=50;     // shorter than this and there is no line to speak of -> not a body
// ---- 圆弧（PPT 式语义）：端点手柄的几何 ----
// 椭圆锚定在 body 本地系的 (lcx,lcy)，随 body 平移/旋转。端点世界坐标 = B 原点 + 旋转(lc + 极坐标)。
export function arcWorldCenter(B){
  var e=B.ell,c=Math.cos(B.th||0),s=Math.sin(B.th||0);
  return {x:B.x+e.lcx*c-e.lcy*s,y:B.y+e.lcx*s+e.lcy*c,c:c,s:s};
}
export function arcEndWorld(B,which){
  var e=B.ell,wc=arcWorldCenter(B),a=(which===0)?e.a0:e.a1;
  var ex=e.lcx+Math.cos(a)*e.rx,ey=e.lcy+Math.sin(a)*e.ry;
  return {x:B.x+ex*wc.c-ey*wc.s,y:B.y+ex*wc.s+ey*wc.c};
}
// 吸附统一在世界系做（与旋转手柄吸 th 的口径一致）；若在本地参数角上吸附，弧自转后吸到的是跟着体斜过去的 0/90/180/270。
//   arcEndWorldAng        端点相对椭圆圆心的世界方向角（= 本地几何方向角 + th）
//   arcParamFromWorldAng  把世界方向角换算成该椭圆上的参数角（pa=atan2(ly/ry,lx/rx) 的逆）
// rx==ry（弧恒为正圆）时两者互为 ±th 的平移，公式自动退化。
export function arcEndWorldAng(B,which){
  var e=B.ell,a=(which===0)?e.a0:e.a1;
  return Math.atan2(Math.sin(a)*e.ry,Math.cos(a)*e.rx)+(B.th||0);
}
export function arcParamFromWorldAng(B,worldAng){
  var e=B.ell,b=worldAng-(B.th||0);
  return Math.atan2(Math.sin(b)/e.ry,Math.cos(b)/e.rx);
}
export function arcSetAngle(B,which,na){
  // 拖端点手柄：把指针角写入 a0/a1。扫过角限幅 [0.15, 2π-0.06]——太短没有意义，整圆则和「圆」工具重复。
  // 以这个端点自己的当前值为参考、逐次累积增量：若以另一端点为参考再 shortAng()，差值被折到 (-π,π]，
  // 扫过角永远 ≤180°，拖过 180° 时弧会跳回成一小截。
  var e=B.ell,cur=(which===0)?e.a0:e.a1;
  na=cur+shortAng(na-cur);
  var MIN=0.15,MAX=Math.PI*2-0.06;
  if(which===0){e.a0=Math.min(Math.max(na,e.a1-MAX),e.a1-MIN);}
  else{e.a1=Math.min(Math.max(na,e.a0+MIN),e.a0+MAX);}
  arcResample(B);
}
export function arcResample(B){
  // 本地坐标直接 = lc + (rx cos a, ry sin a)，与 th 无关，且与 arcEndWorld/arcWorldCenter 的定义自洽（wc = B.x + R(th)·lc）。
  // 不要先算世界点再转回本地：半径向量漏乘 R(th) 时，渲染出的弧世界方向角是 a0/a1，而手柄/吸附按 a+th 算，
  // 弧自转后手柄浮在弧旁、吸附偏移。
  var e=B.ell,th=B.th||0;
  var sw=e.a1-e.a0,n=Math.max(20,Math.min(160,Math.ceil(Math.abs(sw)/0.09))),i;
  B.pts=[];
  for(i=0;i<=n;i++){var a=e.a0+sw*i/n;
    B.pts.push([e.lcx+Math.cos(a)*e.rx, e.lcy+Math.sin(a)*e.ry]);}
  var mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
  for(i=0;i<B.pts.length;i++){
    if(B.pts[i][0]<mnx)mnx=B.pts[i][0];if(B.pts[i][0]>mxx)mxx=B.pts[i][0];
    if(B.pts[i][1]<mny)mny=B.pts[i][1];if(B.pts[i][1]>mxy)mxy=B.pts[i][1];
  }
  B.hw=Math.max(6,(mxx-mnx)/2);B.hh=Math.max(6,(mxy-mny)/2);
  // 建体必须在 th=0 下做；姿态经 rebuildWBody 的第二个参数传入，由 buildMatterBody 负责本地位移换算与建完恢复姿态。
  B.th=0;
  rebuildWBody(B,th);
}
// offset a CONVEX polygon outward by d: shift every edge along its outward normal, then
// intersect neighbouring edges (the correct miter offset — corners stay sharp).
export function inflateHull(h,d){
  var n=h.length,lines=[],i,k,cx=0,cy=0;
  for(k=0;k<n;k++){cx+=h[k][0];cy+=h[k][1];}cx/=n;cy/=n;
  for(i=0;i<n;i++){
    var a=h[i],b=h[(i+1)%n];
    var ex=b[0]-a[0],ey=b[1]-a[1],L=Math.hypot(ex,ey)||1;
    var nx=ey/L,ny=-ex/L;
    var mx=(a[0]+b[0])/2-cx,my=(a[1]+b[1])/2-cy;
    if(nx*mx+ny*my<0){nx=-nx;ny=-ny;}
    lines.push([a[0]+nx*d,a[1]+ny*d,b[0]+nx*d,b[1]+ny*d]);
  }
  var out=[];
  for(i=0;i<n;i++){
    var L1=lines[i],L2=lines[(i+1)%n];
    var x1=L1[0],y1=L1[1],dx1=L1[2]-L1[0],dy1=L1[3]-L1[1];
    var x2=L2[0],y2=L2[1],dx2=L2[2]-L2[0],dy2=L2[3]-L2[1];
    var den=dx1*dy2-dy1*dx2;
    if(Math.abs(den)<1e-9){out.push([L1[2],L1[3]]);continue;}
    var t=((x2-x1)*dy2-(y2-y1)*dx2)/den;
    out.push([x1+dx1*t,y1+dy1*t]);
  }
  return out;
}
/* ---- geometry ------------------------------------------------------------------------ */
export function bndPts(B){
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0),out=[];
  for(var i=0;i<B.pts.length;i++){
    var p=B.pts[i];
    out.push([B.x+p[0]*c-p[1]*s,B.y+p[0]*s+p[1]*c]);
  }
  return out;
}
// 悬浮/抓取命中 = 贴着线才算，空心内部不响应：图形是空心的，只有线是边界。
// 算指针到轮廓折线的最短距离，阈值 = 线半宽 + 抓取余量。
export const INK_GRAB_PAD=11;                     // 线外再放宽 11px 便于点中（视觉线半宽约 4.65）
export function nearInk(B,px,py){
  if(!B||B.kind!=='W'||!B.pts||B.pts.length<2)return false;
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0),n=B.pts.length;
  var lim=B.closed?n:n-1;
  var lim2=(BND_HH*1.55+INK_GRAB_PAD);lim2=lim2*lim2;
  for(var i=0;i<lim;i++){
    var a=B.pts[i],b=B.pts[(i+1)%n];
    var ax=B.x+a[0]*c-a[1]*s, ay=B.y+a[0]*s+a[1]*c;
    var bx=B.x+b[0]*c-b[1]*s, by=B.y+b[0]*s+b[1]*c;
    var ex=bx-ax,ey=by-ay,L2=ex*ex+ey*ey;
    var t=L2>0?((px-ax)*ex+(py-ay)*ey)/L2:0;
    if(t<0)t=0;else if(t>1)t=1;
    var dx=px-(ax+ex*t),dy=py-(ay+ey*t);
    if(dx*dx+dy*dy<=lim2)return true;
  }
  return false;
}
export function bndSegs(B){
  // the solid part of the outline, each piece a thin oriented box — the boundary analogue of the
  // t-rod's single plank, so the rod collision code can treat them the same way. ONLY THE LINE IS
  // SOLID: for a CLOSED shape that is its rim (a hollow frame — you can drop things inside it),
  // for an OPEN pen stroke it is the stroke itself, a chain of marker-thick planks with no gap
  // between neighbours.
  var wp=bndPts(B),m=wp.length,out=[],n=B.closed?m:m-1;
  var hh=BND_INK;   // 开口笔画与闭合轮廓统一取屏幕上那根线的半厚。
                    // 不要用 PEN_HW / BND_HH：两者都是 3.0，比渲染的 2.325 胖 0.675px。
  for(var i=0;i<n;i++){
    var a=wp[i],b=wp[(i+1)%m];
    var ex=b[0]-a[0],ey=b[1]-a[1],L=Math.hypot(ex,ey);
    if(L<0.5)continue;
    out.push({x:(a[0]+b[0])/2,y:(a[1]+b[1])/2,hw:L/2,hh:hh,th:Math.atan2(ey,ex),pad:0});
  }
  return out;
}
/* 复合体（trough/tub/ring/arc → segCompound）的惯量合成。
 * Matter 的 Body.setParts 合成根惯量（_totalProperties）有两处错：只把各 part 的 inertia 相加，漏掉平行轴项
 * Σ m_i·d_i²（d_i = part 质心到根质心）；而每个 part 的 inertia 又是纯几何惯量 × Matter.Body._inertiaScale(=4)。
 * ⇒ 根 = 4·Σ I_cm，物理值应为 Σ I_cm + Σ m_i·d_i²。修正前实测 ring 的根惯量偏小 77 倍（平行轴项占 99.7%）。
 * 步骤：
 *  ① 逐 part 撤掉 scale（p.inertia / Matter.Body._inertiaScale），得到绕 part 自身质心的物理惯量 I_cm
 *     （Body.setVertices 先把顶点平移到自身质心再算 Vertices.inertia）。
 *     这一步不影响求解：Pair.update 把质量/惯量/摩擦折回根，Resolver.solveVelocity 只读 parentA/parentB，
 *     力矩臂量自根 —— 求解器读的是根的 inverseMass / inverseInertia / friction，part 只提供几何。
 *     保留它只为口径一致（任何读者都拿不到 4 倍值）。
 *  ② 根按平行轴重新合成 Σ(I_part + m_i·d_i²) —— 这一步才决定行为；
 *  ③ 必须在 Body.create({parts})（内部走 setParts）之后做，否则被覆盖回 Σ；
 *  ④ Body.setInertia 同时写 inverseInertia，求解器侧跟着变。
 * 注意：_inertiaScale 是 Matter.Body 上的模块级静态，不是体实例属性。写成 p._inertiaScale 会读到 undefined，
 * ① 退化成空操作而 ② 照旧叠加平行轴，根变成 4·ΣI_cm + Σm·d²（超调）；此时逐 part 的 lam 仍为 4 而不是 1。 */
export function segCompoundInertia(mb){
  if(!mb||!mb.parts||mb.parts.length<2)return mb;
  var ps=mb.parts,i;
  var SC=(Matter.Body&&isFinite(Matter.Body._inertiaScale)&&Matter.Body._inertiaScale>0)
           ?Matter.Body._inertiaScale:1;    // 模块级静态，不是 p._inertiaScale（见上）
  function rMass(o){                        // 静态化后 mass=Inf ⇒ 从 `_original` 取回物理质量
    if(isFinite(o.mass))return o.mass;
    return (o._original&&isFinite(o._original.mass))?o._original.mass:0;
  }
  function cmI(p){                          // 绕自身质心的物理惯量（撤掉库的 4 倍；兼容静态化）
    var raw=isFinite(p.inertia)?p.inertia
            :((p._original&&isFinite(p._original.inertia))?p._original.inertia:0);
    var Ip=raw/SC;
    return (isFinite(Ip)&&Ip>0)?Ip:0;
  }
  var tot=0,cx=0,cy=0;
  for(i=1;i<ps.length;i++){
    var m0=rMass(ps[i]);
    tot+=m0;
    cx+=m0*ps[i].position.x;cy+=m0*ps[i].position.y;
  }
  if(!(tot>0))return mb;
  cx/=tot;cy/=tot;                          // 与 Matter.setParts 的合成质心同口径
  var I=0;
  for(i=1;i<ps.length;i++){
    var p=ps[i],m=rMass(p),Ip=cmI(p);
    // ① 撤 scale。静态体不能写：其 inverseInertia 必须留在 0，否则求解器会让它自转。
    if(!p.isStatic&&Ip>0)Matter.Body.setInertia(p,Ip);
    var dx=p.position.x-cx,dy=p.position.y-cy;
    I+=Ip+m*(dx*dx+dy*dy);                   // ② 平行轴
  }
  // ③ 必须在 setParts（Body.create 内部）之后写根 —— 否则被 `_totalProperties` 的 Σ 覆盖回去。
  if(I>0&&!mb.isStatic)Matter.Body.setInertia(mb,I);
  return mb;
}
export function segCompound(parts,B,opt){
  // 开链/凹槽轮廓的刚体构造：沿墨迹每小段一个定向矩形，再合成复合体。
  // 兜底是必须的：arcResample 的段长随扫过角缩小，bndSegs 有 L<0.5 的去噪阈，圆弧扫过角收到最小时
  // parts 会全被滤掉，调用方读 mb.position 就抛 TypeError。这时退化成一根包住实际范围的薄板，绝不返回 undefined。
  if(parts.length>1)return segCompoundInertia(Matter.Body.create({parts:parts}));   // 合成后立刻补惯量（见 segCompoundInertia）
  if(parts.length===1)return parts[0];
  var wp=bndPts(B),n=wp.length,o=opt||{friction:0.08,frictionStatic:0.6,restitution:0,slop:0.02};
  var cx=0,cy=0,x0=1e9,y0=1e9,x1=-1e9,y1=-1e9,i;
  for(i=0;i<n;i++){
    cx+=wp[i][0];cy+=wp[i][1];
    if(wp[i][0]<x0)x0=wp[i][0];if(wp[i][0]>x1)x1=wp[i][0];
    if(wp[i][1]<y0)y0=wp[i][1];if(wp[i][1]>y1)y1=wp[i][1];
  }
  if(n){cx/=n;cy/=n;}else{x0=x1=B.x;y0=y1=B.y;}
  return Matter.Bodies.rectangle(cx,cy,Math.max(6,x1-x0),Math.max(6,y1-y0),o);
}
export function mkBoundary(worldPts,opt){
  opt=opt||{};
  // A pen stroke is an OPEN line; a preset shape is a CLOSED ring. Same body, same physics —
  // only the caps and the last segment differ.
  var closed=(opt.closed!==false);
  var raw=[],i;
  for(i=0;i<worldPts.length;i++){
    var q=worldPts[i];
    if(q&&isFinite(q[0])&&isFinite(q[1]))raw.push([q[0],q[1]]);
  }
  if(raw.length<(closed?3:2))return null;
  // ---- the weight is spread ALONG THE LINE, not over the enclosed area -------------------
  // The user draws a line and the line is the boundary, so the mass sits on the line: uniform
  // linear density, so a segment's weight is proportional to its LENGTH. That is what makes a
  // circle's weight sit on its rim and a long plank's weight sit along its middle.
  var seg=[],L=0,cx=0,cy=0,n=raw.length,last=closed?n:n-1;
  for(i=0;i<last;i++){
    var a=raw[i],b=raw[(i+1)%n];
    var dxx=b[0]-a[0],dyy=b[1]-a[1],len=Math.hypot(dxx,dyy);
    if(len<0.01)continue;
    seg.push([a[0],a[1],b[0],b[1],len]);
    L+=len;cx+=len*(a[0]+b[0])/2;cy+=len*(a[1]+b[1])/2;
  }
  if(!isFinite(L)||L<BND_MIN_LEN)return null;       // too short to be a body at all
  cx/=L;cy/=L;                                       // centroid of the line distribution
  // polar second moment of a uniform LINE distribution about that centroid: each segment carries
  // rho*len*d^2 (parallel-axis, d = the distance from the centroid to the segment's own middle)
  // plus its own rho*len^3/12 (a rod about its own centre). rho == 1, so mass == total length.
  var J=0;
  for(i=0;i<seg.length;i++){
    var s=seg[i];
    var mx=(s[0]+s[2])/2-cx,my=(s[1]+s[3])/2-cy;
    J+=s[4]*(mx*mx+my*my)+s[4]*s[4]*s[4]/12;
  }
  var B=BODY(cx,cy);
  B.kind='W';                     // boundary: gravity-driven falling + gravity-torque tipping
  B.pts=[];
  for(i=0;i<raw.length;i++)B.pts.push([raw[i][0]-cx,raw[i][1]-cy]);
  B.closed=closed;
  B.bndM=L;                       // mass == the length of the line (linear density 1)
  B.bndI=J||1;                    // so bndI carries the right units for bndM
  B.om=0;
  B.wshape=opt.shape||'poly';
  if(opt.rad)B.rad=opt.rad;
  if(opt.notch)B.notch=opt.notch;
  if(opt.ell)B.ell={lcx:opt.ell.cx-cx,lcy:opt.ell.cy-cy,rx:opt.ell.rx,ry:opt.ell.ry,a0:opt.ell.a0,a1:opt.ell.a1};
  // 凹槽/滑梯的真弧渲染元数据。shapeOutline 给的是世界坐标圆心+弧中点，这里转成与 B.pts 同一套本地坐标（质心原点）。
  // 走向(ccw)不存，渲染时用中点在哪一侧现算，避免对四种开口变换逐一推角度方向。
  // 碰撞仍走 bndSegs 的多段采样（Matter 只吃多边形）。
  if(opt.arcs){
    B.arcs=[];
    for(i=0;i<opt.arcs.length;i++){var aR=opt.arcs[i];
      B.arcs.push({i0:aR.i0,i1:aR.i1,lcx:aR.cx-cx,lcy:aR.cy-cy,
                   lmx:aR.mx-cx,lmy:aR.my-cy,r:aR.r});
    }
  }
  var mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
  for(i=0;i<B.pts.length;i++){
    if(B.pts[i][0]<mnx)mnx=B.pts[i][0];if(B.pts[i][0]>mxx)mxx=B.pts[i][0];
    if(B.pts[i][1]<mny)mny=B.pts[i][1];if(B.pts[i][1]>mxy)mxy=B.pts[i][1];
  }
  B.hw=Math.max(6,(mxx-mnx)/2);
  B.hh=Math.max(6,(mxy-mny)/2);
  B.mass=1;
  B.bounc=0;                      // a boundary lands, it never bounces
  B.vx=0;B.vy=0;
  B.pop=1;
  // y grows DOWNWARD, so the "lowest" vertex is the one with the LARGEST y. Never be born
  // buried in the ground line.
  var lowY=-1e9;
  for(i=0;i<B.pts.length;i++)if(B.pts[i][1]>lowY)lowY=B.pts[i][1];
  if(cy+lowY>groundY)B.y-=((cy+lowY)-groundY);
  buildMatterBody(B);              // born into the Matter world: real weight from here on
  return B;
}
export function shapeOutline(shape,x0,y0,x1,y1){
  var ax=Math.min(x0,x1),ay=Math.min(y0,y1),bx=Math.max(x0,x1),by=Math.max(y0,y1);
  if(shape==='circle'){
    var cx=(ax+bx)/2,cy=(ay+by)/2,r=Math.max(10,Math.min(bx-ax,by-ay)/2),out=[];
    for(var i=0;i<32;i++){var a=i/32*6.2832;out.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]);}
    return {pts:out,shape:'circle',rad:r};
  }
  if(shape==='ring'){
    // 圆环/空心圆：里面可以放东西，也可作圆形轨道。与 circle 的差别：这里返回的多边形就是物理几何本身。
    //   · circle 的 B.pts 只服务命中判定，碰撞走 buildMatterBody 的实心圆盘、渲染走 canvas 真弧；
    //   · ring 的 B.pts 是外接多边形，下游同一份几何：bndSegs 沿它切出定向矩形（厚 = 2·BND_INK）、
    //     segCompound 拼成复合体、traceWPath 沿它描边 ⇒ 碰撞体与渲染都恰好是墨线本身：
    //     外壁在 rad+BND_INK、内壁在 rad−BND_INK、环内是空的。
    // 视觉上与 circle 相同（同一条 BND_HH*1.55 = 4.65px 的描边）。
    // 顶点半径必须取 rad/cos(π/N) 而不是 rad：bndSegs 用相邻两点的中点（弦中点，半径 rad·cos(π/N)），
    //   写 rad 会让墨带朝环心内缩（rad=100 时 0.214px），画出来的线与碰撞的线不一致。代价是尖角多探出约 0.21px，不可见。
    // 段数 = outlineSides(rr)：按半径自适应，把半径偏差钉在 OUTLINE_PP_MAX 以下；R≤140 时恰为 48，
    //   R=300 时 71 段（峰峰偏差 0.6120px → 0.2704px）。
    var cxr=(ax+bx)/2,cyr=(ay+by)/2,rr=Math.max(10,Math.min(bx-ax,by-ay)/2),outr=[];
    var NS=outlineSides(rr);
    var rv=rr/Math.cos(Math.PI/NS);
    for(var ir=0;ir<NS;ir++){
      // 整圈角步长用 2*Math.PI 而不是 6.2832：截断字面量会少转 1.47e-5 rad，让多边形长度质心偏离几何中心 ~6e-5px。
      var ar=ir/NS*2*Math.PI;
      outr.push([cxr+Math.cos(ar)*rv,cyr+Math.sin(ar)*rv]);
    }
    return {pts:outr,shape:'ring',rad:rr,cx:cxr,cy:cyr};
  }
  if(shape==='tri'){
    // 直角三角形：首点 P0 与末点 P1 是斜边的两个端点，直角点 = (x0,y1)（从首点走竖直边、到末点走水平边）。
    // 上/下/左/右拖拽自然给出对应朝向，无需特判。
    /* 预设三角形返回 shape:'tri'（矩形返回 'rect'），以区别于画笔手绘折线的 'poly'：预设器件可以赋电荷。
     * 没有任何地方依赖 wshape==='poly'；传送带/画笔仍走 'poly'。 */
    return {pts:[[x0,y0],[x0,y1],[x1,y1]],shape:'tri'};
  }
  if(shape==='trough'){
    // 半凹槽（滑梯）：矩形的「顶边+一条邻边」被一条内凹的四分之一圆弧替代，保留另一条邻边和对边作直边。
    // 开口（弧的凹面）朝拖拽的反方向：向下拖得开口朝上的滑梯，向右拖得开口朝左，以此类推。
    // 方向判定看包围盒宽高比，不看拖拽的 dx/dy：扁盒子上下开口，高盒子左右开口；dx/dy 在 45° 附近
    // 会让形状突然旋转 90°。开口朝哪一侧由末点相对首点的方向决定。
    // 规范形（开口朝上）：左上角 → 顶边小平台 → 四分之一弧 → 底边 → 左边闭合，R=min(H,W-t)。
    var wT=bx-ax,hT=by-ay,wT2=wT,hT2=hT;
    var t5=Math.max(12,wT-hT),R5=Math.min(hT,wT-t5);
    // 弧采样 29 段：渲染走 canvas 真弧（见 arcs 元数据），加密是给碰撞用的 —— 段越密多边形越贴真弧
    // （R≈400px 时 14 段弦高偏差 ~2px，28 段 ~0.5px）。取奇数让弧的扫过中点落在段中央（同 tub 的接缝楔住问题）。
    var N5=29,base=[],k5;
    // 弧心在右上角 (bx,ay)，从 180°（顶边末端）扫到 90°（底边右端）：
    // 起点切线垂直（陡降）、终点切线水平（平滑汇入底边）。
    base.push([ax,ay]);                                        // 左上角 -> 顶边平台（到弧起点）
    for(k5=0;k5<=N5;k5++){var a5=Math.PI-Math.PI/2*k5/N5;      // 180° -> 90°
      base.push([bx+Math.cos(a5)*R5,ay+Math.sin(a5)*R5]);}
    if(ay+R5<by-1)base.push([bx,by]);                          // 弧终点未到底边时补一小段右壁
    base.push([ax,by]);                                        // 底边 -> 左边闭合
    // 弧元数据（规范形）：pts[1..1+N5] 是圆心 (bx,ay)、半径 R5 的圆弧，mid = 弧中点（3π/4 处）。
    // 四种开口变换都是等距变换，圆心与中点跟着点一起变换即可；走向(ccw)渲染时现算。
    var arcs5=[{i0:1,i1:1+N5,cx:bx,cy:ay,r:R5,
                mx:bx+Math.cos(Math.PI*0.75)*R5,my:ay+Math.sin(Math.PI*0.75)*R5}];
    // 方向变换：恒等(开口朝上) / y镜像(朝下) / 绕包围盒中心 ±90° 旋转(朝左、朝右)。
    // 旋转必须绕包围盒中心 (mx,my)：写成 [y, ax+bx-x] 这类转置会让形状跳到关于对角线镜像的位置。
    var wide=(wT2>=hT2),down5=(y1>=y0),right5=(x1>=x0),out5=[];
    var mx5=(ax+bx)/2,my5=(ay+by)/2;
    function xf5(p){
      if(wide&&down5)return p;                                         // 开口朝上（从左上往右下拖）
      if(wide)return [p[0],ay+by-p[1]];                                // 开口朝下（y 镜像，中心不动）
      if(right5)return [mx5-my5+p[1],mx5+my5-p[0]];                    // 开口朝左（绕中心转 90°，顶边→左边）
      return [mx5+my5-p[1],my5-mx5+p[0]];                              // 开口朝右（绕中心转 -90°）
    }
    for(k5=0;k5<base.length;k5++)out5.push(xf5(base[k5]));
    for(k5=0;k5<arcs5.length;k5++){
      var c5=xf5([arcs5[k5].cx,arcs5[k5].cy]),m5b=xf5([arcs5[k5].mx,arcs5[k5].my]);
      arcs5[k5].cx=c5[0];arcs5[k5].cy=c5[1];arcs5[k5].mx=m5b[0];arcs5[k5].my=m5b[1];
    }
    return {pts:out5,shape:'trough',arcs:arcs5};
  }
  if(shape==='tub'){
    // 全凹槽（浴缸/碗）：矩形的顶边被一条半圆弧替代，顶边两端各留一小段平台，开口朝拖拽的反方向。
    // 规范形（开口朝上）：半圆弧圆心在顶边中央，弧底落在包围盒内。
    var w6=bx-ax,h6=by-ay;
    // 参数按参考图反推：半径取 0.92H（弧底不触底，留 ~8% 余量），平台 t = W/2 − R。
    // 先给平台留出 10px，再把 R 压进剩下的空间：R = min(0.92H, 0.43W, W/2−10)，t = W/2−R（至少 2px）。
    // 不要让 R 与 t 各自独立 clamp：小尺寸时 R + t > W/2，弧的两端会伸进顶边平台（W=70 时侵入 5.10px）。
    // W≥143 时 0.43W ≤ W/2−10，大形状不受影响。
    var R6=Math.max(2,Math.min(h6*0.92,w6*0.43,w6/2-10));
    var t6=Math.max(2,w6/2-R6);
    // 弧采样 41 段（理由同 trough，碰撞多边形贴真弧）。必须是奇数：偶数段时弧底恰好落在两段交界的 V 形接缝上，
    // 振荡的球经过时会被两侧楔面吃光切向速度、夹死在弧底并被睡眠冻结（μ=0 也会停）。奇数段让弧底落在段中央。
    var cx6=(ax+bx)/2,N6=41,base6=[],k6;
    base6.push([ax,ay],[ax+t6,ay]);
    // 180° -> 0°（经过 90°），sin 为正 = 弧向下凹进矩形（浴缸底）；写成 180°->360° 会让弧翻到顶边上方。
    for(k6=0;k6<=N6;k6++){var a6=Math.PI-Math.PI*k6/N6;          // 180°(左端) -> 0°(右端)，经底部
      base6.push([cx6+Math.cos(a6)*R6,ay+Math.sin(a6)*R6]);}
    base6.push([bx-t6,ay],[bx,ay],[bx,by],[ax,by]);
    // 弧元数据（规范形）：pts[2..2+N6] 是圆心 (cx6,ay)、半径 R6 的半圆弧，mid = 90° 处（弧底）。走向(ccw)渲染时现算。
    var arcs6=[{i0:2,i1:2+N6,cx:cx6,cy:ay,r:R6,mx:cx6,my:ay+R6}];
    // 方向判定同 trough：宽高比决定上下/左右开口，末点方向决定朝哪一侧；旋转同样绕包围盒中心。
    var wide6=(w6>=h6),down6=(y1>=y0),right6=(x1>=x0),out6=[];
    var mx6b=(ax+bx)/2,my6b=(ay+by)/2;
    function xf6(p){
      if(wide6&&down6)return p;
      if(wide6)return [p[0],ay+by-p[1]];
      if(right6)return [mx6b-my6b+p[1],mx6b+my6b-p[0]];
      return [mx6b+my6b-p[1],my6b-mx6b+p[0]];
    }
    for(k6=0;k6<base6.length;k6++)out6.push(xf6(base6[k6]));
    for(k6=0;k6<arcs6.length;k6++){
      var c6=xf6([arcs6[k6].cx,arcs6[k6].cy]),m6c=xf6([arcs6[k6].mx,arcs6[k6].my]);
      arcs6[k6].cx=c6[0];arcs6[k6].cy=c6[1];arcs6[k6].mx=m6c[0];arcs6[k6].my=m6c[1];
    }
    return {pts:out6,shape:'tub',arcs:arcs6};
  }
  if(shape==='arc'){
    // 弧的绘制语义：统一画四分之一弧 ——
    //   · 按下点 = 圆心
    //   · 松开点 = 弧的中点
    //   · 永远 90° = [θ−45°, θ+45°]，θ = 松开点相对圆心的方向，半径 = 拖拽距离
    // 必须用原始的 x0,y0 / x1,y1：函数开头的 ax/ay/bx/by 已归一化成 min/max，丢了按下与松开的先后关系。
    // 端点手柄照旧（ell 的 a0/a1），黄点仍可改起止角。
    var dxA=x1-x0,dyA=y1-y0;
    var RA=Math.max(30,Math.hypot(dxA,dyA));         // 半径 = 圆心到松开点的距离（保底 30）
    var thA=((dxA||dyA)?Math.atan2(dyA,dxA):Math.PI/4);
    return shapeArcPts(x0,y0,RA,RA,thA-Math.PI/4,thA+Math.PI/4);
  }
  /* 预设矩形返回 shape:'rect'（区别于手绘折线的 'poly'，同上）。 */
  return {pts:[[ax,ay],[bx,ay],[bx,by],[ax,by]],shape:'rect'};
}
// 圆弧采样：角度用屏幕系（y 向下，顺时针为正）。段数按扫过角度自适应：每段角步长 <= 0.09 rad（约 5°），
// 300px 的圆上矢高 < 0.3px。对外永远 rx=ry（正圆弧），保留两个参数以便将来画椭圆。
export function shapeArcPts(cx,cy,rx,ry,a0,a1){
  // 段数强制奇数（n|=1）：偶数段时弧的扫过中点（最凹点）落在两段交界的 V 形接缝上，振荡的球会被楔住（同 tub 的 N6）。
  var sw=a1-a0,n=Math.max(20,Math.min(160,Math.ceil(Math.abs(sw)/0.09)))|1,pts=[],k;
  for(k=0;k<=n;k++){var a=a0+sw*k/n;pts.push([cx+Math.cos(a)*rx,cy+Math.sin(a)*ry]);}
  return {pts:pts,shape:'arc',open:true,ell:{cx:cx,cy:cy,rx:rx,ry:ry,a0:a0,a1:a1}};
}
export function shapeDefault(shape,x,y){
  if(shape==='circle')return shapeOutline('circle',x-70,y-70,x+70,y+70);
  if(shape==='ring')return shapeOutline('ring',x-80,y-80,x+80,y+80);      // 空心圆：默认半径 80
  if(shape==='tri')return shapeOutline('tri',x-85,y-70,x+85,y+70);        // 默认斜边从左上到右下
  if(shape==='trough')return shapeOutline('trough',x-70,y-45,x+70,y+45);  // 默认开口朝上（滑梯）
  if(shape==='tub')return shapeOutline('tub',x-80,y-45,x+80,y+45);        // 默认开口朝上（浴缸）
  // 弧的默认形 = 圆心在落点、半径 70、右下象限 90° 弧（等价于按下后朝右下拖 70px）
  if(shape==='arc')return shapeArcPts(x,y,70,70,0,Math.PI/2);
  return shapeOutline('rect',x-80,y-45,x+80,y+45);
}
// W 体统一描线。直线段 lineTo；带 arcs 元数据的段（半凹槽/全凹槽的圆弧）与整条椭圆弧
// （arc 工具，ell）用 canvas 真弧，弧中间的采样点全部跳过。
// 碰撞不受影响：bndSegs 仍沿 pts 采样成多段薄板（Matter 只吃多边形）。
// 走向(ccw)不存进元数据，渲染时用「弧中点在 (起点,终点) 旋转方向的哪一侧」现算：
// 两次叉积同号 = 沿角度增加方向（ccw=false），异号 = 角度减小（ccw=true）。
// arcs 里的圆心/中点坐标与 pts 同一坐标系：body 上是本地坐标(lcx..)，shapeOutline 虚影上是世界坐标(cx..)。
export function traceWPath(c,pts,closed,arcs,ell){
  var list=null;
  if(arcs&&arcs.length)list=arcs;
  else if(ell)list=[{i0:0,i1:pts.length-1,ell:ell}];
  // traceWPath 自己负责开新路径：moveTo 不会清掉当前路径，而场景里没有 W 体时（刚开画那一刻）
  // 整帧没有别处 beginPath，每次拖拽都会把弧追加到上一帧路径尾巴上、stroke() 重描整条，
  // 表现为 N 条重叠残影，且擦除重画时旧残影会回来。
  c.beginPath();
  c.moveTo(pts[0][0],pts[0][1]);
  var k=0,inA=false,A=null,j;
  // 起点即弧起点的情形（整条椭圆弧的 i0 恒为 0）在循环前先吃掉：
  // 下面的循环从 j=1 起，j===list[k].i0 永远不成立，否则所有采样点都会走 lineTo 画成折线。
  if(list&&list.length&&list[0].i0===0){inA=true;A=list[0];k=1;}
  for(j=1;j<pts.length;j++){
    if(list){
      if(!inA&&k<list.length&&j===list[k].i0){inA=true;A=list[k];continue;}
      if(inA&&j===A.i1){
        if(A.ell){   // 弧工具：整条 = 一段椭圆弧（arcSetAngle 保证 a1>a0，恒沿角度增加方向）
          // 两套圆心坐标都要认：
          //   · 已落体的 W 体：mkBoundary 把世界圆心转成本地坐标，字段 lcx/lcy（渲染前 cvx 已 translate/rotate 到体坐标系）；
          //   · 拖拽中的虚影：shapeOutline 的返回值原样用（画布没有 translate），字段 cx/cy。
          // 只读 lcx/lcy 会让虚影调用 ellipse(undefined,...)，canvas 对非有限参数整个忽略，拖拽时一条线都画不出来。
          var ex=(A.ell.lcx!=null)?A.ell.lcx:A.ell.cx;
          var ey=(A.ell.lcy!=null)?A.ell.lcy:A.ell.cy;
          c.ellipse(ex,ey,A.ell.rx,A.ell.ry,0,A.ell.a0,A.ell.a1,false);
        }else{
          var acx=(A.lcx!=null)?A.lcx:A.cx,acy=(A.lcy!=null)?A.lcy:A.cy;
          var amx=(A.lmx!=null)?A.lmx:A.mx,amy=(A.lmy!=null)?A.lmy:A.my;
          var p0=pts[A.i0],p1=pts[j];
          var a0=Math.atan2(p0[1]-acy,p0[0]-acx),a1=Math.atan2(p1[1]-acy,p1[0]-acx);
          var z1=(p0[0]-acx)*(amy-acy)-(p0[1]-acy)*(amx-acx);
          var z2=(amx-acx)*(p1[1]-acy)-(amy-acy)*(p1[0]-acx);
          // 叉积符号 = 旋转方向：沿角度增加方向走时叉积为正（sin(da)>0）。
          // canvas 的 ccw=true 是「角度减小」。所以两次叉积都正 → ccw=false；都负 → ccw=true。
          var ccw=(z1<0&&z2<0)?true:((z1>0&&z2>0)?false:false);
          // canvas 的 arc() 会先从当前点连一条线到弧起点 —— 正好把「平台 -> 弧起点」那条
          // 直边补上（tub: pts[1]->pts[2]，trough: pts[0]->pts[1]），无需单独 lineTo。
          c.arc(acx,acy,A.r,a0,a1,ccw);
        }
        inA=false;A=null;k++;continue;
      }
      if(inA)continue;
    }
    c.lineTo(pts[j][0],pts[j][1]);
  }
  if(closed)c.closePath();
}
// 圆环渲染走 canvas 真弧（与 circle 同待遇），碰撞留自适应多边形。
// 原因：outlineSides 按矢高定段数（半径偏差峰峰 ≤ OUTLINE_PP_MAX=0.30px），矢高 ∝ R ⇒ N ∝ √R ⇒ 弦长 ∝ √R 无上限
// （R=80 弦长 10.5px、R=300 约 25px、R=1000 达 48.7px），大圆看起来就是折线；
// 肉眼看的是平直段长度而非矢高，靠加密段数在大半径上无解（弦 ≤6px 要 N≈1.05R）。
// 代价有界：多边形边离真圆最远 = 矢高 ≤0.30px（墨宽 4.65px 的 6.5%），画出的线与碰撞线最多差 0.30px。
// 只在顶点确实落在 rad±2px 的圆上时才走真弧：环被变形/单轴缩放后 B.pts 不再是正圆，
// 真弧会与实际几何不符，此时退回多边形。
export function ringIsTrueCircle(B){
  var n=B.pts.length;if(n<8)return false;
  var rad=B.rad;
  for(var i=0;i<n;i++){
    var dx=B.pts[i][0],dy=B.pts[i][1];
    if(dx*dx+dy*dy<1e-9)return false;              // 顶点落在质心上 = 几何塌掉，别硬画
    var d=Math.hypot(dx,dy);
    if(d<rad-2||d>rad+2)return false;
  }
  return true;
}
export function drawBoundaries(){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.kind!=='W')continue;
    // 真带子传本体（_bph 要能累起来）；虚影传桩对象（纹路静止，见 drawDeviceGhost）。
    if(B.belt){drawBeltBody(B,B===app.hoverW);continue;}
    if(B.gnd){drawGroundBody(B,B===app.hoverW);continue;}   // 地面/墙面的符号外观
    
    cvx.save();
    cvx.translate(B.x,B.y);cvx.rotate(B.th||0);
    cvx.beginPath();
    if(B.wshape==='circle'&&B.rad){cvx.arc(0,0,B.rad,0,6.2832);}
    else if(B.wshape==='ring'&&B.rad>0&&ringIsTrueCircle(B)){cvx.arc(0,0,B.rad,0,6.2832);}
    else{
      // 通用路径走 traceWPath：直线段 lineTo，带 arcs 元数据的段（半凹槽/全凹槽）
      // 与整条椭圆弧（arc 工具）用 canvas 真弧。
      traceWPath(cvx,B.pts,B.closed,B.arcs,B.ell);
    }
    // ONLY THE LINE IS THE BOUNDARY — never fill the inside. A pen stroke is a marker line and a
    // preset shape is a hollow frame: the area they enclose is ordinary empty space you can drop
    // things into, and it carries none of the weight (that sits on the line: B.bndM/B.bndI).
    cvx.lineJoin='round';cvx.lineCap='round';
    // 悬浮中的物体线段发淡蓝光，提示「此时点击即可抓取」。
    // 不能用 shadowBlur：画布底色是浅米色 #F4F1EA，浅色光晕会被背景吃掉。
    // 改为在线条外套两层半透明淡蓝加粗描边：外层宽而淡（光晕），内层窄而实（亮边），最后画正常黑线。
    if(B===app.hoverW){
      cvx.strokeStyle='rgba(96,182,255,0.30)';cvx.lineWidth=BND_HH*1.55+13;cvx.stroke();
      cvx.strokeStyle='rgba(120,198,255,0.62)';cvx.lineWidth=BND_HH*1.55+6;cvx.stroke();
    }
    cvx.lineWidth=BND_HH*1.55;
    cvx.strokeStyle=B===app.hoverW?'rgba(28,58,92,1)':'rgba(38,34,28,1)';
    cvx.stroke();
    cvx.restore();
  }
}
/* ---- collision: a boundary is a WALL of solid edges ----------------------------------- */
export function inkPieces(B,pad){
  // the "other side" of a contact, as a list of oriented boxes: a formula's per-glyph ink boxes,
  // a rod's single plank, another boundary's edges, else the plain AABB.
  if(B.glyphs&&B.glyphs.length&&!B.kind&&!B.bh){
    var osc=B.sc||1,oTH=B.th||0,oc=Math.cos(oTH),os=Math.sin(oTH),out=[];
    for(var i=0;i<B.glyphs.length;i++){
      var pg=B.glyphs[i];
      if(!pg||pg.dead||!pg.m)continue;
      var gtop=(pg.m.top==null?-F/2:pg.m.top),gbot=(pg.m.bot==null?F/2:pg.m.bot);
      var gw=(pg.m.w||F*0.6);
      var gil=(pg.m.il==null?-gw/2:pg.m.il),gir=(pg.m.ir==null?gw/2:pg.m.ir);
      var gx=(pg.sx||0)+(gil+gir)/2,gy=(pg.sy||0)+(gtop+gbot)/2;
      out.push({x:B.x+(gx*oc-gy*os)*osc,y:B.y+(gx*os+gy*oc)*osc,
                hw:((gir-gil)/2)*osc,hh:((gbot-gtop)/2)*osc,th:oTH,pad:(pad==null?ROD_PAD:pad)});
    }
    if(out.length)return out;
  }
  if(B.kind==='T')return [{x:B.x,y:B.y,hw:Math.max(4,(B.len||170)/2),hh:2,th:B.th||0,pad:(pad==null?ROD_PAD:pad)}];
  if(B.kind==='W'){
    var sg=bndSegs(B);
    for(var s2=0;s2<sg.length;s2++)sg[s2].pad=(pad==null?ROD_PAD:pad);
    return sg;
  }
  return [{x:B.x,y:B.y,hw:(B.hw||24)*(B.sc||1),hh:(B.hh||18)*(B.sc||1),th:B.th||0,pad:0}];
}
export function segHull(pts,t){      // a dead-straight stroke has no interior: a zero-thickness quad along
                              // its axis. Thickness is added ONCE, as the pad in the SAT below --
                              // inflating here as well double-counts it (the line then rested a
                              // whole stroke-width too high: 683.7 instead of 690.7).
  var bi=0,bj=1,bd=-1,i,j;
  for(i=0;i<pts.length;i++)for(j=i+1;j<pts.length;j++){
    var d=(pts[i][0]-pts[j][0])*(pts[i][0]-pts[j][0])+(pts[i][1]-pts[j][1])*(pts[i][1]-pts[j][1]);
    if(d>bd){bd=d;bi=i;bj=j;}
  }
  var ax=pts[bi][0],ay=pts[bi][1],bx=pts[bj][0],by=pts[bj][1];
  var dx=bx-ax,dy=by-ay,L=Math.hypot(dx,dy)||1,ux=dx/L,uy=dy/L,nx=-uy,ny=ux;
  return [[ax+nx*t,ay+ny*t],[bx+nx*t,by+ny*t],[bx-nx*t,by-ny*t],[ax-nx*t,ay-ny*t]];
}
export function bndHullLocal(B){
  if(B.hull)return B.hull;
  var pts=B.pts||[],h=(pts.length>=3)?hull2D(pts):pts.slice(),i,ar=0;
  for(i=0;i<h.length;i++){var a=h[i],b=h[(i+1)%h.length];ar+=a[0]*b[1]-b[0]*a[1];}
  if(h.length<3||Math.abs(ar)/2<2)h=segHull(pts,0);
  B.hull=h;return h;
}
export function bndHullWorld(B){
  var h=bndHullLocal(B),c=Math.cos(B.th||0),s=Math.sin(B.th||0),out=[],i;
  for(i=0;i<h.length;i++){var q=h[i];out.push([B.x+q[0]*c-q[1]*s,B.y+q[0]*s+q[1]*c]);}
  return out;
}
// separating-axis test between two convex hulls, HB shifted by (ox,oy); null when apart.
export function solidSAT(HA,HB,padA,padB,ox,oy){
  var best=1e9,bnx=0,bny=0,k;
  for(var pi=0;pi<2;pi++){
    var P=(pi===0)?HA:HB;
    for(var i=0;i<P.length;i++){
      var p1=P[i],p2=P[(i+1)%P.length];
      var ex=p2[0]-p1[0],ey=p2[1]-p1[1],el=Math.hypot(ex,ey);
      if(el<1e-6)continue;
      var nx=-ey/el,ny=ex/el;
      var a0=1e9,a1=-1e9,b0=1e9,b1=-1e9;
      for(k=0;k<HA.length;k++){var da=HA[k][0]*nx+HA[k][1]*ny;if(da<a0)a0=da;if(da>a1)a1=da;}
      for(k=0;k<HB.length;k++){var db=(HB[k][0]+ox)*nx+(HB[k][1]+oy)*ny;if(db<b0)b0=db;if(db>b1)b1=db;}
      a0-=padA;a1+=padA;b0-=padB;b1+=padB;
      var ov=Math.min(a1,b1)-Math.max(a0,b0);
      if(ov<=0)return null;                       // a separating axis exists -> they are apart
      if(ov<best){best=ov;bnx=nx;bny=ny;}
    }
  }
  if(best>=1e9)return null;
  return {ov:best,nx:bnx,ny:bny};
}
export function solidDepthAlong(HA,HB,padA,padB,nx,ny){
  var a0=1e9,a1=-1e9,b0=1e9,b1=-1e9,k;
  for(k=0;k<HA.length;k++){var da=HA[k][0]*nx+HA[k][1]*ny;if(da<a0)a0=da;if(da>a1)a1=da;}
  for(k=0;k<HB.length;k++){var db=HB[k][0]*nx+HB[k][1]*ny;if(db<b0)b0=db;if(db>b1)b1=db;}
  a0-=padA;a1+=padA;b0-=padB;b1+=padB;
  return Math.min(a1,b1)-Math.max(a0,b0);
}
export function bndSolidHit(A,B){
  var HA=bndHullWorld(A),HB=bndHullWorld(B);
  if(HA.length<2||HB.length<2)return null;
  var padA=BND_INK,padB=BND_INK;   // 与墨迹同厚（用 closed?BND_HH:PEN_HW 会偏胖 0.675px）
  // same swept search as bndHit: a fast fall must not tunnel through the block it lands on.
  var mdx=((B.vx||0)-(A.vx||0))*lastDt,mdy=((B.vy||0)-(A.vy||0))*lastDt;
  var mlen=Math.hypot(mdx,mdy),K=(mlen>3)?Math.min(12,Math.ceil(mlen/3)):1,nrm=null;
  for(var kk=1;kk<=K&&!nrm;kk++){
    var ft=kk/K;
    nrm=solidSAT(HA,HB,padA,padB,-mdx*(1-ft),-mdy*(1-ft));
  }
  if(!nrm)return null;
  var nx=nrm.nx,ny=nrm.ny;
  if((B.x-A.x)*nx+(B.y-A.y)*ny<0){nx=-nx;ny=-ny;}     // normal points A -> B
  var ov=solidDepthAlong(HA,HB,padA,padB,nx,ny);      // the CURRENT overlap, to separate by
  if(!(ov>0))return null;
  return {ov:ov,nx:nx,ny:ny};
}
// SAT of a boundary's edges against another body's boxes, swept along the other body's motion.
// This is the rod branch of collideBodies() with "one plank" replaced by "every edge": the
// sub-stepping exists for exactly the same reason (a 6px-thick edge vs a 20px/frame fall).
export function bndHit(WB,oth){
  var segs=bndSegs(WB);
  if(!segs.length)return null;
  var pc=inkPieces(oth,ROD_PAD);
  if(!pc||!pc.length)return null;
  // Sweep along the RELATIVE motion of `oth` past this boundary. The boundary itself can fall under
  // its own weight, so its velocity must come out of the sweep too -- otherwise a 7px-thick pen plank
  // moving at ~20px/frame jumps clean through a 4px rod. With the boundary static this is the plain sweep.
  // 边界一侧必须用 rvx/rvy（位姿差分 + 死区）而不是 vx/vy（理由见 stepMatter）：
  // Matter 在静止接触里保留的幻影 velocity、以及复合体静置时的 1px 跳变，都会让墙看起来在高速移动，
  // 横扫出的相对位移会毁掉接触判定。vx/vy 只留给黑洞吸力这类外部驱动。
  var mdx=((oth.vx||0)-(WB.rvx||0))*lastDt,mdy=((oth.vy||0)-(WB.rvy||0))*lastDt;
  var mlen=Math.sqrt(mdx*mdx+mdy*mdy);
  var K=(mlen>3)?Math.min(12,Math.ceil(mlen/3)):1;
  var ov=0,nx=0,ny=0;
  for(var si=0;si<segs.length;si++){
    var S=segs[si];
    var be1x=Math.cos(S.th),be1y=Math.sin(S.th),be2x=-be1y,be2y=be1x;
    for(var qi=0;qi<pc.length;qi++){
      var PC=pc[qi];
      var ae1x=Math.cos(PC.th),ae1y=Math.sin(PC.th),ae2x=-ae1y,ae2y=ae1x;
      var ax=[ae1x,ae1y,ae2x,ae2y,be1x,be1y,be2x,be2y];
      var hit=false,qnx=0,qny=0,qR=0;
      for(var kk=1;kk<=K&&!hit;kk++){
        var ft=kk/K;
        var pdx=PC.x-mdx*(1-ft)-S.x,pdy=PC.y-mdy*(1-ft)-S.y;
        var tmin=1e9,tnx=0,tny=0,tR=0,tsep=false;
        for(var ai=0;ai<8;ai+=2){
          var anx=ax[ai],any=ax[ai+1];
          var ra=S.hw*Math.abs(anx*be1x+any*be1y)+S.hh*Math.abs(anx*be2x+any*be2y);
          var rb=PC.hw*Math.abs(anx*ae1x+any*ae1y)+PC.hh*Math.abs(anx*ae2x+any*ae2y);
          var ad=pdx*anx+pdy*any;
          var need=ra+rb+PC.pad,aov=need-Math.abs(ad);
          if(aov<=0){tsep=true;break;}
          if(aov<tmin){tmin=aov;var asg=(ad<0)?-1:1;tnx=asg*anx;tny=asg*any;tR=need;}
        }
        if(tsep)continue;
        hit=true;qnx=tnx;qny=tny;qR=tR;
      }
      if(!hit)continue;
      // qn points edge -> the side PC came from, i.e. from the boundary towards `oth`
      var adv=(PC.x-S.x)*qnx+(PC.y-S.y)*qny;
      var ovc=qR-adv;
      if(ovc>ov){ov=ovc;nx=qnx;ny=qny;}
    }
  }
  if(ov<=0)return null;
  return {ov:ov,nx:nx,ny:ny};
}
