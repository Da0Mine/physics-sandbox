/* 笔画 / 形状绘制、边界碰撞检测（原 index.html 第 17301–17786 行） */
/* ---- the pen & the shape drag --------------------------------------------------------- */
function startStroke(e){
  pointer.x=e.clientX;pointer.y=e.clientY;
  TOOL.stroke={pts:[[pointer.x,pointer.y]]};
}
function penKeep(pts){
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
function finishStroke(){
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
function startShapeDrag(e){
  pointer.x=e.clientX;pointer.y=e.clientY;
  TOOL.drag={x0:pointer.x,y0:pointer.y,x1:pointer.x,y1:pointer.y};
}
function finishShapeDrag(){
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
    if(B.mb&&typeof Matter!=='undefined'&&Matter.Body){Matter.Body.setStatic(B.mb,true);}
    if(B.mb&&typeof Matter!=='undefined'&&Matter.Sleeping){Matter.Sleeping.set(B.mb,false);}
  }
  if(B)ringGo(B.x,B.y);
  // 单击武装只画一次，画完自动解除；连续模式才保持武装
  if(B&&!TOOL.cont)setToolMode(null);
}
/* ---- drawing -------------------------------------------------------------------------- */
var hoverW=null;   // 悬浮高亮：指针悬停（可抓取）的 W 体，线段发光提示
// W 体统一描线。直线段 lineTo；带 arcs 元数据的段（半凹槽/全凹槽的圆弧）与整条椭圆弧
// （arc 工具，ell）用 canvas 真弧，弧中间的采样点全部跳过。
// 碰撞不受影响：bndSegs 仍沿 pts 采样成多段薄板（Matter 只吃多边形）。
// 走向(ccw)不存进元数据，渲染时用「弧中点在 (起点,终点) 旋转方向的哪一侧」现算：
// 两次叉积同号 = 沿角度增加方向（ccw=false），异号 = 角度减小（ccw=true）。
// arcs 里的圆心/中点坐标与 pts 同一坐标系：body 上是本地坐标(lcx..)，shapeOutline 虚影上是世界坐标(cx..)。
function traceWPath(c,pts,closed,arcs,ell){
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
function ringIsTrueCircle(B){
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
var BELT_DECO_STEP=26;
function drawBeltBody(B,hov){
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
function drawBoundaries(){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.kind!=='W')continue;
    // 真带子传本体（_bph 要能累起来）；虚影传桩对象（纹路静止，见 drawDeviceGhost）。
    if(B.belt){drawBeltBody(B,B===hoverW);continue;}
    if(B.gnd){drawGroundBody(B,B===hoverW);continue;}   // 地面/墙面的符号外观
    
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
    if(B===hoverW){
      cvx.strokeStyle='rgba(96,182,255,0.30)';cvx.lineWidth=BND_HH*1.55+13;cvx.stroke();
      cvx.strokeStyle='rgba(120,198,255,0.62)';cvx.lineWidth=BND_HH*1.55+6;cvx.stroke();
    }
    cvx.lineWidth=BND_HH*1.55;
    cvx.strokeStyle=B===hoverW?'rgba(28,58,92,1)':'rgba(38,34,28,1)';
    cvx.stroke();
    cvx.restore();
  }
}
function drawToolPreview(){
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
/* ---- collision: a boundary is a WALL of solid edges ----------------------------------- */
function inkPieces(B,pad){
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
function hull2D(pts){
  var p=pts.slice().sort(function(a,b){return (a[0]-b[0])||(a[1]-b[1]);}),i;
  function cr(o,a,b){return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);}
  var lo=[],up=[];
  for(i=0;i<p.length;i++){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p[i])<=0)lo.pop();lo.push(p[i]);}
  for(i=p.length-1;i>=0;i--){while(up.length>=2&&cr(up[up.length-2],up[up.length-1],p[i])<=0)up.pop();up.push(p[i]);}
  lo.pop();up.pop();
  return lo.concat(up);
}
function segHull(pts,t){      // a dead-straight stroke has no interior: a zero-thickness quad along
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
function bndHullLocal(B){
  if(B.hull)return B.hull;
  var pts=B.pts||[],h=(pts.length>=3)?hull2D(pts):pts.slice(),i,ar=0;
  for(i=0;i<h.length;i++){var a=h[i],b=h[(i+1)%h.length];ar+=a[0]*b[1]-b[0]*a[1];}
  if(h.length<3||Math.abs(ar)/2<2)h=segHull(pts,0);
  B.hull=h;return h;
}
function bndHullWorld(B){
  var h=bndHullLocal(B),c=Math.cos(B.th||0),s=Math.sin(B.th||0),out=[],i;
  for(i=0;i<h.length;i++){var q=h[i];out.push([B.x+q[0]*c-q[1]*s,B.y+q[0]*s+q[1]*c]);}
  return out;
}
// separating-axis test between two convex hulls, HB shifted by (ox,oy); null when apart.
function solidSAT(HA,HB,padA,padB,ox,oy){
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
function solidDepthAlong(HA,HB,padA,padB,nx,ny){
  var a0=1e9,a1=-1e9,b0=1e9,b1=-1e9,k;
  for(k=0;k<HA.length;k++){var da=HA[k][0]*nx+HA[k][1]*ny;if(da<a0)a0=da;if(da>a1)a1=da;}
  for(k=0;k<HB.length;k++){var db=HB[k][0]*nx+HB[k][1]*ny;if(db<b0)b0=db;if(db>b1)b1=db;}
  a0-=padA;a1+=padA;b0-=padB;b1+=padB;
  return Math.min(a1,b1)-Math.max(a0,b0);
}
function bndSolidHit(A,B){
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
function bndHit(WB,oth){
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
