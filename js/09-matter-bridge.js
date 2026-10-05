/* 工具栏状态、Matter 刚体桥接、弹性接触守卫（原 index.html 第 12526–13839 行） */
/* ---- 工具栏（TOOL PALETTE）----
 * 左上角下拉展开三个图标工具：
 *   ① 公式示例 — 屏幕中央的菜单列出所有现成整体，点一个就在画布正中生成；
 *   ② 画笔     — 手绘一条黑色「有重量的边界」；
 *   ③ 预设物体 — 同样的边界，拖出矩形 / 圆 / 三角。
 * 「有重量」：边界在自身重力力矩下绕最低接触点倾倒（质量分布偏心就会翻），无支撑时下落并停在
 *   地面 / 杆 / 其它边界上。重量沿线条分布（B.bndM = 线总长，B.bndI = 线的二阶矩，见 mkBoundary），
 *   不按围出的面积算：只有线条是边界，内部不填充。
 * 「没有惯性，只能被拖动」：除拖动和重力外没有东西能移动边界：场（stepField）、引力井（stepGravity
 *   只处理 kind==null）都忽略它；碰撞只消掉它的向内速度并把它推出（collideBodies），不会把它甩飞。
 *   无水平惯性（vx 钉 0）、不反弹（bounc=0）、松手后不保留速度。
 * 连续绘制：画笔 / 预设物体模式常驻时，每一笔 / 每个形状各成一个边界，工具保持就绪
 *   （finishStroke / finishShapeDrag 不清模式）；再点同一按钮（或形状切换）取消，画布回到抓取。
 */
var TOOL={open:false,mode:null,shape:'rect',stroke:null,drag:null,
          device:'spring',  // 当前选中的器件（与 shape 同构；器件模式下点画布就放它）
          devDrag:null,     // 从器件面板拖出时跟随指针的落点（{id,x,y,over}）
          cont:false,     // true = 连续绘制（双击进入），false = 只画一次（单击）
          armedKey:null,  // 当前武装的是哪个按钮（'brush' / 'shape:rect'…），双击判定要它
          lastTap:0};     // 上一次点同一个按钮的时间戳
// 单击 = 只画一次；双击 = 连续绘制；再点一次取消。
// 第一次点立即武装（不等双击判定窗口，否则单击要等 330ms 才能用）；窗口内第二次点把同一工具升级为连续，超出窗口再点则取消。
var TOOL_DBL_MS=330;
var tToggle=document.getElementById('ttoggle'),tRow=document.getElementById('trow'),tSub=document.getElementById('tsub');
// 器件行 #dsub 与 #tsub 分开：syncToolUI 用 tSub.querySelectorAll('.tbtn') 只扫形状 chip，
// 器件 chip 若并入 tSub 会被当作形状按钮比对 data-shape（恒 null），永远不高亮。
var dSub=document.getElementById('dsub');
var fmenu=document.getElementById('fmenu'),fmask=document.getElementById('fmask'),
    fmgrid=document.getElementById('fmgrid'),fmclose=document.getElementById('fmclose');
var BND_HH=3.0;         // 基础常量（历史名）；墨迹线宽 = BND_HH*1.55
// 墨迹厚度的唯一真源 BND_INK：物理一律用它，与渲染线宽 BND_HH*1.55 同源。
// 不要在物理里直接用 BND_HH（半厚 3.0）：碰撞体会比可见线（半厚 2.325）胖 0.675px，碰撞箱与笔画对不上。
var BND_INK=BND_HH*1.55/2;   // 屏幕上墨迹的半厚（px）：画多粗就撞多粗
var PEN_HW=BND_INK;     // 画线半厚 == 图形半厚 == 墨迹半厚
var PEN_MAX=90;         // most segments one pen stroke may carry (keeps the collision pass cheap)
var BND_MIN_LEN=50;     // shorter than this and there is no line to speak of -> not a body
// 与墙接触时，相对法向速度低于此值算静止接触（恢复系数按 0 处理）。
// 一帧重力增速 GRAV*dt ≈ 43px/s，静止接触的 vn 即此量级；10px 高自由落体落地约 228px/s，真实撞击照旧反弹。
var W_BOUNCE_MIN=140;
// 边界（W）速度死区（px/s）：Matter 对静置的多段复合体有 ~1px 级求解器跳变（1.2px/帧 ≈ 72px/s），
// 差分成速度后足以把压在弧上的物体顶飞，故低于此值一律当静止；真正下落/被拖动时速度远大于 120px/s。
var W_V_DEAD=120;

/* ---- Matter 层：边界的真实刚体物理 ----
 * 手写的准静态倾倒（绕最低接触点转、力矩对平行轴惯量）能让偏心轮廓倾倒，却没有角动量：不会翻滚、
 * 不会摇到一条边上再稳住、碰撞不传递动量。因此边界体放进内嵌的 Matter.js 世界（顺序冲量求解器，
 * 带摩擦、堆叠、睡眠）。公式字母仍用自己的手写物理（场、碎裂、黑洞…），通过下方 bndHit 与边界的边碰撞；
 * t 杆以运动学静态板镜像进 Matter 世界，线条可以落在上面。
 * 重力对齐：Matter 加速度 = gravity.y*1000 px/s²，所以 2.6 对应 GRAV(2600)。 */
