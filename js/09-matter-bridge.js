/* 工具栏状态、Matter 刚体桥接、弹性接触守卫（原 index.html 第 12526–13839 行） */
/* ================= R47: TOOL PALETTE =====================================================
 * A dropdown at the top-left corner reveals a row of three icon tools:
 *   ① 公式示例 — a menu centred on the screen listing every ready-made WHOLE; clicking one
 *                materialises it dead centre of the canvas.
 *   ② 画笔     — freehand: draw a black "weighty boundary".
 *   ③ 预设物体 — the same boundary, dragged out as a rectangle / circle / triangle.
 *
 * WHAT "有重量" MEANS HERE (the user's own definition):
 *   "会根据其自身重量分布而往哪边倒" — the shape TIPS OVER about its lowest contact point under
 *   its own gravity torque, so an off-centre mass distribution topples it. That is the whole
 *   point of the feature and it is the one thing B/E/q/I do NOT do.
 *
 *   AND IT FALLS. Weight means weight: an unsupported boundary drops under gravity, lands on the
 *   ground / a rod / another boundary and stops there. Its weight is spread ALONG THE LINE
 *   (B.bndM = the line's total length, B.bndI = the line's second moment — see mkBoundary),
 *   never over the enclosed area, because "画出的只是线条，不要填充里面的，只有线条是边界".
 *
 * WHAT "没有惯性，只能被拖动，就和 B 和 E 一样" MEANS:
 *   Nothing but the drag and gravity ever moves a boundary: the fields ignore it (stepField), a
 *   gravity well ignores it (stepGravity only ever touches kind==null) and a collision never
 *   flings it — collideBodies only kills its inward velocity and pushes it back out of something
 *   it fell into. There is no horizontal inertia at all (vx is pinned to 0), it never bounces
 *   (bounc=0) and it keeps no velocity after you let go. An anvil, not a projectile — but it will
 *   not stay standing the way you left it, and it will not hang in mid-air either.
 *
 * WHAT "连续绘制，取消勾选才结束" MEANS (R53):
 *   Picking 画笔 or a 预设物体 arms a MODE that stays on: every stroke / every shape you draw
 *   lands as its own boundary and the tool remains ready for the next one (finishStroke /
 *   finishShapeDrag no longer drop the mode). Clicking the same tool button again (or the
 *   ／ shape toggle) un-arms it and the canvas goes back to grabbing.
 */
var TOOL={open:false,mode:null,shape:'rect',stroke:null,drag:null,
          device:'spring',  // R96：当前选中的器件（与 shape 同构；器件模式下点画布就放它）
          devDrag:null,     // R96：从器件面板拖出来时跟着指针走的落点（{id,x,y,over}）
          cont:false,     // R57（用户 #1）：true = 连续绘制（双击进入），false = 只画一次（单击）
          armedKey:null,  // 当前武装的是哪个按钮（'brush' / 'shape:rect'…），双击判定要它
          lastTap:0};     // 上一次点同一个按钮的时间戳
// R57（用户 #1）：「点一下就是只画一次，双击就是固定（一直画），再点一下才取消」。
// 实现要点：第一次点立刻武装（不延迟——若等双击判定窗口过去再武装，点一下就要等 330ms 才
// 能用，手感很差）。第二次点在窗口内则把同一把工具升级成连续；超出窗口再点则是取消。
var TOOL_DBL_MS=330;
var tToggle=document.getElementById('ttoggle'),tRow=document.getElementById('trow'),tSub=document.getElementById('tsub');
// R96：器件行（#dsub）的引用。与 #tsub 分开放：syncToolUI 里 `tSub.querySelectorAll('.tbtn')` 只该扫
// 形状 chip，若把器件 chip 并进 tSub，它会被当成形状按钮去比对 data-shape（恒 null）⇒ 永远不高亮。
var dSub=document.getElementById('dsub');
var fmenu=document.getElementById('fmenu'),fmask=document.getElementById('fmask'),
    fmgrid=document.getElementById('fmgrid'),fmclose=document.getElementById('fmclose');
var BND_HH=3.0;         // 基础常量（历史名）。屏幕上墨迹的**线宽**由它派生：lineWidth = BND_HH*1.55
// R71⑦（用户：「圆弧碰撞箱和笔画不一样，一端对准地面时小球经过会弹一下」）：
// 这里是**同一个墨迹厚度被写成了两个数**——渲染用 BND_HH*1.55（=4.65px 线宽，半厚 2.325），
// 物理却到处直接用 BND_HH（=3.0，半厚 3.0）。于是每一笔画、每一道轮廓的碰撞体都比看得见的
// 那条线**胖 0.675px**，端点处还额外外延 3px（见 mkBoundary 开链分支）。
// 「碰撞箱和笔画不一样」不是错觉，是常量分叉。修法：立一个唯一真源 BND_INK，物理一律用它，
// 与渲染表达式同源，从此两者不可能再漂移。
var BND_INK=BND_HH*1.55/2;   // 屏幕上墨迹的**半厚**（px）—— 画多粗就撞多粗
var PEN_HW=BND_INK;     // 画线半厚 == 图形半厚 == 墨迹半厚（用户：画的线要和图形一样细）
var PEN_MAX=90;         // most segments one pen stroke may carry (keeps the collision pass cheap)
var BND_MIN_LEN=50;     // shorter than this and there is no line to speak of -> not a body
// R57：与「墙」的接触在多大相对法向速度以下算「静止接触」（此时恢复系数按 0 处理）。
// 一帧重力给物体加上的速度是 GRAV*dt ≈ 43px/s，所以静止接触的 vn 就在这个量级；
// 10px 高的自由落体落地速度约 228px/s，远在门限之上——真正的撞击照旧反弹。
var W_BOUNCE_MIN=140;
// R57：边界（W）的「真实速度」死区。Matter 对静置的多段复合体会有 1px 级求解器跳变，
// 1.2px/帧 ≈ 72px/s，差分成速度后足以把压在弧上的物体顶飞。边界是「没有惯性、只能被拖动」
// 的铁砧，这种亚像素数值抖动一律当静止。真正下落/被拖动时速度远大于 120px/s，不受影响。
var W_V_DEAD=120;

