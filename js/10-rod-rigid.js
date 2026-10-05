/* 杆刚体、stepMatter、边界与形状（原 index.html 第 13840–15067 行） */
/* ============================ 杆是真刚体（冲量 ⇄ 力矩） ============================
 * 注：杆的 Matter 镜像板已删除（见 rebuildRodMirror），B.mb 为 null 时本节依赖镜像板的冲击反馈与支撑解算不生效。
 * 两条通道缺一不可：
 * ① 冲量通道：W-vs-杆 在 collideBodies 里被跳过（归 Matter 世界）；杆的镜像是 isStatic 的位置驱动薄板，
 *    求解器把 W 体弹开却不把反作用力还给杆。做法：在 240Hz 子步前后各量一次 W 体的求解器速度，
 *    其动量变化的反作用施加在杆的接触点上，按刚体冲量（Δω = r×J / I）换算成杆的 vx/vy/om（rodImpactFeedback）。
 * ② 角度积分：stepMatter 的子步循环里按 1/240 积分杆的 x/y/th（rodIntegrate），再同步镜像板。
 *    同步必须逐子步做：杆端速度可达 2500px/s，一帧 41px，没有 CCD 的求解器会让 48px 的方块直接穿过去。
 * 三条护栏（缺一条就退化）：
 *  · 只认冲击不认静置压力（WROD_VN_MIN）
 *  · 接触点速度增量封顶 = K×入射速度（WROD_TIP_K）：否则 2000:1 的质量比会把 ω 算到 1e4 rad/s 量级，等于瞬移
 *  · 耗散（ROD_VKEEP）：杆不受重力也没有支撑约束，不耗散就一次撞击永远转下去 */
var WROD_VN_MIN=25;      // px/s：接触点法向入射速度低于此 = 静置压力，不反馈
var WROD_TIP_K=2.0;      // 接触点速度增量上限 = K × 入射速度（弹性对撞的极限）
var WROD_VMAX=4000;      // px/s：杆的线速度硬上限（数值安全网）
var WROD_WMAX=25;        // rad/s：杆的角速度硬上限（上游已限 |ω|<30）
var ROD_VKEEP=0.25;      // 每秒保留比例（指数耗散）：0.25 ⇒ 1s 后剩 25%。
                         // 实测标定：0.12（1s 剩 12%）太快，杠杆刚被砸起来就泄掉；0.5 以上杆像陀螺转个不停。
                         // 0.25 时轻块上升最多（257px），且仍能被当场按停。
