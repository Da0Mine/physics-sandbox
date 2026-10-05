/* 连接件吸附到物体表面的几何计算（角、边中点、最近点） */
import { clamp, segClosest, segPointDist } from '../core/math.js';
import { BND_INK } from '../physics/matter.js';

// 把端点吸附到宿主的表面上：判定带 SPR_PAD=15px 是为了手感（不用像素级对齐），但落点必须收到面上，
// 否则已经锚定却挂着 10~15px 的可见空隙。
// 与 distToHost 一一对应：笔画/图形 -> 墨迹折线，杆/弹簧 -> 线段，字母刚体 -> 转正后的方框。
export function inkClosestPoint(B,px,py){
  if(!B.pts||B.pts.length<2)return null;
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0),n=B.pts.length;
  var lim=B.closed?n:n-1,bd=1e9,best=null;
  for(var i=0;i<lim;i++){
    var a=B.pts[i],b=B.pts[(i+1)%n];
    var ax=B.x+a[0]*c-a[1]*s,ay=B.y+a[0]*s+a[1]*c;
    var bx=B.x+b[0]*c-b[1]*s,by=B.y+b[0]*s+b[1]*c;
    var q=segClosest(ax,ay,bx,by,px,py);
    var dd=Math.hypot(px-q.x,py-q.y);
    if(dd<bd){bd=dd;best=q;}
  }
  return best;
}
export const SPR_MID_ZONE=30;   // 边中点吸附的作用半径（px），见下方死区说明
/*
 * 边中点吸附：拖动弹簧靠近方框宿主的某条边时，显示并吸附到该边的中点，方便连上后物体不侧翻。
 *
 * 物理依据：匀质矩形板的质心垂直投影到某条边上，落点恰好是该边中点。装在中点的拉力相对质心的力臂方向
 * 与边法线重合，只会沿法线拉/推，不产生倾覆力矩；挂在角点上则有长力臂，一接上就翻。
 *
 * 只对方框类宿主生效：字母刚体（无 kind、有 hw/hh）与闭合且恰好 4 个角的 W 体（手绘/形状工具画的
 * 矩形/平行四边形）。杆/笔画/图形/三角形/圆弧/凹槽/折线的「边中点 = 质心投影」不成立（杆的中点锚定
 * 会让杆端无法受力），继续走 hostClosestPoint。
 *
 * 死区 SPR_MID_ZONE（30px）：中点离端点太远时不抢，否则在 240px 长的边上拖到最右端，锚点却被吸到
 * 120px 外的中央（瞬移）。超出半径就退回「离端点最近的表面点」。
 * 返回 {x,y,mid:true} 或 null（不是方框宿主 / 够不着）。
 */
// W 体（闭合四边形）的四条边中点。本地坐标 pts → 世界系（与 inkClosestPoint 同约定）。
export function wQuadMidSnapPoint(host,px,py){
  if(!host.closed||!host.pts||host.pts.length!==4)return null;   // 只认四边形（见上）
  var c=Math.cos(host.th||0),s=Math.sin(host.th||0);
  var best=null,bd=1e9;
  for(var i=0;i<4;i++){
    var a=host.pts[i],b=host.pts[(i+1)%4];
    var ax=host.x+a[0]*c-a[1]*s,ay=host.y+a[0]*s+a[1]*c;
    var bx=host.x+b[0]*c-b[1]*s,by=host.y+b[0]*s+b[1]*c;
    var mx=(ax+bx)/2,my=(ay+by)/2,dd=Math.hypot(px-mx,py-my);
    if(dd<bd){bd=dd;best={x:mx,y:my,mid:true};}
  }
  return (best&&bd<=SPR_MID_ZONE)?best:null;
}
/* 铰链器件吸附到物体的角：返回离指针最近的多边形顶点，在 CORNER_ZONE 内才命中。
 * 与 hostMidSnapPoint 同构（吸附优先级：角 > 边中点 > 表面点）。 */
