/* 画布尺寸、绘制、render、引力 / 场步进（原 index.html 第 11588–12525 行） */
function resize(){
  W=window.innerWidth;H=window.innerHeight;
  groundY=Math.round(H*0.8);
  // full-screen reach: every point inside the canvas is influenced; pull tapers to 0 at the
  // diagonal so the boundary force is exactly zero and the influence feels total elsewhere
  BH_REACH=Math.hypot(W,groundY)+240;
  cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);
  cv.style.width=W+'px';cv.style.height=H+'px';
  cvx.setTransform(dpr,0,0,dpr,0,0);
  if(MW){   // the Matter ground/walls follow the canvas
    Matter.Body.setPosition(MW.ground,{x:W/2,y:groundY+400});
    Matter.Body.setPosition(MW.wl,{x:-300,y:groundY/2});
    Matter.Body.setPosition(MW.wr,{x:W+300,y:groundY/2});
    /* 天花板（wt）同步：内缘恒落在 y=CEL_INNER，与左右墙一样在屏外，物体必须真的越出画布才碰到它。 */
    if(MW.wt)Matter.Body.setPosition(MW.wt,{x:W/2,y:celCenterY()});
  }
}
function eOut(x){
  x=clamp(x,0,1);
  var c1=1.70158,c3=c1+1;
  return 1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2);
}
function cubE(x){
  x=clamp(x,0,1);
  return 1-Math.pow(1-x,3);
}
function popScale(p){
  var x=1-clamp(p,0,1);
  var c1=1.70158,c3=c1+1;
  var v=1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2);
  return 0.25+0.75*v;
}
function arrow(B,gx,gy,Cx,Cy,ddn){
  var dx=Cx-gx,dy=Cy-gy;
  var L=Math.hypot(dx,dy);
  if(L<26)return;
  var ux=dx/L,uy=dy/L;
  var al=0.3+0.45*ddn;
  var hl=11;
  var sl=Math.min(Math.max((B.hw||60)+4,10),L-hl-2);
  var a0=gx+ux*sl,b0=gy+uy*sl;
  var bx=Cx-ux*hl,by=Cy-uy*hl;
  cvx.strokeStyle='rgba(38,34,28,'+al+')';
  cvx.lineWidth=2;
  cvx.lineCap='round';
  cvx.beginPath();
  cvx.moveTo(a0,b0);
  cvx.lineTo(bx,by);
  cvx.stroke();
  cvx.fillStyle='rgba(38,34,28,'+al+')';
  cvx.beginPath();
  cvx.moveTo(Cx,Cy);
  cvx.lineTo(bx-uy*5.5,by+ux*5.5);
  cvx.lineTo(bx+uy*5.5,by-ux*5.5);
  cvx.closePath();
  cvx.fill();
}
function orbGeom(B){
  var o=B.orb;
  if(!o||o.k<0.02)return;
  var R=o.R||120;
  var Cx=B.x, Cy=B.y-R;
  var Rk=R*Math.max(o.k,0.001);
  var n=72,i;
  var pts=[];
  for(i=0;i<n;i++){
    var b=i/n*6.2832;
    pts.push([Cx+Rk*Math.cos(b),Cy+Rk*Math.sin(b)]);
  }
  cvx.strokeStyle='rgba(38,34,28,'+(0.45*Math.max(o.e,0.001))+')';
  cvx.lineWidth=1.6;
  cvx.setLineDash([7,6]);
  cvx.beginPath();
  for(i=0;i<n;i++){
    if(i)cvx.lineTo(pts[i][0],pts[i][1]);else cvx.moveTo(pts[i][0],pts[i][1]);
  }
  cvx.closePath();
  cvx.stroke();
  cvx.setLineDash([]);
  arrow(B,o.gx!=null?o.gx:B.x,o.gy!=null?o.gy:B.y,Cx,Cy,1);
}
function tickOrbs(dt){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.pop&&B.pop>0)B.pop=Math.max(0,B.pop-dt*3.2);
    var o=B.orb;
    if(!o)continue;
    o.age+=dt;
    o.k=eOut(Math.min(o.age/0.55,1));
    o.e=cubE((o.age-0.18)/0.55);
    var R=o.R||120;
    var Rk=R*Math.max(o.k,0.001);
    if(!(grab.kind==='body'&&grab.obj===B))o.spin+=dt*0.8;
    o.gx=B.x+Rk*Math.cos(o.spin);
    o.gy=B.y-R+Rk*Math.sin(o.spin);
  }
}
/* ---- 弹簧的绘制：锯齿线圈 + 锚点 ------------------------------------------------ */
// 拴住的一端，线圈要停在宿主表面，不能画进物体里。
// 不要用宿主的某个尺寸做回收量近似：按半径/半宽硬减假设锚点在中心（吸附时锚点几乎总在边缘），
// 用包围盒沿轴支撑对非矩形 W 体是高估 —— 两者都会空出 70~150px。
// 做法是对宿主的真实几何求解：
//   · 圆      ：解 |m + u·t| = R 的正根（锚点在体外 -> 0）
//   · 开笔画/弧：锚点本来就在线上，没有「内部」-> 0
//   · 闭合图形 ：锚点在体外 -> 0；在里面 -> 沿 u 射线走到边界为止
// 实测（圆/线/矩形/三角形/涂鸦 × 16 方向 × 3 个内外偏移）最长回收 6.3px，其中圆的 3px 是有意留的内缩。
// 世界坐标约定 world = pos + R(th)·local，与 distToHost / springAnchorOffset 一致。
function hostInsideInk(H,px,py){
  var p=H.pts;if(!p||p.length<3)return false;
  var c=Math.cos(H.th||0),s=Math.sin(H.th||0),ins=false;
  for(var i=0,j=p.length-1;i<p.length;j=i++){
    var ai=p[i],aj=p[j];
    var ax=H.x+ai[0]*c-ai[1]*s, ay=H.y+ai[0]*s+ai[1]*c;
    var bx=H.x+aj[0]*c-aj[1]*s, by=H.y+aj[0]*s+aj[1]*c;
    if(((ay>py)!==(by>py))&&(px<(bx-ax)*(py-ay)/(by-ay)+ax))ins=!ins;   // 奇偶规则
  }
  return ins;
}
// 从 (px,py) 沿 (ux,uy) 走出闭合图形的最小正距离（射线 × 各边求交）
function hostExitDist(H,px,py,ux,uy){
  var p=H.pts;if(!p||p.length<3)return 0;
  var c=Math.cos(H.th||0),s=Math.sin(H.th||0),best=1e9;
  for(var i=0,j=p.length-1;i<p.length;j=i++){
    var ai=p[i],aj=p[j];
    var ax=H.x+ai[0]*c-ai[1]*s, ay=H.y+ai[0]*s+ai[1]*c;
    var bx=H.x+aj[0]*c-aj[1]*s, by=H.y+aj[0]*s+aj[1]*c;
    var ex=bx-ax,ey=by-ay,den=ux*ey-uy*ex;
    if(Math.abs(den)<1e-9)continue;                       // 射线与这条边平行
    var t=((ax-px)*ey-(ay-py)*ex)/den;                    // 交点沿射线
    var v=((ax-px)*uy-(ay-py)*ux)/den;                    // 交点在这条边上的位置
    if(t>0.01&&v>=0&&v<=1&&t<best)best=t;
  }
  return best<1e9?best:0;
}
// 拴住的一端，线圈要从锚点朝**弹簧那一侧**退多少才刚好贴住宿主表面。
// (ux,uy) 就是「朝弹簧」的方向 —— 与 drawSpring 的两处调用一致（e0 端传 +u、e1 端传 -u）。
function springHostSurfDist(H,px,py,ux,uy){
  if(!H)return 0;
  var mx=px-H.x,my=py-H.y,m2=mx*mx+my*my;
  if(H.rad){                                              // 圆：|m + u·t| = R 的正根
    var R=H.rad+3;
    if(m2>=R*R)return 0;                                  // 锚点已在体外
    var a=mx*ux+my*uy,disc=a*a-m2+R*R;
    return disc>0?Math.max(0,-a+Math.sqrt(disc)):0;
  }
  if(!H.closed)return 0;                                  // 开笔画 / 弧：没有「内部」
  if(!hostInsideInk(H,px,py))return 0;                    // 闭合图形的体外
  return hostExitDist(H,px,py,ux,uy);
}
/* 杆的唯一画线函数（render 的 T 分支与器件落点虚影共用）。
 * 只读 {x,y,th,len} ⇒ 真杆或桩对象画出逐像素相同的木板线，
 * 保证「虚影所见 = 松手所得」（与 drawSpring 同一手法，见 drawDeviceGhost）。 */