var ROD_SUB_DT=1/240;    // 杆的积分/约束步长（秒）——与 stepMatter 的 240Hz 子步一致
function rodMirrorOf(mb){return (mb&&mb._rodRef)?mb._rodRef:null;}
// 子步前的「求解器视角」速度：与 snapVelocities 同一口径（position − positionPrev），
// 因为 Matter 的 solveVelocity 全程只读写 positionPrev/anglePrev，velocity 字段是步末同步出来的。
function snapRodWPrev(pre){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.kind!=='W'||!B.mb||B.dead||B.mb.isStatic)continue;
    var b=B.mb,e=pre[b.id];
    if(!e)e=pre[b.id]=[0,0,0];
    e[0]=b.position.x-b.positionPrev.x;
    e[1]=b.position.y-b.positionPrev.y;
    e[2]=b.angle-b.anglePrev;
  }
}
// 子步后：把每一对「杆镜像板 ↔ W 体」的动量变化折算成杆的冲量。
function rodImpactFeedback(pre){
  var list=MW.engine.pairs.list,i;
  for(i=0;i<list.length;i++){
    var pr=list[i];
    if(!pr.isActive||pr.isSensor)continue;
    var col=pr.collision;
    if(!col)continue;
    var A=col.parentA,Bb=col.parentB;
    var rod=rodMirrorOf(A)||rodMirrorOf(Bb);
    if(!rod||rod.dead)continue;
    // 拖长度手柄时不吃冲击反馈：冻结期间 rodResolve 被跳过，`_hinge` 是上次的残值；冲量又加在 rod.vx/vy 上，会攒到松手时让整根杆飞出去。
    if(rodLenFrozen(rod))continue;
    // ---- 护栏④：只有铰接在静态支点上的杆才吃冲击动量（「搁板」与「杠杆」的分界）----
    // 悬空的杆按动量守恒会被落下的笔画敲沉（实测杆 y 500→578.6、th 0→0.49），杆一沉，笔画就穿过
    // 4px 厚的镜像板（Matter 没有 CCD）落到地面，「画出来的搁板」就失效了。悬空的杆背后没有东西接住反作用力；
    // 杆首先是用户画的地形，其次才是杠杆。铰接（支点托在杆中段，见 ROD_PIVOT_BAND）才是杠杆的成立条件。
    // 必须与 rodResolve 支撑循环对动态对方的筛选一起存在：否则压上来的笔画自己会被当成中段支点，悬空被判成铰接。
    if(!rod._hinge)continue;
    var D=rodMirrorOf(A)?Bb:A;                 // D = 撞在杆上的那个 W 体
    var p=pre[D.id];
    if(!p||D.isStatic)continue;
    var cts=pr.contacts||pr.activeContacts;
    var ct=cts&&cts.length?cts[0]:null;
    if(!ct)continue;
    var v=ct.vertex;
    // ---- 护栏①：静置压力不反馈 ----
    // 压着的重物每子步都会交给杆「支持力×Δt」的动量；杆没有重力也没有支撑约束，反馈了就会永远往下沉。
    // 判据用接触点法向入射速度：静置接触恒为 0（重力那份已被求解器抵平），真砸下来的才有量级。
    var rDx=v.x-D.position.x,rDy=v.y-D.position.y;
    var vpx=p[0]-rDy*p[2],vpy=p[1]+rDx*p[2];    // D 的接触点速度（含 ω×r，约定见 springHostVel）
    var vn=Math.abs(col.normal.x*vpx+col.normal.y*vpy)*60;   // px/s
    if(vn<WROD_VN_MIN)continue;
    var dvx=(D.position.x-D.positionPrev.x-p[0])*60,dvy=(D.position.y-D.positionPrev.y-p[1])*60;
    if(!dvx&&!dvy)continue;
    var mD=D.mass||1;                            // Matter 质量 = 自然质量 × wmass 乘数（见 applyParam）
    var Jx=-mD*dvx,Jy=-mD*dvy;                   // 杆受到的冲量 = −(W 体的动量变化)
    var mR=rodMassOf(rod);if(!(mR>1e-9))mR=1;
    var LT=rod.len||170,I=(mR*LT*LT)/12;if(!(I>1e-9))I=16000;
    var rRx=v.x-rod.x,rRy=v.y-rod.y;
    var dvRx=Jx/mR,dvRy=Jy/mR,dwR=(rRx*Jy-rRy*Jx)/I;
    // ---- 护栏②：接触点速度增量封顶 = K×入射速度 ----
    // 2000kg 砸在 1.88kg 的杆上按质量比算 Δω≈1.5e4 rad/s，等于瞬移。封顶取弹性对撞极限 2v
    // （极重撞击方 + 无约束轻杆的接触点速度上限），且随 vn 自标定：轻碰给得少，重砸给得多，不会变成开关。
    var tipx=dvRx-dwR*rRy,tipy=dvRy+dwR*rRx;
    var tip=Math.hypot(tipx,tipy),cap=WROD_TIP_K*vn;
    if(tip>cap&&tip>1e-9){var f=cap/tip;dvRx*=f;dvRy*=f;dwR*=f;}
    rod.vx=(rod.vx||0)+dvRx;rod.vy=(rod.vy||0)+dvRy;rod.om=(rod.om||0)+dwR;
    if(rod.vx>WROD_VMAX)rod.vx=WROD_VMAX;else if(rod.vx<-WROD_VMAX)rod.vx=-WROD_VMAX;
    if(rod.vy>WROD_VMAX)rod.vy=WROD_VMAX;else if(rod.vy<-WROD_VMAX)rod.vy=-WROD_VMAX;
    if(rod.om>WROD_WMAX)rod.om=WROD_WMAX;else if(rod.om<-WROD_WMAX)rod.om=-WROD_WMAX;
  }
}
// 杆的运动学积分（阶段①）：vx/vy/om → x/y/th + 耗散，dt 恒为子步 1/240 秒。
// 只表达「杆想去哪」，约束全在 rodResolve；两者必须分开，因为镜像板写入 Matter 有两种口径：
//   · 意图运动 → setPosition(...,true)：求解器看到的板速度 = 杆的真实运动（碰撞靠它把物块推起来）
//   · 穿透修正 → setPosition(...,false)：只挪位置，positionPrev 不动
// 不要把修正混进带速度的那次调用：等于每子步凭空给板 depth/dt 的速度，物体会被抛出屏幕（实测 y 冲到 −3e4）。
/* 已锚定端不响应「拖端点改长度」：否则会干扰双击解除吸附。 */
function rodEndLenDragAllowed(B,i){
  if(!B||B.kind!=='T'||!B.anc)return true;
  return !B.anc[i];           // 该端已锚定 ⇒ 不允许拖端点改长度
}
function rodIntegrate(B,dt){
  /* 不要在这里用 `!B.mb` 早退：杆镜像板已删除，B.mb 恒为 null，早退会连带跳过 rodSyncAnchors 的约束链
   * （PBD/回位/重建），松手后杆端回不到锚点（实测残差 237px）。杆位姿积分只用 x/y/th，与 mb 无关。 */
  if(B.dead)return false;
  if(grab&&grab.kind==='body'&&grab.obj===B)return false;   // 被抓住时姿态归指针，别抢
  if(rodLenFrozen(B))return false;                    // 拖长度手柄时同上
  // 锚点约束（位置投影 + 铰链速度投影）必须放在积分之后，这个顺序是契约：
  //   放之前，帧边界若落在「只积分不投影」的那一步，锚定端会被带走 v·dt（实测 1.7px 抖动）；
  //   放之后，每个子步结束时锚定端都精确落在锚点上。
  // 也不要用「sync 成功就 return false」跳过积分：先积分再投影（PBD 标准顺序），
  // 「宿主在动、杆速度为 0」的帧才会被投影搬走。
  if(B._lockRot)B.om=0;                              // 方向锁宿主：角速度保持 0（与 springSyncLocks 一致）
  var vx=B.vx||0,vy=B.vy||0,om=B.om||0;
  if(!vx&&!vy&&!om){rodSyncAnchors(B,dt);return false;}   // 静止的杆零开销（大多数帧都是这条）
  B.th=(B.th||0)+om*dt;
  B.x+=vx*dt;B.y+=vy*dt;
  // ---- 护栏③：耗散 ----
  // 杆是「轻质杆」= 无质量，不受重力（stepPhysics 的重力语句用 B.kind!=='T' 排除了杆）。
  // 杆悬在空中是正确行为，不要当成重力失效去修。杆与 W 体的区别在于谁积分：W 归 Matter，杆归 rodIntegrate。
  // 除了杆端锚点（rodSyncAnchors 的铰链投影）外杆没有持续支撑约束，冲量进来只能靠这里耗散。
  // 用与 dt 无关的指数衰减而不是逐帧乘常数：子步是 240Hz，逐帧乘会把「1 秒」变成 1/240 秒。
  var kd=Math.pow(ROD_VKEEP,dt);
  B.vx*=kd;B.vy*=kd;B.om*=kd;
  if(Math.abs(B.vx)<0.5)B.vx=0;
  if(Math.abs(B.vy)<0.5)B.vy=0;
  if(Math.abs(B.om)<0.002)B.om=0;
  // 积分之后再解锚点约束（顺序原因见函数开头）
  rodSyncAnchors(B,dt);
  return true;
}
// 杆的约束求解（阶段②）：地面 / 左右墙 / 别的物体的支撑。用接触冲量改速度，穿透用有界的位置推出处理，
// 返回值表示位置是否被改过。
// 两种朴素写法都不行：
//   ① 每子步把杆平移到不再穿透：转动没被表达，杆会沿地面一点点「爬」上去最后悬空；
//      改用带速度的 setPosition 更糟，每子步注入 depth/dt，物体被抛出屏幕。
//   ② 只清质心的法向速度：杆还在转，端点越压越深。
// 正解是在接触点上解刚体接触冲量 j = −(1+e)·vn / (1/m + (r×n)²/I)，平动与转动一起分摊
// （r×n 就是「撬」，与 collideBodies 里 T 杆那段同一公式）。e=0：支撑不反弹。
// 穿透不要用偏置速度：那是真实速度，深穿透时每子步给杆注入动能，杆会一路向上飘。
// 位置推出只改位置不进能量；冲量已掐掉继续压入的速度，推出量会自然收敛到 0。
var ROD_PUSH_FRAC=0.5;     // 每子步最多推出剩余穿透的多少
var ROD_PUSH_MAX=1.5;      // px/子步：单次位置推出的硬上限
// 支点带：接触点落在杆中段（沿轴偏移 < 该比例 × 半长）时，把这条接触当成铰链。
// 这是「跷跷板」与「滑动的板」的区别：没有它，杆被撬起时绕自己的质心转，端点一边升一边内缩，
// 压在端点的轻块会滑掉，杆本身也会沿支点漂走。铰接 = 质心被支点拴住 ⇒ 质心速度归零、只保留转动。
// 接触点在杆轴上时 r×n ≡ 0，所以铰链这一支不影响角速度，直接清掉质心速度即可。
var ROD_PIVOT_BAND=0.5;
// 静置接触的间隙容差（px）。杆无重力，被支撑解算推到零穿透后就地停住，不再压在支点上；
// 而 Matter.Collision.collides 只认穿透 ⇒ 杠杆的铰接会丢失。
// 因此 rodResolve 支撑循环里：慢速杆与合法支撑物间隙 ≤ 本值时，把镜像板朝对方虚压本值再测一次，
// 测到就以 pen=0 记接触（贴着不是穿透，不产生位置推出）。快杆不做补测：飞过支点旁 2px 就被铰住是 bug。
var ROD_REST_GAP=2;
/* 这个接触点是否落在某个已锚定端点附近？
 * 锚点吸在宿主表面上（hostClosestPoint），锚定端的碰撞镜像必然与宿主重叠几像素，那是铰链本身，不是干涉。
 * 不豁免的话 rodResolve 每子步把杆顶出去（推出量卡在 ROD_PUSH_MAX=1.5px），rodSyncAnchors 又拉回来，
 * 两者永久拉锯，锚点稳定偏 1.5px。 */