var MW=null;
function ensureMatter(){
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
function removeMatterBody(B){
  if(B.mb&&MW){Matter.Composite.remove(MW.wLayer,B.mb);}
  B.mb=null;
  /* 弹簧的端帽体随宿主一起清，否则删弹簧后留下隐形碰撞体 */
  if(B._cap){for(var ci=0;ci<2;ci++){if(B._cap[ci]&&MW){Matter.Composite.remove(MW.wLayer,B._cap[ci]);}}
    B._cap=null;}
}
function rebuildWBody(B,thOpt){
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
// ---- 圆弧（PPT 式语义）：端点手柄的几何 ----
// 椭圆锚定在 body 本地系的 (lcx,lcy)，随 body 平移/旋转。端点世界坐标 = B 原点 + 旋转(lc + 极坐标)。
function arcWorldCenter(B){
  var e=B.ell,c=Math.cos(B.th||0),s=Math.sin(B.th||0);
  return {x:B.x+e.lcx*c-e.lcy*s,y:B.y+e.lcx*s+e.lcy*c,c:c,s:s};
}
function arcEndWorld(B,which){
  var e=B.ell,wc=arcWorldCenter(B),a=(which===0)?e.a0:e.a1;
  var ex=e.lcx+Math.cos(a)*e.rx,ey=e.lcy+Math.sin(a)*e.ry;
  return {x:B.x+ex*wc.c-ey*wc.s,y:B.y+ex*wc.s+ey*wc.c};
}
// 吸附统一在世界系做（与旋转手柄吸 th 的口径一致）；若在本地参数角上吸附，弧自转后吸到的是跟着体斜过去的 0/90/180/270。
//   arcEndWorldAng        端点相对椭圆圆心的世界方向角（= 本地几何方向角 + th）
//   arcParamFromWorldAng  把世界方向角换算成该椭圆上的参数角（pa=atan2(ly/ry,lx/rx) 的逆）
// rx==ry（弧恒为正圆）时两者互为 ±th 的平移，公式自动退化。
function arcEndWorldAng(B,which){
  var e=B.ell,a=(which===0)?e.a0:e.a1;
  return Math.atan2(Math.sin(a)*e.ry,Math.cos(a)*e.rx)+(B.th||0);
}
function arcParamFromWorldAng(B,worldAng){
  var e=B.ell,b=worldAng-(B.th||0);
  return Math.atan2(Math.sin(b)/e.ry,Math.cos(b)/e.rx);
}
function arcSetAngle(B,which,na){
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
function arcResample(B){
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
function inflateHull(h,d){
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
// 把用户调过的质量乘数（mMul）与摩擦系数（wFrict）应用到 Matter 体上。
// buildMatterBody 的所有路径（新建 / rebuildWBody 重建 / 复制）最后都走这里，重建不会把用户参数洗回默认。
function applyWMul(B){
  if(!B.mb)return;
  if(B.mMul&&B.mMul!==1){
    B.mass=B.mMul;
    if(B._natMass&&!B.mb.isStatic)Matter.Body.setMass(B.mb,B._natMass*B.mMul);
  }
  applyWFrict(B);
  applyWBounc(B);
  applyEffRest(B);     // 高中模式默认弹性全 0：effRest 读 PHYS_MODE；applyWFrict/applyWBounc 有 null 守卫不调它，默认体也要在这里刷
}
/* 自算的库仑摩擦（逐子步，挂在引擎 afterUpdate 上，见 ensureMatter；此时本子步的接触对表是新的）。
 * dv = μ·g·dt，与质量无关（滑行距离 ∝ 1/μ），方向与当前速度相反；只刹到停、不反向，静摩擦交给接触求解器。
 * 只处理本子步有活动接触且用户显式调过 μ 的 W 体（_ownFric），其余体不受影响。 */
function wfSelfFriction(dt){
  if(!MW||!MW.engine)return;
  var list=MW.engine.pairs.list,any=0,i,k,B,pr;
  for(i=0;i<bodies.length;i++)if(bodies[i]&&bodies[i]._ownFric){any=1;break;}
  if(!any)return;
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(!B||B.dead||B.kind!=='W'||!B.mb||B.mb.isStatic||!B._ownFric)continue;
    var mu=B.wFrict;
    if(!(mu>0))continue;                       // μ=0 = 真正光滑
    var touch=false;
    for(k=0;k<list.length;k++){
      pr=list[k];
      if(pr&&pr.isActive&&(pr.bodyA===B.mb||pr.bodyB===B.mb)){touch=true;break;}
    }
    if(!touch)continue;
    var v=B.mb.velocity;
    if(!v)continue;
    var sp=Math.hypot(v.x,v.y);
    if(!(sp>1e-9))continue;
    /* 单位换算：Matter 0.19 Body.update 中 velocity 是每子步位移（px/子步），重力项为 (force/mass)·deltaTime²，
     * 所以减速度 a=μ·g 折算到存储口径要乘 dt²。
     * 校核：μ=1、v0=500px/s ⇒ kk=0.04514 px/子步 ⇒ 46 子步(0.192s)停 ⇒ 滑行 48px = v²/(2μg)。
     * 不要写成 μ·g·dt：大 240 倍，几帧就停住。 */
    var kk=mu*GRAV*dt*dt;
    if(kk>sp)kk=sp;
    var ux=v.x/sp,uy=v.y/sp;
    /* Matter 0.19 的 Body.setVelocity 入参是 _baseDelta(16.667ms) 单位，内部乘 deltaTime/_baseDelta
     * （子步 4.1667ms ⇒ 0.25）再存，而 body.velocity 读出的是 px/子步，两者差这个因子。
     * 不补的话实测减速度只有 μ·g 的 1/4。用 Matter 自己的换算因子，别写死 4。 */
    var _bd=(typeof Matter!=='undefined'&&Matter.Body&&Matter.Body._baseDelta)||16.6667;
    var _ts=(B.mb.deltaTime||_bd)/_bd;
    if(!(Math.abs(_ts)>1e-6))_ts=1;
    var kIn=kk/_ts;
    Matter.Body.setVelocity(B.mb,{x:v.x-ux*kIn,y:v.y-uy*kIn});
  }
}
function applyWFrict(B){
  if(!B.mb)return;
  // wFrict 为 null（用户没调过）时绝不能写 mb.friction=undefined：求解器会算出 NaN，物体飞出屏幕。
  // 未调过的体按当前模式写回确定的默认值（高中 0；大学 WFRICT_DEF，与 buildMatterBody 同一套默认）：
  //   · 高中模式必须真写 0，否则面板读数（wEffMu）为 0 而物理仍按 0.08 咬合，读数与物理不同源；
  //   · 大学模式也不能早退，否则高中→大学往返后 mb.friction / frictionStatic 残留高中的 0，
  //     frictionStatic=0 让 pair fs 钉在 0，调任何参数都像没调。
  // 用户显式调过的（wFrict!=null）两种模式下都只同步、不改用户值。
  var v=(B.wFrict==null)?(PHYS_MODE==='high'?0:WFRICT_DEF):B.wFrict;
  if(v==null)return;
  B.mb.friction=v;
  // μ=0 → 动/静摩擦全 0 = 真正光滑；μ>0 → 静摩擦至少 0.6，停下的物体仍站得稳。frictionStatic 不影响动摩擦，二者可解耦。
  // 不要让小 μ 时静摩擦跟着变小（如 μ=0.1 ⇒ 0.1）：物体会停不稳。
  /* 静摩擦经 wfStaticOf 跟随 μ：写死常数时有效摩擦完全由它决定（实测 μ=0.05/0.3/1.0 减速度恒为 1500px/s²），调 μ 无反应。
   * 只放开 μ>WF_STATIC_CAP（静态框侧已抬到 1，见 ensureMatter，配对取 min 后上限就是物体自己）；μ≤cap 不变，默认手感不变。 */
  B.mb.frictionStatic=wfStaticOf(v);
  /* 用户显式调过 μ 的 W 体（wFrict!=null）改走自算库仑摩擦 wfSelfFriction，这里关掉 Matter 自己的摩擦通道
   * （friction=0），避免两个来源叠加。
   * 原因：Matter 的摩擦按每个接触点各施 friction×N 的冲量，方块躺在平地上有 2 个接触点，
   * 实测减速度 ≈ 0.65g + 1.7·μ·g（不是 μg），μ=0.6 与 1.0 滑行距离只差 15%。
   * 自算口径 = 教科书库仑摩擦：切向减速度 μ·g，与质量无关，0~1 量程线性。默认体（0.08）行为不变。 */
  var _own=(B.wFrict!=null);
  B._ownFric=_own;
  B.mb.friction=_own?0:v;
  var ps=B.mb.parts||[];
  for(var i=0;i<ps.length;i++){ps[i].friction=_own?0:v;ps[i].frictionStatic=wfStaticOf(v);}
  refreshWPairs(B);
  applyEffRest(B);     // μ=0 极值体的体级弹性 = 1（见 effRest；调 μ 也会改变生效弹性）
  applyWAir(B);
}
// 把用户调过的弹性（wBounc）应用到 Matter 体上。不做 null 早退：未调过的体也要按当前模式写回默认，
// 否则模式往返后残留上一模式的值。写入全交给 applyEffRest（effRest 覆盖全部情形：调过 = 用户值；
// 没调过 = 模式默认（高中 0 / 大学圆 BALL_REST、其它 0）；显式 μ=0 = 1）。
// ⚠ 不要在这里手搓默认值再覆盖：会把 μ=0 极值体的 rest=1 洗回 0.52/0。applyEffRest 写的永远是确定数值，不会是 undefined。
function applyWBounc(B){
  if(!B.mb)return;
  applyEffRest(B);     // 见上：唯一写入点，四种情形全在 effRest 里
  refreshWPairs(B);
  applyWAir(B);
}
// 生效弹性 = 用户旋钮（wEffE）受 μ 极值语义覆盖：显式 μ=0 的体 → 1。
// 必须在体级生效：若只在帧末 refreshAllPairs 把 pair.restitution 置 1，子步内 Matter 仍按双方 body.restitution
// 取 max（e=0 → 0）做非弹性求解，曲面滑移每子步的法向接近速度被杀掉（凹槽实测损耗 ~0.28/子步，球越滑越低）。
// 体级为 1 时新 pair 创建即带 1，子步内直接弹性求解；EL_Z 恢复只作残余兜底（预算门照旧，不会过补）。
function effRest(B){
  // 极值语义只在用户显式声明 μ=0 时成立：高中模式的默认 μ=0 是教学默认值，不能把体级 e 抬到 1，
  // 否则「高中默认弹性全 0」失效（全场每一对 rest=1）。见 wMuIdeal。
  if(wMuIdeal(B))return 1;
  return wEffE(B);
}
function applyEffRest(B){
  if(!B.mb)return;
  var r=effRest(B);
  B.mb.restitution=r;
  var ps=B.mb.parts||[];
  for(var i=0;i<ps.length;i++)ps[i].restitution=r;
}
// 空气阻尼 frictionAir 与 μ、e 联动（applyWAir，未显式设 wAir 时）：
//   air = defAir × min(1, μ/0.08) × (1 − e)
//   · μ=0 → air=0：完全光滑，匀速滑行；e=1 → air=0：完全弹性，一直弹；
//   · 默认（μ=0.08, e=0）→ air=defAir；默认球（e=BALL_REST=0.52）air 略小，弹跳衰减本由 restitution 主导。
// 否则 air 会独立泄能：实测 μ=0 时 2s 内 vx 6.4→2.5；e=1 时弹跳峰高 600→308→190（air=0 后 562→557→541）。
// μ / e 未调过时按默认值（0.08 / 圆 BALL_REST、其它 0）参与计算。
function wEffMu(B){return (B.wFrict==null)?(PHYS_MODE==='high'?0:WFRICT_DEF):B.wFrict;}
// 高中模式未调过的体默认 μ=0（wEffMu）。μ=0 的极值语义（air 归零 / 禁用睡眠 / pair rest=1 / 体级 e=1）
// 必须按显式声明判定（wMuIdeal：wFrict===0），不能用 wEffMu(B)===0：否则高中默认 μ=0 让全场 W 体都进 EL_Z，
// refreshAllPairs 把每一对 restitution 抬到 1，「高中默认弹性全 0」被推翻（全场永远弹）。
// 极值语义是用户声明的「理想光滑面」，不是教学默认值。
function wMuIdeal(B){return !!B&&B.wFrict===0;}
// 高中模式：未调过的体默认弹性全 0（不给圆 BALL_REST）；显式调过 wBounc 的不受影响。effRest 的 μ=0 极值覆盖仍优先。
function wEffE(B){return (B.wBounc==null)?(PHYS_MODE==='high'?0:((B.wshape==='circle'&&B.rad)?BALL_REST:0)):B.wBounc;}
// 空气阻力 frictionAir 独立于弹簧阻尼（sdamp 只管弹簧自身的 -D·v），Matter 默认 0.01/帧约 1.2s 能量减半，
// 所以开放成参数 wair：设 0 + sdamp=0 = 理想简谐振荡。
function wAirDef(B){if(PHYS_MODE==='high')return 0;return (B.wAir!=null)?B.wAir:WAIR_GLOBAL;}   // 出厂默认 0；高中恒 0；未设置的体回退全局 WAIR_GLOBAL
function applyWAir(B){
  if(!B.mb)return;
  // 高中模式不算空气阻力：忽略显式 wair，frictionAir 恒 0。
  if(PHYS_MODE==='high'){
    B.mb.frictionAir=0;
    var psH=B.mb.parts||[];
    for(var qH=0;qH<psH.length;qH++)psH[qH].frictionAir=0;
    return;
  }
  // 显式设过 wAir 时它就是权威值，不再被 μ/e 联动乘掉。
  if(B.wAir!=null){
    B.mb.frictionAir=B.wAir;
    var ps8=B.mb.parts||[];
    for(var q8=0;q8<ps8.length;q8++)ps8[q8].frictionAir=B.wAir;
    return;
  }
  var air=wAirDef(B)*Math.min(1,wEffMu(B)/WFRICT_DEF)*(1-Math.min(1,wEffE(B)));
  B.mb.frictionAir=air;
  var ps=B.mb.parts||[];
  for(var i=0;i<ps.length;i++)ps[i].frictionAir=air;
}
// pair 级空气阻尼归零：pair 有效摩擦（min）=0 或有效弹性（max）≥1 时，双方（含复合体 parts）的 frictionAir 全部归零，
// 完全光滑/完全弹性的接触里不允许第三条泄能通道。只做体级联动不够：球贴着 μ=0 的弧/凹槽滚动时，
// 球自己（未调过）的 frictionAir≈0.0067 仍在逐帧泄能。脱离接触后下一帧由 refreshAllPairs 按各自语义恢复。
function wZeroAir(m){
  m.frictionAir=0;
  var ps=m.parts||[];
  for(var i=0;i<ps.length;i++)ps[i].frictionAir=0;
}
/* 不要用 ω := sgn(vx)·|v|/R 之类的写法强制圆纯滚动：接触且 v 落到噪声时会把真实自旋改写成噪声值，
 * 带自旋的球一撞东西 ω 从保留 99.3% 掉到 0.2%。（高中模式的圆按质点处理，见 circleRollStep。） */
function refreshAllPairs(){
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
function pairOvPairMb(ma,mb2){
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
function refreshWPairs(B){
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
function buildMatterBody(B){
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
/* ---- 完全弹性接触的能量守恒守卫（elasticContactFix）----
 * Matter 的迭代求解器无法精确复现 e=1：纯垂直弹跳（air=0、rest=1）逐次出/入射速度比平均 0.966，
 * 每跳丢 ~3.4% 速度，偶尔倒赚 0.14%（手绘开链因此越翻越快）。损耗在求解器内部，无法关掉：
 *   Resolver.solveVelocity 中 Z=(1+restitution)*normalVelocity*Y 累加进 normalImpulse，累积器被钳到 ≤0；
 *   法向速度 U < −2·timeScale 时走投机冲量分支、累积器重置为 0；4 子步 × 1/240s（timeScale=0.25）一拍内多次分叉。
 * 所以在应用层显式守恒：每子步前记录求解器视角的速度（position−positionPrev；solveVelocity 只读写
 * positionPrev/anglePrev，不读 velocity），子步后对声明弹性 ≥1 的活动接触，把接触点法向相对速度恢复成入射值的镜像；
 * 切向交给 Matter 摩擦。恢复值等于入射值 ⇒ 不丢能也不注能。
 * 安全门（避免永久微弹）：
 *   · 只在 vr0<0（在接近）且 vr1>0（求解器已弹开）时动作；静置接触两条件都不满足，不碰。
 *   · 门限用用户声明值 wEffE(B)≥1，不用 pair.restitution：后者被「μ=0 极值对 → rest=1」覆写过，
 *     按它开门会让 μ=0 的方块落地永远弹跳。
 *   · μ=0 的体走 EL_Z 名单进同一机制，但额外要求双方均非地面/墙：场上曲面（凹槽/圆弧）上的滑动接触守恒，
 *     μ=0 方块落地面维持衰减弹跳。
 *   · 冲量按接触点算（含 r×n 角向项），开链翻滚也能正确约束到角动量。 */
var VR_EPS=0.002;
// 逐点镜像的目标应是求解器看到的入射速度，但 snapVelocities 的快照在 Engine.update 之前抓，
// 缺本子步的重力增量（Body.update 中 Δv = g.y·g.scale·dt²）；位置求解器（12 次迭代）把物体顶出穿透时
// 还有一份同量级的亏损。倍数为实测标定（圆 r=36、g=2.6、dt=1000/240）：每跳高度损失 1×→1.4%、2×→0.30%、
// 2.5×→0.05%、3×→净增益 +0.3%。只依赖重力 × 子步 dt²，与质量/半径/弹性无关。设 0 即关闭补偿（纯逐点镜像）。
var ECF_GRAV_COMP=2.5;
// EL_Z 速度恢复目标的重力补偿倍数。不要取 1.0：1× 虽与 budgetClean 的记账口径一致，但 s0 是恢复目标
// （无接触时应有速率），1× 让目标偏低、补偿不足。实测（确定性 4×240Hz、6s 平均能量）：1.0 → 漂移 -6.0%
// （圆在凹槽里越滑越低），1.25 → -0.9%。此参数直接决定可感行为，改动须重新测漂移。
var ECF_Z_GCOMP=1.25;
function substepGravityDelta(){
  if(!MW||!MW.engine||!MW.engine.gravity)return 0;
  var dt=1000/240;                    // 与 stepMatter 的子步完全一致
  return MW.engine.gravity.y*MW.engine.gravity.scale*dt*dt;
}
// μ=0 极值体名单（与 EL 并列，perfectElasticMB 每帧一起重算）。μ=0 对的 pair.restitution 虽被 refreshAllPairs⑥ 置 1，
// 求解器仍复现不了 e=1，曲面 41 段接缝实测 ΔE≈130~150/半周期；用同一台补偿机器修，门控多一条「双方均非地面/墙」（见 elasticContactFix）。
var EL_Z=[];
function perfectElasticMB(){
  var out=[];
  EL_Z.length=0;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.dead||!B.mb)continue;
    if(wEffE(B)>=0.999)out.push(B.mb);
    else if(wMuIdeal(B))EL_Z.push(B.mb);   // 只收显式 μ=0 的体（高中默认 μ=0 不算，见 wMuIdeal）
                                           // ⚠ 必须是 else if：e≥1 与显式 μ=0 同时成立时只能进 EL，否则两条补偿通道各处理一遍。
  }
  return out;
}
function snapVelocities(pre){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i],b=B.mb;
    if(!b||B.dead||b.isStatic)continue;
    var e=pre[b.id];
    if(!e)e=pre[b.id]=[0,0,0];
    e[0]=b.position.x-b.positionPrev.x;      // 求解器视角的线速度
    e[1]=b.position.y-b.positionPrev.y;
    e[2]=b.angle-b.anglePrev;                // 求解器视角的角速度
  }
}
function impAt(b,dvx,dvy,dw){
  // 冲量同时写 velocity 与 positionPrev/anglePrev：Matter 用后者做积分与求解，
  // 前者是 Engine.update 末尾 _bodiesUpdateVelocities 同步出来的对外读数 —— 两边都改才自洽。
  b.velocity.x+=dvx;b.velocity.y+=dvy;b.angularVelocity+=dw;
  b.positionPrev.x-=dvx;b.positionPrev.y-=dvy;b.anglePrev-=dw;
}
// 圆的慢速撞击恢复补偿（circleRestitutionFix）。
// 根因（对照 Matter 0.20 Resolver.solveVelocity）：Z=(1+e)·U·Y 不判接近/分离，每轮都算：
//   · 快分支 U<u（u=-_restingThresh·l=-2×0.25=-0.5px/子步 = -120px/s）：normalImpulse=0，一次性全量反弹，干净；
//   · 慢分支（|U|<120px/s）：ni+=Z; ni>0⇒ni=0; Z=ni-ni_prev，没有分离判定，反弹后 U 反号、累加器往回吐，反弹被追回。
//   velocityIterations=8 ⇒ v→(−e)^8·v₀≈0.0054·v₀：80px/s 撞击后只剩 0.63px/s，球当场睡死（快球会弹、慢球急刹）。
// 修法：在 collisionStart（Pairs.update 之后、求解器之前）自己施加标准弹性冲量 j=−(1+e)·Un/(iA+iB)，
//   再把该 pair 本步 restitution 置 0 ⇒ 求解器看到「已在分离 + 累加器为 0」，无追回，e 精确兑现。
//   置 0 只影响本步：Pairs.update 每步从两个体重算 pair.restitution。
// 四条门控收窄作用面，缺一不可：
//   ① 只对 W 圆（wshape==='circle'）；② 高中 e=0 / e≥0.98（EL 有自己的补偿）跳过；
//   ③ 只修慢速撞击（8..120px/s），快分支本来就对，保既有标定；
//   ④ |Un| ≥ 0.5·|vRel|（正面撞）：沿曲面滚动换段的小法向分量（100px/s 滚过 5° 折角 ⇒ Un≈8.7px/s）不算碰撞，否则球面一路小跳。
var REST_FIX_HZ=240;        // 子步频率（1/s），与 stepMatter / substepGravityDelta 一致
var REST_FIX_VMAX=118;      // px/s：Matter 快分支门限 120 之下留 2px/s 余量
var REST_FIX_VMIN=8;        // px/s：低于此按静置处理（球贴地/贴壁的常态）
var REST_FIX_COS=0.5;       // |Un|/|vRel| 下限：正面撞击才算
function circleRestitutionFix(ev){
  if(!MW||!MW.engine||PHYS_MODE==='high')return;
  if(typeof window!=='undefined'&&window.__L&&window.__L.restFix===false)return;  // 探针 A/B 开关
  var list=(ev&&ev.pairs)||(MW.engine.pairs&&MW.engine.pairs.collisionStart);
  if(!list||!list.length)return;
  for(var pi=0;pi<list.length;pi++){
    var pr=list[pi];
    if(!pr||pr.isSensor||!pr.collision)continue;
    var col=pr.collision,n=col.normal;
    if(!n)continue;
    var mA=col.parentA||col.bodyA,mB=col.parentB||col.bodyB;
    if(!mA||!mB)continue;
    var BA=null,BB=null,Bc=null,i;
    for(i=0;i<bodies.length;i++){
      var X=bodies[i];
      if(!X||X.dead||!X.mb)continue;
      if(X.mb===mA)BA=X;else if(X.mb===mB)BB=X;
    }
    if(BA&&BA.kind==='W'&&BA.wshape==='circle')Bc=BA;
    else if(BB&&BB.kind==='W'&&BB.wshape==='circle')Bc=BB;
    if(!Bc||Bc.dead)continue;
    if(grab&&grab.kind==='body'&&(grab.obj===BA||grab.obj===BB))continue;
    var e=wEffE(Bc);
    if(!(e>0)||e>=0.98)continue;                    // 高中 0 / EL(e≈1) 走各自的既有通道
    var vax=mA.position.x-mA.positionPrev.x,vay=mA.position.y-mA.positionPrev.y,
        vbx=mB.position.x-mB.positionPrev.x,vby=mB.position.y-mB.positionPrev.y;
    var rx=vax-vbx,ry=vay-vby;                      // 接触点相对速度（px/子步）
    var Un=n.x*rx+n.y*ry;                           // <0 = 正在接近
    var spd=-Un*REST_FIX_HZ;                        // px/s
    if(spd<REST_FIX_VMIN||spd>REST_FIX_VMAX)continue;
    var vm=Math.sqrt(rx*rx+ry*ry);
    if(vm<=0||(-Un)<REST_FIX_COS*vm)continue;
    var ia=(mA.isStatic||mA.isSleeping)?0:mA.inverseMass;
    var ib=(mB.isStatic||mB.isSleeping)?0:mB.inverseMass;
    var den=ia+ib;
    if(!(den>0))continue;
    var j=-(1+e)*Un/den;                            // >0（Un<0）
    if(ia>0)impAt(mA,j*n.x*ia,j*n.y*ia,0);
    if(ib>0)impAt(mB,-j*n.x*ib,-j*n.y*ib,0);
    pr.restitution=0;                               // 本步求解器不再加自己的 e ⇒ 无 clawback
  }
}
// 圆的模式化摩擦（circleRollStep）：
//   高中：圆 = 质点，不自转（ω≡0）。触地点滑移恒等于平动速度，Matter 的 μ 通道全程按整体滑动摩擦作用（匀减速 a≈μg）。
//   大学：圆 = 刚体纯滚动（不打滑）：μ 是滚动阻力系数（a=μ_r·g，匀减速停下）；撞击造成的接触点滑移由本函数处理，
//         不靠 Matter 的库仑摩擦（它会啃平动）。
// 为什么需要（大学，R=72.325px，λ'=0.5 实测）：球以 500px/s 纯滚动撞右墙，反弹把 vx 翻成 −260（e=0.52），
//   墙接触点在腰部、力矩≈0，ω 几乎不变 ⇒ 触地点滑移 −757px/s，动摩擦 12 帧把平动啃到 −8px/s（解析 (2vx+ωR)/3），
//   反弹后只走 53px，表现为「先很快、一小段后骤降」。纯滚动语义下反弹是整体运动状态的反转，ω 必须跟着 v 走。
// 逐子步执行（与 elasticContactFix 同级）：碰撞注入的速度突变必须在下一子步前归位，否则被求解器当滑移啃掉。
//   ① 高中：ω 归零；② 倒着滚 ⇒ ω 跟随 v，平动不改；④ 滚动阻力 a=μ_r·g 沿切向反对滚动，ω 同步。
// ⚠ 单位：impAt 的实参是「每子步位移」口径（写进 positionPrev/anglePrev），mb.velocity / angularVelocity 是「每 1/60s」口径；
//   下次 Body.update 用 (position−positionPrev)×correction 重算速度，correction = _baseDelta/子步delta = 4，
//   所以 impAt(dv) 的持久效果是 Δvelocity = 4·dv。本函数的速度口径增量写进 impAt 前一律除以 SUBSC，
//   漏了就逐子步 ×(−3) 发散（ω 涨到 1e18）。circleRestitutionFix 的 Un 取自 position−positionPrev，本就是位移口径。
var ROLL_BACK_SLIP_ABS=15; // px/s：|滑移| 下限（慢速撞击也要管：34px/s 撞击的滑移仅 52px/s）
var ROLL_BACK_SLIP_REL=0.2;// 相对下限：|滑移| > 0.2·|v|（尺度无关）
var ROLL_RESIST_G=1;        // 滚阻标定：a = μ_r·g × 本系数（1 = 直接把 μ 当滚动阻力系数）
var ROLL_SUP_NY=0.3;        // 主接触必须「够像支撑面」：|n_y| ≥ 0.3（≈ 倾斜 ≤72.5°）
function circleRollBodies(){
  if(!MW)return null;
  var out=null;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B||B.dead||B.kind!=='W'||!B.mb||B.wshape!=='circle'||!B.rad)continue;
    if(B.mb.isStatic||B.fixed||B.mb.isSleeping)continue;
    if(grab&&grab.kind==='body'&&grab.obj===B)continue;
    (out||(out=[])).push(B);
  }
  return out;
}
// 子步前的平动速度快照，供 circleRollStep 度量本子步速度突变。
// 必须在 Engine.update 之前取（更新后已是碰撞后的速度，量不出接近速度）。
function circleRollSnap(list){
  if(!list)return;
  for(var i=0;i<list.length;i++){
    var B=list[i];
    if(!B||!B.mb)continue;
    var p=B._crPrev||(B._crPrev={x:0,y:0});
    p.x=B.mb.velocity.x;p.y=B.mb.velocity.y;
  }
}
function circleRollStep(list,dt){
  if(!list||!MW||!MW.engine)return;
  // 速度口径 → impAt（每子步位移）口径 的换算比（见函数上方「口径」注释）
  var SUBSC=(Matter.Common&&Matter.Common._baseDelta>0&&dt>0)
    ?(Matter.Common._baseDelta/(dt*1000)):1;
  if(!(SUBSC>0.1)&&!(SUBSC<-0.1))SUBSC=1;
  var pl=MW.engine.pairs.list,pln=pl.length,i,k;
  for(i=0;i<list.length;i++){
    var B=list[i],mb=B.mb,R=mb.circleRadius||0;
    if(!(R>0)||mb.isStatic||mb.isSleeping)continue;
    // ① 高中：圆是质点，不自转（ω≡0）；摩擦由 Matter 的 μ 通道按整体摩擦负责（滑移 = 平动速度 ⇒ 匀减速）。
    if(PHYS_MODE==='high'){
      if(mb.angularVelocity!==0)impAt(mb,0,0,-mb.angularVelocity/SUBSC);
      continue;
    }
    // 主接触 = 法向最「竖直」的那一对（最像地面的支撑）—— 地面+墙同时接触时取地面。
    var best=-1,ptx=0,pty=0,pnx=0,pny=0,pca=0,pcb=0,PO=null,PSt=false;
    for(k=0;k<pln;k++){
      var p2=pl[k];
      if(!p2.isActive||p2.isSensor||!p2.collision)continue;
      var a2=p2.bodyA,b2=p2.bodyB;
      if(a2!==mb&&b2!==mb)continue;
      var sp=p2.collision.supports;
      if(!sp||!sp.length)continue;
      var P=sp[0],rx=P.x-mb.position.x,ry=P.y-mb.position.y;
      var rl=Math.sqrt(rx*rx+ry*ry);
      if(rl<1e-6)continue;
      var nx2=rx/rl,ny2=ry/rl;
      if(Math.abs(ny2)<=best)continue;
      PO=(a2===mb)?b2:a2;PSt=!!(PO.isStatic||PO.isSleeping);
      best=Math.abs(ny2);pnx=nx2;pny=ny2;ptx=-ny2;pty=nx2;  // t = n 逆时针 90°
      pca=rx*pty-ry*ptx;                            // (r_A × t)_z（圆 ⇒ = R）
      pcb=(P.x-PO.position.x)*pty-(P.y-PO.position.y)*ptx;
    }
    // 主接触必须够像支撑面（|n_y| ≥ ROLL_SUP_NY）：撞墙时球被撞得微微离地，地面对可能不活跃，主接触落到墙上；
    // 墙接触点在腰部、切向竖直 ⇒ 无滑移目标 ω≈0，会把自旋整条归零、抹掉「倒着滚」特征，反弹后仍被摩擦啃掉 39%。竖直墙 |n_y|≈0，被排除。
    if(best<ROLL_SUP_NY||!PO)continue;
    // 本体的有效 μ（读数与物理同源）
    var mu=wEffMu(B);
    // 摩擦存在性闸门：pair.friction = min(A,B)，任一方为 0 就没有摩擦维持纯滚动。没有摩擦却强行不打滑 = 凭空注入转动能
    // （实测自旋峰值 0.13→0.66、12s 高度下沉 +3%→+12%）。μ_pair=0 时让位给「滑」，这正是光滑面的物理语义。
    var muP=Math.min(mu,(PO&&typeof PO.friction==='number')?PO.friction:mu);
    // 对方在接触点的速度（睡眠/静态体 = 0）
    var ovx=PSt?0:PO.velocity.x,ovy=PSt?0:PO.velocity.y,ow=PSt?0:PO.angularVelocity;
    // 无滑移目标 ω（纯滚动应有的自旋）与当前接触点滑移
    var wt=((ovx-mb.velocity.x)*ptx+(ovy-mb.velocity.y)*pty+ow*pcb)/pca;
    var slip=(mb.velocity.x-ovx)*ptx+(mb.velocity.y-ovy)*pty+mb.angularVelocity*pca-ow*pcb;
    // 判据 = 球在「倒着滚」（目标 ω 与实际 ω 反号）且滑移超过阈值：撞墙反弹的特征——平动被翻向，墙接触点在腰部、力矩≈0，ω 不动。
    // 不要用事件型判据：
    //   · 「滑移 > 固定阈值」：慢速撞击（34px/s ⇒ 滑移仅 52px/s）会漏掉；
    //   · 「本子步切向速度突变 > 阈值」：撞墙那一子步地面接触常不活跃，主接触落到墙上，切向投影≈0，漏判；
    //   · 「每子步施加静摩擦冲量消滑移」：与 Matter 在手绘复合体上的多接触约束打架，虚假自旋峰值 0.44→0.77。
    // 状态型判据：稳态（含笔画上的虚假自旋）自旋与平动同号，不触发；触发后 ω 写到无滑移值、滑移归零，自限。
    // 稳态滑移交给 Matter 的摩擦（它本身会把滑→滚收敛到纯滚动），这里只管撞击。
    // 滑移阈值必须尺度无关：max(ROLL_BACK_SLIP_ABS, ROLL_BACK_SLIP_REL·|v|)；写死 90px/s 时慢速撞击漏判，反弹速度被摩擦啃光。
    if(muP>0){
      var spd=Math.sqrt(mb.velocity.x*mb.velocity.x+mb.velocity.y*mb.velocity.y)*60;
      var thr=Math.max(ROLL_BACK_SLIP_ABS,ROLL_BACK_SLIP_REL*spd);
      if(wt*mb.angularVelocity<0&&Math.abs(slip*60)>thr){
        // ② 倒着滚：ω 跟随 v，平动（碰撞刚给的）不改，只把 ω 重算到纯滚动值
        impAt(mb,0,0,(wt-mb.angularVelocity)/SUBSC);
      }
    }
    // ④ 滚动阻力 a = μ_r·g：沿切向反对滚动，ω 同步（保住纯滚动 ⇒ 球匀减速自然停下）。
    //    只写球、不写对方 —— 滚阻是变形耗散，不是接触力对；写对方会把下面的板凭空推走。
    if(mu>0&&Math.abs(pca)>1e-9){   // mu 已在本函数上方算过（同为 wEffMu 口径）
      var vr=(mb.velocity.x-ovx)*ptx+(mb.velocity.y-ovy)*pty-ow*pcb;   // 球心相对接触面的切向速度
      var dv=mu*GRAV*dt/60*ROLL_RESIST_G;                              // px/s² → velocity 口径
      if(dv>Math.abs(vr))dv=Math.abs(vr);                              // 不许冲过零
      if(dv>0){
        var sg=-(vr>0?1:-1)*dv;
        impAt(mb,sg*ptx/SUBSC,sg*pty/SUBSC,-sg/(pca*SUBSC));
      }
    }
  }
}
function elasticContactFix(pre,EL){
  // 守恒预算：多对同时接触时（手绘开链贴地的常态，每条贴地段与地面各成一对）逐点镜像会累加超调——
  // 每个点的补入都 ≤ 它自己的入射量，但 N 个接触共享同一份入射动能，加起来会超过它（实测越弹越高、飞出屏幕顶）。
  // 所以本子步允许注入的动能上限 = 子步前总动能 KE0；预算耗尽就按精确公式截断成部分反射
  // （N 点同时全镜像是超定的，部分反射才是一致解）。下一子步重计预算；单接触时 s 恒为 1，等同逐点镜像。
  // 先补本子步重力增量，让 vr0 与求解器实际看到的一致（见 ECF_GRAV_COMP）。pre 里只有动态体（snapVelocities 跳过 isStatic），
  // 双方都动态时增量为共模、在 vr0 中抵消；一边静态时正是求解器多看到的那一份。
  // EL_Z（μ=0 体）走速度大小恢复路径，需要清洁预算：下落阶段重力注能会让 budget=KE0−KEcur 偏紧（KEcur 含 1× 重力增益），
  // 清洁口径把 μ=0 球凹槽滚动 7s 衰减从 -27% 拉到 -1.18%。raw = 未加重力补偿的快照；gravGain = 本子步真实重力动能增量（1×）。
  var KE0=0,KEcur=0,i5,b5,KE0raw=0,gravGain=0,gdS2=0,raw=null;
  if(EL_Z.length){
    gdS2=substepGravityDelta();
    raw={};
    for(var gk0 in pre)raw[gk0]=[pre[gk0][0],pre[gk0][1],pre[gk0][2]];
  }
  if(ECF_GRAV_COMP>0){
    var gd=ECF_GRAV_COMP*substepGravityDelta();
    if(gd!==0){for(var gk in pre)pre[gk][1]+=gd;}
  }
  for(i5=0;i5<bodies.length;i5++){
    b5=bodies[i5].mb;
    if(!b5||b5.dead||b5.isStatic)continue;
    var e5=pre[b5.id];
    if(e5)KE0+=0.5*b5.mass*(e5[0]*e5[0]+e5[1]*e5[1])+0.5*b5.inertia*e5[2]*e5[2];
    if(raw){
      var er=raw[b5.id];
      if(er){
        KE0raw+=0.5*b5.mass*(er[0]*er[0]+er[1]*er[1])+0.5*b5.inertia*er[2]*er[2];
        gravGain+=0.5*b5.mass*(2*er[1]*gdS2+gdS2*gdS2);
      }
    }
    var vx5=b5.position.x-b5.positionPrev.x,vy5=b5.position.y-b5.positionPrev.y,
        w5=b5.angle-b5.anglePrev;
    KEcur+=0.5*b5.mass*(vx5*vx5+vy5*vy5)+0.5*b5.inertia*w5*w5;
  }
  var budget=KE0-KEcur;                  // 还允许注入多少动能（负 = 已经超额，只许再减）
  var budgetClean=raw?KE0raw-KEcur+gravGain:budget;   // 清洁口径：真实求解器损耗
  var inZDone={};                        // 每子步每体只处理一次（凹槽多段同时接触时防过度修正）
  var list=MW.engine.pairs.list;
  for(var i=0;i<list.length;i++){
    var pr=list[i];
    if(!pr.isActive||pr.isSensor)continue;
    var col=pr.collision,A=col.parentA,B=col.parentB;
    var inEL=EL.indexOf(A)>=0||EL.indexOf(B)>=0;   // 用户声明 e≥1 的体
    var inZ=EL_Z.indexOf(A)>=0||EL_Z.indexOf(B)>=0; // μ=0 极值体
    if(!inEL&&!inZ)continue;
    // μ=0 极值体（EL_Z）不查 pair.restitution（⑥ 置 1 在帧末才执行，子步内看到的仍是出厂值），名单本身就是判据。
    // 地面/墙门：μ=0 方块落地面保持衰减弹跳，只有场上物体之间的曲面接触才补偿。
    if(inEL&&pr.restitution<0.999)continue;        // EL 场景：求解器子步内真按 e≥1 解（原语义）
    if(!inEL&&(A===MW.ground||A===MW.wl||A===MW.wr||A===MW.wt||B===MW.ground||B===MW.wl||B===MW.wr||B===MW.wt))continue;
    // 贴合滑动接触的 vr 只有 ~0.01 量级（VR_EPS=0.002 会把它们全当「没在接近」）——
    // EL_Z 场景放宽到 0.0005，让双接触接缝处的微干涉也能被预算机制精确补偿。
    var eps=inZ?0.0005:VR_EPS;
    // 字段名：Matter 0.20 求解器读的是 pair.contacts / pair.contactCount，activeContacts 是旧版命名。
    var cts=pr.contacts||pr.activeContacts;
    var ct=cts&&cts.length?cts[0]:null;
    if(!ct)continue;
    var n=col.normal,v=ct.vertex;
    var rAx=v.x-A.position.x,rAy=v.y-A.position.y;
    var rBx=v.x-B.position.x,rBy=v.y-B.position.y;
    var pA=pre[A.id]||[0,0,0],pB=pre[B.id]||[0,0,0];
    var vr0=n.x*((pA[0]-rAy*pA[2])-(pB[0]-rBy*pB[2]))
           +n.y*((pA[1]+rAx*pA[2])-(pB[1]+rBx*pB[2])); // 子步前接触点法向相对速度
    // μ=0 滑动接触的 vr0≈0（贴着表面滑），但曲面分段的方向离散仍每子步杀速；用「接近」门会挡掉大部分 inZ 接触
    // （实测 85%，补偿只覆盖 ~20%）。所以 inZ 路径改用速度本身判静置（见下方 s0 门），EL 镜面路径保留「接近」门。
    if(vr0>=-eps&&!inZ)continue;                         // 不在接近 → 不管（仅 EL 镜面路径）
    var aAx=A.position.x-A.positionPrev.x,aAy=A.position.y-A.positionPrev.y,aAa=A.angle-A.anglePrev;
    var bBx=B.position.x-B.positionPrev.x,bBy=B.position.y-B.positionPrev.y,bBa=B.angle-B.anglePrev;
    var vr1=n.x*((aAx-rAy*aAa)-(bBx-rBy*bBa))
           +n.y*((aAy+rAx*aAa)-(bBy+rBx*bBa));         // 子步后
    if(inZ){
      // ---- EL_Z：每体总速率恢复（受预算限制）+ 棘轮钳制，弹跳/滑动一视同仁 ----
      // budgetClean = KE0raw − KEcur + gravGain，gravGain 恰为本子步重力动能增量 ½m(2·vy·gdS2+gdS2²)，
      //   ⇒ budgetClean = 无摩擦时应有动能 − 实际动能 = 能量亏损。求解器对 μ=0 体只应移除法向重力分量
      //   （法向力对刚体面不做功），但 Baumgarte 位置修正会额外吃掉切向能量，表现为 budgetClean>0，恢复即可。
      // 不按「是否弹跳」设门：凹槽里的球始终在滑动，带弹跳门时补偿从不触发。dKE>0 时受预算限制恢复，dKE<0 时钳制。
      // 方向沿求解器后速度 (qx,qy) 缩放（方向已由求解器处理），只补幅度；inZDone 防凹槽多段同时处理同一体导致累加超调。
      // 静置门：s0 < 2·gdS2 跳过（只受重力压在面上，无真实运动）。
      // 已知限制（未修）：曲面上仍慢速漏能（实测 9s 摆幅 弧 −33%、凹槽 −61%），预算几乎总在 ~1e-12 被掐断。
      //   恢复目标是自由落体速度幅度 s0=|v_raw+(0,gdS2)|，在斜坡/凹面上重力有切向分量、自由落体速度大于约束速度，
      //   过度补偿与求解器损耗互相抵消。去掉预算门全额恢复无净收益（在夹具抖动带内），且预算是不变式，不要去掉。
      //   正解方向：恢复目标改成切向速度（求解器对 μ=0 的切向冲量与法向无关），法向交给 rest=1 的求解器。
      var bodies2=[];
      if(!A.isStatic)bodies2.push(A);
      if(!B.isStatic)bodies2.push(B);
      for(var bi=0;bi<bodies2.length;bi++){
        var bd=bodies2[bi],pe=raw[bd.id]||[0,0,0];
        if(inZDone[bd.id])continue;
        var pvx=pe[0],pvy=pe[1]+ECF_Z_GCOMP*gdS2;
        var s0sq=pvx*pvx+pvy*pvy;
        if(s0sq<gdS2*gdS2*4)continue;             // 静置: s0≈gdS2 → 跳过
        var qx=bd.position.x-bd.positionPrev.x,qy=bd.position.y-bd.positionPrev.y;
        var s1sq=qx*qx+qy*qy;
        if(s1sq<1e-18)continue;
        var s0=Math.sqrt(s0sq),s1=Math.sqrt(s1sq);
        var KE0b=0.5*bd.mass*s0sq;
        var KE1b=0.5*bd.mass*s1sq;
        var dKE=KE0b-KE1b;
        if(Math.abs(dKE)<1e-12)continue;
        inZDone[bd.id]=true;
        if(dKE>0){
          // 能量减少：受预算限制恢复（弹跳/滑动均恢复，budgetClean 已扣除重力分量）。曲面漏能的已知限制见上方注释。
          var cap=Math.max(0,budgetClean);
          if(cap<=1e-12)continue;
          var tf=Math.min(1,cap/dKE);
          var sf=Math.sqrt(KE0b/KE1b);
          var es=1+tf*(sf-1);
          budget-=tf*dKE;budgetClean-=tf*dKE;
          impAt(bd,qx*(es-1),qy*(es-1),0);
        }else{
          // 能量增加(棘轮):钳制到 s0(不限预算,增预算)
          var sf2=Math.sqrt(KE0b/KE1b);
          budget-=dKE;budgetClean-=dKE;
          impAt(bd,qx*(sf2-1),qy*(sf2-1),0);
        }
      }
      continue;
    }
    if(vr1<=eps)continue;                                // 求解器没把它弹开（静置/仍在压入）→ 不管
    var d=(-vr0)-vr1;                                    // 目标 = 入射值的镜像（完美反射）
    if(Math.abs(d)<eps)continue;
    var ima=A.isStatic?0:A.inverseMass,imb=B.isStatic?0:B.inverseMass;
    var iia=A.isStatic?0:A.inverseInertia,iib=B.isStatic?0:B.inverseInertia;
    var X=rAx*n.y-rAy*n.x,Q=rBx*n.y-rBy*n.x;            // cross(r,n)
    var K=ima+imb+iia*X*X+iib*Q*Q;                      // 接触点法向有效质量倒数
    if(K<=1e-12)continue;
    var J=d/K;
    // 守恒预算：施满 J 的精确动能增量 dke=(vr0²−vr1²)/2K；超出预算就求部分系数
    // s（ΔKE(s·J)=budget 的正根，s∈(0,1) = 部分反射），冲量按 s·J 施加。
    var dke=(vr0*vr0-vr1*vr1)/(2*K);
    if(dke>budget){
      if(budget<=1e-12)continue;         // 预算耗尽：这一子步不再注入，只保留求解器自己的结果
      var sB=(-vr1+Math.sqrt(vr1*vr1+2*budget*K))/d;   // s·d·(2vr1+s·d)/2K = budget 的正根
      if(!(sB>0&&sB<1))continue;
      J*=sB;
      dke=sB*d*(2*vr1+sB*d)/(2*K);
    }
    budget-=dke;                         // 负 dke（削超额）会反过来把预算加回来 —— 与 KEcur 一致
    impAt(A, n.x*J*ima, n.y*J*ima, iia*J*X);
    impAt(B,-n.x*J*imb,-n.y*J*imb,-iib*J*Q);
  }
}