/* ---- the Matter layer: REAL rigid-body physics for boundaries --------------------------
   The hand-rolled quasi-static topple (rotate about the lowest contact, torque vs parallel-axis
   inertia) could make a lopsided outline TIP, but it could not give the tip ANGULAR MOMENTUM:
   no tumbling, no rocking onto an edge and settling, no momentum carried through a collision —
   which is exactly what "heavy like a real object" means (the draw-a-line-to-save-the-dog kind
   of physics). So boundary bodies now live in an embedded Matter.js world (same engine class the
   drawing-physics games use): a sequential-impulse solver with friction, stacking, sleeping.
   The formula letters keep their own hand-rolled physics (fields, shatter, black holes...) and
   still collide against a boundary's edges through bndHit below; the t-rod is mirrored into the
   Matter world as a kinematic static plank so a line can land on it. Gravity is matched:
   Matter accelerates bodies at gravity.y*1000 px/s^2, so 2.6 == GRAV (2600). */
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
  /* ★★R132-9r（用户：「这个物体怎么我摩擦力调成 1 了，怎么还和之前一样缓慢下滑，
   *   怎么感觉这个摩擦力系数没用似的」）。
   *  ★先纠正 R132-9n 的一处理解错误：**天花板不是 `friction`**。
   *    `Body.setStatic`（`isStatic:true` 时 Matter 内部会调）会把 `part.friction` 覆写成 **1**，
   *    所以 `friction:0.6` 这个选项**根本没生效**（实测 `MW.ground.friction === 1`），
   *    `pair.friction = min(μ, 1) = μ` ⇒ 动摩擦一路都跟着 μ 走，**没有被截顶**。
   *  ★真正的天花板是 `frictionStatic`：Matter 的 `Body.setStatic` **不动它** ⇒ 静态框留在
   *    默认 **0.5**；而配对规则两边都取 min（本项目 R68 起 `frictionStatic` 也取 min），
   *    体侧写的是 0.6 ⇒ `pair.frictionStatic = min(0.6, 0.5) = 0.5` —— **恒定、与 μ 无关**。
   *    静摩擦咬合在低速段主导（实测：μ=0.05/0.3/0.5/0.6/0.7/1.0 的滑行距离
   *    72.1/31.5/26.1/23.8/22.7/20.4px，从 μ=0.3 到 1.0 只差 1.55×，远小于 1/μ 的 3.3×）
   *    ⇒ 用户观感就是「μ 调到很大也没区别」。
   *  修法（两处缺一不可，且**只放开 μ>0.6**，默认手感一格不动）：
   *    ① 静态框的 `frictionStatic` 显式给 **1**（`friction` 不用动，setStatic 已经给 1）；
   *    ② 物体侧 `frictionStatic` 在 μ>0.6 时跟随 μ（这正是 R132-9n 注释里写的意图，
   *       当时代码落成了 `(v===0)?0:0.6`）；μ≤0.6 仍取 0.5 ⇒ `pair` 与改动前**逐位相同**。 */
  var ground=Matter.Bodies.rectangle(W/2,groundY+400,W+400,800,{isStatic:true,friction:0.6,frictionStatic:1,label:'ground'});
  var wl=Matter.Bodies.rectangle(-300,groundY/2,600,groundY*2+800,{isStatic:true,frictionStatic:1,label:'wl'});
  var wr=Matter.Bodies.rectangle(W+300,groundY/2,600,groundY*2+800,{isStatic:true,frictionStatic:1,label:'wr'});
  /* ★★R131-64（用户：「天花板怎么没有边界？天花板也是一面墙」）：
   *  原来只有「地面 + 左右两面离屏墙」——**顶部是敞开的**，而 walls(B) 的顶部夹子
   *  （`if(cyp-hh<-8){…}`，见该处注释）只对**公式体**生效，W 体在 stepPhysics 里
   *  被 `if(B.kind==='W')continue;` 整段跳过 ⇒ 画出来的物体（图形/风/绳/杆的宿主）
   *  一旦获得足够向上的速度就真的飞出世界、再也回不来（REC 里就发生过）。
   *  修：补上**和左右墙同款**的离屏静态顶墙 wt —— W 体与公式体都吃 Matter 碰撞，
   *  与用户「天花板也是一面墙」的表述一致（是挡板，不是左上那种自动回推）。
   *  尺寸/位置与 wl/wr 同口径（厚 600、纵向跨 2*groundY+800），中心压在画布上方
   *  离屏处 ⇒ 内缘 y = wtY+300，`resize()` 每帧按 H 同步 ⇒ 内缘恒 = -(BND_INK+CEL_INSET)。 */
  var wtY=celCenterY();
  var wt=Matter.Bodies.rectangle(W/2,wtY,W+400,600,{isStatic:true,frictionStatic:1,label:'wt'});
  Matter.Composite.add(E.world,[ground,wl,wr,wt]);
  MW={engine:E,wLayer:wLayer,ground:ground,wl:wl,wr:wr,wt:wt,acc:0};
  // ★R119：圆的恢复系数补偿挂在 collisionStart 上 —— 这是 Pairs.update 之后、位置/速度
  // 求解器**之前**的唯一窗口（此时 positionPrev 还是撞击前的，改完求解器才看到新速度）。
  Matter.Events.on(E,'collisionStart',circleRestitutionFix);
  /* ★★R132-9v：自算库仑摩擦挂在**引擎的 afterUpdate** 上，而不是产品的子步循环里 ——
     挂在子步循环里有一个致命洞：任何**直接调 `Matter.Engine.update`** 的代码路径
     （`_probe_r75/76` 等探针、以及任何绕开 `stepMatter` 的推进）根本不会经过那里
     ⇒ 那条路上 `mb.friction` 已被我们置 0（Matter 通道关掉）⇒ **一个体都摩擦不到**
     （实测 `_probe_r75.py` E3：μ=0/0.1/0.25/0.5 滑行距离全是 360.0px，零减速）。
     挂到事件上之后，「凡是 Matter 推进一步」就一定有一次自算摩擦。 */
  Matter.Events.on(E,'afterUpdate',function(){ try{wfSelfFriction(ROD_SUB_DT);}catch(e){} });
}
function removeMatterBody(B){
  if(B.mb&&MW){Matter.Composite.remove(MW.wLayer,B.mb);}
  B.mb=null;
  /* ★R131-14：弹簧的端帽体随宿主一起清（否则删弹簧后留下隐形碰撞体） */
  if(B._cap){for(var ci=0;ci<2;ci++){if(B._cap[ci]&&MW){Matter.Composite.remove(MW.wLayer,B._cap[ci]);}}
    B._cap=null;}
}
function rebuildWBody(B,thOpt){
  // 几何被编辑（弧端点手柄）后重建 Matter 复合体。注意 buildMatterBody 会把 fixed 复位，
  // 重建前后要保持固定态（setStatic），否则一编辑就掉下去。
  // R57（用户 #2）：拖端点手柄期间整条弧处于「编辑固定」态（B.editLock），重建后也要保持
  // static，否则每帧 arcResample -> rebuild 都会造出一个新的动态体，弧会在拖动中往下掉。
  // R75：thOpt = 重建完成后的**目标姿态**。buildMatterBody 内部要在 th=0 下建体（bndPts 的
  // 约定），但它同时要用这个真实姿态把「原点重定位的世界位移」换成本地位移 —— 旧版没有这条
  // 通路，只能靠 th=0 的巧合（见 buildMatterBody 里 R75 的注释）。
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
// ---- 圆弧（R56 PPT 语义）：端点手柄的几何 ----------------------------------------------
// 椭圆锚定在body 本地系里的 (lcx,lcy)，随body 平移/旋转。端点世界坐标 = B 原点 + 旋转(lc + 极坐标)。
function arcWorldCenter(B){
  var e=B.ell,c=Math.cos(B.th||0),s=Math.sin(B.th||0);
  return {x:B.x+e.lcx*c-e.lcy*s,y:B.y+e.lcx*s+e.lcy*c,c:c,s:s};
}
function arcEndWorld(B,which){
  var e=B.ell,wc=arcWorldCenter(B),a=(which===0)?e.a0:e.a1;
  var ex=e.lcx+Math.cos(a)*e.rx,ey=e.lcy+Math.sin(a)*e.ry;
  return {x:B.x+ex*wc.c-ey*wc.s,y:B.y+ex*wc.s+ey*wc.c};
}
// R75（用户⑫：「弧的 90° 吸附偏移了」）：吸附的**共同口径**——世界系。
// 旧版在 body 本地参数角上做吸附，弧自转过 th 后吸的就是「跟着体斜过去的 0/90/180/270」，
// 而旋转手柄吸的是 th 本身（世界系）。两个辅助函数把口径统一到世界系：
//   arcEndWorldAng  端点相对椭圆圆心的**世界**方向角（= 本地几何方向角 + th）
//   arcParamFromWorldAng  把任意世界方向角换算成该椭圆上的参数角（pa=atan2(ly/ry,lx/rx) 的逆）
// rx==ry（R69 起弧恒为正圆）时两者互为 ±th 的平移，公式自动退化。
function arcEndWorldAng(B,which){
  var e=B.ell,a=(which===0)?e.a0:e.a1;
  return Math.atan2(Math.sin(a)*e.ry,Math.cos(a)*e.rx)+(B.th||0);
}
function arcParamFromWorldAng(B,worldAng){
  var e=B.ell,b=worldAng-(B.th||0);
  return Math.atan2(Math.sin(b)/e.ry,Math.cos(b)/e.rx);
}
function arcSetAngle(B,which,na){
  // 拖端点手柄：把指针角写入 a0/a1。扫过角限幅 [0.15, 2π-0.06]——太短没有意义，
  // 整圆则和「圆」工具重复。
  // R57（用户 #3）：展开的参考点必须是**这个端点自己的当前值**，不能是另一端点。
  // 旧代码用 ref=另一端点 + shortAng()，shortAng 把差值折到 (-π,π]，于是扫过角永远 ≤180°：
  // 一旦拖过 180°，差值符号翻转，弧「跳回原点变成小小的一截」。以自身当前值为基准展开，
  // 每次拖动累积增量，就能连续转过 180°（上限 2π-0.06，由下面的 clamp 保证）。
  var e=B.ell,cur=(which===0)?e.a0:e.a1;
  na=cur+shortAng(na-cur);
  var MIN=0.15,MAX=Math.PI*2-0.06;
  if(which===0){e.a0=Math.min(Math.max(na,e.a1-MAX),e.a1-MIN);}
  else{e.a1=Math.min(Math.max(na,e.a0+MIN),e.a0+MAX);}
  arcResample(B);
}
function arcResample(B){
  // R75（用户⑫：「弧的 90° 吸附偏移了」的**真凶**）：旧版这样算世界点 ——
  //     world.push([wc.x+cos(a)*rx, wc.y+sin(a)*ry]);
  // 半径向量**没有跟着刚体姿态转**（漏了 R(th)）。而 arcResample 是「世界 -> 本地」再回写的，
  // 于是算出来的本地 pts 是 R(-th)·polar 而不是 polar，渲染时再乘 R(th) 恰好抵消 ——
  // 屏幕上那条弧的**世界方向角就是 a0/a1 本身**，可端点手柄 / arcEndWorld / 吸附算的却是
  // a+th（它们都乘了 R(th)）。两边差一个 th：弧一旦自己转过角度，黄点手柄就浮在弧身旁边，
  // 拖上去吸附自然「偏移」（`_diag_r76_arcsnap.py` 用例 B 实测：世界角 − 参数角 = 恰好 th）。
  // 修法：根本不必绕世界系 —— 本地坐标 = lc + (rx cos a, ry sin a)，与 th 无关，
  // 一行直出，且与 arcEndWorld/arcWorldCenter 的定义天然自洽（wc = B.x + R(th)·lc）。
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
  // 建体必须在 th=0 下做；姿态通过 rebuildWBody 的第二个参数带进去，由 buildMatterBody
  // 负责「本地位移换算 + 建完恢复姿态」，这里不再自己零/还原。
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
// R64：把 W 体上用户调过的质量乘数（mMul）与摩擦系数（wFrict）应用到 Matter 体上。
// buildMatterBody 的所有路径（新建 / rebuildWBody 弧编辑重建 / 复制）最后都走这里，
// 保证「重建一个体」不会把用户调好的参数悄悄洗回默认值。
function applyWMul(B){
  if(!B.mb)return;
  if(B.mMul&&B.mMul!==1){
    B.mass=B.mMul;
    if(B._natMass&&!B.mb.isStatic)Matter.Body.setMass(B.mb,B._natMass*B.mMul);
  }
  applyWFrict(B);
  applyWBounc(B);
  applyEffRest(B);     // R74-D/J：高中模式默认弹性全 0 —— effRest 读 PHYS_MODE（applyWFrict/applyWBounc 有 null 守卫不调它，默认体也要刷）
}
/* ★★R132-9v：**自算的库仑摩擦**（逐子步，调用点在 `stepMatter` 的子步循环里、
 *   紧跟 `Matter.Engine.update` 之后 —— 那时本子步的接触对表才是新的）。
 *   口径：`dv = μ · g · dt`（**与质量无关**，滑行距离 ∝ 1/μ），方向恒与当前速度相反；
 *   `k` 不超过当前速度（**只刹到停、不反向**，静摩擦由接触求解器自己处理）。
 *   只处理「本子步有活动接触」且「用户显式调过 μ」的 W 体（`_ownFric`）⇒ 其余体零开销、零影响。 */
function wfSelfFriction(dt){
  if(!MW||!MW.engine)return;
  var list=MW.engine.pairs.list,any=0,i,k,B,pr;
  for(i=0;i<bodies.length;i++)if(bodies[i]&&bodies[i]._ownFric){any=1;break;}
  if(!any)return;
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(!B||B.dead||B.kind!=='W'||!B.mb||B.mb.isStatic||!B._ownFric)continue;
    var mu=B.wFrict;
    if(!(mu>0))continue;                       // μ=0 = 真正光滑（R76 语义）
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
    /* ★单位换算（Matter 0.19 `Body.update`：`velocity` = 每子步位移 px/子步，
       重力项是 `(force/mass)·deltaTime²`）⇒ 物理减速度 a=μ·g 折算到存储口径要乘 **dt²**
       （先 px/s→px/子步，再 px/子步→"每子步的位移"）。
       校核：μ=1、v0=500px/s ⇒ kk=0.04514 px/子步 ⇒ 停时 2.083/0.04514=46 子步=0.192s
       ⇒ 滑行 500·0.192/2 = **48px** = 教科书 v²/(2μg) ✔（第一版写成 μ·g·dt ⇒ 大了 240 倍，
       实测 4 帧就停住）。 */
    var kk=mu*GRAV*dt*dt;
    if(kk>sp)kk=sp;
    var ux=v.x/sp,uy=v.y/sp;
    /* ★★Matter 0.19 的 `Body.setVelocity(body, v)`：**入参是 `_baseDelta`(16.667ms) 单位**，
       内部会乘 `body.deltaTime / Body._baseDelta`（我们子步 delta=4.1667 ⇒ **0.25**）再存。
       而 `body.velocity` 读出来是**每子步位移(px/子步)**。两个口径差一个 0.25 ——
       不补这因子，实测减速度只有 μ·g 的 **1/4**（μ=1 反推 a=646px/s²=0.25g）。
       用 Matter 自己的换算因子，别写死 4。 */
    var _bd=(typeof Matter!=='undefined'&&Matter.Body&&Matter.Body._baseDelta)||16.6667;
    var _ts=(B.mb.deltaTime||_bd)/_bd;
    if(!(Math.abs(_ts)>1e-6))_ts=1;
    var kIn=kk/_ts;
    Matter.Body.setVelocity(B.mb,{x:v.x-ux*kIn,y:v.y-uy*kIn});
  }
}
function applyWFrict(B){
  if(!B.mb)return;
  // R65 修复（全量回归抓到的真 NaN）：wFrict 为 null（用户没调过）时**绝不能**写
  // mb.friction —— friction=undefined 会进求解器算成 NaN，物体位置直接飞出屏幕
  // （实测弧 y 飘到 -668 万、球速度衰减测试崩盘）。没调过 = 保留 buildMatterBody 的默认值。
  //
  // R76（用户①「高中模式下默认摩擦系数为 0」）：高中模式下**未调过**的体也必须真写 0 ——
  // 旧版在这里对 wFrict==null 直接 return，于是只改了 wEffMu（面板读数），mb.friction 还是
  // buildMatterBody 给的 0.08、pair 仍按 min(0.08,0.6)=0.08 咬合。「读数 0 而运动照旧有摩擦」
  // 正是用户会一眼看穿的假象，所以读数与物理必须同源。
  //
  // R89（用户⑥「高中→大学往返后调 μ/e 全没效果」）：大学模式下**未调过**的体也不能早退 ——
  //   往返链路：切高中时 mb.friction 被写成 0（上条 R76 语义）；切回大学时 v=null 早退，
  //   mb.friction / frictionStatic 就**永远留在 0**（诊断 _diag_r89a_modefric 实测：往返后
  //   未调过的体 mb f=0/fs=0/r=0/air=0 全是高中残留，面板却显示 0.08 —— 两张皮）。更糟的是
  //   frictionStatic=0 会让 pair fs 钉在 0，低速咬合全失效，「调什么都像没调」。修法 =
  //   大学模式按 buildMatterBody 的**同一套默认**（0.08/0.6）真正写回；R65 的 NaN 教训不受
  //   影响 —— 那条禁止的是写 **undefined**，这里写的是确定数值。
  //   用户显式调过的（wFrict!=null）两条分支都不碰用户值，只做同步。
  var v=(B.wFrict==null)?(PHYS_MODE==='high'?0:WFRICT_DEF):B.wFrict;
  if(v==null)return;
  B.mb.friction=v;
  // H-2：μ=0 → 动/静摩擦全 0 = 真正光滑（R68 原意）；μ>0 → 静摩擦保持 0.6（R65 设计：
  // 「停下来的物体仍站得稳」）。诊断（H-1）证实 frictionStatic 不影响动摩擦，故解耦安全。
  // 旧版 R68 把 frictionStatic 也写成 wFrict，μ=0.1 时静摩擦从 0.6 掉到 0.1，物体停不稳。
  /* ★★R132-9n：**静摩擦必须跟随 μ**（原来写死 0.6）——`_diag_r346` 实测「μ=0.05/0.3/1.0 的
   *  减速度恒为 1500px/s²」，即有效摩擦完全由这个常数决定、调 μ 毫无反应（用户报的正是这条）。
   *  ★R132-9r 修正：**`frictionStatic = μ` 这句上一轮只写进了注释、代码仍是 0.6**；
   *    真正的天花板在**静态框那侧**（Matter `setStatic` 不动 `frictionStatic` ⇒ 留在默认 0.5，
   *    配对取 min ⇒ `pair.fs = min(0.6, 0.5) = 0.5` 恒定）。静态框已抬到 1.0（见 `ensureMatter`），
   *    这里补上真正跟随 μ 的那一半，并且**只放开 μ>WF_STATIC_CAP** ——
   *    μ≤0.6 时取 `WF_STATIC_DEF=0.5`，与改动前 `pair.fs` **逐位相同**（默认手感零变化）。
   *  ★手感由默认 μ=WFRICT_DEF 保住 ⇒ 不改默认表现。 */
  B.mb.frictionStatic=wfStaticOf(v);
  /* ★★R132-9v（用户：「关于摩擦系数里面现在不也是下滑有摩擦力吗，就**分开计算摩擦力
   *   然后代码挂钩**不就行了」）：**用户显式调过 μ 的 W 体改走我们自己算的库仑摩擦**
   *   （`wfSelfFriction`，逐子步挂在 `Engine.update` 之后）—— 这里把 **Matter 自己的
   *   摩擦通道关掉**（`friction=0`），否则两个来源叠加。
   *   为什么必须自己算：Matter 的摩擦是「**每个接触点**各按 `friction × N` 施加冲量」，
   *   一个方块躺在平地上就有 **2 个接触点** ⇒ 实测减速度 ≈ `0.65g + 1.7·μ·g`（不是 μg）
   *   ⇒ μ=0.6 与 μ=1.0 的滑行距离只差 15%（用户原话：「调成 1 了怎么还和之前一样缓慢下滑」）。
   *   自己算的口径 = 教科书库仑摩擦：**切向**减速度 μ·g，与质量无关、整条 0~1 量程线性。
   *   ★**只对 `wFrict!=null`（用户自己动过滑块）的体生效** ⇒ 默认体（0.08）行为一格不动。 */
  var _own=(B.wFrict!=null);
  B._ownFric=_own;
  B.mb.friction=_own?0:v;
  var ps=B.mb.parts||[];
  for(var i=0;i<ps.length;i++){ps[i].friction=_own?0:v;ps[i].frictionStatic=wfStaticOf(v);}
  refreshWPairs(B);
  applyEffRest(B);     // μ=0 极值体的体级弹性 = 1（见 effRest；调 μ 也会改变生效弹性）
  applyWAir(B);
}
// R68：把用户调过的弹性（wBounc）应用到 Matter 体上 —— 与 applyWFrict 同一条守卫规则：
// 没调过（null）绝不写 mb.restitution，保留 buildMatterBody 的默认（圆 BALL_REST / 其它 0）。
// R89（用户⑥ 往返钉死）：**删掉 null 早退** —— 未调过的体也要按当前模式真正写回默认。
// 写入完全交给 applyEffRest（它读 effRest，已经覆盖全部情形：wBounc 调过=用户值；没调过=
// 模式默认（高中 0 / 大学圆 BALL_REST、其它 0）；用户显式 μ=0 的极值语义=1）。
// ⚠ 不要在这里手搓默认值再覆盖 —— 会把 μ=0 极值体的 rest=1 洗回 0.52/0（R76-B 语义）。
// R65 的 NaN 教训不受影响 —— applyEffRest 写的永远是确定数值，不是 undefined。
function applyWBounc(B){
  if(!B.mb)return;
  applyEffRest(B);     // 见上：唯一写入点，四种情形全在 effRest 里
  refreshWPairs(B);
  applyWAir(B);
}
// R76-B：生效弹性 = 用户旋钮（wEffE）受 μ 极值语义覆盖。μ=0 的体 → 1：
// R70⑥ 的「μ=0 对 → pair.restitution=1」原本只在帧末 refreshAllPairs 生效，子步内 Matter
// 仍按双方 body.restitution 求 **max**（用户 e=0 → 0）做非弹性求解 —— 曲面滑移的每子步
// 法向接近速度被直接杀掉（凹槽实测残余损耗 ~0.28/子步，EL_Z 补偿只盖 ~25%，球「越滑越低」）。
// 提前到**体级**：新 pair 创建时（Matter 取双方 max）就带上 1，子步内直接弹性求解，
// 无损耗可补；EL_Z 恢复降级为残余兜底（预算门照旧，不会过补）。
function effRest(B){
  // R76：极值语义（μ=0 ⇒ 完全弹性）只在**用户显式**声明 μ=0 时成立 —— 高中模式的默认 μ=0
  // 是教学默认值，不能顺带把体级 e 抬到 1，否则 R74-D/J 刚定好的「高中模式默认弹性全 0」
  // 当场失效（全场每一对 rest=1）。见 wMuIdeal 的注释。
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
// R68（用户②③的真凶）：**空气阻尼 frictionAir 是用户没要求却一直在泄能的通道** ——
// 探针实测（Matter 速度单位是 px/帧）：μ=0 时 2 秒内 vx 6.4→2.5（衰减 61%），把 air 设 0 后
// vx 恒 8.00 一格不掉；e=1 时弹跳峰高 600→308→190（第一跳就丢一半），air=0 后 562→557→541
// （近乎完全弹性）。μ 与 e 是用户仅有的两个「耗散旋钮」，就让 air 跟着它们联动：
//   air = defAir × min(1, μ/0.08) × (1 − e)
//   · μ=0 → air=0：完全光滑，匀速滑行（用户要的「摩擦 0 不减速」）
//   · e=1 → air=0：完全弹性，一直弹（用户要的「弹性 1 一直弹」）
//   · 默认（μ=0.08, e=0）→ air=defAir：普通块与旧行为完全一致；默认球（e=BALL_REST=0.52）
//     air=0.0067 略小于旧 0.014 —— 弹跳衰减本就由 restitution 主导，手感几乎不变。
// μ 或 e 没调过（null）时按默认值（0.08 / 圆 BALL_REST、其它 0）参与计算，等价于旧默认。
function wEffMu(B){return (B.wFrict==null)?(PHYS_MODE==='high'?0:WFRICT_DEF):B.wFrict;}
// R76（用户①③：高中模式默认摩擦系数为 0）：高中模式 → 未调过的体默认 μ=0。
//   ⚠ 这条与「μ=0 的**极值语义**」必须分开，否则会连环炸：整套极值语义（air 归零 / 禁用睡眠 /
//   pair rest=1 / 体级 e=1）原先都以 `wEffMu(B)===0` 判定 —— 高中默认 μ=0 会让**全场每一个
//   W 体**都进 EL_Z，于是 refreshAllPairs⑥ 把每一对的 restitution 抬到 1，R74-D/J 刚定好的
//   「高中模式默认弹性全 0」被整个推翻（画面变成全场永远弹下去）。
//   语义界限：极值语义是用户**声明**的「理想光滑面」，不是教学默认值。所以判据换成显式声明。
function wMuIdeal(B){return !!B&&B.wFrict===0;}
// R74-D/J（用户：「高中模式下所有物体的弹性系数默认调为 0」）：高中模式 → 未调过的默认弹性全 0
// （不再给圆 BALL_REST）；用户显式调过 wBounc 的体不受影响。effRest 的 μ=0 极值覆盖仍在前置。
function wEffE(B){return (B.wBounc==null)?(PHYS_MODE==='high'?0:((B.wshape==='circle'&&B.rad)?BALL_REST:0)):B.wBounc;}
// R72（用户：「弹簧的阻尼系数我调成 0，怎么还是很快就停止了」）：阻尼参数只管弹簧自身的
// -D·v 通道；宿主 W 体身上还有一条**空气阻力** frictionAir（默认 0.01/帧，约 1.2s 能量减半）
// 在独立泄能 —— sdamp=0 关不掉它。所以把空气阻力本体也开放成参数 wair：设 0 即真·无阻尼
// （配 sdamp=0 = 理想简谐振荡）。没调过（null）时维持各自旧默认，手感不变。
function wAirDef(B){if(PHYS_MODE==='high')return 0;return (B.wAir!=null)?B.wAir:WAIR_GLOBAL;}   // R73-C 出厂默认 0；R74-D 高中恒 0；★R131 未设置体回退全局 WAIR_GLOBAL
function applyWAir(B){
  if(!B.mb)return;
  // R74-D 高中模式③：不算空气阻力 —— 忽略显式 wair 设置，frictionAir 恒 0。
  if(PHYS_MODE==='high'){
    B.mb.frictionAir=0;
    var psH=B.mb.parts||[];
    for(var qH=0;qH<psH.length;qH++)psH[qH].frictionAir=0;
    return;
  }
  // R72：显式设过 wAir 时它就是权威值 —— 不再被 μ/e 联动乘掉（用户要 0 就是真的 0）。
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
// R70（用户③：「摩擦系数调成 0 还是衰减运动，过一会儿就停了，圆弧和凹槽里都是这样」）：
// R68 的空气阻尼联动是**体级**的 —— 只把被调 μ 的那个体的 frictionAir 归零。球贴着 μ=0 的
// 弧/凹槽滚动时，球自己（没被调过，默认 e=BALL_REST=0.52）的 frictionAir≈0.0067 仍在逐帧
// 泄能 —— R68 的平面探针测不到它（测的是被调体自己），曲面滚动场景它就是主凶。
// 空气阻尼耗散的是**接触系统**的能量，配对语义与 friction 相同：pair 有效摩擦（min）=0 或
// 有效弹性（max）≥1 时，双方（含复合体 parts）的 frictionAir 全部归零 —— 完全光滑/完全弹性
// 的接触里不允许存在第三条泄能通道（L031 极值语义的 pair 版）。脱离接触后下一帧自动按
// R68 公式恢复（refreshAllAir 每帧先重算再覆盖），无残留副作用。
function wZeroAir(m){
  m.frictionAir=0;
  var ps=m.parts||[];
  for(var i=0;i<ps.length;i++)ps[i].frictionAir=0;
}
/* ---- 高中纯滚动 highPureRoll 已于 R117 **整体删除**（回退到 R91_pre）----------
   ★R117（用户 2026-09-22）：「关于那个圆的转动问题还要再往前找备份，找到**没有分滚动摩擦
     和滑动摩擦**的那一版，然后把这个圆的运动回退回去，用之前的来」。
   目标锚点 = backups/index_20260917_R91_pre.html（highPureRoll=0、rollChain=0，圆只有 μ 一个旋钮）。
   R116 实测定位（INVARIANTS §44.1）：高中带自旋的球一撞东西，ω 从保留 99.3% 掉到 0.2%
     （R114c_pre / R114c_post 跨基线 A/B）—— 根因就是本函数的 `ω := sgn(vx)·|v|/R` 在
     「接触 + v 掉到噪声」时把**真实自旋**改写成噪声值（门限 sp*60<1 拦不住）。
   已删：本函数定义 + stepMatter 子步循环里的调用（原 10133 行）。
   ⇒ 圆的运动回到 R91_pre 语义：纯 Matter + μ 一个旋钮，高中不再有任何「写 ω」的通道。 */
function refreshAllPairs(){
  if(!MW)return;
  var i,B;
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind==='W'&&B.mb){
      // ① 每帧恢复 air。R70b：只对**被调过** μ/e 的体按 R68 公式重算——未调过的体恢复
      //    出厂值（圆 BALL_AIR / 其它 0.01，与 buildMatterBody 的赋值一致）。此前无条件按
      //    公式重算，默认球的 air 被从 0.014 静默改写成 0.0067（(1−BALL_REST) 因子），滚动
      //    摩阻变小多滑 ~50px，r61 1b 锚定 A/B 实测回归。R68 时期公式只在用户拖滑杆时执行，
      //    从未作用于未调过的体——保持这个有效语义。μ=0 极值接触把 air 清零后，脱离接触的
      //    下一帧由本循环按各自语义恢复（极值语义不变，见 ④）。
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
    // ② R70（诊断实测：球贴 μ=0 凹槽滚动 pair.fs=0.6、7s 睡死）：Matter 原生在**新 pair
    //    创建**时 frictionStatic 取 **max**（Pairs.update），R68 只把「调参时手动刷」这条
    //    路径改成了 min —— 球滚过弧/凹槽的几十个条带 part，每个新 pair 都按 max 带上对方
    //    （球 0.6）的静摩擦，低速时逐段咬住泄能。每帧把活动对按 min/max 统一刷一遍
    //    （与 refreshWPairs 同语义），新 pair 的错误初值下一帧即被纠正。
    pr.friction=Math.min(pr.bodyA.friction,pr.bodyB.friction);
    pr.frictionStatic=Math.min(pr.bodyA.frictionStatic,pr.bodyB.frictionStatic);
    // ⑤ R70（决定性诊断）：修完 fs/air/rest 后球速度与恒幅简谐振荡逐点吻合（V=3.3 恒定、
    //    零衰减）——「衰减运动过一会儿就停」的真凶是 **Matter 睡眠**：球在凹弧端点速度→0，
    //    motion（speed² 平滑）跌破 0.08 阈值累计 sleepThreshold(240) 帧后被冻结（pairs 随之
    //    清空）。平面匀速场景 motion 恒大从不触发，所以 R68 探针没暴露。理想无摩擦振荡本就
    //    该永动，μ=0 极值对的成员直接禁用睡眠（sleepThreshold=0 短路 Sleeping.update 的
    //    `sleepThreshold>0` 守卫）；脱离极值对后 ① 循环恢复 240。
    // R76（用户①「高中模式下默认摩擦系数为 0」的**必要配套**）：μ=0 的极值语义只在两侧里至少
    //   一方**显式**声明 μ=0（或用户对该对显式设 μ=0）时成立，判据见 wMuIdeal。
    //   为什么不能照旧只判 pr.friction===0：高中模式的默认 μ=0 会让 pr.friction **全场为 0**
    //   ⇒ 每一对都拿到 rest=1 + 禁睡眠 + air 归零，R74-D/J 刚定好的「高中默认弹性全 0」与
    //   R65 的「停下来的物体仍站得稳」一起被推翻（方块落地后永远弹、永不入睡）。
    //   ovv 顺带提前算 —— ⑥ 的判据要用 ovv.mu，⑦ 原样复用同一个值。
    var ovv=pairOvPairMb(a,b);
    var idealMu=(pr.friction===0)&&(wMuIdeal(bodyOfMb(a))||wMuIdeal(bodyOfMb(b))||ovv.mu===0);
    if(idealMu){
      wZeroAir(a);wZeroAir(b);                        // ④ 极值 μ=0：空气泄能通道一并关闭
      a.sleepThreshold=0;b.sleepThreshold=0;          // ⑤ 极值对成员禁用睡眠（见上）
      // ⑥ R70：μ=0 极值对 → **完全弹性 rest=1**。离散弧面的接缝碰撞在 rest<1 时每次把球
      //    切向速度的法向投影吸走（每秒漏 ~45% 动能，密集采样实测 τ≈1.2s 衰减睡死）；
      //    rest=1 时接缝碰撞变成**镜面反射**，微弹高度 ~0.04px 肉眼不可见。这是「μ=0 ⇒
      //    无耗散」极值语义（L031）在曲面上的延伸；平面滑动 R68 已覆盖，曲面滚动由本条补齐。
      pr.restitution=1;
      //    rest=1 后仍有 τ≈4s 的残余衰减（多接触干涉 + 位置修正不一致，Matter 固有——
      //    段数加密/稀疏化、求解迭代加厚均无改善，N=41 实测最优）。曾试「能量维护」（按
      //    E=½v²+g·h 把速度补回 E_ref），实测与约束求解打架产生正反馈自加速弹飞（L018
      //    反阻尼家族）——已回退，宁留慢衰减不引入注能 bug。
    }else{
      pr.restitution=Math.max(pr.bodyA.restitution,pr.bodyB.restitution);
    }
    // ⑦ R71⑪（用户：「展开后调节和场内所有物体的单独配对系数（含地面）」）：用户对该对
    //    显式设过的配对系数**优先级最高**，压过上面的 max/min 默认规则与 μ=0 极值语义
    //    （用户明确要求这对弹 0.9，就不该被「取 max」或「μ=0 ⇒ rest=1」改写）。
    //    地面/墙是引擎常驻静态体，没有实体对象，用它们的短键（@g/@wl/@wr）参与查表。
    //    （ovv 已在 ⑥ 之前算好，见那里 R76 的注释）
    if(ovv.mu!=null){pr.friction=ovv.mu;pr.frictionStatic=wfStaticOf(ovv.mu);}  // H-2：同 applyWFrict（★R132-9r 走 wfStaticOf 单一真源）
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
  // ★R115：原 `roll:pick('roll')`（滚动摩擦的第三通道）已删。配对覆盖只剩 弹性 e / 摩擦 μ。
  return {e:pick('e'),mu:pick('mu')};
}
// pair.friction/frictionStatic 只在 collisionStart 时按双方算一次；把当前**活动中的**
// 涉及该体的对全部按新摩擦重算（动摩擦 min / 静摩擦 max / 弹性 max），「贴着地面调 μ」立即生效。
function refreshWPairs(B){
  if(!MW||!B.mb)return;
  var list=MW.engine.pairs.list;
  for(var i=0;i<list.length;i++){
    var pr=list[i];
    var a=pr.bodyA.parent||pr.bodyA,b=pr.bodyB.parent||pr.bodyB;
    if(a!==B.mb&&b!==B.mb)continue;
    pr.friction=Math.min(pr.bodyA.friction,pr.bodyB.friction);
    // R68：frictionStatic 同步改 min（原 max）。旧规则下单边 μ=0 无效 —— 物体自己静摩擦 0，
    // pair 仍取到对方的 0.6，低速时照样被按住（用户「μ=0 还会慢慢停下」的帮凶之一）。
    // 取 min = 较光滑的一面主导接触，与动摩擦的 min 规则自洽。
    pr.frictionStatic=Math.min(pr.bodyA.frictionStatic,pr.bodyB.frictionStatic);
    pr.restitution=Math.max(pr.bodyA.restitution,pr.bodyB.restitution);   // R65
    // R71⑪：用户在配对表里显式设过的系数优先（调 μ/弹性「贴着地面立刻生效」走这条路径）
    var ovp=pairOvPairMb(a,b);
    if(ovp.mu!=null){pr.friction=ovp.mu;pr.frictionStatic=wfStaticOf(ovp.mu);}  // H-2：同 applyWFrict（★R132-9r 走 wfStaticOf 单一真源）
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
  // ---- R75（用户⑫：「弧的 90° 吸附偏移了」/「拖端点整条弧乱跑」）的公共根因 ------------
  // 本函数**始终在 th=0 下建体**：bndPts 会按 B.th 旋转，所以调用方（arcResample）先把 B.th
  // 清零，建完再恢复。但下面两处「原点重定位补偿」加给 pts/hull/ell/arcs 的是**世界**位移
  // δ_world，而这些字段是**本地**量、渲染时要经 R(th) 才回到世界 —— 只有 th=0 时两者才相等。
  // th≠0 时补偿量偏成 δ_world，整幅图漂 |R(th)δ−δ|（实测 th=30° 时 26px，端点手柄同步错开 th）。
  // 现在从 rebuildWBody 拿到真实姿态 prevTh，把 δ 换成 R(−prevTh)·δ；建完把姿态恢复回去。
  var prevTh=(B._rebuildTh!=null)?B._rebuildTh:(B.th||0);
  var cT=Math.cos(prevTh),sT=Math.sin(prevTh);
  // sleepThreshold 240 (default 60): a slow tip-over has tiny "motion" for a second or two —
  // at the default the engine freezes a hammer MID-TIP, parked in mid-air at 0.4 rad forever.
  // R65（用户：「物体在地面的默认摩擦系数改小一些，改成让其可以滑动一段距离就停下」）：
  // 动摩擦 0.3 -> 0.08（配对取 min，地面 0.6 不受影响）；frictionStatic 保持 0.6 ——
  // 滑动时阻力小、停下来的物体仍站得稳，「滑一段再停」正是这两者的分工。
  // R73-C：frictionAir 出厂 0（Matter 的默认是 0.01）—— 与 wAirDef 的默认一致，
  // 免得「出生第一帧」还有空气阻力（refreshAllPairs 每帧会再写一遍，这里只是不留缝）。
  var opts={friction:WFRICT_DEF,frictionStatic:0.6,restitution:0,slop:0.02,sleepThreshold:240,frictionAir:0};
  var mb;
  if(B.wshape==='circle'&&B.rad){
    // R58：圆形 = 会弹的球（用户要「像丢到地上的球弹几下」）。Matter 的碰撞恢复系数取
    // 双方 max，所以只给球自己 restitution 就够，地面/其它物体保持 0 不受影响。
    // frictionAir 略调高：让水平方向也跟着衰减，弹几下就停，不会一路弹到天涯。
    // R76-D：改用 CIRCLE_SIDES 边多边形 —— Matter 的 Bodies.circle 其实只是
    //   polygon(min(maxSides,R) 取偶, R)（其源码自注「用多边形近似圆，SAT 还没实现真圆」），
    //   24 边时接触法线偏离径向最多 7.5°，每个接触都带力臂、给球虚假角动量（详见 CIRCLE_SIDES
    //   上方注释的实测数据）。24→48 边把「越滑越低」从 +8.41% 压到 +3.79%。
    //   circleRadius 照旧写上：Matter 纯多边形碰撞不读它，但它一被写进 options，
    //   Body.scale / 渲染等沿用 Matter 自身的「这是个圆」语义，不留行为空洞。
    var _R=B.rad+BND_INK;
    mb=(CIRCLE_SIDES>24)
      ? Matter.Bodies.polygon(B.x,B.y,CIRCLE_SIDES,_R,
          {friction:0.08,frictionStatic:0.6,restitution:BALL_REST,slop:0.02,
           frictionAir:BALL_AIR,sleepThreshold:240,circleRadius:_R})
      : Matter.Bodies.circle(B.x,B.y,_R,
          {friction:0.08,frictionStatic:0.6,restitution:BALL_REST,slop:0.02,
           frictionAir:BALL_AIR,sleepThreshold:240});
    // R79：给圆体打上「真圆」标记 —— 解析碰撞通道（Matter.Collision.collides 的挂钩）只认这个
    // 字段，不看 circleRadius。理由是 circleRadius 是 Matter 自己的语义（渲染/scale 也读它），
    // 将来别处造出 Matter 圆时不该**意外**被卷进本通道；要进通道就得在这里显式声明。
    // ⚠ 必须写在**本分支内部**：掉到分支外就会改嫁后面的 `else if` 链（本行初版就踩了这个坑，
    //   把槽/闭链的分支挂到了圆的判断上）。
    if(mb)mb._circleR=_R;
    // R121（同上的用户授权：按真实物理改）：把圆的转动惯量写回**物理值**（圆盘 I=½mR²）。
    //   为什么非改不可 —— 这是「急刹」的另一半：Matter 的 Body 工厂把**所有**体的惯量都乘了
    //   `_inertiaScale=4`（Body.setVertices / setParts 里的 `Body._inertiaScale * Vertices.inertia(...)`），
    //   48 边形≈圆盘 ⇒ mb.inertia = 4×(½mR²) = **2mR²**，即 λ'≡I/(mR²) = **2.0**（圆盘应为 0.5）。
    //   而「纯滑动 → 纯滚动」的收敛速度（对接触点取角动量守恒）是
    //       v_f = v₀/(1+λ')        λ'=I/(mR²)
    //     物理圆盘 λ'=0.5 ⇒ v_f = v₀/1.5 = **2v₀/3**（丢 1/3，就是课本那个数）
    //     实际     λ'=2.0 ⇒ v_f = v₀/3  （丢 2/3）—— `_diag_r120d` S1 臂实测 33.7%，逐位对上。
    //   ⇒ 改 R121-A（松手补自旋）之后正常路径已不再触发这条通道；这一处是**治本**：让真正的
    //     滑动→滚动（例如球被打上反旋、或落地时带自旋）只丢物理该丢的那 1/3，且让下面两条
    //     自定义通道的口径终于与 Matter 侧一致 ——
    //       · 弹簧力矩通道（2458-2465）的惯量是 `Iu = rad²/2`（**单位质量圆盘**）；
    //       · 传带通道（5380）注释里写的 `λ=mR²/I（圆盘 λ=2 ⇒ dv=ΔS/3）`；
    //     两者都按圆盘推、且**不读** mb.inertia，所以它们一直是自洽的；改前只有 Matter 那一侧
    //     偏大 4 倍，改后全场一个口径。
    //   ⚠ 只改圆这一支：方块/公式体同一处 4 倍偏差**未处理**（无实测、无用户症状）；
    //     环（wshape==='ring'）是 48 段复合体、物性上更近薄圆环（λ'=1 ⇒ v_f=v₀/2），口径不同，
    //     同样留作未处理项。两项都登记进 INVARIANTS §49 的覆盖账。
    //   ⚠ 会不会被冲掉（三个 setter 都查过）：Matter.setMass/setDensity 保持 `inertia/(mass/6)`
    //     不变比 ⇒ 改质量不丢；setStatic 走 `_original` 存/取、**不**从顶点重算 ⇒ 钉住/放开不丢；
    //     产品从不调 setVertices/Body.scale（全局 grep 只命中库内部与本处注释）。
    //   ⚠ R 用 `_R`（= B.rad+BND_INK = mb.circleRadius）：实心圆盘的半径就是碰撞半径。
    if(mb){Matter.Body.setInertia(mb,0.5*mb.mass*_R*_R);}
  }else if(B.wshape==='trough'||B.wshape==='tub'||B.wshape==='ring'){
    // 半凹槽/全凹槽（R54）：轮廓含内凹弧线，fromVertices 的凸包会填平凹面——
    // 所以和开链笔画走同一条路：沿轮廓线每个小段一个定向矩形 part 复合体。
    // 「只有线是边界」：条带就是墨迹本身，弧面由离散段近似（段间角度小，滚动平滑）。
    // R82（空心圆）：ring 走同一条路，理由完全一致 —— 它的「凹面」是与外壁同心的**空腔**，
    //   凸包会把整个空腔填成一个实心圆盘。B.pts 是中线圆（shapeOutline 给的），
    //   bndSegs 切出的每段厚 2·BND_INK ⇒ 复合体 = 一整圈「墨线」，空腔天然敞着。
    //   走这条路的另一个好处：rodResolve / 摩擦配对 / 睡眠等既有机器全部照旧生效。
    var sg5=bndSegs(B),parts5=[];
    for(var qi5=0;qi5<sg5.length;qi5++){var s5=sg5[qi5];
      parts5.push(Matter.Bodies.rectangle(s5.x,s5.y,s5.hw*2+PEN_HW*2,s5.hh*2,
                                         {angle:s5.th,friction:0.08,frictionStatic:0.6,restitution:0,slop:0.02}));
    }
    mb=segCompound(parts5,B);
    // R82：给环的**每个 part** 打上「内外壁半径」标记，供 R79 解析通道里的「环 vs 圆」分支使用。
    // 为什么打在 part 上而不是根：Matter 的 Detector.collisions 在「任一方是复合体」时传的是
    //   **part**（源码 `c(P,_,i)`，且 P 从 parts[1] 起 —— parts[0] 是根自己，被跳过），
    //   根永远收不到这通调用。环心则要由 part.parent 取回（part.position 在中线上！）。
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
      // R72-F（用户：「直角边的放到地上陷进去了一些」）：fromVertices 会把顶点集的**质心**
      // 搬到 (B.x,B.y)，并不是「顶点留在传入的世界位置」。中心对称形（矩形）的质心恰好与
      // 原点重合，从来暴露不出；偏心形（直角三角形）的碰撞体就整体漂移 —— 实测漂
      // (+4.31,-1.33)px：碰撞底边比墨迹下缘高 1.33px，落地时墨迹扎进地面线一截。
      // 把这次平移用与下方原点重定位**完全相同**的动作补偿回来（pts/hull/ell/arcs 一起搬）。
      var ctrF=Matter.Vertices.centre(wp),fxw=B.x-ctrF.x,fyw=B.y-ctrF.y;
      // R75：世界位移 -> 本地位移（R(−prevTh)），见 buildMatterBody 顶部说明。
      var fx=fxw*cT+fyw*sT,fy=-fxw*sT+fyw*cT;
      // 阈值 1e-6：Matter 的 Vertices.centre 走叉积累加，中心对称形也会算出 1e-12 级的残差
      // （实测矩形质心 499.9999999999974）。不加阈值就把这 1.3e-12 反向加进 B.pts，
      // 于是 inkPointDist 从精确的 15 变成 14.999999999999998 —— distToHost 与 SPR_PAD(15)
      // 的严格小于判定被这 1e-12 翻面（r57 57-3：e1 隔空 15px 被吸到方块上）。
      if(Math.abs(fx)>1e-6||Math.abs(fy)>1e-6){
        // hull2D 返回的数组里装的是 **B.pts 里那几个同一个点对象**（不是拷贝）。pts 与 hull
        // 各平移一次 = 同一个点被搬两遍 —— 实测直角三角形补偿量翻倍（2×2.92=5.83px），
        // 碰撞底边反而跑到墨迹下缘下面 2.9px（图形悬空）。按**引用**去重后再搬。
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
      mb=Matter.Bodies.rectangle(cx,cy,Math.max(14,tot),PEN_HW*2,opts);   // PEN_HW==BND_HH: same 6px ink
    }
    // ★R122（同 R121 的用户授权：「按照真实世界的物理规律来修改，符合真实物理现象就行」）：
    //   把**闭合笔画**（方块/三角/任意闭合多边形的碰撞体）的转动惯量写回**物理值**。
    //   依据（`_diag_r122a.py` 实测，同一把尺子、同一页面）：
    //     Matter 的 `Body._inertiaScale = 4` 让**每个**体的惯量都是「纯几何惯量 × 4」；
    //     圆的 lam 在 R121 之后是 **1.0029**（已改），而方块/三角实测 **4.0000 / 4.0000**。
    //   后果（`_diag_r122b.py` 量到的下游症状）：方块斜着落地的翻滚角速度 `ω = J·r_perp/I`
    //     ⇒ **ω ∝ 1/I** ⇒ 惯量大 4 倍 ⇒ 同一个手势下转速只有物理值的 **1/4**、方块「翻不动」。
    //   写法为什么是 `/4` 而不是显式 `Vertices.inertia(...)`：
    //     · `/4` **精确等价于把库的 `_inertiaScale` 从 4 改成 1**，不假设形状；
    //     · 显式公式对 `fromVertices` 的结果可能是**多 part** 的复合体，`mb.vertices` 那时是
    //       **凸包**（非凸形会丢信息）⇒ 显式公式反而会算错；`/4` 对单/多 part 都只是「撤掉 scale」。
    //   ⚠ 本行**只覆盖 `closed` 这一支**（方块/三角/手绘闭环）。另外两支**不动**，理由不同：
    //     · `trough/tub/ring/arc` 走 `segCompound`：实测它们的**根** `inertia` 还**额外漏掉
    //       平行轴项 m·d²**（环的平行轴占完整物理惯量的 **99.7%**）。那里若跟着 `/4`，会让
    //       「偏小」更偏小（环会从偏小 77 倍变成偏小 307 倍）⇒ **比物理更远**，必须**先补齐
    //       平行轴合成**才谈得上除 4，留作单独课题（见 INVARIANTS §50 覆盖账）。
    //     · 圆已在 R121 显式写成 `½mR²`，不走这里。
    //   ⚠ 会不会被后续 setter 冲掉：`setMass/setDensity` 保持 `inertia/(mass/6)` 不变比；
    //     `setStatic` 走 `_original` 存/取、不从顶点重算 —— 与本行正交（同 R121 的查证）。
    if(mb)Matter.Body.setInertia(mb,mb.inertia/4);
  }else{
    // 开链笔画 / 圆弧：沿墨迹每段一个定向矩形。
    // R71⑦（用户：「圆弧碰撞箱和笔画不一样，一端对准地面时小球经过会弹一下」）：
    // 每段盒子原来是 `hw*2 + PEN_HW*2` —— 两端各向外多伸 3px，用意是**相邻段互搭、消除接缝**
    // （内部段必须保留，否则盒与盒之间会有 V 形缝，球滚过去就是咯噔一下）。
    // 但首段/末段的外侧那 3px 没有任何东西要对搭，它只是让碰撞**越出笔画端点 3px**：
    // 屏幕上笔端是 round cap（半径 2.325px 的半圆），碰撞却是一块 6px 宽、往外突 3px 的方头。
    // 后果正是用户描述的那一幕——把弧的一端「对准」地面时，肉眼看到端点刚碰到地面，碰撞体
    // 其实已经扎进地面 3px，Matter 把它顶起来，视觉端点与地面之间就裂开一条 ~3px 的缝；
    // 小球沿地面滚过来正好钻进缝里被楔起，看起来就是「经过端点被弹一下」。
    // 修法：只有**开链**的首末段取消外侧外延（端点停在笔画端点，方头与 round cap 的圆心齐平），
    // 内侧照旧外延以维持与邻段的搭接。闭链（矩形/三角/凹槽等）首末段本就相邻，一律不动。
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
  /* ★★R132-9l（用户：「拖动圆弧两端加长延生时，圆弧和上面的按钮就不断抽搐和卡bug，
   *   最后直接飞出整个屏幕」）—— 补偿量必须取**世界位移本身**。
   *
   *  推导（由 `_diag_r339` 产品内部真值 + 解析对账互证）：
   *   · 本函数在 `B.th = 0` 下建体（`bndPts` 此时输出 `B.x + pts`）⇒ 建体帧里
   *     **本地系与世界系重合**，所以「世界位移」直接就是「本地位移」。
   *   · 建完 `setAngle(prevTh)` 是 Matter 语义的**绕质心**旋转（`Body._rotate` 以
   *     `body.position` 为中心），而渲染 `drawBoundaries` 是绕**原点 `(B.x,B.y)`** 旋转
   *     ⇒ 两者恒差 `(I − R(θ))·ρ̄`（ρ̄ = 本地几何的质量加权质心偏移）。
   *   · 旧版补偿量取 `R(−prevTh)·δw`（R75 引入），与「下一轮 arcResample 用 `lc` 重算
   *     `pts`、却**不动 `lc`**」耦合成乘性递推：
   *         ρ̄_{n+1} = (I − R(−θ))·ρ̄_n ,   谱半径 = 2|sin(θ/2)|
   *     θ=0 → 0（一轮归零）、θ=60° → 1、θ=141.73° → **1.8895 > 1**（发散）。
   *     ★实测对账（`_diag_r336`，ΔB.x 逐轮）：
   *         43.470 106.984 226.756 427.610 717.088 1033.498 1129.644
   *       解析预测：43.470 106.983 226.754 427.607 717.086 1033.498 1129.654  ——逐位吻合。
   *     这才解释了「只有把弧转过大角度、再拖端点才会飞出屏幕」。
   *   · 退回世界位移后下一轮 `ρ̄ = 0` ⇒ **一步进入不动点**（`fixA` 实测 wc 漂移 0.0000px、
   *     物理≡渲染间隙 0.762px，与「从未转过角」的对照臂逐位相同）。
   *
   *  ★口径：本函数**必须**在 `B.th=0` 下被调用（`arcResample` 已保证）。若将来有调用方
   *    带着非零 `B.th` 进来，`bndPts` 会输出「已旋转的世界点」，本行的「世界位移直加」
   *    就不再是本地位移 —— 那时必须把这一行改回按 `prevTh` 换算。
   *  ★th=0 时 `R(0) = I` ⇒ 本行与原式 `dxw*cT+dyw*sT` 逐字节等价，历史行为不变。 */
  var dx=dxw,dy=dyw;
  if(dx||dy){
    for(var k=0;k<B.pts.length;k++){B.pts[k][0]+=dx;B.pts[k][1]+=dy;}
    // R72-F：本地 hull 缓存也跟着搬 —— solidSAT（公式体↔实体的手写碰撞）读的是它，
    // 只搬 pts 不搬 hull 的话，渲染与 Matter 对齐了、手写通道却错开同样的量。
    if(B.hull)for(var kh=0;kh<B.hull.length;kh++){B.hull[kh][0]+=dx;B.hull[kh][1]+=dy;}
    // R56：圆弧的椭圆锚点必须跟着本地原点的平移一起补偿，否则重建后 ell 与 pts 脱节，
    // 端点手柄拖一次就把角度算飞（实测 a1 直接掉到最小扫过角）。
    if(B.ell){B.ell.lcx+=dx;B.ell.lcy+=dy;}
    // R68：凹槽真弧元数据同样要跟着平移（圆心 + 弧中点都是本地坐标）。
    if(B.arcs)for(var k8=0;k8<B.arcs.length;k8++){
      B.arcs[k8].lcx+=dx;B.arcs[k8].lcy+=dy;B.arcs[k8].lmx+=dx;B.arcs[k8].lmy+=dy;
    }
  }
  B.x=mb.position.x;B.y=mb.position.y;
  // R75：把姿态恢复成重建前的值，并同步到 Matter —— 旧版这一步在 arcResample 里做，
  // 现在收进 buildMatterBody，好让上面的本地位移换算拿得到真实姿态。
  B.th=prevTh;
  /* ★★R132-9l（同上一处）：`setAngle` 是 Matter 语义的**绕质心**旋转，而渲染
   *   `drawBoundaries` 是绕**原点 `(B.x,B.y)`** 旋转 —— 两者只差一个把原点搬回原位的平移
   *     T = (I − R(prevTh))·δw
   *   （δw = 重建前原点与本体质心的世界位移，即上面那两个 `dxw/dyw`）。
   *   补上 T 之后，Matter 顶点与 `traceWPath` 画出的世界几何**逐点重合** ⇒
   *   ①「肉眼看到的弧」与「碰撞/旋转体」不再错位（用户说的「抽搐」）；
   *   ② 下一轮重建时 ρ̄ 归零，乘性递推熄火（这是止住爆炸的另一半，缺一不可 ——
   *      只补 T 而不退世界位移的对照臂 `armZ` 实测仍然发散至 2.8e4）。
   *   prevTh=0 时 cT=1、sT=0 ⇒ T=0，整段退化为原行为（逐字节等价）。 */
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
  B._natMass=mb.mass;              // R64：自然质量（按几何算），wmass 乘数以它为基准
  applyWMul(B);                    // R64：重建/复制后恢复用户调过的质量乘数与摩擦
}
/* ================= R71-B：完全弹性接触的能量守恒守卫 ========================
   用户②「弹性调到 1，弹跳高度还是缓慢衰减」＋用户⑥「手绘开链 e=1 从空中释放会在地上
   翻滚越来越快」。两者是同一个 bug 的两面：Matter 的迭代求解器**无法精确复现 e=1**。
   诊断实测（_diag_r71_energy.py，纯垂直弹跳、air=0、rest=1，逐次触底的出/入射速度比）：
       0.9715  0.9443  0.9603  1.0014  0.9474  0.9701
   平均 0.966 —— 每次弹跳丢 ~3.4% 速度（≈6.7% 高度），偶尔还**倒赚** 0.14%（正是 ⑥ 的
   自加速种子）。丢能也不是任何「可关掉的通道」：frictionAir 已为 0、friction 已被 min
   归零，剩下的全在求解器内部，看反编译就明白：
     Resolver.solveVelocity：Z=(1+restitution)*normalVelocity*Y 累加进 normalImpulse，
     而该累积器被 `normalImpulse>0 && (normalImpulse=0)` 硬钳到 ≤0；并且当法向速度
     U < u = −2·timeScale 时**整条累积器被重置为 0**（快速接近走「投机冲量」分支，不累积）。
     加上引擎是 4 子步 × 1/240s（timeScale=0.25），一拍内多次分叉 —— 单次接触的 e=1
     在数学上就无法精确达成。
   所以只能在应用层**显式守恒**：每子步前记录「求解器视角」的速度（= position−positionPrev，
   注意 Matter 的 solveVelocity 全程只读写 positionPrev/anglePrev，不读 velocity 字段），
   子步后对「声明弹性 ≥1」的活动接触，把**接触点法向相对速度**精确恢复成入射值的镜像
   （完美反射）；切向照旧交给 Matter 的摩擦。恢复值恒等于入射值 ⇒ 既不丢能也不注能，
   ② 的衰减与 ⑥ 的自加速由同一条修好。
   安全门（避免弄出「永久微弹」—— R57 的老坑）：
     · 只在 vr0<0（真的在接近）**且** vr1>0（求解器确实已把它弹开）时动作；
       静置接触（重力压着、求解器把它压回 0）两条件都不满足 → 一律不碰，不引入抖动。
     · 门限用**用户旋钮的声明值** wEffE(B)≥1，不是 pair.restitution —— 后者被 R70 的
       「μ=0 极值对 → rest=1」覆写过，若按它开门，μ=0 的方块落地也会永远弹跳
       （用户⑨要的是「滑得动」，不是「弹不停」）。
     · R74-B：μ=0 的体另走 EL_Z 名单进同一台机器（pair.restitution 已被 ⑥ 置 1，
       上面的 restitution 门天然通过），但 ECF 里额外要求「双方均非地面/墙」——
       曲面（凹槽/圆弧，全是场上画出来的 W 体）上的滑动接触由此守恒
       （用户：「圆的摩擦力都调成 0 了，在圆凹槽里还是越滑越低」），
       而 μ=0 方块落**地面**的衰减弹跳维持本条的 R72 语义不变。
     · 冲量按接触点算（含 r×n 的角向项），所以 ⑥ 的开链翻滚也能正确约束到角动量上。 */
var VR_EPS=0.002;
// R73-C（用户：「我把球的弹性都调成1了，它在地上还是越弹越低」）：逐点镜像的目标应当是
// 「求解器看到的入射速度」，而 snapVelocities 的 PRE 是在 Engine.update **之前**抓的 ——
// 本子步的重力增量（Matter 的 Body.update 里 Δv = g.y·g.scale·dt²）还没加进去。
// 只补这一个重力增量实测把每跳高度损失从 2.0% 降到 1.4%；再往上扫描（见 _diag_r73_bounce5.py，
// 圆 r=36、g=2.6、dt=1000/240 的子步）得到 1×→1.4%、2×→0.30%、2.5×→0.05%、3×→净增益+0.3%。
// 除重力外还有一条同量级的系统性亏损：位置求解器（12 次迭代）把物体从穿透里顶出来时同样
// 改变 position / positionPrev 的相对关系，量级恰是又一个重力增量。故倍数取**实测标定值**，
// 它只依赖「重力 × 子步 dt²」，与质量/半径/弹性无关（亏损 ∝ gΔt²/v，而 v ∝ sqrt(gΔt²)）。
// 由 _probe_r73.py 锁住行为；设为 0 即整条补偿关闭（回到 R72 的逐点镜像原样）。
var ECF_GRAV_COMP=2.5;
// R81-B 一度把它改成 1.0，理由是「1× 是求解器每子步真正施加的重力增量，dKE=½m(s0²−s1²)
// 与 budgetClean 严格一致」。口径自洽是对的，但**物理错了**：s0 是**恢复目标**（无接触时
// 应有速率），不是预算的记账量。1.0× 让目标偏低 ⇒ 补偿不足。
// R75-A 实测（_probe_r74.py 组 B，确定性 4×240Hz 驱动、6s 每秒平均能量）：
//     1.0  → 漂移 -6.0%   （= 用户①「圆在凹槽里越滑越低」的真身，R74 的 +1% 被吃掉了）
//     1.25 → 漂移 -0.9%   （复现 R74 定稿值；B3 守卫「没被抛出世界」同时通过）
// 这条参数直接决定用户可感行为，改动必须重跑 _probe_r74.py 组 B。
var ECF_Z_GCOMP=1.25;
function substepGravityDelta(){
  if(!MW||!MW.engine||!MW.engine.gravity)return 0;
  var dt=1000/240;                    // 与 stepMatter 的子步完全一致
  return MW.engine.gravity.y*MW.engine.gravity.scale*dt*dt;
}
// R74-B：μ=0 极值体名单（与 EL 并列，perfectElasticMB 每帧一起重算）。μ=0 对的
// pair.restitution 已被 refreshAllPairs⑥ 覆写成 1，但求解器复现不了 e=1（R71-B），
// 曲面 41 段接缝上实测 ΔE≈130~150/半周期（球「越滑越低」）—— 与显式 e=1 是同一台
// 补偿机器能修的同一类流失，只是门控多一条「双方均非地面/墙」（见 elasticContactFix）。
var EL_Z=[];
function perfectElasticMB(){
  var out=[];
  EL_Z.length=0;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.dead||!B.mb)continue;
    if(wEffE(B)>=0.999)out.push(B.mb);
    else if(wMuIdeal(B))EL_Z.push(B.mb);   // R76：只收**显式** μ=0 的体（高中默认 μ=0 不算，见 wMuIdeal）
                                           // ⚠ 这里必须是 else if：e≥1 与显式 μ=0 同时成立时只能进 EL，
                                           //   否则两条补偿通道会各处理一遍（原版就是 else if）
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
// ★R119（大学模式「圆突然急刹」——根因与修法，源码级）
// 根因（_diag_r118d 实测 + Matter 0.20 Resolver.solveVelocity 原文逐行对账）：
//   求解器里 `Z=(1+e)·U·Y` **不判接近/分离**，每轮都算，只有两条出路：
//     · 快分支 `U<u`（u=-_restingThresh·l=-2×0.25=-0.5px/子步 = **-120px/s**）：
//       `V.normalImpulse=0` —— 一次性全量反弹，累加器清零 ⇒ 后续正冲量被钳 0 ⇒ 干净反弹。
//     · 慢分支（|U|<120px/s）：`ni+=Z; ni>0⇒ni=0; Z=ni-ni_prev` —— **没有分离判定**，
//       反弹后 U 反号 ⇒ Z 变正 ⇒ 累加器往回吐 ⇒ 反弹被「追回」（clawback）。
//   本产品 velocityIterations=8 ⇒ v→(−e)^8·v₀≈0.0054·v₀：实测 80px/s 撞击后只剩 0.63px/s，
//   球当场睡死。这就是「快球会弹、慢球急刹」的全部原因（R117 删 highPureRoll 没碰这条链）。
// 修法（用户拍板「只对圆」）：在 collisionStart（Pairs.update 之后、求解器之前）自己施加一次
//   标准弹性冲量 j=−(1+e)·Un/(iA+iB)，再把该 pair **本步** 的 restitution 置 0 ——
//   求解器于是看到「已在分离 + 累加器为 0」⇒ 正冲量被钳 0 ⇒ 无追回，e 精确兑现。
//   ⚠ 置 0 只影响本步：Pairs.update 每步从两个体重算 pair.restitution（refreshAllPairs 同）。
// 四条门控都在收窄打击面，缺一不可：
//   ① 只对 W 圆（wshape==='circle'）；② 高中 e=0 / 用户 e≥0.98（EL 有自己那套补偿）跳过；
//   ③ 只修**慢速**撞击（8..120px/s）—— 快分支本来就是对的，不动它，保既有标定；
//   ④ |Un| ≥ 0.5·|vRel|（只要「正面撞」）：沿曲面滚动换段产生的微小法向分量
//      （100px/s 滚过 5° 折角 ⇒ Un≈8.7px/s）不算碰撞，否则球面会一路小跳。
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
    if(typeof grab!=='undefined'&&grab&&grab.kind==='body'&&(grab.obj===BA||grab.obj===BB))continue;
    var e=(typeof wEffE==='function')?wEffE(Bc):0;
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
// ★★R130：圆的**模式化摩擦**（用户原话两则 —— 这是语义分野，不是参数微调）
//   高中：「高中模式下圆不是有一个控制摩擦力的参数吗……就是控制球的完整摩擦力的，因为高中
//          一般不考虑球的滚动，所以就当做一个整体摩擦力，高中也不考虑圆的滚动」
//   大学：「大学模式下的参数，摩擦力系数也是控制的滚动摩擦的，这个球不打滑一般，一般只考虑滚动」
// ⇒ 高中：圆 = **质点** —— 不自转（ω≡0）。于是触地点滑移恒等于平动速度，Matter 的 μ 通道
//         全程按「整体滑动摩擦」作用（匀减速 a≈μg），与「不考虑滚动」完全同义。
//   大学：圆 = **刚体** —— 纯滚动（不打滑）：μ 是**滚动阻力系数**（a=μ_r·g ⇒ 匀减速自然停下），
//         接触点切向滑移由本函数的静摩擦冲量消掉（不靠 Matter 的库仑摩擦 —— 那个会啃平动）。
//
// 为什么非要自己写这条通道（_diag_r130 实测：大学 / R=72.325px / λ'=I/(mR²)=0.500）：
//   球以 500px/s 纯滚动撞右墙 ⇒ 墙反弹把 vx 翻成 −260（e=0.52），而接触点在**腰部**
//   ⇒ 力矩 r×j≈0 ⇒ ω 几乎不变（6.99→6.86）⇒ 触地点滑移 = vx−ωR = **−757px/s**。
//   动摩擦接下来 12 帧把平动啃到 −8px/s（解析终值 (2vx+ωR)/3 = −8.0，逐位吻合），
//   反弹后只走了 53px —— 正是用户报的「先很快、运动一小段距离后突然速度骤降」。
//   在「不打滑、只考虑滚动」的大学语义下这个滑移根本不该存在：反弹是**整体运动状态的
//   反转**，ω 必须跟着 v 走。
//
// 通道形态（**逐子步**，与 rodResolve / elasticContactFix 同级 —— 碰撞注入的速度突变必须在
// 下一个子步之前归位，否则会被求解器当成真实滑移啃掉）：
//   ① 本子步**刚撞上**（Matter collisionStart 含该球）⇒ **ω 跟随 v**（平动一个字不改，
//      保住反弹速度）。⚠ 判据必须是「刚撞上」而不是「滑移大」—— 见函数内 R130 注释。
//   ② 其余（滑移由重力/滚阻缓慢积累）⇒ **静摩擦冲量**消掉残余滑移，双方按 (1/m + c²/I)
//      分摊（接触点角动量守恒）⇒ 斜面上自动给出正确的滚动加速度 a = g·sinθ/(1+λ')
//      = (2/3)·g·sinθ（λ'=0.5）。
//   ③ 滚动阻力 a = μ_r·g 沿切向反对滚动，ω 同步（不破坏纯滚动）⇒ 球会匀减速自然停下。
//
// ⚠⚠口径（_diag_r130d 实测，踩过一次）：**impAt 的实参是「每子步位移」口径，而 mb.velocity /
//   mb.angularVelocity 是「每 1/60 s」口径** —— 前者写进 positionPrev/anglePrev，下一次
//   Body.update 用 (position−positionPrev)×correction 重算速度，correction = _baseDelta/子步delta
//   = 16.667/4.167 = **4** ⇒ impAt(dv) 的**持久**效果是 Δvelocity = 4·dv。
//   （circleRestitutionFix 之所以对，是因为它的 Un 取自 position−positionPrev，本来就是位移口径。）
//   所以本函数算出来的（速度口径）增量写进 impAt 前**一律除以 SUBSC** —— 漏了它就是逐子步
//   ×(−3) 发散（超调 4 倍 ⇒ 残余 −3 倍），实测 ω 一路涨到 1e18。
var ROLL_BACK_SLIP_ABS=15; // px/s：|滑移| 下限（慢速撞击也要管，r119 实测 34px/s 撞击滑移仅 52px/s）
var ROLL_BACK_SLIP_REL=0.2;// 相对下限：|滑移| > 0.2·|v|（尺度无关 —— 同一句话不能只对高速成立）
var ROLL_RESIST_G=1;        // 滚阻标定：a = μ_r·g × 本系数（1 = 直接把 μ 当滚动阻力系数）
var ROLL_SUP_NY=0.3;        // 主接触必须「够像支撑面」：|n_y| ≥ 0.3（≈ 倾斜 ≤72.5°）
function circleRollBodies(){
  if(!MW)return null;
  var out=null;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B||B.dead||B.kind!=='W'||!B.mb||B.wshape!=='circle'||!B.rad)continue;
    if(B.mb.isStatic||B.fixed||B.mb.isSleeping)continue;
    if(typeof grab!=='undefined'&&grab&&grab.kind==='body'&&grab.obj===B)continue;
    (out||(out=[])).push(B);
  }
  return out;
}
// R130：子步**前**的平动速度快照 —— circleRollStep 用它算「本子步法向速度突变」= 撞击强度。
// 必须在 Engine.update 之前取（更新后速度已经是碰撞后的，量不出接近速度）。
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
    // ① 高中：圆是质点 —— 不自转（ω≡0）。摩擦仍由 Matter 的 μ 通道按「整体摩擦」负责，
    //    滑移恒 = 平动速度 ⇒ 全程动摩擦 ⇒ 匀减速，与「不考虑滚动」同义。
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
    // ★★主接触必须**够像支撑面**（_diag_r130 A 臂实证）：撞墙那一子步球同时接触地面和墙，
    //   「最竖直」那一对确实是地面 —— 但球被撞得微微离地时地面那一对可能不活跃，主接触就落到
    //   **墙**上；而墙的接触点在**腰部**、切向是竖直的 ⇒ 无滑移目标 ω = −v_y/R ≈ 0 ⇒ 我会把
    //   自旋整条归零（实测 ω 从 +6.20 直掉到 −0.17），于是真正的「倒着滚」指纹被我自己抹掉，
    //   反弹后仍要被摩擦啃掉 39%（−226.5→−139）。竖直墙 |n_y|≈0 ⇒ 用 0.3 把它排除掉。
    if(best<ROLL_SUP_NY||!PO)continue;
    // 本体的有效 μ（读数与物理同源）
    var mu=(typeof wEffMu==='function')?wEffMu(B):0.08;
    // ★★摩擦存在性闸门（_mut_r130_noback / _probe_r76 三臂实证）：Matter 的 pair.friction
    //   = min(A,B) ⇒ **任一方为 0 就没有任何摩擦**可用来维持纯滚动（r76 的凹槽夹具球和槽
    //   都显式 μ=0）。没有摩擦却去强行「不打滑」= 凭空注入转动能：实测把球的自旋峰值从
    //   0.1269 抬到 0.6618、12s 高度下沉从 +3.02% 恶化到 +12.02%。⇒ μ_pair=0 时整条不打滑
    //   通道必须让位给「滑」，这正是「光滑面」的物理语义。
    var muP=Math.min(mu,(PO&&typeof PO.friction==='number')?PO.friction:mu);
    // 对方在接触点的速度（睡眠/静态体 = 0）
    var ovx=PSt?0:PO.velocity.x,ovy=PSt?0:PO.velocity.y,ow=PSt?0:PO.angularVelocity;
    // 本子步**切向**速度突变（px/s）= 撞击强度的度量。
    //   ★为什么用「切向」而不是「法向」（_probe_r76 实证，这是本轮最贵的教训）：
    //     撞墙时球的**主接触是地面**（法向竖直），墙给的水平冲量在地面法向上的投影 ≈ 0、
    //     在地面**切向**上的投影 = −(1+e)·v（撞 500px/s ⇒ 760px/s）—— 判「法向突变」会把
    //     真正的撞墙漏掉；反过来，手绘笔画是复合体、表面起伏，球滚过每个小凸包都会吃一个
    //     **法向**大、切向≈0 的冲量 —— 判「法向突变」会把它们全算成撞击。
    //   ★为什么不用「滑移大小」判：慢速撞击（r119：34px/s ⇒ 反弹后滑移仅 52px/s）会被任何
    //     固定滑移阈值漏掉；而稳态滑移**不该由我消** —— 实测每子步自己施加静摩擦冲量去消滑移
    //     会和 Matter 的多接触约束打架，把笔画上的「虚假自旋」峰值从 0.44 抬到 0.77。
    //     稳态交给 Matter 的摩擦（它本来就把滑→滚收敛到纯滚动，R129 A 臂实测滑移恒 ≈0），
    //     我只管**撞击**。
    // 无滑移目标 ω（纯滚动应有的自旋）与当前 ω
    var wt=((ovx-mb.velocity.x)*ptx+(ovy-mb.velocity.y)*pty+ow*pcb)/pca;
    var slip=(mb.velocity.x-ovx)*ptx+(mb.velocity.y-ovy)*pty+mb.angularVelocity*pca-ow*pcb;
    // ★判据 = **球在「倒着滚」**（目标 ω 与实际 ω 反号）+ 滑移够大。这是撞墙反弹的独有指纹：
    //   反弹把平动翻向 −x，而墙的接触点在腰部、力矩 ≈0 ⇒ ω 纹丝不动 ⇒ 球变成「倒着走、正着转」。
    //   为什么不用事件型判据（本轮最贵的教训，_probe_r76 实证）：
    //     · 「滑移 > 阈值」—— 慢速撞击（r119：34px/s ⇒ 滑移仅 52px/s）会被固定阈值漏掉；
    //     · 「本子步切向速度突变 > 阈值」—— 撞墙那一子步**地面接触常常不活跃**（球被撞得微微
    //       离地），主接触落到墙上 ⇒ 切向投影 ≈0 ⇒ 漏判（实测 A 臂 ω=+6.0 纹丝不动）；
    //     · 「每子步施加静摩擦冲量消滑移」—— 手绘笔画是复合体、表面起伏，会和 Matter 的多接触
    //       约束打架，把「虚假自旋」峰值从 0.44 抬到 0.77（D2/D3 当场红）。
    //   状态型判据天然避开上面三条：稳态（含笔画上的虚假自旋）自旋与平动**同号** ⇒ 不触发；
    //   一旦触发就把 ω 写到无滑移值 ⇒ 滑移归零 ⇒ 自动不再触发（自限）。
    //   ★★滑移阈值必须**尺度无关**（_diag_r119 实证）：原先写死 90px/s ⇒ 慢速撞击
    //     （34px/s 入射、反弹后滑移仅 51.8px/s）被漏掉，球带着「正着转」的 ω 倒着走，
    //     摩擦把反弹速度啃光（−17.8→0）。改成 max(绝对值下限, 0.2·|v|)。
    if(muP>0){
      var spd=Math.sqrt(mb.velocity.x*mb.velocity.x+mb.velocity.y*mb.velocity.y)*60;
      var thr=Math.max(ROLL_BACK_SLIP_ABS,ROLL_BACK_SLIP_REL*spd);
      if(wt*mb.angularVelocity<0&&Math.abs(slip*60)>thr){
        // ② 倒着滚：ω 跟随 v —— 平动（碰撞刚给的）一个字不改，只把 ω 重算到纯滚动值
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
  // R72-B（用户：「弹性=1、从高空释放，越弹越高」—— 密集手绘开链实测复现：9s 内
  // ΣΔKE=+52、物体弹回 y<0 直接飞出屏幕顶）：逐点镜像在**多对同时接触**时（手绘笔画
  // 贴地的常态 —— 开链是一块复合体，每条贴地的段与地面各成一对）会累加超调：每一步的
  // 补入虽然都 ≤ 该点自己的入射量（单冲量 ΔKE=(vr0²−vr1²)/2K，精确、有界），但 N 个
  // 接触对共享的是同一条入射动能，各自「补到自己的镜像」加起来就能超过它。
  // 修法 = 守恒预算：本子步修正允许注入的动能上限 = 子步前（入射）总动能 KE0。
  // 修正只许把求解器丢掉的那部分补回来；预算耗尽就按精确公式截断成**部分反射**
  // （物理上 N 点同时全镜像本来就是超定方程，部分反射才是一致解）。下一子步重计预算。
  // 单接触的常见情形 s 恒为 1，行为与旧版逐点镜像完全一致 —— 守卫零成本。
  // R73-C：先补「本子步重力增量」，让 vr0 与求解器实际看到的一致（推导与标定见
  // ECF_GRAV_COMP 上方注释）。pre 里只有动态体（snapVelocities 跳过 isStatic），
  // 所以双方都动态时增量为共模、在 vr0 里自动抵消，一边静态时则正是求解器多看到的那一份。
  // R74-B：μ=0 极值体（EL_Z）走「速度大小恢复」路径，需要清洁预算 ——
  // ECF_GRAV_COMP=2.5 是给 EL 镜面路径标定的，下落阶段重力注能（每子步 vy+gdS）会把
  // 产品口径 budget=KE0−KEcur 污染成偏紧（KEcur 吃进了 1× 重力增益），实测
  // （_diag_r74_speedrestore）清洁口径把 μ=0 球凹槽滚动 7s 衰减从 -27% 拉到 -1.18%。
  // raw = 未加重力补偿的 snapVelocities 快照；gravGain = 本子步真实重力动能增量（1×）。
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
  var inZDone={};                        // R81-B：每子步每体只钳一次（凹槽多段同触→防过度移除）
  var list=MW.engine.pairs.list;
  for(var i=0;i<list.length;i++){
    var pr=list[i];
    if(!pr.isActive||pr.isSensor)continue;
    var col=pr.collision,A=col.parentA,B=col.parentB;
    var inEL=EL.indexOf(A)>=0||EL.indexOf(B)>=0;   // 用户声明 e≥1 的体
    var inZ=EL_Z.indexOf(A)>=0||EL_Z.indexOf(B)>=0; // μ=0 极值体
    if(!inEL&&!inZ)continue;
    // R74-B：μ=0 极值体（EL_Z）不查 pair.restitution —— ⑥ 置 1 在帧末才执行，
    // ECF 在子步内看到的还是出厂 0.52；名单本身就是判据。地面/墙门照旧：
    // μ=0 方块落地面维持 R72 语义（衰减弹跳），只有场上物体之间的曲面接触才补偿。
    if(inEL&&pr.restitution<0.999)continue;        // EL 场景：求解器子步内真按 e≥1 解（原语义）
    if(!inEL&&(A===MW.ground||A===MW.wl||A===MW.wr||A===MW.wt||B===MW.ground||B===MW.wl||B===MW.wr||B===MW.wt))continue;
    // 贴合滑动接触的 vr 只有 ~0.01 量级（VR_EPS=0.002 会把它们全当「没在接近」）——
    // EL_Z 场景放宽到 0.0005，让双接触接缝处的微干涉也能被预算机制精确补偿。
    var eps=inZ?0.0005:VR_EPS;
    // 注意字段名：Matter 0.20 求解器读的是 pair.contacts / pair.contactCount
    // （反编译实证：`B=m.contacts, M=m.contactCount`），activeContacts 是旧版命名。
    var cts=pr.contacts||pr.activeContacts;
    var ct=cts&&cts.length?cts[0]:null;
    if(!ct)continue;
    var n=col.normal,v=ct.vertex;
    var rAx=v.x-A.position.x,rAy=v.y-A.position.y;
    var rBx=v.x-B.position.x,rBy=v.y-B.position.y;
    var pA=pre[A.id]||[0,0,0],pB=pre[B.id]||[0,0,0];
    var vr0=n.x*((pA[0]-rAy*pA[2])-(pB[0]-rBy*pB[2]))
           +n.y*((pA[1]+rAx*pA[2])-(pB[1]+rBx*pB[2])); // 子步前接触点法向相对速度
    // R76-B：μ=0 滑动接触的 vr0≈0（球贴着表面滑、不弹跳），但曲面分段的方向离散仍在每子步
    // 杀速（实测凹槽内 85% 的 inZ 接触被这条「接近」门挡掉，补偿只覆盖 ~20% 损耗）。滑动与否
    // 改用速度本身判：resting 接触的 s0 ≈ gdS2（1e-4 量级），滑动接触的 s0 远大于阈值 ——
    // 见 inZ 分支内的 SLIDE_SPD 门。EL 路径（镜面反弹）保留原「接近」语义不动。
    if(vr0>=-eps&&!inZ)continue;                         // 不在接近 → 不管（仅 EL 镜面路径）
    var aAx=A.position.x-A.positionPrev.x,aAy=A.position.y-A.positionPrev.y,aAa=A.angle-A.anglePrev;
    var bBx=B.position.x-B.positionPrev.x,bBy=B.position.y-B.positionPrev.y,bBa=B.angle-B.anglePrev;
    var vr1=n.x*((aAx-rAy*aAa)-(bBx-rBy*bBa))
           +n.y*((aAy+rAx*aAa)-(bBy+rBx*bBa));         // 子步后
    if(inZ){
      // ===== R86-B：每体总速率恢复(预算限制) + 棘轮钳制,弹跳/滑动一视同仁 =====
      // R75-A 定量复测（用户①仍未解决，留档）：
      //   确定性夹具（shapeOutline->mkBoundary，几何逐位可复现）置于 μ=0 / e=0 / air=0，
      //   球在碗底上方 12px 落下并给水平初速，页面内 rAF 采样 9s，取每 1s 窗口的摆幅：
      //     基线(R87_post)  弧 28.42→19.02px(−33%)   凹槽 22.71→8.76px(−61%)
      //   ⇒ 「弧里没事」不成立：弧也在漏，只是比凹槽慢一倍。ECF 计数器（_dbg_r75/）：
      //     全场 2316 次调用、620 次 μ=0 接触、restore 命中 222 次，而 budCleanSum 只累积
      //     4.64 ⇒ 预算几乎总在 ~1e-12 被 capZero 掐断（42 次），补偿只落到残差零头。
      //   去掉预算门试跑（全额恢复）：凹槽末窗 8.76→11.60、弧 19.02→15.43 —— 一升一降，
      //   都在夹具抖动带内，且 R72-B 预算是不许动的不变式 ⇒ 已回退。
      //   真因（尚未修）：本条恢复目标是**自由落体速度幅度** s0=|v_raw+(0,gdS2)|。在水平面上
      //   这与「约束运动应有的速度」一致，但在**斜坡/凹面**上重力有切向分量，自由落体速度
      //   比约束速度大 ⇒ 过度补偿，恰好抵消掉求解器自身的损耗，净结果仍是慢速漏能。
      //   正解方向：恢复目标改成**切向速度**（求解器对 μ=0 的切向冲量公式与法向无关，
      //   见 solveVelocity 滑动分支 n=μ·sign(W)·(δ/baseΔ)³），法向交给 rest=1 的求解器。
      //
      // R85-B 用 dot<-0.3 判弹跳,滑动时 if(!bounced)continue 跳过恢复。但凹槽球
      // 始终在滑动(非弹跳),所以补偿从不触发 → 结果与 R84-B 完全相同(-46%)。
      //
      // 核心推导:budgetClean = KE0raw - KEcur + gravGain,其中 gravGain 恰好等于
      //   本子步重力动能增量(0.5*m*(2*vy*gdS2+gdS2²))。因此:
      //   budgetClean = (KE0raw + gravGain) - KEcur = expected_KE_post - actual_KE_post
      // 即 budgetClean 就是「无摩擦时球应该有的动能」减去「实际动能」,正是能量亏损。
      // 求解器对 μ=0 体只应移除法向重力分量(法向力对刚体面不做功),但 Baumgarte
      // 位置修正会额外吃掉切向能量 → 表现为 budgetClean>0 → 恢复即可。
      //
      // R86-B 移除 bounced 门:始终在 dKE>0 时预算限制恢复,dKE<0 时钳制。
      // 方向沿后求解器速度(qx,qy)缩放——求解器已处理方向(弹跳反射/滑动改向),
      // 只补幅度。inZDone 防多段同时处理同一体(凹槽 41 段)导致累加超调。
      // 静置门: s0<2*gdS2 → 跳过(球只受重力压在面上,无真实运动)。
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
          // 能量减少:预算限制恢复(弹跳/滑动均恢复——budgetClean 已扣除重力分量)
          // R75-A 试行过「去掉预算、全额恢复」：实测无净收益（凹槽末窗幅 8.76→11.60，弧 19.02
          // →15.43，都在夹具抖动带内），而 R72-B 的预算是不许动的不变式 ⇒ 已回退，见
          // 2026-09-15 记忆。曲面漏能的真因在下方 R75-A 注释里（ECF 用「自由落体速度」做
          // 恢复目标，在斜坡上会过度补偿，与求解器自身的损耗互相抵消，净剩 ~50%/9s）。
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
    // R72-B 守恒预算：施满 J 的精确动能增量 dke=(vr0²−vr1²)/2K。超出预算就求部分系数
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