export const CORNER_ZONE=26;
export function hostCornerSnapPoint(host,px,py){
  if(!host||host.dead)return null;
  var th=host.th||0,c=Math.cos(th),s=Math.sin(th);
  var best=null,bd=CORNER_ZONE;
  var pts=null;
  if(host.pts&&host.pts.length)pts=host.pts;                       // 画的多边形（本地系）
  else if(host.mb&&host.mb.vertices&&host.mb.vertices.length>2)pts=host.mb.vertices;  // 物理体顶点（世界系）
  if(!pts)return null;
  var isWorld=!(host.pts&&host.pts.length);
  for(var i=0;i<pts.length;i++){
    var p=pts[i],wx,wy;
    if(isWorld){wx=p.x;wy=p.y;}
    else{wx=host.x+p[0]*c-p[1]*s;wy=host.y+p[0]*s+p[1]*c;}
    var d=Math.hypot(px-wx,py-wy);
    if(d<bd){bd=d;best={x:wx,y:wy};}
  }
  return best;
}
export function hostMidSnapPoint(host,px,py){
  if(!host||host.dead)return null;
  if(host.kind==='W')return wQuadMidSnapPoint(host,px,py);   // 画的方框也参与
  if(host.kind)return null;                                  // 杆/线/场源一律退出
  var c=Math.cos(host.th||0),s=Math.sin(host.th||0);
  var dx=px-host.x,dy=py-host.y;
  var lx=dx*c+dy*s,ly=-dx*s+dy*c;
  var hw=host.hw||30,hh=host.hh||24;
  // 四条边各自的中点（本地坐标），顺带算出端点到该边所在直线的距离，选最近的一条
  var ex=1e9,ey=1e9,exx=0,eyy=0;
  var dR=hw-lx,dL=lx+hw,dB=hh-ly,dT=ly+hh;
  var mid=null,mind=1e9;
  if(dR<mind){mind=dR;mid=[hw,0];}
  if(dL<mind){mind=dL;mid=[-hw,0];}
  if(dB<mind){mind=dB;mid=[0,hh];}
  if(dT<mind){mind=dT;mid=[0,-hh];}
  if(!mid)return null;
  var wx=host.x+mid[0]*c-mid[1]*s,wy=host.y+mid[0]*s+mid[1]*c;
  if(Math.hypot(px-wx,py-wy)>SPR_MID_ZONE)return null;   // 太远不抢（见死区说明）
  return {x:wx,y:wy,mid:true};
}
/*
 * 铰链端点的落点必须落在宿主的碰撞面上，不能落在墨迹中线上。
 *
 * 原因：W 体的碰撞几何 = 墨迹中线外扩 BND_INK（闭链走 inflateHull(...,BND_INK)，开链/弧走 bndSegs 的
 * hh=BND_INK 定向矩形，buildMatterBody 里两处同值），而吸附落点（hostMidSnapPoint / hostClosestPoint）
 * 在中线上 ⇒ 落点在碰撞体内部 2.325px。铰链两端必须重合（len=0 的销），两个宿主的碰撞体就被迫互埋
 * 2·BND_INK = 4.65px —— 无解构型：Matter 位置求解器每步把可动宿主顶出去，hingeSolve 的 conPull 立刻
 * 拖回销上，表现为持续抖动 + 稳态穿透（实测 33~34px）。这种 60Hz 振荡在 rAF 采样下逐帧净位移看着很小，
 * Matter 配对表里存的深度也很小，要直接调 Collision.collides 才量得到。
 *
 * 做法（hingeSurfacePoint）：把锚点从中线推到碰撞面上，外法向取最近那条边的外法线（与 inflateHull 的
 * 边平移口径一致），两锚点在碰撞面上重合 ⇒ 两碰撞体正好相切（零重叠），销与接触解算器不再互斗。
 * 顶点处的处理见 hingeSurfacePoint 内注释。
 *
 * 只对铰链生效：弹簧/轻绳是单点附着，没有两锚点必须重合的约束，落点一挪会平移一批已标定的手感数值；
 * 轻绳限制的是最大间距，与接触方向一致，本来就不互斗。字母刚体的碰撞体就是它自己的方框（pad=0）。
 */