function drawRodPlank(B){
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
function drawSpring(B){
  var x0=B.e0.x,y0=B.e0.y,x1=B.e1.x,y1=B.e1.y;
  var dx=x1-x0,dy=y1-y0,L=Math.hypot(dx,dy)||1,ux=dx/L,uy=dy/L,px=-uy,py=ux;
  /* 端帽压缩量 _capCmp 的唯一消费者：被撞那一端沿轴向内缩 _capCmp，线圈挤在更短的一段上
   * （螺距变小，像真弹簧被压扁）；物体弹开后 _capCmp 指数回落，弹簧自己弹回来。
   * 不要在 refreshSpringGeom / springEndCaps 里挪 e0/e1：压缩量一旦参与几何，判据基准随状态漂移
   * ⇒ 正反馈（物体被越推越远 / 弹簧冻死）。几何保持自然长度，压缩只做渲染 + 力。
   * 只画未锚定端（锚定端钉在宿主上，没有端帽）。 */
  if(B._capCmp>0){
    var _ci=(B._capEIdx===1)?1:0,_ce=(_ci===1)?B.e1:B.e0;
    var _sgn=(_ci===1)?-1:1;                     // 该端向内 = 沿 e0→e1 方向（i=1 时为 −u）
    var _cp=B._capCmp,_cL=Math.hypot(_cp,0);
    if(_cp>0&&_cp<L-8){
      _cp=_cp>L-8?L-8:_cp;
      if(_ci===1){x1=x1-ux*_cp;y1=y1-uy*_cp;}
      else{x0=x0+ux*_cp;y0=y0+uy*_cp;}
      dx=x1-x0;dy=y1-y0;L=Math.hypot(dx,dy)||1;ux=dx/L;uy=dy/L;px=-uy;py=ux;
    }
  }
  // 弹簧恒用墨线画，不按拉长/压缩染色（形变信息由参数面板的劲度系数/自然长度承担）。
  var col='rgba(38,34,28,0.85)';
  // 圈数由自然长度定，与当前拉伸量无关：真实弹簧圈数固定，拉长时螺距变大、压缩时螺距变小。
  var nc=Math.round(clamp(B.len/16,6,20)),amp=8;
  var r0=B.anc[0]?springHostSurfDist(B.anc[0].B,x0,y0, ux, uy):0;      // 拴住的一端止于表面
  var r1=B.anc[1]?springHostSurfDist(B.anc[1].B,x1,y1,-ux,-uy):0;
  var room=L-16;                                  // 至多退到只剩 16px 线圈，不许退穿
  if(r0+r1>room&&r0+r1>0){var rt=room/(r0+r1);r0*=rt;r1*=rt;}
  var c0x=x0+ux*r0,c0y=y0+uy*r0,c1x=x1-ux*r1,c1y=y1-uy*r1;
  var CL=Math.hypot(c1x-c0x,c1y-c0y)||1;
  var lead=Math.min(9,CL*0.12);
  cvx.strokeStyle=col;cvx.lineWidth=2.4;cvx.lineJoin='round';cvx.lineCap='round';
  cvx.beginPath();
  cvx.moveTo(c0x,c0y);
  cvx.lineTo(c0x+ux*lead,c0y+uy*lead);
  var span=Math.max(1,CL-2*lead),steps=nc*2;
  for(var i=1;i<=steps;i++){
    var t=lead+span*i/steps,sgn=(i%2===0)?1:-1;
    cvx.lineTo(c0x+ux*t+px*amp*sgn,c0y+uy*t+py*amp*sgn);
  }
  cvx.lineTo(c1x,c1y);
  cvx.stroke();
  cvx.fillStyle=col;
  for(var a=0;a<2;a++){
    if(!B.anc[a])continue;                 // 只有拴住的一端才画锚点
    cvx.beginPath();cvx.arc(a?x1:x0,a?y1:y0,4.4,0,6.2832);cvx.fill();
  }
}
/* 杆端吸附预览红点：未锚定的杆端（或独立铰链端）靠近可吸附位置时在吸附点画红点，
 * 与边界中点吸附的红点反馈同款。 */
var ROD_SNAP_PREVIEW=null;
function rodSnapPreviewScan(){
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
/* 带电荷的物体在质心画 +/− 符号（正负取决于 B.charge）。 */
function drawChargeMark(){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B||B.dead||!B.charge)continue;
    var pos=B.mb?B.mb.position:{x:B.x||0,y:B.y||0};
    var sgn=(B.charge>0)?'+':'-';
    cvx.save();
    cvx.strokeStyle=(B.charge>0)?'rgba(198,72,58,.95)':'rgba(58,96,182,.95)';
    cvx.lineWidth=2.4;cvx.lineCap='round';
    cvx.beginPath();cvx.moveTo(pos.x-6,pos.y);cvx.lineTo(pos.x+6,pos.y);
    if(sgn==='+'){cvx.moveTo(pos.x,pos.y-6);cvx.lineTo(pos.x,pos.y+6);}
    cvx.stroke();
    cvx.restore();
  }
}
/* 待融合提示环：拖着 v/q 悬停在可赋物体上 ⇒ 物体外画一圈橙色虚线。 */
function drawPendingHint(){
  if(!(grab&&grab.kind==='letter'&&grab.obj))return;
  var t=grab.obj.type||grab.obj.ch;
  if(t!=='v'&&t!=='q')return;
  var B=findSolidBodyAt(pointer.x,pointer.y);
  if(!B||B.dead)return;
  var rad=Math.max(B.hw||26,B.hh||26,B.rad||0)+10;
  cvx.save();
  cvx.setLineDash([6,5]);
  cvx.strokeStyle='rgba(232,163,61,.95)';
  cvx.lineWidth=2;
  cvx.beginPath();cvx.arc(B.x,B.y,rad,0,6.2832);cvx.stroke();
  cvx.restore();
}
function render(){
  cvx.clearRect(0,0,W,H);
  rodSnapPreviewScan();
  if(ROD_SNAP_PREVIEW){
    /* 实心红点 = 预览点（吸附目标点；杆端落在物体内部的回退分支则为杆端） */
    cvx.beginPath();
    cvx.arc(ROD_SNAP_PREVIEW.x,ROD_SNAP_PREVIEW.y,5,0,6.2832);
    cvx.fillStyle='rgba(220,60,50,0.9)';cvx.fill();
    cvx.lineWidth=1.5;cvx.strokeStyle='rgba(255,255,255,0.85)';cvx.stroke();
    /* 空心小圈 = 将要吸附的目标点（在物体表面/中点） */
    if(ROD_SNAP_PREVIEW.tx!=null){
      cvx.beginPath();
      cvx.arc(ROD_SNAP_PREVIEW.tx,ROD_SNAP_PREVIEW.ty,7,0,6.2832);
      cvx.lineWidth=1.8;cvx.strokeStyle='rgba(220,60,50,0.75)';cvx.stroke();
    }
  }
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.frac&&B.st.bar&&!B.st.bar.dead){
      var ob=B.orb,oxB=(ob&&ob.k>=0.02&&ob.gx!=null)?(ob.gx-B.x):0,oyB=(ob&&ob.k>=0.02&&ob.gy!=null)?(ob.gy-B.y):0;
      /* 分数线必须与字形同口径缩放：syncGlyphs() 画字形用 sc2 = popScale(B.pop)·(B.sc||1)·(B.infl||1)，
       * 只乘 B.sc 的话 pop 脉冲 / infl 膨胀时字形缩小而分数线仍满宽，横杠会戳在外面。
       * 时间静止保底（TIME_SCALE<=0 时保底到 1）也须与字形一致，否则两边在不同帧切换。 */
      var extra2=(B.pop&&B.pop>0)?popScale(B.pop):1;
      var scb=extra2*(B.sc||1)*(B.infl||1);
      if(TIME_SCALE<=0&&scb<0.6)scb=1;
      var b=B.st.bar,th=B.th||0,sc=scb,ct=Math.cos(th),st=Math.sin(th);
      var s=slot(B,b);
      var hw=(b.w/2)*scb;
      cvx.strokeStyle='rgba(38,34,28,0.85)';
      cvx.lineWidth=1.6;cvx.lineCap='round';
      cvx.beginPath();
      cvx.moveTo(s.x+oxB-Math.cos(th)*hw,s.y+oyB-Math.sin(th)*hw);
      cvx.lineTo(s.x+oxB+Math.cos(th)*hw,s.y+oyB+Math.sin(th)*hw);
      cvx.stroke();
      if(B.subBar){
        var sb=B.subBar,shw=(sb.w/2)*sc;
        var spx=B.x+oxB+(-sb.y*st)*sc,spy=B.y+oyB+(sb.y*ct)*sc;
        cvx.beginPath();
        cvx.moveTo(spx-Math.cos(th)*shw,spy-Math.sin(th)*shw);
        cvx.lineTo(spx+Math.cos(th)*shw,spy+Math.sin(th)*shw);
        cvx.stroke();
      }
    }
  }
  for(var q=0;q<bodies.length;q++){
    var B2=bodies[q];
    if(B2.orb)orbGeom(B2);
  }
  // gravity formulas (GMm/r^n, complete): draw their attraction-range wireframe (dashed circle)
  for(var gv=0;gv<bodies.length;gv++){
    var GV=bodies[gv];
    if(GV.kind||!GV.isWell)continue;
    cvx.strokeStyle='rgba(120,80,30,0.38)';
    cvx.lineWidth=1.5;
    cvx.setLineDash([9,7]);
    cvx.beginPath();
    cvx.arc(GV.x,GV.y,GV.wellR||G_RANGE,0,6.2832);
    cvx.stroke();
    cvx.setLineDash([]);
  }
  // t-rods (vt->plank): a thin line like the ground, but draggable & rotatable
  // 画线在 drawRodPlank（与器件落点虚影共用），这里只负责遍历（不滤 dead）。
  for(var tr=0;tr<bodies.length;tr++){
    var TB=bodies[tr];
    if(TB.kind!=='T')continue;
    drawRodPlank(TB);
  }
  // 弹簧（kx）一族：拴住的一端画实心锚点，一眼能看出哪端接上了、哪端还悬着。
  for(var sp2i=0;sp2i<bodies.length;sp2i++){
    var SPB=bodies[sp2i];
    if(SPB.kind!=='S'||SPB.dead)continue;
    // 'S' 一族三个成员按标志分派渲染（同一份锚点约定，三套画法）。
    if(SPB.hinge)drawHinge(SPB);else if(SPB.rope)drawRope(SPB);else drawSpring(SPB);
  }
  // 拖动器件时在最近那条边的中点提示吸附位置（drawDeviceSnapHints）必须最后画：
  // 放在 drawBoundaries() 之前会被 W 体和指针悬浮时 16px/9px 的蓝色光晕整份盖掉。
  // stamped boundaries (kind 'W'): solid black, with a centre-of-mass tick
  drawBoundaries();
  // magnetic fields: dotted disc, q orbital paths, I Ampere force arrows
  for(var fb=0;fb<bodies.length;fb++){
    var FB=bodies[fb];
    if(FB.kind==='B')drawFieldDots(FB.x,FB.y,FB.fieldR,FB.Bz);   /* 传 Bz ⇒ 负值画叉 */
    else if(FB.kind==='E')drawFieldE(FB.x,FB.y,FB.fieldR,FB.th||0,FB);
  }
  for(var qo=0;qo<bodies.length;qo++){
    var OB=bodies[qo];
    if(OB.kind==='q'&&OB.fieldState){
      // no orbit guide ring (motion is derived from release position + velocity)
    }else if(OB.kind==='I'){
      // Ampere force arrow: sum the pull directions of ALL covering B sources (superposition)
      var fySum=0;
      for(var ss=0;ss<bodies.length;ss++){
        var S3=bodies[ss];
        if(S3.kind!=='B')continue;
        var d2=Math.hypot(OB.x-S3.x,OB.y-S3.y);
        if(d2<=S3.fieldR){
          var dir2=S3.Bz>0?1:-1;
          fySum+=Math.sign(A_FORCE*OB.Isign*dir2);
        }
      }
      if(fySum!==0)arrow(OB,OB.x,OB.y,OB.x,OB.y+Math.sign(fySum)*36,0.6);
    }
  }
  for(var fi=0;fi<formulas.length;fi++){
    var F=formulas[fi];
    if(!F.bar)continue;
    var fsc=F.sc||1;
    cvx.strokeStyle='rgba(38,34,28,'+(0.85*F.alpha)+')';
    cvx.lineWidth=1.8;
    cvx.lineCap='round';
    cvx.beginPath();
    cvx.moveTo(F.x+F.bar.x1*fsc,F.y+F.bar.y*fsc);
    cvx.lineTo(F.x+F.bar.x2*fsc,F.y+F.bar.y*fsc);
    cvx.stroke();
  }
  // black holes: gravitational-lens rings (warped space) + dark hole + accretion ring
  for(var bhv=0;bhv<bodies.length;bhv++){
    var HB=bodies[bhv];
    if(HB.bh){
      drawBlackHole(HB);
    }
  }
  drawParticles();
  drawDeviceSnapHints();   // 界面层，画在所有实体之上（见上方 drawBoundaries 处的说明）
  drawToolPreview();
}
function drawBlackHole(B){
  var bh=B.bh,cx=B.x,cy=B.y;
  var r=Math.max(4,bh.r);
  // ---- 1) gravitational lens: concentric distorted rings around the hole ----
  var rings=5;
  for(var li=0;li<rings;li++){
    var lr=r*1.15+li*13+Math.sin(bh.spin*1.4+li*1.9)*3;
    var wob=1+0.10*Math.sin(bh.spin*2.1+li*2.4);
    cvx.strokeStyle='rgba(38,34,28,'+(0.30-li*0.045)+')';
    cvx.lineWidth=1.6-li*0.18;
    cvx.beginPath();
    // a ring drawn as a wobbly ellipse: space is "stretched" tangentially
    var N=26;
    for(var n=0;n<=N;n++){
      var a=n/N*6.2832;
      var rr=lr*(wob+(0.05*Math.sin(3*a+bh.spin*1.7))*li*0.4);
      var xx=cx+Math.cos(a)*rr;
      var yy=cy+Math.sin(a)*rr*(0.92+0.06*Math.sin(2*a+bh.spin));
      if(n===0)cvx.moveTo(xx,yy);else cvx.lineTo(xx,yy);
    }
    cvx.stroke();
  }
  // lens streaks: short arcs tangentially smeared (space warping streaks)
  cvx.strokeStyle='rgba(38,34,28,0.22)';
  cvx.lineWidth=1.2;
  for(var s2=0;s2<8;s2++){
    var sa=bh.spin*0.9+s2*0.7854;
    var sr=r*1.3+(s2%3)*10;
    cvx.beginPath();
    cvx.arc(cx,cy,sr,sa,sa+0.9);
    cvx.stroke();
  }
  // ---- 2) accretion disk: a MONOCHROME swirl of dark streaks just outside the horizon.
  // Everything on this canvas is ink-black line art — no colour anywhere.
  for(var ai=0;ai<3;ai++){
    var ar=r+4+ai*4;
    cvx.strokeStyle='rgba(38,34,28,'+(0.55-ai*0.13)+')';
    cvx.lineWidth=3.4-ai*0.9;
    cvx.beginPath();
    cvx.arc(cx,cy,ar,bh.spin*2+ai*0.5,bh.spin*2+ai*0.5+4.6-ai*1.1);
    cvx.stroke();
  }
  // ---- 3) the hole itself: pure black core with a soft dark falloff ----
  var grd=cvx.createRadialGradient(cx,cy,r*0.2,cx,cy,r*1.05);
  grd.addColorStop(0,'rgba(0,0,0,1)');
  grd.addColorStop(0.78,'rgba(12,10,14,0.96)');
  grd.addColorStop(1,'rgba(20,18,22,0)');
  cvx.fillStyle=grd;
  cvx.beginPath();
  cvx.arc(cx,cy,r*1.05,0,6.2832);
  cvx.fill();
  // thin photon-ring edge (ink, not colour)
  cvx.strokeStyle='rgba(38,34,28,0.75)';
  cvx.lineWidth=1.4;
  cvx.beginPath();
  cvx.arc(cx,cy,r+1,0,6.2832);
  cvx.stroke();
}
function syncGlyphs(){
  var i,j,k;
  for(i=0;i<bodies.length;i++){
    var B=bodies[i];
    var bar=B.st.bar;
    if(bar&&!bar.dead)bar.el.style.display='none';
      var extra=(B.pop&&B.pop>0)?popScale(B.pop):1;
      var sc2=extra*(B.sc||1)*(B.infl||1);
      /* 时间静止时缩放可能被算成极小值（合成链上的缩放累积依赖 dt），保底到 1。 */
      if(TIME_SCALE<=0&&sc2<0.6)sc2=1;
      var th2=(B.th||0)+(B.wob||0);
      var ox=0,oy=0;
      if(B.orb&&B.orb.k>=0.02&&B.orb.gx!=null){ox=B.orb.gx-B.x;oy=B.orb.gy-B.y;}
      for(j=0;j<B.glyphs.length;j++){
        var g2=B.glyphs[j];
        if(g2.dead||g2.type===BAR)continue;
        var s2=slot(B,g2);
        /* 字形中心必须与元素尺寸走同一个缩放系数：slot() 只乘了 B.sc，而 place() 用 sc2（含 pop/infl），
         * 不补偿的话 pop 脉冲/膨胀时每个字形各自原地缩小、中心不动，式子会散架。
         * 把槽位偏移按 sK = sc2/B.sc 同比例放大，等价于以质心为原点整体缩放。
         * TIME_SCALE<=0 的保底（sc2=1）自动一致：此时偏移×B.sc×sK = 偏移×1。 */
        var sK=(B.sc||1)>1e-9?(sc2/(B.sc||1)):1;
        place(g2,B.x+(s2.x-B.x)*sK+ox,B.y+(s2.y-B.y)*sK+oy,th2,sc2,true);
        g2.el.style.opacity=(B.bh&&B.bh.fade!=null)?B.bh.fade:(B.bhFade!=null?B.bhFade:'');
      }
  }
  for(k=0;k<freeL.length;k++){
    var d=freeL[k];
    if(d.dead){freeL.splice(k,1);k--;continue;}
    if(d.state==='free')placeLetter(d);
  }
}
function cursorTick(){
  if(grab.kind==='body'){cv.style.cursor='grabbing';return;}
  if(grab.kind==='letter'){cv.style.cursor=findMergeTarget(grab.obj)?'copy':'grabbing';return;}
  if(grab.kind==='rot'){cv.style.cursor='grabbing';return;}
  cv.style.cursor='default';
}
var G_RANGE=360;
/* 真 GM/r²（Plummer 软化）的系数。标定：在 r=150px 处与旧的 G_PULL/(r+80) 加速度相等
 ⇒ G_PULL2 = 52000·(150+80)/150·(150²+80²)^1.5/… = 7.405e6
 （旧公式在 r=150、默认 M/3=1 时 a=52000/230=226.1 px/s²）。 */
