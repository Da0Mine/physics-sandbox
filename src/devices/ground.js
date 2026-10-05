/* 地面 / 墙面器件 */
import Matter from 'matter-js';
import { BND_HH, mkBoundary } from '../bodies/boundary.js';
import { clamp, shortAng } from '../core/math.js';
import { GROUND_SPAWN_LEN } from '../params/defs.js';
import { MW, rebuildWBody } from '../physics/matter.js';
import { cvx } from '../render/render.js';

/* ================= 器件「地面 / 墙面」 =================
 * 一个器件：一块可任意摆角的静态板，转 90° 自然读作墙面。可拖动、悬浮旋转（45° 吸附），
 * 拖两端改长度，参数里可调长度和角度。
 * 性质与地面/边界一致：fixed=true + Matter static ⇒ 外部支撑源（与 railHostSupported / hostIsAnvil 口径一致，
 * 物件可以被它挡住、站上去、被弹簧顶住），默认固定。
 * 外观：上边 = 一条实线（受力面），下方 = 一排斜杠（工程制图的地面符号），两者都落在 mkBoundary 建出的
 * 矩形内部 ⇒ 看到的即能挡能站的。 */
// GROUND_SPAWN_LEN 声明在 PX_PER_M / CONV_DEF 那一区：参数表 gndlen 的 def 在字面量求值时就要拿到值
//   （var 提升只提升声明）。不要在这里重复声明。
export const GROUND_TH=18;              // 厚度（px）：碰撞箱就是这个矩形，刚好罩住斜杠
export const GROUND_MIN_LEN=60, GROUND_MAX_LEN=1600;   // 与带子同量级（太短则两端手柄重叠没法拖）
export function makeGround(cx,cy,len){
  len=clamp(len||GROUND_SPAWN_LEN,GROUND_MIN_LEN,GROUND_MAX_LEN);
  var hw=len/2,hh=GROUND_TH/2;
  var B=mkBoundary([[cx-hw,cy-hh],[cx+hw,cy-hh],[cx+hw,cy+hh],[cx-hw,cy+hh]],
                   {shape:'poly',closed:true});
  if(!B)return null;
  B.gnd=1;                                  // 器件身份（paramDef / 渲染 / 手柄白名单都认它）
  B.fixed=true;                             // 默认保持固定
  if(B.mb)Matter.Body.setStatic(B.mb,true); // 与 __box(fixed) 同款：裸写 isStatic 会被搬
  B.len=len;B.hw=hw;B.hh=hh;
  B._mlen=len;B._mth=B.th||0;
  return B;
}
/* 改两端 = 改长度的唯一入口（同 setBeltEnds 三件事：pts 重写 → hull 作废 → 重建 W 体）。
 * 必须作废 B.hull：bndHullLocal 只在 hull 为空时由 pts 重算，而这里是整数组替换（新点对象），
 * 旧 hull 会永久停在出生时的矩形（几何变了、碰撞还是旧尺寸）。 */
export function setGroundEnds(B,x0,y0,x1,y1,force){
  if(!B||!B.gnd)return;
  var dx=x1-x0,dy=y1-y0,raw=Math.hypot(dx,dy)||1;
  var d=clamp(raw,GROUND_MIN_LEN,GROUND_MAX_LEN);
  var ux=dx/raw,uy=dy/raw;
  B.x=(x0+x1)/2;B.y=(y0+y1)/2;B.th=Math.atan2(uy,ux);
  var hw=d/2,hh=GROUND_TH/2;
  B.len=d;B.hw=hw;B.hh=hh;
  B.pts=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
  B.hull=null;                              // 几何真值被改写 ⇒ 凸包缓存必须作废
  if(!MW||!B.mb)return;
  var stale=(B._mlen==null)||(Math.abs(B._mlen-d)>2)||(Math.abs(B._mth-(B.th||0))>0.01);
  if(force||stale){B._mlen=d;B._mth=B.th;rebuildWBody(B,B.th);}
  else{Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th);}
}
/* 长度手柄拖拽（调用形状同 setBeltEnds：远端锁存 fx/fy、本端跟指针）。
 * 指针位置投影到当前轴，只取轴向分量（只改长度），角度锁死：否则旋转后再拖端手柄，手偏离轴会让
 * atan2 跟着变，角度被拖回 0/90°。改角度走旋转手柄（45° 吸附）/参数面板。 */