function rodEndAnchoredNear(B,x,y,tol){
  if(!B||!B.anc)return false;
  for(var i=0;i<2;i++){
    if(!B.anc[i])continue;
    var e=rodEndWorld(B,i);
    if(Math.hypot(e.x-x,e.y-y)<tol)return true;
  }
  return false;
}
// h 是否为本杆某个端点的锚定宿主（铰链的销穿在这个宿主上）。
// 只按接触点到销的距离豁免不够：杆贴着宿主表面垂下时，接触点在宿主下缘、离销很远，照样被顶开
// （残留恰好 = ROD_PUSH_MAX）。所以锚定宿主整体退出支撑解算：杆与它的重叠是销孔，不是干涉。
function rodAnchorHostOf(B,h){
  if(!B||!B.anc||!h)return false;
  for(var i=0;i<2;i++){var a=B.anc[i];if(a&&a.B===h)return true;}
  return false;
}
function rodResolve(B){
  if(B.dead||!B.mb)return;
  // 拖长度手柄时不解算：杆此刻归指针，穿透修正会与 setRodEnds 打架（一个往指针摆、一个往外推 ⇒ 端点抖）。
  if(rodLenFrozen(B))return;
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0),hl=Math.max(4,(B.len||170)/2),hh=ROD_HH;
  var LT=B.len||170;
  var mR=rodMassOf(B);if(!(mR>1e-9))mR=1;
  var I=(mR*LT*LT)/12;if(!(I>1e-9))I=16000;
  var dX=0,dY=0;                          // 本子步累计的位置推出量
  var pivotLock=false;                    // 本子步是否吃到过铰链接触
  // n = 把杆推离接触物的单位法向；p = 接触点（世界坐标）。pen = 该方向上的穿透。
  // 接触点速度含 ω×r：v_p = (vx − ω·r_y, vy + ω·r_x)，与 springHostVel / collideBodies 同约定。
  function impact(nx,ny,px,py,pen){
    var rx=px-B.x,ry=py-B.y;
    var sAlong=rx*c+ry*s;
    if(Math.abs(sAlong)<ROD_PIVOT_BAND*hl){
      B.vx=0;B.vy=0;                      // 铰链：质心被支点拴住（见 ROD_PIVOT_BAND 注释）
      pivotLock=true;
    }else{
      var vpx=(B.vx||0)-(B.om||0)*ry, vpy=(B.vy||0)+(B.om||0)*rx;
      var vn=vpx*nx+vpy*ny;
      if(vn<0){
        var rr=rx*ny-ry*nx;
        var K=1/mR+(rr*rr)/I;
        if(K>0){
          var j=-vn/K;                    // e=0：支撑不反弹，只把接触点的压入速度清零
          B.vx+=j*nx/mR;B.vy+=j*ny/mR;B.om+=(rx*(j*ny)-ry*(j*nx))/I;
        }
      }
    }
    if(pen>0){
      // 锚定端的接触只吸收冲量、不搬杆：那一端的位置归 rodSyncAnchors。
      // 按接触点到已锚定端点的距离判断，地面/墙/任何宿主一视同仁。
      if(!rodEndAnchoredNear(B,px,py,ROD_SNAP)){
        var push=pen*ROD_PUSH_FRAC;
        if(push>ROD_PUSH_MAX)push=ROD_PUSH_MAX;
        dX+=nx*push;dY+=ny*push;
      }
    }
  }
  // ---- 地面 / 左右墙：杆的墨迹是一条薄板（半厚 2，与 bndSegs 对杆的口径一致），两端点分别判
  for(var e=0;e<2;e++){
    var sx=(e?hl:-hl);
    var px=B.x+c*sx,py=B.y+s*sx;
    var ovG=py+hh-groundY;                                  // 墨迹下缘扎进地面多少
    if(ovG>0)impact(0,-1,px,py+hh,ovG);
    var ovL=-8-(px-hh);
    if(ovL>0)impact(1,0,px-hh,py,ovL);
    var ovR=(px+hh)-(W+8);
    if(ovR>0)impact(-1,0,px+hh,py,ovR);
  }
  // ---- 支撑：杆压在别的物体上时不许沉进去 ----
  // 杆的 Matter 镜像是 isStatic，支点也是静态体（右键固定的方块）时，两个静态体在 Matter 里不产生碰撞，
  // 杆会整根沉进支点。这里借 Matter 的接触几何，把杆按接触冲量顶出去；对方按不可推动处理
  // （与 collideBodies 里 W 体恒为 imm 一致）。
  // 出口方向必须自己算：一方完全落在另一方内部（4px 板插在 60px 方块里）时，Matter 的 collision.normal
  // 是最小单向重叠的投影方向，符号随 bodyA/bodyB 的 id 排序翻面，可能把杆朝支点更深处推。
  // 用「两个候选平移取小」自己定方向（等价 SAT 最小平移矢量）。
  // 包围盒用 Matter.Bounds.create(vertices) 现算：body.bounds 被 velocity 膨胀过。
  // 对方的筛选：静态对方一律认；动态 W 体只有位于杆心下方（O2.y > B.y+hh）时才认。
  //   · 不能排除全部动态体：形状工具画出的支点是动态 W 体，排除后 _hinge 恒 false，冲击通道被护栏④整条掐断
  //     （实测 500kg 落下：支点未固定时杆转角 0°、对侧 1kg 不动；固定时转角 55.3°、上升 22.9px）。
  //   · 也不能全认：压在悬空杆上的笔画会被当成支撑物，杆每子步被往下推，最后连同笔画落到地面。
  //     落体的中心必然在杆心上方，被方向判据排除。
  for(var k2=0;k2<bodies.length;k2++){
    var O2=bodies[k2];
    if(O2===B||O2.dead||O2.kind!=='W'||!O2.mb)continue;
    // 铰链的宿主不参与支撑解算（销孔 ≠ 干涉，见 rodAnchorHostOf）
    if(rodAnchorHostOf(B,O2))continue;
    if(!O2.mb.isStatic&&!(O2.y>B.y+hh))continue;
    var c2=Matter.Collision.collides(B.mb,O2.mb);
    // 静置补测：间隙 ≤ ROD_REST_GAP 时 Matter 不给接触，而无重力的杆恰好停在零穿透上（见 ROD_REST_GAP）。
    // 慢速杆把镜像板朝对方虚压 ROD_REST_GAP 再测；测到就带着虚压走完下面的几何与 impact
    // （pen 按 0 记，restNudge 在循环体末尾回退）。
    var restNudge=null;
    if((!c2||!c2.collided)
       &&Math.abs(B.vx||0)<40&&Math.abs(B.vy||0)<40&&Math.abs(B.om||0)<0.5){
      var rdx=O2.x-B.x,rdy=O2.y-B.y,rdl=Math.hypot(rdx,rdy)||1;
      restNudge={x:rdx/rdl*ROD_REST_GAP,y:rdy/rdl*ROD_REST_GAP};
      Matter.Body.translate(B.mb,restNudge);
      var c2r=Matter.Collision.collides(B.mb,O2.mb);
      if(c2r&&c2r.collided){c2=c2r;}
      else{Matter.Body.translate(B.mb,{x:-restNudge.x,y:-restNudge.y});restNudge=null;}
    }
    if(!c2||!c2.collided)continue;
    var bb=Matter.Bounds.create(B.mb.vertices),ob2=Matter.Bounds.create(O2.mb.vertices);
    var nx2,ny2,d2;
    if(Math.abs(c2.normal.x)>=Math.abs(c2.normal.y)){
      var mNegX=bb.max.x-ob2.min.x,mPosX=ob2.max.x-bb.min.x;
      nx2=(mNegX<mPosX)?-1:1;ny2=0;d2=(mNegX<mPosX)?mNegX:mPosX;
    }else{
      var mNegY=bb.max.y-ob2.min.y,mPosY=ob2.max.y-bb.min.y;
      nx2=0;ny2=(mNegY<mPosY)?-1:1;d2=(mNegY<mPosY)?mNegY:mPosY;
    }
    if(!(d2>0)&&!restNudge)continue;
    // 接触点：Matter 的 supports 是这条接触的两个支撑顶点（一个来自杆、一个来自对方），
    // 取中点即接触位置。只取到 1 个时就用那一个。
    var sp=c2.supports||[],s0=sp[0],s1=sp[1],cpx,cpy;
    if(s0&&s1){cpx=(s0.x+s1.x)/2;cpy=(s0.y+s1.y)/2;}
    else if(s0){cpx=s0.x;cpy=s0.y;}
    else{cpx=(B.x+O2.x)/2;cpy=(B.y+O2.y)/2;}
    // 静置补测命中的接触按 pen=0 记：贴着不是穿透（虚压状态下 d2 量到的是虚压本身 ~2px）。
    impact(nx2,ny2,cpx,cpy,restNudge?0:d2);
    // 销钉的横向约束：铰链落在哪个支点上，就把质心横向钉在该支点中心线上。
    // 只作废推出量不够：非铰链端的冲量可带水平分量（方块角撞杆端面时最小平移方向是水平的），
    // 杆会被整根推离支点。真实杠杆的销是刚性的。
    if(pivotLock){B.x+=(O2.x-B.x)*0.35;B.vx=0;}
    // 回退虚压平移：必须放在循环体末尾，上面的 supports/impact 都要用虚压后的几何
    if(restNudge){Matter.Body.translate(B.mb,{x:-restNudge.x,y:-restNudge.y});restNudge=null;}
  }
  // 销钉：本子步吃到过铰链接触 ⇒ 水平方向的位置修正全部作废（铰链只留转动自由度，
  // 否则冲量的水平分量会把杆推离支点）；竖直方向照常推出，那是不沉进支点的唯一保障。
  // B._hinge 供 rodImpactFeedback 的护栏④读取。
  B._hinge=pivotLock;
  if(pivotLock)dX=0;
  if(dX||dY){B.x+=dX;B.y+=dY;}
}
function stepMatter(dt){
  if(!MW)return;
  var i,B,anyW=false;
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind==='T'&&!B.mb&&!B.dead){
      // 把杆镜像成运动学静态薄板（建板参数与 setRodLen / 长度手柄共用 rebuildRodMirror）
      rebuildRodMirror(B);
    }
    if(B.kind==='T'&&B.mb&&!B.dead){
      B.mb._rodRef=B;    // 兜住「先建板、后补引用」的旧状态
      // 锚定签名变了（吸附/双击解除）⇒ 重建板（板端缩进随锚定状态变化）
      if(B._manc!==((B.anc[0]?1:0)|(B.anc[1]?2:0)))rebuildRodMirror(B);
    }
    if(B.kind==='W'&&!B.dead&&B.mb)anyW=true;
  }
  // 本帧的杆清单。早退条件要带上 RODS：场上没有 W 体时杆也要能被积分（被字母撞、被黑洞推）。
  var RODS=[];
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind==='T'&&!B.dead)RODS.push(B);
  }
  // 本帧的「圆」清单（模式化摩擦：高中=质点不自转 / 大学=纯滚动+滚阻）。
  var CB=(typeof circleRollBodies==='function')?circleRollBodies():null;
  if(!anyW&&!RODS.length){MW.acc=0;return;}
  // gravity is read EVERY frame, not baked in at engine creation: tests (and anything else)
  // may set GRAV=0 after the engine already exists; a value captured at creation would never update.
  MW.engine.gravity.y=GRAV/1000;
  // 杆的镜像同步不在这里做，必须逐 240Hz 子步做（一帧一同步 = 41px 的位移台阶，方块会被没有 CCD 的求解器穿过去）。
  // a boundary being dragged: the pointer owns the pose, matter only records zero velocity
  // 拖拽悬摆：提着物体的一个角拖时，物体按质量分布转到质心垂在抓点正下方。三重门全过才转——
  //   ① 悬空：贴地拖永不转（G.y+半宽 < groundY-8）；
  //   ② 力臂：抓点世界 x 偏移 |glx·c-gly·s| > DRAG_ROT_DEADBAND×max(hw,hh) —— 抓点在质心
  //      正上方的竖直中带里是「平衡区」，普通拖动不转；
  //   ③ 非方向锁装配宿主 / 非 fixed：装配体的姿态归弹簧管，悬摆不抢。
  // 平衡角：质心垂在抓点正下方 = 本地偏移的世界方向朝正上，thEq = -π/2 - atan2(gly,glx)。
  // 用临界阻尼式逼近（不模拟摆动，到位即停不过头），抓点离质心越远转得越干脆。
  // 抓点始终钉在指针上：转完用当前 th 反解质心位置（世界偏移 = R(th)·(glx,gly)）。
  if(grab.kind==='body'&&grab.obj&&grab.obj.kind==='W'&&grab.obj.mb){
    var G=grab.obj;
    var hw66=G.hw||30,hh66=G.hh||24,half66=Math.max(hw66,hh66);
    var glx66=grab.glx||0,gly66=grab.gly||0;
    var c66=Math.cos(G.th||0),s66=Math.sin(G.th||0);
    var air66=(G.y+half66)<groundY-8;
    var lever66=Math.abs(glx66*c66-gly66*s66);
    var canRot66=air66&&lever66>DRAG_ROT_DEADBAND*half66&&!G.fixed&&!G._lockRot&&!springLockedAsmOf(G);
    if(canRot66){
      var rl66=Math.sqrt(glx66*glx66+gly66*gly66);
      var thEq66=-Math.PI/2-Math.atan2(gly66,glx66);
      var k66=Math.min(10,Math.max(4,4+6*rl66/half66));
      G.th=(G.th||0)+shortAng(thEq66-(G.th||0))*Math.min(1,k66*dt);
      c66=Math.cos(G.th);s66=Math.sin(G.th);
    }
    var ox66=glx66*c66-gly66*s66,oy66=glx66*s66+gly66*c66;
    // 被导轨拴住的装配体只能沿轴拖（与 pointermove 共用 dragPtrAxis()）。
    // 这里是每帧执行的权威摆放（跑在 pointermove 之后），漏改它轴锁就完全失效。
    var p66=dragPtrAxis();
    G.x=clamp(p66.x-ox66,-hw66*0.6,W+hw66*0.6);
    G.y=clamp(p66.y-oy66,-hh66*0.6,groundY+hh66*0.9);
    // 轻绳/铰链约束也必须施加在这里（每帧的权威摆放）：否则指针目标会覆盖上一帧 conPull 的修正，
    // 箱子绕销轴自转而抓点钉在指针上，销轴端的锚点被甩出去（实测偏差长到 143px）。分配规则见 conDragConstrain。
    var pj66=conDragConstrain(G);
    if(pj66){G.x=pj66.x;G.y=pj66.y;}
    /* 被拖体上连着杆时再跑一遍投影（Gauss-Seidel 第二趟）：投影沿锚点连线搬另一端，搬动又改变连线方向与本地偏移，
     * 单趟在快拖时收不干净（残差 13~18px），加一趟即收敛到亚像素。只在确实连着杆时才加，绳/铰链行为不变。 */
    if(typeof rodSyncAnchors==='function'){
      var _hasRod=false;
      for(var _k=0;_k<bodies.length;_k++){var _b2=bodies[_k];
        if(_b2&&!_b2.dead&&_b2.kind==='T'&&_b2.anc&&
           ((_b2.anc[0]&&_b2.anc[0].B===G)||(_b2.anc[1]&&_b2.anc[1].B===G))){_hasRod=true;break;}}
      if(_hasRod){var pj2=conDragConstrain(G);if(pj2){G.x=pj2.x;G.y=pj2.y;}}
    }
    G.om=0;
    Matter.Body.setPosition(G.mb,{x:G.x,y:G.y});
    Matter.Body.setAngle(G.mb,G.th||0);
    Matter.Body.setVelocity(G.mb,{x:0,y:0});
    Matter.Body.setAngularVelocity(G.mb,0);
    Matter.Sleeping.set(G.mb,false);
    /* 被拖的是支撑体时，唤醒压在它上面的睡眠体，否则把地面拖走后球会悬在空中。 */
    if(G.mb&&(G.mb.isStatic||G.fixed))
      wakeSleepNear(G.x,G.y,(G.hw||0)+(G.hh||0)+80);
    /* 拖拽摆放之后立刻把连在被拖体上的杆摆正，否则杆位姿要等下一子步的 rodSyncAnchors 才更新，
     * 拖动期出现一帧滞后。只处理连在被拖体上的杆，不全场扫。 */
    if(typeof rodSyncAnchors==='function'){
      for(var _ri=0;_ri<bodies.length;_ri++){
        var _rb=bodies[_ri];
        if(!_rb||_rb.dead||_rb.kind!=='T'||!_rb.anc)continue;
        var _hA=_rb.anc[0]?_rb.anc[0].B:null,_hB=_rb.anc[1]?_rb.anc[1].B:null;
        if(_hA!==G&&_hB!==G)continue;
        try{rodSyncAnchors(_rb,0);}catch(e){}
        if(_rb.mb){Matter.Body.setPosition(_rb.mb,{x:_rb.x,y:_rb.y});Matter.Body.setAngle(_rb.mb,_rb.th||0);}
      }
    }
  }
  // 固定的边界正被旋转手柄拖动：角度由指针决定，Matter 只跟着转（静止体 setAngle 合法）
  if(grab.kind==='rot'&&grab.obj&&grab.obj.kind==='W'&&grab.obj.mb){
    var RB56=grab.obj;
    Matter.Body.setAngle(RB56.mb,RB56.th||0);
    Matter.Body.setAngularVelocity(RB56.mb,0);
    Matter.Sleeping.set(RB56.mb,false);
  }
  // fixed 1/60 steps on an accumulator, so matter runs in real time on any refresh rate.
  // Each 1/60 step is internally 4 sub-steps of 240 Hz: matter has NO continuous collision
  // detection, and a stroke that has fallen 440px moves 25px per 1/60 step — clean through
  // a 4px rod mirror. Sub-stepping brings the fastest fall down to 6.4px/substep, inside the
  // ~9px contact band (stroke half-thickness 7 + rod half-thickness 2).
  // 方向锁宿主的角速度必须在积分前清零：只在引擎步进之后（stepSprings）清，碰撞注入的角速度
  // 会在子步里真的转过一大截（实测 av=2 一帧转 1.9rad）。步进内的残余由下一次清零兜住。
  springSyncLocks();
  MW.acc+=dt;
  var n=0;
  // 本帧声明 e≥1 的体（没有则整套守卫不进快照、不进修正）
  var EL=perfectElasticMB(),PRE={};
  // 有杆时再建一份 W 体的子步前速度快照（与 PRE 同口径，只装 W 体）
  var PREW=RODS.length?{}:null;
  while(MW.acc>=1/60&&n<4){
    for(var s4=0;s4<4;s4++){
      // 子步前存求解器视角速度 → 子步 → 把 e≥1 接触的接触点法向相对速度还原成入射镜像。
      // 逐子步做：每个子步是一次独立的接触求解，逐子步纠正误差才不累积。μ=0 极值体（EL_Z）同样适用。
      if(EL.length||EL_Z.length)snapVelocities(PRE);
      // 杆先按 1/240 积分，再把镜像板推到新位姿。setPosition 第三参 true 让 Matter 把位移记成板的速度
      // （positionPrev 一起走），求解器算接触点相对速度读的就是它；不带速度则只做位置修正，方块被撬起但不飞。
      if(RODS.length){
        for(var r4=0;r4<RODS.length;r4++){
          var R4=RODS[r4];
          R4._xps=null;   // 杆被抓住时 rodIntegrate 早退不产快照 ⇒ 先清上一子步的残留
          // dt 单位是秒（vx/vy 是 px/s、om 是 rad/s），不是 Matter 的毫秒。
          // 传 1000/240 会让积分放大 1000 倍、耗散瞬间归零。
          rodIntegrate(R4,ROD_SUB_DT);
          /* 杆镜像板已删除，R4.mb 为 null 时跳过板的 setPosition/setAngle（否则 TypeError）。 */
          if(R4.mb){
            Matter.Body.setPosition(R4.mb,{x:R4.x,y:R4.y},true);
            Matter.Body.setAngle(R4.mb,R4.th||0,true);
          }
        }
        snapRodWPrev(PREW);
      }
      if(CB)circleRollSnap(CB);        // 必须在 Engine.update 之前（量的是接近速度）
      /* a 赋予的持续加速度逐子步施力，且必须紧挨 Engine.update 之前：Matter 每次 update 结束清 force，
       * 每帧只施一次只剩 1/4（见 applyGivenAccel）。 */
      applyGivenAccel(ROD_SUB_DT);
      Matter.Engine.update(MW.engine,1000/240);
      /* 杆宿主全量 XPBD 速度重建，必须在积分之后（完整子步位移 = rodSyncAnchors 快照 → 现位置），
       * 修轻杆摆动越摆越低，见 rodXPBDVel。 */
      if(RODS.length)rodXPBDVel(RODS);
      // 拖动中的轻质杆 = 拖整个装配体。必须逐子步、且在求解之后：宿主在子步里被重力带下去，
      // 只在 pointermove 里跟随的话指针一停就断开（见 rodDragPinHosts）。只对正被抓着的杆调用。
      if(grab.kind==='body'&&grab.obj&&grab.obj.kind==='T'&&!grab.obj.dead)
        rodDragPinHosts(grab.obj);
      /* 拖的是物体时，沿杆链把整条装配体一起解，否则多杆链会分离（见 rodDragPinChain）。 */
      if(grab.kind==='body'&&grab.obj&&!grab.obj.dead)rodDragPinChain(grab.obj);
      // S 族（弹簧/绳/铰链）同理（见 springDragPinRig）：逐子步、求解之后、只对正被抓着的体。
      if(grab.kind==='body'&&grab.obj&&grab.obj.kind==='S'&&!grab.obj.dead)
        springDragPinRig(grab.obj);
      // 边中点磁吸：拖到边中点附近时吸附过去。必须放在上面两条「跟指针」之后，顺序反了会被 pin 覆盖。
      // 逐子步、纯位置投影、幂等。
      if(grab.kind==='body'&&grab.obj&&!grab.obj.dead)midMagnetPullRig(grab.obj);
      /* 不要对被抓 W 体逐子步重钉：实测会让铰链拖拽的另一端逐帧爆震（位移 5.6→82.3px）。
       * 杆钟摆衰减的病根在 conDragConstrain 的帧级清速度，不在这里。 */
      // 从面板拖出、还没放下的虚影也要吸，否则虚影停在旁边、松手却跳到中点。
      if(typeof TOOL!=='undefined'&&TOOL&&TOOL.devDrag)midMagnetPullGhost();
      // 高中模式没有任何逐子步「写 ω」的通道（不强制纯滚动）。
      if(RODS.length){
        // 约束求解只改速度（位置由速度推进 + 穿透偏置速度），镜像板不必再写一次
        for(var r6=0;r6<RODS.length;r6++)rodResolve(RODS[r6]);
        rodImpactFeedback(PREW);
      }
      // 圆的模式化摩擦：逐子步，放在求解之后、e≥1 修正之前。滑移归位要赶在下一子步前，
      // 否则求解器会把它当真实滑移吃掉平动（表现为撞墙后速度骤降）。
      if(CB)circleRollStep(CB,ROD_SUB_DT);
      if(EL.length||EL_Z.length)elasticContactFix(PRE,EL);
    }
    MW.acc-=1/60;n++;
  }
  if(n===4)MW.acc=0;
  // 步进后全量刷新活动碰撞对：① frictionStatic 每帧刷成 min（Matter 新 pair 默认取 max，球在 μ=0 凹槽里
  // 滚动会被逐段静摩擦咬死）；② 极值接触对（有效 μ=0 或 e≥1）双方 frictionAir 归零；③ 非极值体按公式恢复。
  // 幂等，与 applyWFrict 的手动刷新不冲突。
  if(n>0)refreshAllPairs();
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind!=='W'||!B.mb)continue;
    B.x=B.mb.position.x;B.y=B.mb.position.y;B.th=B.mb.angle;
    // 「安定后自动吸附地面」已移除，这里只维护 _snapped 标记（被抓住时清零）。
    if(grab.kind==='body'&&grab.obj===B)B._snapped=false;
    else if(!B.fixed&&!B._snapped&&!B.dead){
      var vs7=B.mb.velocity;
      if(vs7.x*vs7.x+vs7.y*vs7.y<0.25){          // <0.5px/子步（120px/s）≈ 已安定
        /* 不要恢复每帧安定吸附：近地的弧会每帧重吸一次、位姿被反复回写，造成卡顿。 */
        B._snapped=true;   // 只留「别再试」的标记，不再做任何吸附
      }
    }
    // ---- 边界速度：用位姿差分，不用 Matter 的 velocity ----
    //  ① 静止接触里 Matter 会保留非零 velocity（靠每帧 positionImpulse 抵消位移）：静置的弧 mb.velocity.y
    //     恒约 2.6（≈156px/s），位置却不动，也进不了休眠。
    //  ② 把它当墙速喂给 bndHit / collideBodies，压在上面的物体每帧都被反弹一次，永久微弹。
    //  ③ 差分也有噪声：多段复合体静置时 Matter 有 1px 级求解器跳变（约每 15 帧上跳 1.2px 再落回），
    //     差出 ±72px/s 的假速度 → 亚像素运动按静止处理（死区）。边界是没有惯性、只能被拖动的铁砧，
    //     数值抖动不该传给压在上面的物体。
    if(B._px===undefined){B._px=B.x;B._py=B.y;B._pth=B.th;}
    var invdt=1/Math.max(1e-4,dt);
    var rvx=(B.x-B._px)*invdt,rvy=(B.y-B._py)*invdt;
    // vx/vy = 对外语义的「边界真实速度」（位姿差分），渲染以外的读取者（黑洞吸力累加、
    // 调试探针、验证脚本）都看它；rvx/rvy = 接触计算专用，多一层亚像素死区（见下）。
    B.vx=rvx;B.vy=rvy;
    B.rvx=(Math.abs(rvx)<W_V_DEAD)?0:rvx;
    B.rvy=(Math.abs(rvy)<W_V_DEAD)?0:rvy;
    B._px=B.x;B._py=B.y;B._pth=B.th;
    // ④ 静置检测：每 20 帧（约 0.33s）比一次快照，净位姿变化 < 1.6px 就让它睡。Matter 自己睡不着
    //    （①的幻影 velocity 让 motion 永远高于门限）；压在上面的物体会通过 Sleeping.afterCollisions
    //    反复唤醒它，所以必须能重复入睡。
    //    按净位移判而不是逐帧：多段复合体静置时会周期性上跳 1.2px 再落回，逐帧判永远攒不满静置帧数。
    //    同时看转角：绕质心原地倾倒时质心净位移接近 0，只看位移会把正在倒的物体冻在倾斜半空。
    // ⑤ 还要看窗口内的最大偏离（excursion）：弹跳体一起一落，净位移几乎为 0 却走了 ~27px，
    //    只看净位移会把它睡死在半空、永不苏醒。「净位移小」≠「没在动」。
    //    excursion 阈值复用 1.6px：静置跳变 ~1.2px 在门内，弹跳体是 20px 量级，差一个数量级。
    if(!B.mb.isStatic&&!(grab.kind==='body'&&grab.obj===B)){
      if(!B._snap)B._snap={x:B.x,y:B.y,th:B.th,n:0,ex:0};
      if(B._snap.ex===undefined)B._snap.ex=0;
      var exd=Math.abs(B.x-B._snap.x)+Math.abs(B.y-B._snap.y)+Math.abs(B.th-B._snap.th)*60;
      if(exd>B._snap.ex)B._snap.ex=exd;
      if(++B._snap.n>=20){
        var nd=Math.abs(B.x-B._snap.x)+Math.abs(B.y-B._snap.y)+Math.abs(B.th-B._snap.th)*60;
        if(nd<1.6&&B._snap.ex<1.6&&!B.mb.isSleeping)Matter.Sleeping.set(B.mb,true);
        B._snap={x:B.x,y:B.y,th:B.th,n:0,ex:0};
      }
    }else if(B._snap)B._snap.n=0;
    // 圆形是真实刚体：滚动角速度回传（松开时带着转）；形状/线保持 0 即可
    if(B.wshape==='circle'&&B.rad){B.om=B.mb.angularVelocity;}
    if(grab.kind==='body'&&grab.obj===B){B.vx=0;B.vy=0;B.rvx=0;B.rvy=0;B._px=B.x;B._py=B.y;}
  }
  // W 体回写之后把双端锚定的杆再摆一次姿态：杆位姿在子步内（Engine.update 之前）摆，W 体随后还会被积分，
  // 杆姿态恒滞后一帧（自由落体时实测 gap=17.1px，恰好一帧位移，看起来杆和体脱钩）。
  // 这里只摆姿态（setPosition/setAngle 不带速度），求解器口径仍以子步内那次为准；单端锚定杆由 rodSyncAnchors 自算。
  if(n>0&&RODS.length){
    for(var rq=0;rq<RODS.length;rq++){
      var RQ=RODS[rq];
      if(!RQ||RQ.dead||!RQ.anc||!RQ.anc[0]||!RQ.anc[1])continue;
      if(grab&&grab.obj===RQ&&(grab.kind==='body'||grab.kind==='rodlen'))continue;
      if(RQ.anc[0].B&&!RQ.anc[0].B.dead&&RQ.anc[1].B&&!RQ.anc[1].B.dead&&
         bodies.indexOf(RQ.anc[0].B)>=0&&bodies.indexOf(RQ.anc[1].B)>=0){
        var q0=springAnchoredWorld(RQ,0),q1=springAnchoredWorld(RQ,1);
        if(q0&&q1){
          RQ.x=(q0.x+q1.x)/2;RQ.y=(q0.y+q1.y)/2;
          RQ.th=(RQ.th||0)+shortAng(Math.atan2(q0.y-q1.y,q0.x-q1.x)-(RQ.th||0));  // shortAng 保持角度连续
          RQ.hw=RQ.len/2+2;
          if(MW&&RQ.mb){Matter.Body.setPosition(RQ.mb,{x:RQ.x,y:RQ.y});Matter.Body.setAngle(RQ.mb,RQ.th||0);}
        }
      }
    }
  }
}
/* ---- geometry ------------------------------------------------------------------------ */
function bndPts(B){
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0),out=[];
  for(var i=0;i<B.pts.length;i++){
    var p=B.pts[i];
    out.push([B.x+p[0]*c-p[1]*s,B.y+p[0]*s+p[1]*c]);
  }
  return out;
}
/* 开链笔画/圆弧的地面吸附（当前停用：snapWToGround 首行直接 return false）。
 * 只对开链生效（闭合图形姿态由重心决定，圆形没有朝下的平面）。判据缺一不可：
 *  · 够近：最低点的墨迹下缘离地面在 SNAP_D 之内（也允许轻微扎进地面）
 *  · 够平：最低点处的局部切线与水平夹角在 SNAP_A 之内
 * 满足就绕最低点把切线转成水平（最低点不动），再竖直平移使墨迹下缘落在地面线上：与地面平滑相接，无台阶。
 * force = 允许已固定的体参与吸附（拖拽松手路径）；返回 true 表示确实吸附了。 */
