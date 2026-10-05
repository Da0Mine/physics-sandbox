/* 通用数学/几何小工具 */


export function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
export function shortAng(d){d=d%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;}
// snap an angle to the nearest multiple of 90° when within SNAP_DEG (default 8°), else unchanged.
export const SNAP_DEG=8;
export function snapAngle90(a){var q=Math.PI/2,d=Math.PI*SNAP_DEG/180;var near=Math.round(a/q);return Math.abs(a-near*q)<=d?near*q:a;}
export const BELT_SNAP_DEG=8;
/* 只在离 stepDeg 整数倍 ±tolDeg（默认 BELT_SNAP_DEG）以内才吸上去，带外保留自由斜角。
 * 例：拖到 44° → 吸到 45°；拖到 30° → 保持 30°。 */
export function snapAngleDeg(a,stepDeg,tolDeg){
  if(!(stepDeg>0))return a;
  var q=stepDeg*Math.PI/180;
  var tol=((tolDeg!=null)?tolDeg:BELT_SNAP_DEG)*Math.PI/180;
  var near=Math.round(a/q);
  return Math.abs(a-near*q)<=tol?near*q:a;
}
// 端点与「别的物体」的距离（点不在端点附近就不算接触）——锚定判定就靠它
export function segPointDist(ax,ay,bx,by,px,py){
  var ex=bx-ax,ey=by-ay,L2=ex*ex+ey*ey;
  var t=L2>0?((px-ax)*ex+(py-ay)*ey)/L2:0;
  if(t<0)t=0;else if(t>1)t=1;
  return Math.hypot(px-(ax+ex*t),py-(ay+ey*t));
}
export function segClosest(ax,ay,bx,by,px,py){
  var ex=bx-ax,ey=by-ay,L2=ex*ex+ey*ey;
  var t=L2>0?((px-ax)*ex+(py-ay)*ey)/L2:0;
  if(t<0)t=0;else if(t>1)t=1;
  return {x:ax+ex*t,y:ay+ey*t};
}
export function overlap(a,b){return !(a.right<b.left||a.left>b.right||a.bottom<b.top||a.top>b.bottom);}
export function eOut(x){
  x=clamp(x,0,1);
  var c1=1.70158,c3=c1+1;
  return 1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2);
}
export function cubE(x){
  x=clamp(x,0,1);
  return 1-Math.pow(1-x,3);
}
export function popScale(p){
  var x=1-clamp(p,0,1);
  var c1=1.70158,c3=c1+1;
  var v=1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2);
  return 0.25+0.75*v;
}
/* ---- boundary vs boundary: each outline is a SOLID BLOCK -------------------------------- */
// Two hollow rims can INTERLOCK like two links of a chain — a rectangle overlapping another one
// side-on has its rim sitting inside the other's empty middle, and for HOLLOW rims there is then
// no translation at all that separates them. A per-edge "deepest contact" search therefore finds
// two opposing contacts of almost equal depth and flips between them forever; measured, the pair
// swapped its normal between (0,-1) and (0,1) every few frames, each body jumping 3.5px — the
// permanent shaking that was reported. Real building blocks do not interlock, because they are
// solid. So boundary-vs-boundary uses each outline's CONVEX HULL inflated by its own stroke
// half-thickness: a solid block of the same shape, which has ONE least-penetration axis and so
// cannot flip. Boundary-vs-anything-else still goes through bndHit (per-edge), so a formula can
// still be dropped through the hole in a frame.
export function hull2D(pts){
  var p=pts.slice().sort(function(a,b){return (a[0]-b[0])||(a[1]-b[1]);}),i;
  function cr(o,a,b){return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);}
  var lo=[],up=[];
  for(i=0;i<p.length;i++){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p[i])<=0)lo.pop();lo.push(p[i]);}
  for(i=p.length-1;i>=0;i--){while(up.length>=2&&cr(up[up.length-2],up[up.length-1],p[i])<=0)up.pop();up.push(p[i]);}
  lo.pop();up.pop();
  return lo.concat(up);
}