export function hostSurfacePad(host){
  if(!host)return 0;
  return host.kind==='W'?BND_INK:0;    // W 体：中线外扩 BND_INK 就是碰撞面；字母刚体/杆：0
}
export function hingeSurfacePoint(host,q){
  if(!host||!q||!host.pts||host.pts.length<2)return q;
  var pad=hostSurfacePad(host);
  if(!(pad>0))return q;
  var c=Math.cos(host.th||0),s=Math.sin(host.th||0),n=host.pts.length;
  /* 外推到碰撞面（幅度 pad）是铰链两体相切而非互埋的必要手段，不能省。角点不要用以下简化处理，都会互埋抖动：
   * ① 角点跳过外推（落点回到墨迹中线，壳内 2.325px）；② 沿角平分线 u1+u2 外推（指向宿主内部）。
   * 顶点的正确处理见下。 */
  var lim=host.closed?n:n-1,bd=1e9,ne=null,bi=-1,bq=null;
  for(var i=0;i<lim;i++){
    var a=host.pts[i],b=host.pts[(i+1)%n];
    var ax=host.x+a[0]*c-a[1]*s,ay=host.y+a[0]*s+a[1]*c;
    var bx=host.x+b[0]*c-b[1]*s,by=host.y+b[0]*s+b[1]*c;
    var qq=segClosest(ax,ay,bx,by,q.x,q.y);
    var dd=Math.hypot(q.x-qq.x,q.y-qq.y);
    if(dd<bd){bd=dd;ne=[ax,ay,bx,by];bi=i;bq=qq;}
  }
  if(!ne)return q;
  /* 顶点（角）上要推到碰撞壳的斜接角，不能沿单条边法线推 pad：
   *  · 碰撞壳 = inflateHull(pts, BND_INK)，每条边平行外移 pad，壳顶点 = 相邻两条外偏线的交点 ⇒ 壳角点离墨迹
   *    顶点 pad/sinψ（ψ = 半顶角）。只推 pad 时本宿主壳角会朝另一宿主多戳 pad(1/sinψ − 1)：直角 0.96px、
   *    顶角 40° 4.47px。
   *  · 超过 hingeContactUnfold 的进入门（hingePairDepth > HINGE_UF_EPS = 2.0）后进入无解构型：接触解算把可动
   *    宿主顶出去、conPull 拖回销上，unfold 每帧 Matter.Body.rotate 宿主（只改 angle/position、不改
   *    angularVelocity），位姿写在速度通道之外 ⇒ 自维持极限环。大学模式有空气阻力/摩擦压着，
   *    高中 air=μ=e=0 ⇒ 全幅抽搐。实测改为斜接后互埋从 3~58px 降到 0。
   *  · 方向取两条边外法线之和（外法向按背离质心选定，与 inflateHull 一致），幅度 pad/cos(θ/2) = pad/sin(半顶角)，
   *    落点恰好是壳的斜接角。直线段上两外法线相等 ⇒ cosHalf=1，退化为单边法线推 pad。
   *  · 开链（笔画）的两个端点没有相邻边（壳走方帽），退回单边法线；尖刺（cosHalf≤0.2，即内角 ≤23°）也退回，
   *    避免幅度爆掉。 */
  if(bi>=0&&bq){
    var dA=Math.hypot(bq.x-ne[0],bq.y-ne[1]);
    var dB=Math.hypot(bq.x-ne[2],bq.y-ne[3]);
    var k=-1;
    if(dA<pad)k=bi; else if(dB<pad)k=(bi+1)%n;
    if(k>=0&&(host.closed||(k>0&&k<n-1))){
      var pL=host.pts[(k-1+n)%n],vL=host.pts[k],nL=host.pts[(k+1)%n];
      var e1x=vL[0]-pL[0],e1y=vL[1]-pL[1],e2x=nL[0]-vL[0],e2y=nL[1]-vL[1];
      var L1=Math.hypot(e1x,e1y)||1,L2=Math.hypot(e2x,e2y)||1;
      var n1x=e1y/L1,n1y=-e1x/L1,n2x=e2y/L2,n2y=-e2x/L2;
      var m1x=(pL[0]+vL[0])/2,m1y=(pL[1]+vL[1])/2;        // 本地系里质心就是原点
      var m2x=(vL[0]+nL[0])/2,m2y=(vL[1]+nL[1])/2;
      if(n1x*m1x+n1y*m1y<0){n1x=-n1x;n1y=-n1y;}
      if(n2x*m2x+n2y*m2y<0){n2x=-n2x;n2y=-n2y;}
      var bsx=n1x+n2x,bsy=n1y+n2y,bl=Math.hypot(bsx,bsy);
      if(bl>1e-6){
        bsx/=bl;bsy/=bl;
        var cosHalf=n1x*bsx+n1y*bsy;                     // = cos(θ/2)，θ = 两外法线夹角
        if(cosHalf>0.2){
          var mag=pad/cosHalf;
          var lx=vL[0]+bsx*mag,ly=vL[1]+bsy*mag;
          return {x:host.x+lx*c-ly*s,y:host.y+lx*s+ly*c};
        }
      }
    }
  }
  var ex=ne[2]-ne[0],ey=ne[3]-ne[1],L=Math.hypot(ex,ey)||1;
  var nx=ey/L,ny=-ex/L;                                  // 边的法线（方向待定）
  var mx=(ne[0]+ne[2])/2-host.x,my=(ne[1]+ne[3])/2-host.y;
  if(nx*mx+ny*my<0){nx=-nx;ny=-ny;}                      // 取背离宿主质心那一侧 = 外法向
  return {x:q.x+nx*pad,y:q.y+ny*pad};
}
export function hostClosestPoint(host,px,py){
  if(!host||host.dead)return null;
  if(host.kind==='T'){
    var hl=(host.len||170)/2,c=Math.cos(host.th||0),s=Math.sin(host.th||0);
    return segClosest(host.x-c*hl,host.y-s*hl,host.x+c*hl,host.y+s*hl,px,py);
  }
  if(host.kind==='S')return segClosest(host.e0.x,host.e0.y,host.e1.x,host.e1.y,px,py);
  if(host.kind==='W')return inkClosestPoint(host,px,py);
  if(host.kind)return null;                       // 场源不是可锚定的实体
  // 字母刚体：转到本地坐标，夹到 ±hw/±hh 的框上（已在框内时推到最近的那条边）
  var dx=px-host.x,dy=py-host.y,c2=Math.cos(host.th||0),s2=Math.sin(host.th||0);
  var lx=dx*c2+dy*s2,ly=-dx*s2+dy*c2;
  var hw=host.hw||30,hh=host.hh||24;
  var qx=clamp(lx,-hw,hw),qy=clamp(ly,-hh,hh);
  if(qx===lx&&qy===ly){                           // 点在框内：推到最近的边
    var ex=hw-Math.abs(lx),ey=hh-Math.abs(ly);
    if(ex<=ey)qx=(lx<0?-hw:hw);else qy=(ly<0?-hh:hh);
  }
  return {x:host.x+qx*c2-qy*s2,y:host.y+qx*s2+qy*c2};
}
// 锚点语义：hostClosestPoint 取离端点最近的表面点（不取离导轨线最近的垂足）。
export function inkPointDist(B,px,py){
  // 与 nearInk 同一套「贴线」几何，但返回距离而不是布尔
  if(!B.pts||B.pts.length<2)return 1e9;
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0),n=B.pts.length;
  var lim=B.closed?n:n-1,bd=1e9;
  for(var i=0;i<lim;i++){
    var a=B.pts[i],b=B.pts[(i+1)%n];
    var ax=B.x+a[0]*c-a[1]*s,ay=B.y+a[0]*s+a[1]*c;
    var bx=B.x+b[0]*c-b[1]*s,by=B.y+b[0]*s+b[1]*c;
    var dd=segPointDist(ax,ay,bx,by,px,py);
    if(dd<bd)bd=dd;
  }
  return bd;
}
export function distToHost(host,px,py){
  if(!host||host.dead)return 1e9;
  if(host.kind==='T'){
    var hl=(host.len||170)/2,c=Math.cos(host.th||0),s=Math.sin(host.th||0);
    return segPointDist(host.x-c*hl,host.y-s*hl,host.x+c*hl,host.y+s*hl,px,py);
  }
  if(host.kind==='S')return segPointDist(host.e0.x,host.e0.y,host.e1.x,host.e1.y,px,py);
  if(host.kind==='W')return inkPointDist(host,px,py);
  if(host.kind)return 1e9;                       // E/B/q/I 场源不是可锚定的实体
  // 字母刚体：转到本地坐标，算点到矩形框的距离（框内为 0）
  var dx=px-host.x,dy=py-host.y,c2=Math.cos(host.th||0),s2=Math.sin(host.th||0);
  var lx=dx*c2+dy*s2,ly=-dx*s2+dy*c2;
  var ox=Math.max(0,Math.abs(lx)-(host.hw||30)),oy=Math.max(0,Math.abs(ly)-(host.hh||24));
  return Math.hypot(ox,oy);
}