var SNAP_D=20;                        // 吸附带：离地面 20px 以内
var SNAP_A=Math.PI*9/180;             // 「即将水平」：与水平相差 9° 以内
function snapWToGround(B,force){
  /* 地面吸附已停用：调用点均已删除，这里直接返回 false，残留调用不会改位姿。
   * 停用原因：吸附不准，且每帧「安定触发」造成卡顿。 */
  return false;
  /* eslint-disable no-unreachable */
  if(!B||B.dead||B.kind!=='W'||B.closed)return false;
  if(B.fixed&&!force)return false;    // 固定体只在「拖拽松手」这条显式路径上吸附
  if(!B.pts||B.pts.length<2)return false;
  var wp=bndPts(B),n=wp.length,i;
  if(n<2)return false;
  var lo=-1e9,li=0;
  for(i=0;i<n;i++)if(wp[i][1]>lo){lo=wp[i][1];li=i;}
  var gap=groundY-(lo+BND_INK);              // 墨迹下缘到地面的净空（正 = 悬空）
  if(gap>SNAP_D)return false;                // 太高，够不着
  if(gap<-BND_INK*5)return false;            // 已经深埋，不是「接近」而是穿模了，别动它
  // 最低点处的局部切线：取相邻两点连成的方向（弧的采样足够密，等价于真切线）。
  // 注意开链：首/末点的邻居不能取模绕到另一端（会算出跨越整条线的假切线），端点处用唯一的内侧邻居。
  var pa,pb;
  if(li===0){pa=wp[0];pb=wp[1];}
  else if(li===n-1){pa=wp[n-2];pb=wp[n-1];}
  else {pa=wp[li-1];pb=wp[li+1];}
  var tx=pb[0]-pa[0],ty=pb[1]-pa[1];
  if(Math.abs(tx)<1e-6&&Math.abs(ty)<1e-6)return false;
  var d=Math.atan2(ty,tx);
  while(d>Math.PI/2)d-=Math.PI;              // 折到 (-90°,90°]，因为「水平」不分正反方向
  while(d<=-Math.PI/2)d+=Math.PI;
  if(Math.abs(d)>SNAP_A)return false;        // 不够平
  // 绕最低点旋转 -d：最低点在世界坐标里原地不动，只把切线摆平
  var px=wp[li][0],py=wp[li][1];
  var c0=Math.cos(-d),s0=Math.sin(-d);
  var vx=B.x-px,vy=B.y-py;
  B.x=px+vx*c0-vy*s0;
  B.y=py+vx*s0+vy*c0;
  B.th=(B.th||0)-d;
  // 再按旋转后的真实几何竖直平移，令墨迹下缘 == 地面线（自校正，不依赖上面的角度推导）
  var wp2=bndPts(B),lo2=-1e9;
  for(i=0;i<wp2.length;i++)if(wp2[i][1]>lo2)lo2=wp2[i][1];
  B.y+=groundY-(lo2+BND_INK);
  B.vx=0;B.vy=0;B.om=0;
  if(B.mb&&MW){
    Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});
    Matter.Body.setAngle(B.mb,B.th);
    Matter.Body.setVelocity(B.mb,{x:0,y:0});
    Matter.Body.setAngularVelocity(B.mb,0);
    Matter.Sleeping.set(B.mb,false);
  }
  return true;
}
// 悬浮/抓取命中 = 贴着线才算，空心内部不响应：图形是空心的，只有线是边界。
// 算指针到轮廓折线的最短距离，阈值 = 线半宽 + 抓取余量。
var INK_GRAB_PAD=11;                     // 线外再放宽 11px 便于点中（视觉线半宽约 4.65）
function nearInk(B,px,py){
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
function bndSegs(B){
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
function segCompoundInertia(mb){
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
function segCompound(parts,B,opt){
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
function mkBoundary(worldPts,opt){
  opt=opt||{};
  // A pen stroke is an OPEN line; a preset shape is a CLOSED ring. Same body, same physics —
  // only the caps and the last segment differ.
  var closed=(opt.closed!==false);
  var raw=[],i,j;
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
function shapeOutline(shape,x0,y0,x1,y1){
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
function shapeArcPts(cx,cy,rx,ry,a0,a1){
  // 段数强制奇数（n|=1）：偶数段时弧的扫过中点（最凹点）落在两段交界的 V 形接缝上，振荡的球会被楔住（同 tub 的 N6）。
  var sw=a1-a0,n=Math.max(20,Math.min(160,Math.ceil(Math.abs(sw)/0.09)))|1,pts=[],k;
  for(k=0;k<=n;k++){var a=a0+sw*k/n;pts.push([cx+Math.cos(a)*rx,cy+Math.sin(a)*ry]);}
  return {pts:pts,shape:'arc',open:true,ell:{cx:cx,cy:cy,rx:rx,ry:ry,a0:a0,a1:a1}};
}
function shapeDefault(shape,x,y){
  if(shape==='circle')return shapeOutline('circle',x-70,y-70,x+70,y+70);
  if(shape==='ring')return shapeOutline('ring',x-80,y-80,x+80,y+80);      // 空心圆：默认半径 80
  if(shape==='tri')return shapeOutline('tri',x-85,y-70,x+85,y+70);        // 默认斜边从左上到右下
  if(shape==='trough')return shapeOutline('trough',x-70,y-45,x+70,y+45);  // 默认开口朝上（滑梯）
  if(shape==='tub')return shapeOutline('tub',x-80,y-45,x+80,y+45);        // 默认开口朝上（浴缸）
  // 弧的默认形 = 圆心在落点、半径 70、右下象限 90° 弧（等价于按下后朝右下拖 70px）
  if(shape==='arc')return shapeArcPts(x,y,70,70,0,Math.PI/2);
  return shapeOutline('rect',x-80,y-45,x+80,y+45);
}
/* ---- ① ready-made wholes -------------------------------------------------------------- */
// Each preset is just "a mass letter + the letters merged into it" — the exact same assembly
// path copyBody() uses (massG as the base, mem[] merged in, then refresh()), so a preset is
// byte-for-byte what you get by dragging the same letters together.
// `tex` is the WRITTEN form of the very same formula — a tiny LaTeX subset (\frac{a}{b}, ^{2},
// \mu). It exists because a formula has to LOOK the way it is written on paper: the numerator
// stacked over the denominator with a rule between, superscripts raised. "mv^2/r" is computer
// notation and it is exactly what the menu must never show.
var WHOLE_PRESETS=[
  /* note 只写物理名称（定理/概念名），不写行为说明：行为描述是实现细节，物理一改就与实际对不上。 */
  {name:'mg',      tex:'mg',                 note:'重力',                mass:'m',mem:['g'],friction:0.01},
  {name:'ma',      tex:'ma',                 note:'牛顿第二定律',        mass:'m',mem:['a']},
  {name:'mv',      tex:'mv',                 note:'动量',                mass:'m',mem:['v']},
  {name:'mv²',     tex:'mv^{2}',             note:'动能',                mass:'m',mem:['v','v']},
  {name:'mv²/r',   tex:'\\frac{mv^{2}}{r}',  note:'向心力',              mass:'m',mem:['v','v','r']},
  /* tex 用标准 \frac{1}{2}mv^{2}（真上下分式）。mem 仍是单个 ½ 字形：那是物理组装体的内部表示，
   * 与显示无关，bossIsEk 认的也是它。 */
  {name:'½mv²',    tex:'\\frac{1}{2}mv^{2}',  note:'动能定理',            mass:'m',mem:[HALF,'v','v']},
  {name:'GMm/r²',  tex:'\\frac{GMm}{r^{2}}', note:'万有引力',            mass:'m',mem:['G','M','r','r']},
  {name:'2GM/c²',  tex:'\\frac{2GM}{c^{2}}', note:'史瓦西半径',          mass:'M',mem:['G','c','c']},
  {name:'mc²',     tex:'mc^{2}',             note:'质能方程',            mass:'m',mem:['c','c']},
  {name:'m(g+gμ)', tex:'m(g+g\\mu)',         note:'滑动摩擦',            mass:'m',mem:['g','g',MU]}
];
/* ---- written maths (a LaTeX subset -> HTML) -------------------------------------------
   Hand-rolled so the page stays ONE offline file (no KaTeX, no CDN, no network):
     \frac{mv^{2}}{r} -> mv² stacked over r with a rule between them
     mv^{2}           -> mv with a raised superscript 2
     \mu              -> μ
   Everything else is passed straight through; digits and operators are set upright while the
   letters inherit the italic of the .mth container — the way a hand-written formula looks. */
function mthHTML(tex){
  var S=String(tex==null?'':tex);
  function esc(c){return c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c;}
  function grp(s,i){                       // read one {...} group (or a single char) at s[i]
    if(s.charAt(i)!=='{')return {body:s.charAt(i),next:i+1};
    var d=0,j;
    for(j=i;j<s.length;j++){
      if(s.charAt(j)==='{')d++;
      else if(s.charAt(j)==='}'){d--;if(!d)return {body:s.slice(i+1,j),next:j+1};}
    }
    return {body:s.slice(i+1),next:s.length};
  }
  function run(s){
    var out='',i=0;
    while(i<s.length){
      var c=s.charAt(i);
      if(c==='\\'){
        var m=/^\\([a-zA-Z]+)/.exec(s.slice(i));
        var cmd=m?m[1]:'';
        if(cmd==='frac'){
          var a=grp(s,i+5),b=grp(s,a.next);
          /* 分数线做成独立元素 .fracbar（而非 .mnum 的 border-bottom）：DOM 顺序天然是「分子 → 横线 → 分母」，
           * 进 BOSS.chars 后可被逐个点亮（边框/伪元素做不到）。 */
          out+='<span class="mfrac"><span class="mnum">'+run(a.body)+'</span>'+
               '<span class="fracbar"></span>'+
               '<span class="mden">'+run(b.body)+'</span></span>';
          i=b.next;continue;
        }
        if(cmd==='mu'){out+='μ';i+=3;continue;}
        if(cmd==='cdot'){out+='<span class="mcoef">·</span>';i+=5;continue;}
        out+=esc(c);i++;continue;
      }
      if(c==='^'||c==='_'){                // superscript / subscript, braced or single char
        var g=grp(s,i+1);
        out+=(c==='^')?('<sup>'+run(g.body)+'</sup>'):('<sub>'+run(g.body)+'</sub>');
        i=g.next;continue;
      }
      out+=((c>='0'&&c<='9')?('<span class="mcoef">'+esc(c)+'</span>'):esc(c));
      i++;
    }
    return out;
  }
  return '<span class="mth">'+run(S)+'</span>';
}
function spawnWhole(ps,x,y){
  var massN=GD(ps.mass);massN.pop=0;
  var B=BODY(x,y);
  B.massG=massN;massN.body=B;
  B.glyphs=[];B.mem=[];
  var mm=[];
  for(var i=0;i<ps.mem.length;i++){var g=GD(ps.mem[i]);g.pop=0;B.mem.push(g);mm.push(g);}
  var list=[massN].concat(mm);
  list.forEach(function(g){g.body=B;g.inBody=true;B.glyphs.push(g);});
  // 摩擦预设：mg = 重力，地面摩擦极小（像冰面）；m(g+gμ) = 有 μ，用默认摩擦。
  // 由 WHOLE_PRESETS 的 friction 字段注入；μ 字母本身仍是 frict 参数（右键可调）。
  if(ps.friction!=null)B.frict=ps.friction;
  refresh(B);   // layoutRun/layoutFrac/anchorBox all centre the INK on B.x/B.y
  B.pop=1;B.vx=0;B.vy=0;
  return B;
}