var G_PULL2=7.405e6;
function stepGravity(dt){
  var gravs=[];
  for(var g=0;g<bodies.length;g++){var Gb=bodies[g];if(Gb.isWell)gravs.push(Gb);}
  // NOTE: no early return even without wells — binary-star pairs (two mv²/r wholes)
  // must be able to form on their own.
  function releaseGo(Bb){
    var go=Bb.go;if(!go)return;
    if(go.bin&&go.by&&bodies.indexOf(go.by)>=0){go.by.goB=null;}
    var tx=-Math.sin(go.ang),ty=Math.cos(go.ang);
    Bb.vx=tx*go.w*go.rad;Bb.vy=ty*go.w*go.rad;
    Bb.go=null;
  }
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.kind)continue;
    if(B.bh)continue;   // black holes do not orbit anything
    if(B.isWell)continue;
    // 不再是完整 mv²/r（例如拆走 m、只剩 v²/r）时主动解开圆轨道，否则已建立的
    // B.go / B.goB 链接会继续把两个物体按在原轨道上。isMVR 负责质量判据，这里清理链接。
    if(!isMVR(B)){
      if(B.go)releaseGo(B);
      if(B.goB){var HB2=B.goB;if(HB2&&HB2.go)releaseGo(HB2);B.goB=null;}
    }
    if(grab.kind==='body'&&grab.obj===B)continue;
    if(B.goB){
      // partner of a binary pair — the holder integrates it; clear stale links only
      if(bodies.indexOf(B.goB)<0)B.goB=null;
      continue;
    }
    var best=null,bd=1e9,bcx=0,bcy=0;
    for(var k=0;k<gravs.length;k++){
      var Gb2=gravs[k];
      var dx=B.x-Gb2.x,dy=B.y-Gb2.y;
      var d=Math.hypot(dx,dy);
      if(d<bd){bd=d;best=Gb2;bcx=Gb2.x;bcy=Gb2.y;}
    }
    var isRot=isMVR(B);
    // A COMPLETE gravity well (GMm/r²) DOMINATES anything inside its range: the mv²/r
    // whole is SIMPLY ATTRACTED to it like every other body — no fixed circular orbit
    // rail and no binary hijack while it sits inside the well's reach (that "stuck on a
    // circle" path the well used to force is gone). The binary-star pairing between two
    // mv²/r wholes is still available as long as no well is pulling on them.
    // The well's reach is its r-scaled attraction range (wellR), falling back to G_RANGE.
    var wRange=(best&&best.isWell)?(best.wellR||G_RANGE):G_RANGE;
    var wellHolds=!!(best&&bd<=wRange&&!(grab.kind==='body'&&grab.obj===best));
    if(isRot&&!wellHolds){
      // BINARY-STAR pairing: two full mv²/r wholes within range orbit their COMMON
      // center of mass. m1·r1 = m2·r2 (the lighter one sweeps the wider circle) and
      // ω ∝ √(m_total / separation) — different M/m mixes visibly change the motion.
      // keep an existing binary link (don't let the partner-exclusion chatter the pair apart)
      var P=null,pp=1e9;
      if(B.go&&B.go.bin){
        var oldP=B.go.by;
        if(bodies.indexOf(oldP)>=0){P=oldP;pp=Math.hypot(P.x-B.x,P.y-B.y);}
        else B.go=null;
      }
      if(!P){
        for(var pk=0;pk<bodies.length;pk++){
          var C=bodies[pk];
          if(C===B)continue;
          if(!isMVR(C))continue;
          if(C.go&&C.go.bin)continue;          // already holding its own pair
          if(C.goB&&C.goB!==B)continue;        // partner of ANOTHER holder
          if(grab.kind==='body'&&grab.obj===C)continue;
          var dp=Math.hypot(C.x-B.x,C.y-B.y);
          if(dp<pp){pp=dp;P=C;}
        }
      }
      if(P&&pp<=G_RANGE){
        var m1=B.mass||1,m2=P.mass||1,ms=m1+m2;
        if(!B.go||B.go.by!==P){
          var cmx=(m1*B.x+m2*P.x)/ms,cmy=(m1*B.y+m2*P.y)/ms;
          B.go={by:P,cmx:cmx,cmy:cmy,ang:Math.atan2(B.y-cmy,B.x-cmx),
                rad:Math.max(pp,10),target:clamp(pp,80,300),
                rB:m2/ms,rP:m1/ms,
                w:1.1*Math.sqrt(ms/Math.max(pp,40)),bin:1};
          P.goB=B;
        }
        if(grab.kind==='body'&&grab.obj===P){
          // partner grabbed -> dissolve the pair, release B tangentially
          var gX=B.go,txd=-Math.sin(gX.ang),tyd=Math.cos(gX.ang);
          B.vx=txd*gX.w*(gX.rad*gX.rB);B.vy=tyd*gX.w*(gX.rad*gX.rB);
          P.goB=null;B.go=null;
        }else{
          var go=B.go;
          go.rad+=(go.target-go.rad)*Math.min(1,dt*0.9);
          go.ang+=dt*go.w;
          var cA=Math.cos(go.ang),sA=Math.sin(go.ang);
          var rB=go.rad*go.rB,rP=go.rad*go.rP;
          var bx=go.cmx+rB*cA,by=go.cmy+rB*sA;
          var px=go.cmx-rP*cA,py=go.cmy-rP*sA;
          // keep the WHOLE pair inside the screen: shift the pair (separation preserved),
          // never stretch it — nothing may fly off the boundary.
          var shx=0,shy=0;
          if(bx>W-B.hw)shx=W-bx-B.hw;else if(bx<B.hw)shx=B.hw-bx;
          if(by>groundY-B.hh)shy=groundY-by-B.hh;else if(by<B.hh)shy=B.hh-by;
          if(px>W-P.hw)shx=W-px-P.hw;else if(px<P.hw)shx=P.hw-px;
          if(py>groundY-P.hh)shy=groundY-py-P.hh;else if(py<P.hh)shy=P.hh-py;
          if(shx||shy){go.cmx+=shx;go.cmy+=shy;bx+=shx;by+=shy;px+=shx;py+=shy;}
          B.x=bx;B.y=by;B.vx=0;B.vy=0;
          P.x=px;P.y=py;
          P.vx=-go.w*rP*sA;P.vy=go.w*rP*cA;
          continue;
        }
      }
      // no pair formed / partner left range / pair dissolved -> drop any stale capture
      if(B.go)releaseGo(B);
    }else{
      // a gravity well dominates (or the body is an ordinary one): drop any leftover go
      // so every body falls under the SAME simple attraction below
      if(B.go)releaseGo(B);
    }
    if(!best||bd>(best.isWell?(best.wellR||G_RANGE):G_RANGE))continue;
    // ---- SIMPLE ATTRACTION (identical for plain m, mv², mv²/r, …) ----
    // 井的中心质量 M 缩放引力；加速度与下落体自身质量无关（见下）。
    var inv=1/Math.max(bd,24);
    var ax=(bcx-B.x)*inv, ay=(bcy-B.y)*inv;
    /* 真公式 a = GM/r²：
     · 引力加速度与测试质量无关，不要乘掉落体自身的质量。
     · Plummer 软化 r/(r²+ε²)^1.5（ε=80）⇒ r≫ε 时就是 1/r²，且 r→0 不发散；沿指向井心的单位方向 (ax,ay) 施加。
     · M 取井的 massCap（大写 M 参数）/ mass，默认 3；除以 3 即「相对默认值」。
     · G_PULL2 按 r=150px 处与旧公式 1/(r+80) 加速度相等标定 ⇒ 中距离手感一致，
     远距离因 1/r² 衰减会比旧公式弱。 */
    var wm=best.isWell?(best.massCap!=null?best.massCap:3):(best.mass!=null?best.mass:3);
    var _rg=Math.max(bd,24);
    var a=G_PULL2*(wm/3)*_rg/Math.pow(_rg*_rg+80*80,1.5);
    B.vx+=ax*a*dt; B.vy+=ay*a*dt;
  }
}
function stepField(dt){
  var bsrcs=[],esrcs=[];
  for(var i=0;i<bodies.length;i++){var S=bodies[i];if(S.kind==='B')bsrcs.push(S);else if(S.kind==='E')esrcs.push(S);}
  if(!bsrcs.length&&!esrcs.length){
    // no field source: no forces, but keep I/q clamped to the screen bounds (everything stays on screen)
    for(var kb=0;kb<bodies.length;kb++){
      var Kb=bodies[kb];
      if(Kb.kind==='B'||Kb.kind==='E'||Kb.kind==='T')continue;
      if(grab.kind==='body'&&grab.obj===Kb)continue;
      if(Kb.kind==='q'||Kb.kind==='I'){
        if(Kb.x<24){Kb.x=24;Kb.vx=Math.abs(Kb.vx)*0.5;}
        if(Kb.x>W-24){Kb.x=W-24;Kb.vx=-Math.abs(Kb.vx)*0.5;}
        if(Kb.y<24){Kb.y=24;Kb.vy=Math.abs(Kb.vy)*0.5;}
        if(Kb.y>groundY-24){Kb.y=groundY-24;Kb.vy=-Math.abs(Kb.vy)*0.5;}
      }
    }
    return;
  }
  for(var j=0;j<bodies.length;j++){
    var O=bodies[j];
    if(O.kind==='B'||O.kind==='E')continue;   // field sources don't feel their own field
    /* W 体（画出来的边界）设计上是「锚」，场不推它；只有带电的 W 体（O.charge 非 0）参与场受力，
     *   没电的边界照旧不被场推。
     *   带电 W 体的施力必须注入 Matter：W 体由 Matter 积分，stepMatter 每帧用 mb.velocity 覆写 B.vx，
     *   只改 O.vx 会被吃掉（见本块末尾的 applyForce）。 */
    if(O.kind==='W'&&!O.charge)continue;
    if(O.bh)continue;                          // black holes don't feel fields
    if(grab.kind==='body'&&grab.obj===O)continue;
    // collect EVERY B source whose disc covers O (field superposition: several magnets
    // placed on the same spot must ADD their effects, not be reduced to the nearest one)
    var bsIn=[];
    for(var s=0;s<bsrcs.length;s++){
      var S2=bsrcs[s];
      if(Math.hypot(O.x-S2.x,O.y-S2.y)<=S2.fieldR)bsIn.push(S2);
    }
    var esIn=[];
    for(var se=0;se<esrcs.length;se++){
      var SE=esrcs[se],erE=SE.er||{l:SE.fieldR/2,r:SE.fieldR/2,t:SE.fieldR/2,b:SE.fieldR/2};
      // E field range is an asymmetric box: each edge has its own half-extent (l/r/t/b)
      var dxE=O.x-SE.x,dyE=O.y-SE.y;
      if(dxE>=-erE.l&&dxE<=erE.r&&dyE>=-erE.t&&dyE<=erE.b)esIn.push(SE);
    }
    if(O.kind==='q'||O.charge){
      // 带电的 W 体（O.charge 非 0）也走这条，施力后注入 Matter（见下面）。
      /* a = qE/m、ω = qB/m 用到的三个参数必须声明在本块最前面
       （B 场那一段就要用；声明在后面会被 var 提升成 undefined）。 */
      var _qNum=(O.qCharge!=null)?O.qCharge:((O.charge!=null)?O.charge:O.qsign);
      var _mRel=(O.mMul!=null)?O.mMul:1;
      if(!(_mRel>0.001))_mRel=0.001;
      // magnetic Lorentz force (B field): F = q(v×B), always perpendicular -> constant speed.
      // Multiple B sources COMPOSE their rotation rates (rotations about z add linearly).
      if(bsIn.length){
        var rot=0;
        /* ω = qB/m（洛伦兹）。默认 q=1、B=1、m=1 时等于旧的手感标定。 */
        for(var bi=0;bi<bsIn.length;bi++){
          var BS=bsIn[bi];
          var bzP=(BS.Bz!=null)?BS.Bz:1;
          rot+=-_qNum*bzP*Q_FORCE/_mRel*dt;
        }
        var cs2=Math.cos(rot),sn2=Math.sin(rot);
        var nvx2=cs2*O.vx-sn2*O.vy;
        var nvy2=sn2*O.vx+cs2*O.vy;
        /* W 体不在这里写速度：它由 Matter 积分，只能通过本块末尾的 applyForce 施力；
         在此写 O.vx/O.vy 会被 stepMatter 覆写，还会造成同一个力算两遍的口径混乱。 */
        if(O.kind!=='W'){O.vx=nvx2;O.vy=nvy2;}
      }
      // electric force (E field): F = qE — each source adds its own acceleration vector.
      /* 真公式 a = qE/m：q 取电荷量数值（O.qCharge / O.charge，默认 1），E 取 ESi.eacc（默认 1），
       m 取面板质量乘数 B.mMul（默认 1，见 wmass）。三者默认都是 1 ⇒ 默认手感不变，
       而调电荷量 / E / 质量都会真的改变加速度（符号由 q·E 给出）。
       q_ref = E_ref = m_ref = 1 把真实单位换算吸收掉，换算系数就是 E_FIELD_ACC
       （px/s²，即默认电荷在默认场里的加速度）。 */
      for(var ei=0;ei<esIn.length;ei++){
        var ESi=esIn[ei];
        var eth2=ESi.th||0, eaP2=(ESi.eacc!=null)?ESi.eacc:1;
        var ea2=E_FIELD_ACC*_qNum*eaP2/_mRel*dt;
        if(O.kind!=='W'){O.vx+=Math.cos(eth2)*ea2;O.vy+=Math.sin(eth2)*ea2;}   /* W 体只走 applyForce */
      }
      O.fieldState=(bsIn.length||esIn.length)?{active:true}:null;
      /* 带电 W 体走 Matter 的力通道（applyForce），不要每帧 setVelocity + Sleeping.set(false)：
       那会覆盖 Matter 刚积分出的速度并重置睡眠计时，运动一卡一卡。
       作用点取 mb.position（质心）⇒ 零力矩，物体不会被场推着自转。
       · E 场：沿 th 的恒定加速度，各源矢量相加。
       · B 场：洛伦兹力垂直于速度、大小 ω·|v| ⇒ 走圆弧。
       · 施力后把速度镜像还原成 Matter 真值（上面共用的速度写法对 W 体不适用）。 */
      if(O.kind==='W'&&O.mb){
        var _fm=O.mb.mass||1,_afx=0,_afy=0,i3,src3,a3;
        for(i3=0;i3<esIn.length;i3++){src3=esIn[i3];
          /* 与上面 q 通道同口径：a = qE/m */
          a3=E_FIELD_ACC*_qNum*((src3.eacc!=null)?src3.eacc:1)/_mRel;
          _afx+=Math.cos(src3.th||0)*a3;_afy+=Math.sin(src3.th||0)*a3;}
        var _vx3=O.vx||0,_vy3=O.vy||0,_sp3=Math.hypot(_vx3,_vy3);
        if(_sp3>1e-6){
          for(i3=0;i3<bsIn.length;i3++){src3=bsIn[i3];
            var _bz3=(src3.Bz!=null)?src3.Bz:1;
            /* ω = qB/m ⇒ 切向加速度 ω·|v| */
            var _w3=Q_FORCE*_qNum*_bz3/_mRel*_sp3;
            _afx+=(-_vy3/_sp3)*_w3;_afy+=(_vx3/_sp3)*_w3;}
        }
        /* 力的换算按帧级标定：stepField 是帧级（60 次/秒），不能沿用 applyGivenAccel 的逐子步口径 F=m·a/1e6
         （那样 4 个子步只有 1 个吃到力，实测只得到约 5.7 px/s²，被地面摩擦 208 px/s² 完全吃掉）。
         Matter 每步给 (F/m)·deltaTime²（deltaTime=4.1667ms ⇒ ×17.36）；帧级一次要产生 a/60 px/s
         的增量 = a/14400 px/step ⇒ F = m·a/(17.36·14400) ≈ m·a/250000（理论推导值）；
         * 实际使用的 QFIELD_K=112500 是实测标定值，见 01-core.js。 */
        if(_afx||_afy)Matter.Body.applyForce(O.mb,{x:O.mb.position.x,y:O.mb.position.y},
                                            {x:_fm*_afx/QFIELD_K,y:_fm*_afy/QFIELD_K});
        O.vx=O.mb.velocity.x*60;O.vy=O.mb.velocity.y*60;
      }
    }else if(O.kind==='I'){
      // Ampere force on a current segment from ALL covering B fields (superposition)
      if(bsIn.length){
        var fy=0;
        for(var bi2=0;bi2<bsIn.length;bi2++){
          var BS2=bsIn[bi2];
          var dir2=BS2.Bz>0?1:-1;
          var iacP2=(O.iacc!=null)?O.iacc:1;
          fy+=A_FORCE*O.Isign*dir2*iacP2;
        }
        O.vy+=fy*dt;
        var dmp2=Math.pow(0.94,dt*60);
        O.vx*=dmp2;O.vy*=dmp2;
      }
    }
  }
  for(var k=0;k<bodies.length;k++){
    var K=bodies[k];
    if(K.kind==='B'||K.kind==='E'||K.kind==='T'||K.kind==='S')continue;
    if(K.bh)continue;
    if(K.x<24){K.x=24;K.vx=Math.abs(K.vx)*0.5;}
    if(K.x>W-24){K.x=W-24;K.vx=-Math.abs(K.vx)*0.5;}
    if(K.y<24){K.y=24;K.vy=Math.abs(K.vy)*0.5;}
    if(K.y>groundY-24){K.y=groundY-24;K.vy=-Math.abs(K.vy)*0.5;}
  }
}