export function groundDragEnds(B,g,px,py,force){
  if(!B||!B.gnd||!g)return;
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0);
  /* outward 方向按抓的端定（end=0→+u、end=1→−u）：若固定用 +u，抓 end=1 时 tAlong 恒负
   * ⇒ 被 clamp 到 MIN，板缩到最小并瞬移。sgn=−1 时交换 setGroundEnds 两参以保持 th 不翻转。 */
  var sgn2=(g.end===1)?-1:1;
  var ax=c*sgn2, ay=s*sgn2;                    // far→被抓端的 outward 方向
  var dxp=px-g.fx,dyp=py-g.fy;
  var tAlong=dxp*ax+dyp*ay;                    // 指针在轴上的投影参数
  /* tAlong 必须 ≥MIN：负值（指针越过远端）会让等效端点落到反向射线 ⇒ atan2 翻转 180° */
  tAlong=clamp(tAlong,GROUND_MIN_LEN,GROUND_MAX_LEN);
  var nx2=g.fx+ax*tAlong, ny2=g.fy+ay*tAlong;  // 投影后的等效端点（角度不变）
  if(sgn2===1)setGroundEnds(B,g.fx,g.fy,nx2,ny2,force);
  else setGroundEnds(B,nx2,ny2,g.fx,g.fy,force);  // 交换两参：th 保持原值不翻转
  B.vx=0;B.vy=0;B.om=0;
}
/* 参数面板改角度：绕质心转（同 setBeltAngle 语义，只是没有两端要同步）。
 * 几何真值在 pts（本地坐标）⇒ 只改 B.th + 摆 Matter 镜像，不需要重建。 */
export function setGroundAngle(B,th){
  if(!B||!B.gnd)return;
  B.th=shortAng(th);
  if(MW&&B.mb){Matter.Body.setAngle(B.mb,B.th);Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});}
}
/* 外观（上边实线 + 下方斜杠）—— 与 drawBoundaries 的通用描线互斥，调用处直接 continue
 * （同传送带，否则矩形框会被画两遍、盖掉符号）。 */
export const GROUND_HATCH_STEP=18;
export function drawGroundBody(B,hov){
  if(!B||!B.gnd)return;
  var hw=B.hw||GROUND_SPAWN_LEN/2,hh=B.hh||GROUND_TH/2;
  var ink=hov?'rgba(28,58,92,1)':'rgba(38,34,28,1)';
  cvx.save();
  cvx.translate(B.x,B.y);cvx.rotate(B.th||0);
  cvx.beginPath();cvx.rect(-hw,-hh,hw*2,hh*2);
  /* 静置态不铺底（只留上边实线 + 斜杠）；悬浮时保留淡蓝提示，与其他器件的选中反馈一致。 */
  if(hov){cvx.fillStyle='rgba(96,182,255,0.16)';cvx.fill();}
  /* ① 受力面：上边一条实线 */
  cvx.beginPath();
  cvx.moveTo(-hw,-hh);cvx.lineTo(hw,-hh);
  cvx.lineWidth=BND_HH*2.2;cvx.strokeStyle=ink;cvx.lineCap='round';cvx.stroke();
  /* ② 斜杠：从受力面向下斜铺，全部落在矩形内部 */
  var y0=-hh+BND_HH*1.7,y1=hh-BND_HH*0.7,drop=y1-y0;
  cvx.beginPath();
  for(var x=-hw+2;x<=hw-2;x+=GROUND_HATCH_STEP){
    var xa=x+drop*0.75;
    if(xa>hw-1)xa=hw-1;
    cvx.moveTo(x,y0);cvx.lineTo(xa,y1);
  }
  cvx.lineWidth=BND_HH*0.85;cvx.strokeStyle=ink;cvx.stroke();
  cvx.restore();
}
