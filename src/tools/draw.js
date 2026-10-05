/* 画笔与预设形状的绘制 */
import Matter from 'matter-js';
import { BND_HH, mkBoundary, shapeDefault, shapeOutline, traceWPath } from '../bodies/boundary.js';
import { drawDeviceGhost } from '../devices/placement.js';
import { pointer } from '../input/pointer.js';
import { cvx } from '../render/render.js';
import { ringGo } from '../ui/menu.js';
import { TOOL, flashHint, setToolMode } from '../ui/toolbar.js';

export const PEN_MAX=90;         // most segments one pen stroke may carry (keeps the collision pass cheap)
/* ---- the pen & the shape drag --------------------------------------------------------- */
export function startStroke(e){
  pointer.x=e.clientX;pointer.y=e.clientY;
  TOOL.stroke={pts:[[pointer.x,pointer.y]]};
}
export function penKeep(pts){
  // Thin the raw pointer stream (a sample every >=9px keeps the plank chain cheap and every plank
  // long enough to be a real wall), then cap the chain so one long scribble cannot cost the
  // collision pass hundreds of SAT tests on every single frame.
  var keep=[pts[0]],last=pts[0],i;
  for(i=1;i<pts.length;i++){
    if(Math.hypot(pts[i][0]-last[0],pts[i][1]-last[1])>=9){keep.push(pts[i]);last=pts[i];}
  }
  var end=pts[pts.length-1];
  if(keep.length<2||keep[keep.length-1]!==end)keep.push(end);
  while(keep.length>PEN_MAX){
    var thinned=[];
    for(i=0;i<keep.length;i+=2)thinned.push(keep[i]);
    if(thinned[thinned.length-1]!==keep[keep.length-1])thinned.push(keep[keep.length-1]);
    keep=thinned;
  }
  return keep;
}
export function finishStroke(){
  var pts=TOOL.stroke?TOOL.stroke.pts:null;
  TOOL.stroke=null;
  if(!pts||pts.length<2)return;          // a bare click is not a stroke: stay armed
  var keep=penKeep(pts);
  // the stroke itself is the body — an OPEN line, so its physics planks run along the stroke and
  // its weight is the stroke's own length (never the area the scribble happens to enclose)
  var B=mkBoundary(keep,{shape:'poly',closed:false});
  if(B)ringGo(B.x,B.y);
  // 单击武装只画一次，画完自动解除；双击进入的连续模式才保持武装。
  // 只有真画出了体才解除——空点一下（没成体）不收工具。
  if(B&&!TOOL.cont)setToolMode(null);
}
export function startShapeDrag(e){
  pointer.x=e.clientX;pointer.y=e.clientY;
  TOOL.drag={x0:pointer.x,y0:pointer.y,x1:pointer.x,y1:pointer.y};
}
export function finishShapeDrag(){
  var d=TOOL.drag;TOOL.drag=null;
  if(!d)return;
  var r;
  // 连续模式（TOOL.cont）下单击（没拖出尺寸）不生成默认图形，必须拖出形状才落体：
  // 否则误双击进入连续模式后，一路点过去会生成一串几乎重叠的默认图形。
  // 单次模式仍是单击画一个默认图形。
  if(Math.abs(d.x1-d.x0)<12&&Math.abs(d.y1-d.y0)<12){
    if(TOOL.cont){if(flashHint)flashHint('连续模式·拖出形状才落体','cont');return;}
    r=shapeDefault(TOOL.shape,d.x0,d.y0);
  }
  else r=shapeOutline(TOOL.shape,d.x0,d.y0,d.x1,d.y1);
  // 半凹槽(trough)是「矩形被圆挖掉一块」的闭合多边形（shapeOutline 返回 shape:'trough'，带 notch 凹口元数据）；
  // 圆弧(arc)是开链（shape:'arc'）。
  var closed=r.shape!=='arc'&&!r.open;
  // 必须传 arcs:r.arcs：漏传时 mkBoundary 不会把弧的世界坐标转成本地坐标，B.arcs 为 undefined，
  // traceWPath 认不出弧，凹槽/滑梯一落体就从真弧退化成折线。
  // （拖拽虚影走 drawToolPreview 的 r.arcs 分支仍是真弧，松手才变，容易漏看。）
  var B=mkBoundary(r.pts,{shape:r.shape,rad:r.rad,closed:closed,notch:r.notch,ell:r.ell,arcs:r.arcs});
  // 用形状工具画出的圆轨（shape 'ring'）默认固定：它是场地/轨道，不固定放下去就自己溜走。
  // 写在落体路径而不是 mkBoundary：mkBoundary 是所有构造入口（复制/粘贴、解散重组等）的公共入口，
  // 在那里置 fixed 会让复制出的圆轨、改成圆轨形状的手绘线也变成固定的。
  // 写法与 makeBelt 相同：B.fixed=true + setStatic(true) + 唤醒
  // （不唤醒的话静止体可能在建体那一帧就被判睡，之后拖不动）。
  if(B&&r.shape==='ring'&&!B.fixed){
    B.fixed=true;
    if(B.mb){Matter.Body.setStatic(B.mb,true);}
    if(B.mb){Matter.Sleeping.set(B.mb,false);}
  }
  if(B)ringGo(B.x,B.y);
  // 单击武装只画一次，画完自动解除；连续模式才保持武装
  if(B&&!TOOL.cont)setToolMode(null);
}
export function drawToolPreview(){
  // 器件从面板拖出时的落点虚影。虚影 = drawDeviceGhost → drawSpring（同一份渲染代码），
  // 看见什么就是放下什么。只在真的拖动了、且落点不在浮层上时才画。
  if(TOOL.devDrag&&TOOL.devDrag.moved&&TOOL.devDrag.over)drawDeviceGhost(TOOL.devDrag.id,TOOL.devDrag.x,TOOL.devDrag.y);
  if(TOOL.stroke&&TOOL.stroke.pts.length>1){
    var p=TOOL.stroke.pts;
    cvx.beginPath();cvx.moveTo(p[0][0],p[0][1]);
    for(var i=1;i<p.length;i++)cvx.lineTo(p[i][0],p[i][1]);
    cvx.strokeStyle='rgba(38,34,28,0.75)';cvx.lineWidth=BND_HH*1.55;cvx.lineJoin='round';cvx.lineCap='round';
    cvx.stroke();
    cvx.strokeStyle='rgba(201,168,106,0.9)';cvx.lineWidth=1.4;cvx.stroke();
  }
  if(TOOL.drag){
    var d=TOOL.drag;
    var r=(Math.abs(d.x1-d.x0)<12&&Math.abs(d.y1-d.y0)<12)?shapeDefault(TOOL.shape,d.x0,d.y0)
                                                          :shapeOutline(TOOL.shape,d.x0,d.y0,d.x1,d.y1);
    // 弧的拖拽虚影只画实际弧段，不要再画整圈外接参考线：弧是正圆，参考线会退化成完整虚线圆，
    // 淹没实际弧段，看起来像画了整圆。
    // 环的拖拽虚影也走真弧，否则拖拽时是折线、松手变圆。虚影没有 translate/rotate，
    // 所以用 shapeOutline 原样给的世界圆心 cx/cy（与 arcs 的 cx/cy 同一约定）。
    if(r.shape==='ring'&&r.rad>0&&r.cx!=null){cvx.beginPath();cvx.arc(r.cx,r.cy,r.rad,0,6.2832);}
    else traceWPath(cvx,r.pts,(r.shape!=='arc'&&!r.open),r.arcs,r.ell);
    // 开链（圆弧/开放笔画）虚影不 closePath：闭合一根弦会把弧补成整圆，看不出画的是哪段。
    // outline only while dragging too — the preview must promise exactly what you get
    cvx.strokeStyle='rgba(38,34,28,0.8)';cvx.lineWidth=BND_HH*1.55;
    cvx.setLineDash([6,5]);cvx.stroke();cvx.setLineDash([]);
  }
}
