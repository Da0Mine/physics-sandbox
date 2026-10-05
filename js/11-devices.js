/* 器件：传送带 / 绳 / 铰链 / 地面、吸附提示（原 index.html 第 15068–16554 行） */
/* ================= 器件（DEVICES）：从面板直接拖出 =================
 * 不新造物理：每个器件复用已有的构造函数（弹簧 = makeSpring，与「把 k 和 x 拖到一起」拼出来的
 * 逐字段相同：同一默认 ks/阻尼/长度钳制，高中模式下同样拿到 auto 导轨）。器件表里每一项只需回答
 * 「给我一个落点，在那儿造一个默认尺寸的你」。
 *
 * 弹簧默认自然长度 SPR_SPAWN_LEN=110 = makeSpring 长度钳制 clamp(d,110,340) 的下限，也就是 kx 拼接
 * 实际拿到的值（两字母贴着放，间距必被夹到 110）。两条入口的物理参数 ks/bounc/mass/anc 本就相同，
 * 唯一独立差异是 len，其余（cur/hw/th/_ax/_ay/x/y）都是 len 与落点的派生量 ⇒ 默认 110 时两条入口完全一致。
 * 悬挂伸长 mg/k=2600/50=52px，对 110 是 +47% 伸长率，仍在合理范围。
 * 方向恒为水平：最常见的挂法，且是大学/高中两种模式下都合法的方向（高中只允许水平/竖直，
 * makeSpring 会自动补 auto 导轨）。放下后长度和方向都能改。
 */
// SPR_SPAWN_LEN 声明在「出生尺寸常量区」（紧邻 GROUND_SPAWN_LEN、PARAM_DEFS 之前）：
// 参数表 slen.def 在字面量求值时就要拿到值（var 提升只提升声明）。不要在这里重复声明。
/* 轻质杆：走同一个 makeRod，与 vt 拼接出来的杆逐字段相同（len=170、hasG=true、php=F*0.55、
 * refresh 后 hw=len/2+2）；ROD_SPAWN_LEN=170 即 makeRod 默认，两条入口默认参数一致。
 * makeRod 造的杆 kind==='T'，已在旋转手柄白名单里（refreshHover），无需新增；
 * 两端长度手柄走 setRodLen。 */
// ROD_SPAWN_LEN 声明在「出生尺寸常量区」（理由同 SPR_SPAWN_LEN）。
/* 传送带 = 一条画出来的闭合矩形（mkBoundary closed poly）+ 两个专属字段：
 *   B.belt=true   —— 渲染/参数面板认它；
 *   B.conv (px/s) —— 带面速度，沿本体 +x（随 th 旋转），可为负（反向）。
 * 复用 W 体而不新造 kind：拖动、固定、旋转、右键参数、解散、悬浮高亮等既有机器都能直接用它
 * （新 kind 意味着每一处都要补，必然漏）。
 * 默认带速 CONV_DEF 声明在 PX_PER_M 旁边：放在这里会让参数表 convspeed 的 def 求值时拿到 undefined。
 * 物理走 beltTract（见 collideBodies 上方注释：公式体没有 Matter 镜像，唯一有效的写入点是手写 SAT 通道）。 */
// BELT_SPAWN_LEN 声明在「出生尺寸常量区」（理由同 SPR_SPAWN_LEN）。
// BELT_TH（带子厚度）不属于出生尺寸、也不进参数表，留在这里。
var BELT_TH=20;
function makeBelt(cx,cy){
  var hl=BELT_SPAWN_LEN/2,ht=BELT_TH/2;
  var B=mkBoundary([[cx-hl,cy-ht],[cx+hl,cy-ht],[cx+hl,cy+ht],[cx-hl,cy+ht]],
                   {shape:'poly',closed:true});
  if(!B)return null;
  B.belt=true;
  B.conv=CONV_DEF;
  B.fixed=true;                                   // 传送带是钉在地上的机器，不是会掉的东西
  if(B.mb){Matter.Body.setStatic(B.mb,true);Matter.Sleeping.set(B.mb,false);}
  // 带面自带摩擦 μ=0.6（器件属性，不是世界默认）：否则高中模式「默认 μ 全 0」下传送带一放就完全打滑，
  // 用户会以为器件坏了。显式写进 B.wFrict ⇒ 参数面板读数即物理生效值；想打滑就把 μ 拖到 0。
  B.wFrict=0.6;applyWFrict(B);
  return B;
}
/* ================= 器件：光滑铰链 / 轻绳 =================
 * 两者都复用 kind==='S' + 布尔标志（B.rope / B.hinge），不新造 kind：大量 kind==='S' 分派
 * （两端锚定 anc/ox/oy、端点拖拽、悬浮高亮、springMoveRig、复制、双击解散、碰撞幽灵化、
 * 垃圾桶、参数面板）都直接认它；新 kind 必然漏改某处（拖不动 / 删不掉 / 面板写不进物理）。
 * 只在必须分派的五处判断标志：力律（stepSprings）、渲染（render 的 'S' 分支）、
 * 参数行（paramDef/paramV/applyParam）、名称（bodyName）、不参与碰撞（springMirror）。
 *
 * ---- 光滑铰链（无摩擦转动副）----
 * 两锚点必须重合（双边约束，拉推都管），不约束相对转动：只传力、不传力矩。
 * 与杆的单端锚定不同：杆锚定是位置驱动（摆到锚点上，不反算宿主受力），挂墙可以、撬重物不行；
 * 铰链是真正的双边约束，冲量按 1/m 与 1/I 分配后同时作用在两个宿主上，双摆、曲柄这类
 * 两端都是动力学体的装配才成立。
 * 求解 = 位置投影（限幅 CON_MAXSTEP，防初始大偏差瞬移）+ 二维点约束冲量投影（含转动项）。
 *
 * ---- 轻绳（不可伸长、只拉不压）----
 * 单边约束：d ≤ len 时完全不受力（松弛）；d > len 才绷直。绷直是非弹性的：位置拉回 + 只消掉
 * 分离方向的相对速度，接近方向不动（绳不能推）。
 * 与弹簧的区别：弹簧会推会拉、d 在 len 两侧振荡；轻绳只拉不推，d 永远 ≤ len + 容差。
 * 无 Matter 镜像：弹簧线圈是实物（有薄板镜像），轻绳理想化为只传张力的连线。
 * 参数只有绳长（理想轻绳无内耗；绷直时的非弹性响应本身就在耗散）。
 *
 * ---- 量纲 ----
 * 求解器全部在 Matter 本体口径里算：mb.velocity / mb.angularVelocity 是「每 1/60 步」的值
 * （真值 = ×60），冲量 J 同一口径，位置修正是 px。Δv(每步) = J·(1/m)、J = −v_rel(每步)/k 两边自洽，
 * 不需要任何 60 倍换算。
 * 不要在这里改写 h.vx/h.vy：它们由 stepMatter 每帧用位置差分重建，插手会造成同一帧两套速度错位；
 * 冲量只留在 Matter 域内。
 */
// ROPE_SPAWN_LEN 声明在「出生尺寸常量区」（理由同 SPR_SPAWN_LEN）。
var ROPE_MIN_LEN=20, ROPE_MAX_LEN=2000;
// 落点虚影的视觉垂度（px）：只喂给 drawRope 的第二个实参，不改 B.len、不改 makeRope。
// 放下后 B.len 严格等于跨度（ROPE_SPAWN_LEN），静置时绷直须画直线；虚影则额外加垂度，
// 走 drawRope 同一条下垂弧分支，与 chip 的波浪单线读起来是同一件东西。
// 取值注意：drawRope 用 quadraticCurveTo，控制点偏移 sag 的实际最大垂深只有 sag/2，
//   而 sag=min(slack·0.55,90) ⇒ 可见垂深 = slack·0.275。取 50 ⇒ 可见 13.75px（110px 弦的 12.5%）；
//   取 26 只有 7.15px（6.5%），看不出是绳。纯渲染参数。
var ROPE_GHOST_SAG=50;
var CON_MAXSTEP=12;              // 约束每帧位置修正的限幅（px）：初始大偏差平滑收敛而不是瞬移
// 轻绳/铰链的每帧位置修正步长：拖动端也参与位移分配（conPull 的 allowGrab，见 conMov），
//   一帧的修正能力必须盖得住指针一帧的位移。stepSprings 每帧只跑一次；实测 CON_MAXSTEP=12 时
//   30px/帧 的拖速会把 d 顶到 415px，取 48 时 d 全程 ≤ len+1.5。
var CON_DRAG_STEP=48;
function makeRope(ax,ay,bx,by){
  var dx=bx-ax,dy=by-ay,d=Math.hypot(dx,dy);
  if(d<1){dx=1;dy=0;d=1;}
  var len=clamp(d,ROPE_MIN_LEN,ROPE_MAX_LEN);
  var ex=ax+dx/d*len,ey=ay+dy/d*len;
  var B=BODY((ax+ex)/2,(ay+ey)/2);
  B.kind='S';
  B.rope=true;
  B.e0={x:ax,y:ay};B.e1={x:ex,y:ey};
  B.anc=[null,null];
  B.len=len;
  B.bounc=0;
  refreshSpringGeom(B);
  initRopeNodes(B);          // 链化：柔性绳的离散节点（见下）
  return B;
}
/* ================= 柔性绳（verlet 链）：阻断 + 耷拉 =================
 * 绳 = 离散质点链（verlet），会被物体阻断并耷拉在上面：
 *   · 中间节点：B.nodes（不含两端；两端 = e0/e1，由宿主锚定 / ropeSolve 管辖，链不篡改）；
 *   · 每帧 ropeVerletStep：节点重力 verlet 积分 → 段长约束迭代（两端钉死，来回各一遍）→
 *     节点-物体碰撞（Matter.Query.point 判定 + hostClosestPoint 推到最近表面点外 1px）；
 *   · 绷直拉拽语义仍由 ropeSolve 负责（e0/e1 距离 > len 时的 conPull/conProj）——
 *     链几何保证「端距 ≤ 链总长」，链被拉直时自然成直线，两套机制不冲突；
 *   · 绳长改变（springSetLen）→ initRopeNodes 沿新 e0/e1 重铺；加载/旧数据 → 调用点兜底链化；
 *   · 渲染：有 nodes 走链形，无 nodes（ghost/兼容）走抛物线。
 * 已知限制：节点不把质量分配回宿主（链对宿主只有 e0/e1 两点约束），绳重不压弯宿主；
 *   节点碰撞是「推出」不是冲量，不会把物体撞动 —— 符合理想轻绳无质量的语义。 */
var ROPE_NODE_GAP=26;        // 节点平均间距（px）：链的空间分辨率（3~36 段自动适配绳长）
var ROPE_VERLET_DAMP=0.95;   // 节点速度保留率：松弛链晃动 ~1s 内进冻结门（轻绳无质量、准静态，快安定更真实）
var ROPE_COLLIDE_ITER=3;     // 段长约束+碰撞的迭代轮数
/* 两个让链停住的门：
 *   · ROPE_TAUT_EPS 绷直判据：端距 de ≥ len−0.5 时，满足「链总长=len、两端钉死」的构型只有直线
 *     ⇒ 直接等分铺点 + 清 verlet 速度（px=x/py=y），跳过本帧积分/约束。否则重力每帧把节点往下坠、
 *     只拉不推的段约束再拉回，位移全变成节点速度 ⇒ 放下即弯、晃好几秒（实测 0.25s 内垂度 0→7.95px）。
 *   · ROPE_SETTLE 静止冻结门：松弛链收敛后（本帧最大节点位移 < 0.03px）把 px/py 对齐 x/y
 *     ⇒ verlet 速度清零，链彻底停住；单靠阻尼要几十帧才耗完。 */
var ROPE_TAUT_EPS=0.5;       // 绷直判据（px）：端距距 len 不足此值视为绷直
var ROPE_SETTLE=0.03;        // 静止冻结门（px/帧）：最大节点位移低于此值即冻结
function ropeSegCount(len){return clamp(Math.round((len||100)/ROPE_NODE_GAP),3,36);}
function initRopeNodes(B){
  if(!B||!B.rope)return;
  var n=ropeSegCount(B.len);
  B._segLen=(B.len||100)/n;
  var ns=[];
  for(var i=1;i<n;i++){
    var t=i/n;
    var x=B.e0.x+(B.e1.x-B.e0.x)*t, y=B.e0.y+(B.e1.y-B.e0.y)*t;
    ns.push({x:x,y:y,px:x,py:y});
  }
  B.nodes=ns;
}
var _ropeHitBuf=[];
function ropeCollidables(B){           // 可碰撞实体：一切有 Matter 体的非 S 族（W/杆镜像/带子/字母刚体）
  /* 排除绳自己的锚宿主：绳端钉在宿主表面，端旁节点落进宿主内部属正常几何；
   * 若推出，会与钉死端的段约束打架 ⇒ 端部锯齿跳动。 */
  _ropeHitBuf.length=0;
  var ex0=(B&&B.anc[0]&&B.anc[0].B&&!B.anc[0].B.dead)?B.anc[0].B:null,
      ex1=(B&&B.anc[1]&&B.anc[1].B&&!B.anc[1].B.dead)?B.anc[1].B:null;
  for(var i=0;i<bodies.length;i++){
    var b=bodies[i];
    if(b.dead||!b.mb||b.kind==='S')continue;
    if(b===ex0||b===ex1)continue;
    _ropeHitBuf.push(b.mb);
  }
  return _ropeHitBuf;
}
function ropeVerletStep(B,dt){
  var ns=B.nodes;
  if(!ns||!ns.length)return;
  /* 绷直态直线精确解：端距 ≥ len−eps 时唯一满足约束的构型就是直线，
   * 直接铺点并清速度、跳过积分 —— 出生即直、绷直期间零晃动。 */
  var dxe=B.e1.x-B.e0.x,dye=B.e1.y-B.e0.y,de=Math.hypot(dxe,dye)||1e-6;
  if(de>=(B.len||0)-ROPE_TAUT_EPS){
    var uxe=dxe/de,uye=dye/de,nn=ns.length+1;
    for(var i0=0;i0<ns.length;i0++){var tt=(i0+1)/nn,nd0=ns[i0];
      nd0.x=B.e0.x+dxe*tt;nd0.y=B.e0.y+dye*tt;nd0.px=nd0.x;nd0.py=nd0.y;}
    /* 绷直 ≠ 免碰撞：铺完直线后仍要做一次推出，否则障碍压在绳线上时节点全在物体内、
     * 永远不推出（绳从方块正中切过）。障碍上的节点贴到最近表面外 1px，绳沿障碍表面凸出。
     * 无余量还要弯对无质量绳没有严格解，这里取视觉正确。
     * 无障碍时 bounds 粗筛即排除，绷直快路径不受影响。 */
    if(Matter.Query&&Matter.Query.point){
      var mbs0=ropeCollidables(B);
      if(mbs0.length){
        var bx0=Math.min(B.e0.x,B.e1.x),by0=Math.min(B.e0.y,B.e1.y),
            bx1=Math.max(B.e0.x,B.e1.x),by1=Math.max(B.e0.y,B.e1.y);
        for(var q3=0;q3<mbs0.length;q3++){
          var b3=mbs0[q3],bd3=b3.bounds;
          if(bd3.max.x<bx0||bd3.min.x>bx1||bd3.max.y<by0||bd3.min.y>by1)continue;
          for(var j3=0;j3<ns.length;j3++){
            var nd3=ns[j3];
            if(nd3.x<bx0||nd3.x>bx1||nd3.y<by0||nd3.y>by1)continue;
            var h3=Matter.Query.point([b3],nd3);
            if(h3&&h3.length){
              var hB3=null;
              for(var k3=0;k3<bodies.length;k3++)if(bodies[k3].mb===b3){hB3=bodies[k3];break;}
              if(!hB3)continue;
              var qq=(typeof hostClosestPoint==='function')?hostClosestPoint(hB3,nd3.x,nd3.y):null;
              if(qq){
                var ox3=qq.x-b3.position.x,oy3=qq.y-b3.position.y,ol3=Math.hypot(ox3,oy3)||1;
                nd3.x=qq.x+ox3/ol3;nd3.y=qq.y+oy3/ol3;nd3.px=nd3.x;nd3.py=nd3.y;
              }
            }
          }
        }
      }
    }
    return;
  }
  var g=GRAV*dt*dt;
  var mbs=ropeCollidables(B);
  var i,k,nd;
  // ① verlet 积分
  for(i=0;i<ns.length;i++){
    nd=ns[i];
    var vx=(nd.x-nd.px)*ROPE_VERLET_DAMP, vy=(nd.y-nd.py)*ROPE_VERLET_DAMP;
    nd.px=nd.x;nd.py=nd.y;
    nd.x+=vx;nd.y+=vy+g;
  }
  // ②③ 段长约束（e0/e1 两端钉死、来回各一遍）+ 碰撞阻断（每轮末以碰撞为准）
  // 段约束只拉不推（d>segLen 才收）：绳只抗拉不抗压。若双向约束，两钉死端之间受压的链会像细杆
  //   一样屈曲成锯齿，叠加重力注入与碰撞推出 ⇒ 锯齿形态 + 永不收敛的跳动。
  for(var it=0;it<ROPE_COLLIDE_ITER;it++){
    var px_=B.e0.x,py_=B.e0.y;
    for(i=0;i<ns.length;i++){          // 正向：e0 端钉死
      nd=ns[i];
      var dx1=nd.x-px_,dy1=nd.y-py_,d1=Math.hypot(dx1,dy1)||1e-6;
      if(d1>B._segLen){
        var f1=(d1-B._segLen)/d1;
        nd.x-=dx1*f1;nd.y-=dy1*f1;
      }
      px_=nd.x;py_=nd.y;
    }
    px_=B.e1.x;py_=B.e1.y;
    for(i=ns.length-1;i>=0;i--){       // 反向：e1 端钉死
      nd=ns[i];
      var dx2=nd.x-px_,dy2=nd.y-py_,d2=Math.hypot(dx2,dy2)||1e-6;
      if(d2>B._segLen){
        var f2=(d2-B._segLen)/d2;
        nd.x-=dx2*f2;nd.y-=dy2*f2;
      }
      px_=nd.x;py_=nd.y;
    }
    if(Matter.Query&&Matter.Query.point&&mbs.length){
      for(i=0;i<ns.length;i++){
        nd=ns[i];
        var hits=Matter.Query.point(mbs,{x:nd.x,y:nd.y});
        if(hits&&hits.length){
          var hitMb=hits[0],hB=null;
          for(k=0;k<bodies.length;k++)if(bodies[k].mb===hitMb){hB=bodies[k];break;}
          if(!hB)continue;
          /* 最近表面点用本帧起始位置（px/py = 积分前位置）选面，而不是切进体内后的当前位置：
           * 后者会把相邻节点推到障碍的不同侧面（一个贴顶、一个贴底），段直接横穿物体。
           * 用起始位置 ⇒ 绳从哪侧来就贴哪侧，实现绕行。 */
          var q=(typeof hostClosestPoint==='function')?hostClosestPoint(hB,nd.px,nd.py):null;
          if(!q)q=(typeof hostClosestPoint==='function')?hostClosestPoint(hB,nd.x,nd.y):null;
          if(q){
            var oxq=q.x-hitMb.position.x,oyq=q.y-hitMb.position.y,ol=Math.hypot(oxq,oyq)||1;
            nd.x=q.x+oxq/ol;nd.y=q.y+oyq/ol;    // 推出表面 1px（防 Query 边界抖动）
            nd.px=nd.x;nd.py=nd.y;              // 推出不攒速度（轻绳无质量，位置修正不注能）
          }
        }
      }
    }
  }
  /* 静止冻结：本帧最大节点位移低于 ROPE_SETTLE ⇒ px/py 对齐 x/y（verlet 速度清零），
   * 链彻底停住；否则阻尼要几十帧才耗完，看起来像绳子自己在动。 */
  var _mv=0;
  for(var i2=0;i2<ns.length;i2++){var nd2=ns[i2];
    var mvi=Math.abs(nd2.x-nd2.px)+Math.abs(nd2.y-nd2.py);if(mvi>_mv)_mv=mvi;}
  if(_mv<ROPE_SETTLE){
    for(i2=0;i2<ns.length;i2++){ns[i2].px=ns[i2].x;ns[i2].py=ns[i2].y;}
  }
}
// 光滑铰链：长度恒 0（两锚点重合）。不设 ks/damp —— 它是约束不是弹簧。
function makeHinge(cx,cy){
  var B=BODY(cx,cy);
  B.kind='S';
  B.hinge=true;
  B.e0={x:cx,y:cy};B.e1={x:cx,y:cy};
  B.anc=[null,null];
  B.len=0;
  B.bounc=0;
  refreshSpringGeom(B);
  return B;
}
// ---- 统一的两点约束求解器（轻绳 / 铰链共用）----
// 单位冲量在某点沿 n 产生的法向速度：k = 1/m + (r×n)²/I。
// 转动项即「偏心冲量会把物体转起来」：少了它，挂在球边缘时球不会被拽正，
// 而是以偏挂姿态僵在半空（弹簧上踩过同样的坑）。
function conVel(h,px,py,nx,ny){
  if(!h||!h.mb)return 0;
  var v=h.mb.velocity||{x:0,y:0};
  var s=v.x*nx+v.y*ny;
  if(h.mb.angularVelocity){
    var rx=px-h.mb.position.x,ry=py-h.mb.position.y;
    s+=h.mb.angularVelocity*(rx*ny-ry*nx);
  }
  return s;
}
// 「这一侧吃不吃冲量、吃多少」。null = 完全动不了：static / fixed / 正被鼠标拖的 /
// 正被长度手柄按住的杆 / 弹簧这种无质量幽灵。指针与外部位移源不能被约束改写：
// 拖拽端在约束里等于无穷大质量，约束只搬另一端。
function conSide(h,nx,ny,px,py){
  if(!h||!h.mb||h.dead)return null;
  if(h.kind==='S')return null;
  if(typeof grab!=='undefined'&&grab&&grab.kind==='body'&&grab.obj===h)return null;
  if(typeof rodLenFrozen==='function'&&rodLenFrozen(h))return null;
  var mb=h.mb,im=(mb.inverseMass!=null)?mb.inverseMass:0;
  if(!(im>0))return null;                        // isStatic / 被 setStatic 过：inverseMass = 0
  var ii=(mb.inverseInertia!=null)?mb.inverseInertia:0;
  var rx=px-mb.position.x,ry=py-mb.position.y,cr=rx*ny-ry*nx;
  return {k:im+cr*cr*ii,im:im,ii:ii,cr:cr};
}
function conPush(h,s,nx,ny,J){
  if(!s||!h||!h.mb)return;
  var mb=h.mb,v=mb.velocity||{x:0,y:0};
  Matter.Body.setVelocity(mb,{x:v.x+nx*J*s.im,y:v.y+ny*J*s.im});
  if(s.ii&&s.cr)Matter.Body.setAngularVelocity(mb,(mb.angularVelocity||0)+s.cr*J*s.ii);
  if(Matter.Sleeping)Matter.Sleeping.set(mb,false);
}
// 沿 n 把两个物质点的相对速度投影成 0。onlySep=true 时只在「正在分离」时才动手
// —— 轻绳的单边语义：会拉，绝不推。
function conProj(h0,px0,py0,h1,px1,py1,nx,ny,onlySep){
  var s0=conSide(h0,nx,ny,px0,py0),s1=conSide(h1,nx,ny,px1,py1);
  var kk=(s0?s0.k:0)+(s1?s1.k:0);
  if(!(kk>1e-12))return 0;
  var vr=conVel(h1,px1,py1,nx,ny)-conVel(h0,px0,py0,nx,ny);
  if(onlySep&&!(vr>0))return 0;
  // 符号约定（别改）：n 由 e0 指向 e1，vr = (v1−v0)·n（>0 = 两端在远离）；J = 施加在 h0 上沿 +n 的冲量
  //   ⇒ Δv0·n = +J/m0、Δv1·n = −J/m1 ⇒ vr' = vr − J·kk，令 vr'=0 得 J = +vr/kk。
  //   写成 −vr/kk 会让 vr' = 2·vr，每帧把分离速度翻倍（悬挂载荷 1.5s 掉 287px），而代码照常运行不报错。
  var J=vr/kk;
  conPush(h0,s0,nx,ny,J);
  conPush(h1,s1,nx,ny,-J);
  return J;
}
// 位置修正用的「动得了的程度」（只要 1/m，与转动无关）。
// allowGrab 只给轻绳/铰链的位置修正开口：拖拽端在冲量通道（conSide）里仍当无穷大质量（不跟指针抢）；
//   但若位置通道也把它归零，就没有任何通道能把它拉回，指针每帧外搬一点，d 一路涨到 368px（脱离物体还拖一根线）。
// 让拖动端按 1/m 参与 conPull 的位移分配：两端都可动 ⇒ 一起走；另一端是铁砧 ⇒ 全由拖拽端吸收。
// 不要改用「求解器末端另加夹子否决越界位移」：它绕过 CON_MAXSTEP 平滑收敛，与 Matter 自走形成正反馈，
//   帧内修正量单调增长（20.8→219.7px），还会把被拖物体顶进铁砧。
function conMov(h,allowGrab){
  if(!h||!h.mb||h.dead)return 0;
  if(h.kind==='S')return 0;
  if(!allowGrab&&typeof grab!=='undefined'&&grab&&grab.kind==='body'&&grab.obj===h)return 0;
  if(typeof rodLenFrozen==='function'&&rodLenFrozen(h))return 0;
  var im=(h.mb.inverseMass!=null)?h.mb.inverseMass:0;
  return im>0?im:0;
}
// 把两锚点沿连线拉近（按 1/m 分配位移，限幅 maxStep）。
// setPosition 只能传两参：第三参会把位移当速度传送，凭空注能。
function conPull(h0,px0,py0,h1,px1,py1,target,maxStep,allowGrab){
  var dx=px1-px0,dy=py1-py0,d=Math.hypot(dx,dy);
  if(!(d>1e-4))return 0;
  var w0=conMov(h0,allowGrab),w1=conMov(h1,allowGrab),sw=w0+w1;
  if(!(sw>0))return 0;
  var ux=dx/d,uy=dy/d;
  // target 必须显式传入：轻绳的目标是 len（绷直后停在 len），铰链的目标是 0（两锚点重合）。
  //   若写死成 0，轻绳一绷直就被当铰链往重合处拉（载荷被往上提、两端交叉后另一端被推飞）。
  //   这里只做「超出多少就收回多少」。
  var over=d-target;
  if(!(over>0))return 0;
  var pen=Math.min(over,maxStep);
  var m0=pen*(w0/sw),m1=pen*(w1/sw);
  if(m0>1e-9){
    Matter.Body.setPosition(h0.mb,{x:h0.mb.position.x+ux*m0,y:h0.mb.position.y+uy*m0});
    h0.x=h0.mb.position.x;h0.y=h0.mb.position.y;
    if(Matter.Sleeping)Matter.Sleeping.set(h0.mb,false);
  }
  if(m1>1e-9){
    Matter.Body.setPosition(h1.mb,{x:h1.mb.position.x-ux*m1,y:h1.mb.position.y-uy*m1});
    h1.x=h1.mb.position.x;h1.y=h1.mb.position.y;
    if(Matter.Sleeping)Matter.Sleeping.set(h1.mb,false);
  }
  return pen;
}
/*
 * 松手那一刻的速度也要落在约束可行域里。
 * 位置收口（conDragConstrain）只在拖拽期运行；pointerup 会把指针速度原样抛出（~3200px/s ⇒ 53px/帧），
 * 而约束每帧最多拉回 CON_DRAG_STEP=48px ⇒ 位置修正与速度对拉，表现为松手后「拉出一根线 + 抖」。
 *
 * 做法：先把速度投影到约束的可行方向，而不是事后拽回：
 *   · 铰链（锚点必须停在销上）⇒ 只留绕销的转动分量：v := ω ẑ×r，ω=(r×v)/|r|²，丢掉径向分量
 *     （与杆端投影同一个式子）。
 *   · 轻绳（锚点到挂点距离 ≤ len）⇒ 只在绷直且正往外跑时丢掉向外的径向分量；
 *     松弛、向内收、切向摆一概不碰。
 * 另一端可动时的规则见下方分支。
 */
function releaseConstrainVel(B){
  if(!B||!B.mb||B.kind==='T')return false;
  var touched=false;
  for(var i=0;i<bodies.length;i++){
    var S=bodies[i];
    if(S.dead||S.kind!=='S'||(!S.rope&&!S.hinge)||!S.anc)continue;
    for(var j=0;j<2;j++){
      var a=S.anc[j],oh=S.anc[1-j];
      if(!a||a.B!==B)continue;
      if(!oh||!oh.B||oh.B===B)continue;
      if(!hostIsAnvil(oh.B))continue;
      var p=springAnchoredWorld(S,j),q=springAnchoredWorld(S,1-j);
      if(!p||!q)continue;
      var rx=p.x-q.x,ry=p.y-q.y,rl=Math.hypot(rx,ry);
      var O=oh.B;
      if(hostMovableByConstraint(O)){
        // 另一端可动 ⇒ 速度也要传过去（与 conDragConstrain 的位置规则一致）。
        //   不能指望 hingeSolve 的冲量投影（conProj）：偏心锚点 k = 1/m + (r×n)²/I，销在 80px 方块边中点时
        //   (r×n)²/I = 40²·0.0067 = 10.7，而 1/m 只有 0.14 —— 冲量 98% 变成自转，线速度几乎没变，
        //   松手后拖拽端飞走、另一端不动。
        //   铰链 = 刚性连杆 ⇒ 直接给另一端同速度（两端 ω 为 0 时销点速度自然相等）；
        //   绷直的绳 ⇒ 只补「正在分离」的径向相对速度（绳不管切向）。
        if(S.hinge){
          O.vx=B.vx;O.vy=B.vy;
        }else{
          if(!(rl>(S.len||0)-0.5))continue;    // 松弛：绳不传速度
          if(!(rl>1e-6))continue;
          var ux2=rx/rl,uy2=ry/rl;
          var vrel=(B.vx||0)*ux2+(B.vy||0)*uy2-(((O.vx||0)*ux2+(O.vy||0)*uy2));
          if(!(vrel>0))continue;               // 没在分离 ⇒ 不动
          O.vx=(O.vx||0)+ux2*vrel;O.vy=(O.vy||0)+uy2*vrel;
        }
        if(O.mb&&MW){
          Matter.Body.setVelocity(O.mb,{x:(O.vx||0)/60,y:(O.vy||0)/60});
          Matter.Sleeping.set(O.mb,false);
        }
        touched=true;
        continue;
      }
      if(S.hinge){
        var rl2=rx*rx+ry*ry;
        if(rl2<1e-6)continue;
        var om=(rx*(B.vy||0)-ry*(B.vx||0))/rl2;
        B.vx=-om*ry;B.vy=om*rx;          // 只留绕销的切向速度
        touched=true;
      }else{
        var L=rl,len=S.len||0;
        if(!(L>len-0.5))continue;        // 松弛：绳不约束速度
        var ux=rx/L,uy=ry/L,vn=(B.vx||0)*ux+(B.vy||0)*uy;
        if(!(vn>0))continue;             // 不是在往外跑 ⇒ 不动
        B.vx-=ux*vn;B.vy-=uy*vn;
        touched=true;
      }
    }
  }
  if(touched&&B.mb&&MW){
    Matter.Body.setVelocity(B.mb,{x:B.vx/60,y:B.vy/60});
    Matter.Sleeping.set(B.mb,false);
  }
  return touched;
}
// 「另一端动不了」= 铁砧：静态 Matter 体 / 右键固定过 / 长度手柄正冻结。只有这种另一端
// 才让约束唯一决定拖拽端的位姿（见 conDragConstrain）。
function hostIsAnvil(h){
  if(!h||!h.mb)return true;
  /* 正在被拖拽、位置归指针的体在杆链求解里也当铁砧（不许被约束搬走，否则破坏指针权威）。
   * 由 rodDragPinChain 临时打标。 */
  if(h._dragPin)return true;
  if(h.mb.isStatic||h.fixed)return true;
  if(typeof rodLenFrozen==='function'&&rodLenFrozen(h))return true;
  return false;
}
// 「还能被约束搬动」= W 体（位置驱动体，见 stepMatter 里 W 的分工）且不是铁砧。
// 只对 W 开放：非 W 动体的位置归 Matter 积分，直接写字段会被下一帧覆盖，形成两个写者互相追打。
function hostMovableByConstraint(h){
  if(!h||!h.mb)return false;
  if(h.kind!=='W')return false;
  return !hostIsAnvil(h);
}
/*
 * 拖拽期的权威摆放先满足轻绳/铰链约束 —— 必须是精确投影（唯一解），不能是按质量分配。
 *
 * 根因是过约束：指针把抓取点钉在世界某点（2 个方程），销钉把锚点钉在另一点（2 个方程），
 * 刚体只有 3 个自由度（x,y,th）⇒ 一般无解。两个写者（stepMatter 按指针摆、conPull 按销拉回）
 * 互相追打成极限环；任何按质量分配的平滑收敛都不可能收敛（只改每步走多远，不改无解）。
 * （实测夹具：拖 B 绕固定 A 的铰链，d 每帧变大、B.th 转到 −72.6°、B.x 来回跳 ±100px。）
 *
 * 解法：另一端是铁砧时销/挂点在世界系里不动，「锚点落在销上」对 (x,y) 有唯一解（th 仍自由，
 * 被拖物体照样能绕销转）。精确投影：
 *   · 铰链：B.pos += (q − p)          ⇒ 锚点精确落到销上（d ≡ 0）
 *   · 轻绳：越界时 B.pos −= v·(L−len)/L ⇒ 锚点落在半径 len 的圆上；L ≤ len 时不动（松弛态自由拖）。
 * 只动 (x,y)、不动 th，改完即止，没有第二个写者。
 * 另一端可动（自由物体）时方程组有解，在下方分支直接把另一端拉过来（拖一个，另一个跟着走）。
 *
 * 调用点：stepMatter 里 W 体的每帧权威摆放（以及 pointermove 的同款分支）。
 * 返回 null = 没有约束需要投影；否则返回投影后的 {x,y}。
 */
function conDragConstrain(B){
  if(!B||!B.mb||B.kind==='T')return null;
  var moved=false;
  for(var i=0;i<bodies.length;i++){
    var S=bodies[i];
    if(S.dead||!S.anc)continue;
    // 轻质杆（kind 'T'）也走同一条拖拽规则：两端锚定时它是刚体连杆，
    //   漏掉会导致拖快时杆变长 / 异常抖动。
    var isS=(S.kind==='S'&&(S.rope||S.hinge));
    var isT=(S.kind==='T');
    if(!isS&&!isT)continue;
    for(var j=0;j<2;j++){
      var a=S.anc[j],oh=S.anc[1-j];
      if(!a||a.B!==B)continue;
      if(!oh||!oh.B)continue;                  // 只有一端锚定 ⇒ 自由端无载荷，不约束拖拽摆位
      if(oh.B===B)continue;                    // 两端都在被拖的物体上：没有「另一端」可言
      var p=springAnchoredWorld(S,j);          // 本端锚点（按指针摆出来的位姿算）
      var q=springAnchoredWorld(S,1-j);        // 另一端锚点
      if(!p||!q)continue;
      var dx=p.x-q.x,dy=p.y-q.y,d=Math.hypot(dx,dy);
      if(!(d>1e-6))continue;                   // 两端重合：方向未定，无从投影
      var need;
      if(isT){
        /* 轻质杆是刚体连杆，拖拽规则必须覆盖它，且是双向的（拉长与压短都算越界）；
         * 目标长度取 _rodL（有意设定的长度，见 rodSyncAnchors 双端分支）。
         * 否则指针每帧整份覆盖被抓方块位姿、杆的纠正每子步只还 24px 又被覆盖 ⇒ 拖动期杆长在
         * 120↔204 之间来回写，表现为抖动、另一物体垂到地上。
         * 分配规则与下方相同：另一端可动 ⇒ 拉过来；另一端是铁砧 ⇒ 反向钳位拖拽端。
         * 位移量精确等于越界量 ⇒ 本帧结束时 d 恒等于目标。 */
        //   杆没有 e0/e1（几何真值是 x/th/len）⇒ 不能调 springSyncEnds（会在 springSetEnd 里读
        //   undefined.e0）；杆的位姿由同一帧子步的 rodSyncAnchors 摆正。
        var tl=(S._rodL!=null&&S._rodL>0)?S._rodL:(S.len||170);
        need=d-tl;
        if(!(Math.abs(need)>1e-4))continue;    // 已满足（±1e-4）⇒ 指针说了算
      }else{
        need=S.hinge?d:(d-(S.len||0));         // 要缩短多少：铰链 ⇒ 全量；绳 ⇒ 只收越界量
        if(!(need>1e-4))continue;              // 铰链 d≈0 / 绳在长度以内 ⇒ 指针说了算
      }
      var ux=dx/d,uy=dy/d,mvx=ux*need,mvy=uy*need;
      // 「谁能动，谁吸收」—— 两条分支是同一个位移量，只是施加在哪一侧：
      //   · 另一端可动 ⇒ 把它沿 p→q 拉过来 need ⇒ 拖一个、另一个同步跟走；本帧结束时 d 恒等于 target。
      //   · 另一端是铁砧 ⇒ 反向施加在拖拽端上（钳位）⇒ 绳不可伸长 / 销钉刚性。
      //   不能交给 conPull 分配：拖拽端位姿下一帧会被指针整份覆盖，分给它的那一半白做，
      //   d 每帧残留越界量（实测拖拽期 dmax=46.6px，即 CON_DRAG_STEP 饱和值）。
      if(hostMovableByConstraint(oh.B)){
        var O=oh.B;
        O.x+=mvx;O.y+=mvy;
        if(O.mb){
          Matter.Body.setPosition(O.mb,{x:O.x,y:O.y});
          Matter.Sleeping.set(O.mb,false);
          /* 不要在这里清另一端速度（setVelocity(0,0)）：每帧清零会把可动端的切向钟摆速度一并杀掉，
           * 下面的杆和物体无法自由摆动（只会缓慢蠕行）。径向一致性由每子步的速度投影 + 位置相位守住。 */
        }
        if(!isT)springSyncEnds(S);
      }else if(hostIsAnvil(oh.B)){
        B.x-=mvx;B.y-=mvy;
        if(!isT)springSyncEnds(S);
      }else{
        continue;                              // 另一端是可动的非 W 体：位置归它自己的物理管，
      }                                        // 交给 hingeSolve/ropeSolve 的通道内机制
      moved=true;
    }
  }
  return moved?{x:B.x,y:B.y}:null;
}
// 轻绳：单边约束（见上方语义段）。ux/uy 由 d>len 那一刻的连线定；d≈0 时用上一帧稳定轴。
function ropeSolve(B,dt,h0,h1){
  // 只有一端锚定时也要守住「绳不可拉长」：stepSprings 的自由端跟随只补宿主位移增量，
  //   从不收回已拉长的部分，拖拽期更是不跟（实测抓绳身上提后绳长稳在 2×len）。
  //   做法：不动宿主、不做冲量分配（自由端无质量、内力恒 0），只做纯几何收口 ——
  //   d>len 时把自由端投影回以锚定端为心、半径 len 的圆上。动的是无载荷的自由端，不会注能，
  //   也不涉及 hostIsAnvil / conSide 那套规则。
  if(!h0||!h1){
    var hA=h0||h1;
    if(hA&&B.rope){
      var kA=h0?0:1, fI=1-kA;                       // 锚定端索引 kA / 自由端索引 fI
      var pk=springAnchoredWorld(B,kA), fE=springEnd(B,fI), Lh=B.len||0;
      if(pk&&fE){
        var ddx=fE.x-pk.x,ddy=fE.y-pk.y,dl=Math.hypot(ddx,ddy);
        if(dl>Lh+0.01){                             // 只在越界时动手（松弛态自由端完全自由）
          springSetEnd(B,fI,pk.x+ddx/dl*Lh,pk.y+ddy/dl*Lh);
          refreshSpringGeom(B);
        }
      }
    }
    return;                          // 只有一端锚定 = 自由端无载荷 ⇒ 内力恒为 0（轻质元件通则）
  }
  var e0=B.e0,e1=B.e1;
  var dx=e1.x-e0.x,dy=e1.y-e0.y,d=Math.hypot(dx,dy);
  if(!(d>B.len+0.01))return;       // 松弛：轻绳零力，也不会把两端推开
  var ux,uy;
  if(d>1e-6){ux=dx/d;uy=dy/d;B._ax=ux;B._ay=uy;}
  else if(B._ax!=null){ux=B._ax;uy=B._ay;}
  else{ux=1;uy=0;}
  // 拖拽端也参与位移分配（allowGrab）+ 放开每帧步长 —— 见 conMov 的注释。
  //   只开位置通道（conSide 冲量规则不动），「不跟指针抢速度」照旧。
  conPull(h0,e0.x,e0.y,h1,e1.x,e1.y,B.len,CON_DRAG_STEP,true);   // 目标 = 绳长（不可伸长）
  conProj(h0,e0.x,e0.y,h1,e1.x,e1.y,ux,uy,true);
  springSyncEnds(B);               // 宿主已移动 ⇒ 端点/几何重算（与弹簧触底块同一手法）
}
// 光滑铰链：双边约束 —— 两锚点必须重合；固定铰链开关（hfix）开启时有折角限位。
// 二维投影用世界轴 x̂/ŷ 各做一遍：d≈0 时「分离方向」退化，世界轴不退化。
// ---- 绕销展开：把互埋的两个宿主绕销转开（纯旋转 ⇒ 销不动）----
// 为什么必须是绕销旋转而不是平移：
//   Matter 子步能把互埋的宿主顶出去（穿透 26.6px → 0.006px），但随后 conPull 把它平移回销上（d=0），
//   同时把角重新插进对方 ⇒ 帧末（用户所见）穿透 26.6px。平移只能二选一：回销则穿透、让 Matter 顶出则 d≈30px。
//   绕销纯旋转同时满足两者：销是旋转中心，旋转不破坏销，又能把插进去的角转出来
//   （实测穿透 31.47 → 0.288px、销误差 0、帧边界抖动 0）。
// 算法（三步，缺一不可）：
//   ① 方向：0.004rad 小步探测，只取使深度变小的方向；两个方向都不改善 ⇒ 放弃（也挡住面贴面静置这类接触）。
//   ② 步长：牛顿式 Δθ = depth / R，R 取可动宿主的最远顶点到销的距离（不是接触点距离）。
//      绕销转 Δθ 时最深点沿 MTV 法线移动 ≤ R·Δθ ⇒ 用 R 必然欠转、单调收敛（每步剩 (1−r_true/R)·depth，
//      5~6 步进 0.15px）。用接触点距离可能过转：转过头后深度为 0、判收敛，过转量被永久留下，
//      逐帧累积成凭空自转（实测 157 帧累积到 −π/2）。
//      也不能用倍增大步长搜索：销在碰撞面上、边与对方面近共线时可行角窗极窄
//      （|θ| ≤ atan(BND_INK/半边长)，约 2°），大步长会跨过这条缝。
//   ③ 非弹性挡块：方向定下后掐掉继续往互埋方向转的角速度（同 hingeKillOutwardTangential），否则下一帧又转进去。
// 守卫（都不能省）：
//   · 只对两个 W 宿主做：字母刚体没有 Matter 体、杆是运动学镜像、弹簧/绳另有语义；
//   · 只在两者真的会互相碰撞时做（同组豁免见 springSyncGroups）；
//   · hfix（固定铰链=刚接）开启时跳过：相对姿态归 hingeFoldLimit 管，再叠展开就是两个写者互相追打。
// 进入阈值 HINGE_UF_EPS 的标定（W 体碰撞几何 = 墨迹中线外扩 BND_INK=2.325px，两墨线相切时深度即 4.65px）：
//   下端 = 合法邻接构型的天然残差：墨线留 4px 空隙时碰撞体天生重叠 0.65~0.97px。
//     阈值低于它（如 0.15px）会把近贴着的宿主当穿透，展开变成反向角弹簧把铰链焊死
//     （载荷自由转动跨度 171° → 2.6°、双击解不开、拖一个另一个不跟）。
//   上端 = 真互埋规模：用户场景 26.6~36.6px；铰链强制对压时 Matter 自己也能到 4.4px（不处理则 θ 抖 6.6°/帧并缓慢嵌入）。
//   取 2.0px：对下端 0.97px 留 2.06× 余量，对上端 4.4px 留 2.2× 余量。
//   不要取 5px（按 2·BND_INK）：残差停在 Matter 挤压平衡 4.417px，恰好坐在门口，展开时进时出，
//     帧边界 |Δθ| 劣化到 0.1147rad（6.6°/帧）。
var HINGE_UF_EPS=2.0;        // 进入阈值（px）：见上面的两端夹逼
// 退出阈值（修到什么程度）必须与进入阈值分开：混成一个常量时，为压低残差会把进入门也压到
// 合法邻接残差（0.65~0.97px）以下而误伤自由转动。分开后合法接触进不来，真互埋（4.4~36.6px）
// 进来后牛顿步仍把残差收到亚像素（≈0.18px）。
var HINGE_UF_DONE=0.2;       // 迭代停止阈值（px）
var HINGE_UF_PROBE=0.004;    // 方向探测步长（rad）
var HINGE_UF_MAXDTH=0.35;    // 牛顿单步限幅（rad）
var HINGE_UF_IT=14;          // 牛顿迭代上限（欠转 ⇒ 需要多几步；实测 5~6 步收敛）
function hingePairCollision(a,b){
  if(!a||!b)return null;
  if(typeof Matter==='undefined'||!Matter.Collision||!Matter.Collision.collides)return null;
  try{var c=Matter.Collision.collides(a,b);return (c&&c.collided&&c.depth>0)?c:null;}catch(e){return null;}
}
function hingePairDepth(a,b){var c=hingePairCollision(a,b);return c?c.depth:0;}
function hingeHostsCanCollide(h0,h1){
  var a=h0&&h0.mb,b=h1&&h1.mb;
  if(!a||!b)return false;
  try{
    if(Matter.Detector&&Matter.Detector.canCollide)
      return !!Matter.Detector.canCollide(a.collisionFilter,b.collisionFilter);
  }catch(e){}
  return true;
}
// 宿主顶点里离销最远的距离（即上面 ② 里的 R：取上界才能保证欠转）
function hingeMaxVertexRadius(mb,px,py){
  if(!mb||!mb.vertices||!mb.vertices.length)return 0;
  var r=0,i,v,dd;
  for(i=0;i<mb.vertices.length;i++){
    v=mb.vertices[i];
    dd=Math.hypot(v.x-px,v.y-py);
    if(dd>r)r=dd;
  }
  return r;
}
function hingeContactUnfold(B,h0,h1,dPre){
  if(!B||!h0||!h1)return 0;
  if(h0.kind!=='W'||h1.kind!=='W')return 0;                 // 守卫：只认两个 W 宿主
  if(B.param&&B.param.hfix)return 0;                        // 守卫：固定铰链开着时归 hingeFoldLimit 管
  var a=h0.mb,b=h1.mb;
  if(!a||!b)return 0;
  if(a.isStatic&&b.isStatic)return 0;
  if(!hingeHostsCanCollide(h0,h1))return 0;
  var d0=hingePairDepth(a,b);
  if(!(d0>HINGE_UF_EPS))return 0;
  /* 只在深度确实被本帧 conPull 的平移增大时才展开（dPre = conPull 之前的深度）。
   * 本函数的职责是还掉 conPull 平移回销时插进去的角；若只看绝对深度，两个宿主重力下静置压合
   * （深度天生 > HINGE_UF_EPS，那是支撑而非干涉）也会被每帧转开、重力又压回 ⇒ 极限环（来回卡）。
   * 静置压合时 conPull 不平移 ⇒ d0≈dPre ⇒ 不展开；真互埋（拖拽/初始构型）时 d0>dPre ⇒ 照旧处理。
   * 0.5px 余量留给求解器帧间噪声。 */
  if(dPre!=null&&!(d0>dPre+0.5))return 0;
  var i0=a.isStatic?0:(a.inverseMass||0),i1=b.isStatic?0:(b.inverseMass||0);
  var Wm=i0+i1;
  if(!(Wm>0))return 0;
  // 宿主位姿回写：springAnchoredWorld 读的是产品字段 h.th，而 Matter.Body.rotate 只改 mb.angle。
  //   漏掉 ⇒ 随后的 springSyncEnds 用过期角度重算锚点而发散。
  if(h0.mb){h0.x=a.position.x;h0.y=a.position.y;h0.th=a.angle;}
  if(h1.mb){h1.x=b.position.x;h1.y=b.position.y;h1.th=b.angle;}
  var px=(B.e0.x+B.e1.x)/2,py=(B.e0.y+B.e1.y)/2;             // 销（conPull 之后两端已重合）
  var rot=function(s){
    if(i0)Matter.Body.rotate(a,-s*i0/Wm,{x:px,y:py});
    if(i1)Matter.Body.rotate(b, s*i1/Wm,{x:px,y:py});
  };
  // ① 方向探测
  rot(HINGE_UF_PROBE);  var dp=hingePairDepth(a,b); rot(-HINGE_UF_PROBE);
  rot(-HINGE_UF_PROBE); var dm=hingePairDepth(a,b); rot(HINGE_UF_PROBE);
  var sgn=0;
  if(dp<d0)sgn=1; else if(dm<d0)sgn=-1; else return 0;
  // ② 欠转牛顿步：Δθ = depth / R（R = 可动宿主最远顶点到销的距离，按 1/m 加权）
  var Rsum=(i0?hingeMaxVertexRadius(a,px,py)*i0:0)+(i1?hingeMaxVertexRadius(b,px,py)*i1:0);
  var R=Rsum/Wm;
  if(!(R>1))R=Math.max(1,Wm>0?(1/Wm):1);
  var applied=0,last=d0,ok=false;
  for(var it=0;it<HINGE_UF_IT;it++){
    var c=hingePairCollision(a,b);
    if(!c||!(c.depth>HINGE_UF_DONE)){ok=true;break;}         // 退出阈值（≠ 进入阈值，见常量注释）
    var dth=c.depth/R; if(dth>HINGE_UF_MAXDTH)dth=HINGE_UF_MAXDTH;
    var before=c.depth;
    rot(sgn*dth); applied+=dth;
    var nd=hingePairDepth(a,b);
    if(!(nd>HINGE_UF_DONE)){ok=true;break;}
    if(!(nd<before-1e-9))break;                              // 不再改善 ⇒ 这条方向解不出来
    last=nd;
  }
  if(applied>0&&!(ok||last<d0-1e-9)){                         // 净效果没变好 ⇒ 整笔撤销，不留半吊子姿态
    rot(-sgn*applied); applied=0;
    if(h0.mb){h0.x=a.position.x;h0.y=a.position.y;h0.th=a.angle;}
    if(h1.mb){h1.x=b.position.x;h1.y=b.position.y;h1.th=b.angle;}
    return 0;
  }
  if(h0.mb){h0.x=a.position.x;h0.y=a.position.y;h0.th=a.angle;}
  if(h1.mb){h1.x=b.position.x;h1.y=b.position.y;h1.th=b.angle;}
  // ③ 非弹性挡块（a 被转 −s·i0/W、b 被转 +s·i1/W ⇒ 两者的「互埋方向」符号相反）
  if(i1&&(b.angularVelocity||0)*sgn<0)Matter.Body.setAngularVelocity(b,0);
  if(i0&&(a.angularVelocity||0)*sgn>0)Matter.Body.setAngularVelocity(a,0);
  return applied;
}
/* 用真正的 Matter.Constraint 当铰链销。Matter 文档：revolute/pin joint 设 length: 0 和高 stiffness
 * （0.7 以上），不稳定时降低 stiffness 和/或提高 engine.constraintIterations。
 * 关键在求解器跑在哪里：Constraint 跑在 Matter 自己的求解循环里（Gauss-Seidel、constraintIterations 次迭代、
 * 直接改 position/positionPrev），与碰撞解算同一轮迭代，天然不打架。产品级 hingeSolve
 * （conPull 平移 + hingeContactUnfold 绕销转）跑在 Matter 循环之外、每帧才补一次，与碰撞/重力互相追打
 * 形成自维持极限环；入口类守卫（dPre / 销孔门 / 退出阈值 / 跳过 conPull）都无法根治。
 * 只在双端都锚上、且至少一端可动时挂。 */
/* stiffness 取 1：0.7 实测会留下 0.0064rad（0.37°）的残余抖动；length 为 0 时需要 stiffness 1。
 * constraintIterations 用 HINGE_CON_ITER（Matter 默认值 2）。 */
var HINGE_CON_STIFF=1;
var HINGE_CON_ITER=2;   // 回到默认迭代数
function hingeConstraintDrop(B){
  /* 解绑时把宿主标记一起清掉（否则那个体会永远豁免 ω 重建）。 */
  if(B&&B._hconH){for(var qi=0;qi<B._hconH.length;qi++){if(B._hconH[qi])B._hconH[qi]._hconOn=false;}B._hconH=null;}
  if(B&&B._hcon){
    try{Matter.Composite.remove(MW.engine.world,B._hcon);}catch(e){}
    B._hcon=null;
  }
}
function hingeConstraintSync(B,h0,h1){
  if(MW&&MW.engine&&MW.engine.constraintIterations!==HINGE_CON_ITER)
    MW.engine.constraintIterations=HINGE_CON_ITER;
  if(!B){return null;}
  var a=h0&&h0.mb,b=h1&&h1.mb;
  if(!a||!b||(a.isStatic&&b.isStatic)){hingeConstraintDrop(B);return null;}
  /* 拖拽期让 Constraint 退场：拖拽期位姿权威在 conDragConstrain，再挂 Constraint 等于给同一位姿
   * 加第三个写者 ⇒ 「拖一个另一个跟走」间歇性失败（约 1/3）。静态构型不受影响。 */
  if(grab&&grab.kind==='body'&&grab.obj&&(grab.obj===h0||grab.obj===h1)){hingeConstraintDrop(B);return null;}
  var w0=springAnchoredWorld(B,0),w1=springAnchoredWorld(B,1);
  if(!w0||!w1){hingeConstraintDrop(B);return null;}
  var pa={x:w0.x-h0.x,y:w0.y-h0.y},pb={x:w1.x-h1.x,y:w1.y-h1.y};
  var C=B._hcon;
  if(!C){
    /* 给两个宿主打「被独立铰链钉住」标记，供下面 velocity 重建豁免用
     * （否则被铰链钉住的板几乎不转：5s 只转 0.0085rad）。 */
    h0._hconOn=true;h1._hconOn=true;B._hconH=[h0,h1];
    C=Matter.Constraint.create({bodyA:a,pointA:pa,bodyB:b,pointB:pb,
                                length:0,stiffness:HINGE_CON_STIFF,damping:0.1});
    Matter.Composite.add(MW.engine.world,C);
    B._hcon=C;
  }else{
    C.bodyA=a;C.bodyB=b;C.pointA=pa;C.pointB=pb;C.length=0;C.stiffness=HINGE_CON_STIFF;
    h0._hconOn=true;h1._hconOn=true;B._hconH=[h0,h1];
  }
  return C;
}
function hingeSolve(B,dt,h0,h1){
  /* 铰链不再双端都锚上时必须摘掉真 Constraint：宿主被删/失效时 springSyncEnds 把 anc[i] 清成 null，
   * 本函数第一行就 return ⇒ hingeConstraintSync（唯一摘除点）永远跑不到，
   * 那条 Matter.Constraint 会留在世界里把两个体隐形地永久钉住。 */
  if(!h0||!h1){hingeConstraintDrop(B);return;}
  var e0=B.e0,e1=B.e1;
  // 铰链是销钉，两锚点必须重合 —— 硬约束。拖拽端 + 铁砧时 conPull 原本无解（w0=w1=0），d 会涨到
  //   368px、drawHinge 画出两条长臂；因此让拖拽端按 1/m 参与位移分配（只开位置通道，见 conMov）。
  var _hingeDPre=hingePairDepth(h0&&h0.mb,h1&&h1.mb);   // conPull 平移之前的深度（供 hingeContactUnfold 判断）
  /* 同步真 Constraint：双端锚上且至少一端可动时挂上；挂不了（只锚一端 / 两端都是铁砧）时摘除，走原行为。 */
  var _hCon=hingeConstraintSync(B,h0,h1);
  /* conPull 照常跑：真 Constraint 与 conPull 的目标相同（两锚点重合），不会打架；
   * 关掉 conPull 反而破坏依赖其行为的既有场景。 */
  conPull(h0,e0.x,e0.y,h1,e1.x,e1.y,0,CON_DRAG_STEP,true);      // 目标 = 0（两锚点重合）
  // 上面「平移回销」的代价是把互埋的角重新插进对方（穿透 0.006 → 26.657px）；
  //   立刻用绕销旋转还掉 —— 旋转不破坏销，却正好把角转出来。
  springSyncEnds(B);                 // 让 e0/e1 落在平移后的真实锚点上（= 销），展开要绕它转
  /* unfold 也照常跑（反直觉）：让它让位反而导致间歇性失败；照常跑则稳定且穿透很小。
   * 原先的极限环是 unfold 与产品级 conPull 抢位姿；现在销由 Matter 求解循环托住，unfold 不再自激。 */
  hingeContactUnfold(B,h0,h1,_hingeDPre);
  conProj(h0,e0.x,e0.y,h1,e1.x,e1.y,1,0,false);
  conProj(h0,e0.x,e0.y,h1,e1.x,e1.y,0,1,false);
  hingeFoldLimit(B,h0,h1);                                // 折角限位
  springSyncEnds(B);
}
// 不要加「卡死门」（两宿主互埋 >1.5px 时让位给 Matter 接触）：它是冗余的；楔死的真因是
//   springSyncGroups 曾把铰链两宿主放进同一个互不碰撞组，修正后接触解算自己就能顶住折叠穿透。
// ---- 折角限位 ----
// 折角 fold = atan2(销→宿主1中心) − atan2(销→宿主0中心)。在两端都锚上那一刻捕获基准
// （springTryAnchor / springTryAnchorByHost），限位判相对基准的偏差 |Δfold|。
// 越限时把两个宿主绕销转回去（不动销本身 ⇒ 位置约束不被破坏）：
//   a0 = −exc·i0/W、a1 = +exc·i1/W（i = 可动体的反质量，static 为 0）
//   ⇒ Δfold = a1 − a0 = exc·(i0+i1)/W = exc 精确归位，重的一侧转得少、铁砧不转。
function hingeCaptureFold(B){
  if(!B.anc[0]||!B.anc[1]||!B.anc[0].B||!B.anc[1].B){B._hFold0=null;return;}
  var h0=B.anc[0].B,h1=B.anc[1].B;
  var px=(B.e0.x+B.e1.x)/2,py=(B.e0.y+B.e1.y)/2;
  B._hFold0=Math.atan2(h1.y-py,h1.x-px)-Math.atan2(h0.y-py,h0.x-px);
}
function hingeRotateAboutPin(h,ang,px,py){
  if(!ang||!h.mb||h.mb.isStatic)return;
  Matter.Body.rotate(h.mb,ang,{x:px,y:py});
  h.x=h.mb.position.x;h.y=h.mb.position.y;      // 同帧后续求解/渲染读的是字段
  h.th=(h.th||0)+ang;
}
// 非弹性挡块：限位只回转位置不处理速度时，宿主带着残余切向速度（~110px/s）下一帧又冲出限位，
//   位置修正与速度互斗，把锚点拽滑（销→心距 26→10.1）。把「继续往超限方向转」的切向分量消掉
//   （像碰到止动销）。sign=+1 管 fold 增方向（h1 侧），−1 管 fold 减方向（h0 侧，fold=ang1−ang0）。
function hingeKillOutwardTangential(h,px,py,sign){
  if(!h||!h.mb||h.mb.isStatic)return;
  var rx=h.x-px,ry=h.y-py,r=Math.hypot(rx,ry);
  if(!(r>1e-3))return;
  var tx=-ry/r,ty=rx/r;                          // ang 增大方向的切向单位向量
  var v=h.mb.velocity||{x:0,y:0};
  var vt=v.x*tx+v.y*ty;
  if(!(vt*sign>0))return;                        // 不是往超限方向 ⇒ 不动
  Matter.Body.setVelocity(h.mb,{x:v.x-tx*vt,y:v.y-ty*vt});
}
function hingeFoldLimit(B,h0,h1){
  // 由固定铰链开关驱动：关闭（默认）= 完全光滑，相对转动不受限，直接返回；
  //   开启 = 刚接，lim 取 0 ⇒ 折角冻结在基准构型，两侧绕销转回 + 掐掉继续超限的切向速度。
  var fixed=!!(B.param&&B.param.hfix);
  if(!fixed)return;
  var hl=0;
  var lim=hl*Math.PI/180;
  if(lim>=Math.PI*0.999)return;                 // 180° = 不限位（完全光滑）
  // 闭合门：铰链还没钉合成销（两端分开）时「销→两宿主中心的折角」没有物理意义；按拉伸构型捕获的基准
  //   会与 conPull 的回收打架而不收敛（实测两端卡在 d=28.6）。所以 d>HINGE_FOLD_DMAX 时跳过限位并作废基准，
  //   等真正闭合时按闭合构型重新捕获。
  var d0=Math.hypot(B.e1.x-B.e0.x,B.e1.y-B.e0.y);
  if(d0>HINGE_FOLD_DMAX){B._hFold0=null;return;}
  if(B._hFold0==null)hingeCaptureFold(B);
  if(B._hFold0==null)return;                    // 退化解（宿主中心压在销上）⇒ 放弃限位
  var px=(B.e0.x+B.e1.x)/2,py=(B.e0.y+B.e1.y)/2;
  var f=Math.atan2(h1.y-py,h1.x-px)-Math.atan2(h0.y-py,h0.x-px);
  var d=shortAng(f-B._hFold0);
  var over=Math.abs(d)-lim;
  if(!(over>0.001))return;
  var exc=-((d>0)?1:-1)*over;
  // 按子步限步渐进（同 conPull 的 CON_MAXSTEP）：大角度一步转回等于传送，锚点会瞬滑
  //   （销→心距 26 → 14.8）。每步最多转 HINGE_FOLD_STEP，大偏差几帧内收敛。
  var step=HINGE_FOLD_STEP;
  if(exc>step)exc=step;else if(exc<-step)exc=-step;
  var i0=(h0.mb&&!h0.mb.isStatic)?1/(h0.mass||1):0;
  var i1=(h1.mb&&!h1.mb.isStatic)?1/(h1.mass||1):0;
  var W=i0+i1;
  if(!(W>0))return;                             // 两端都是铁砧：限位没意义
  hingeRotateAboutPin(h0,-exc*i0/W,px,py);
  hingeRotateAboutPin(h1, exc*i1/W,px,py);
  // 非弹性挡块：消掉「继续超限」的切向速度（见 hingeKillOutwardTangential 注释）
  hingeKillOutwardTangential(h1,px,py,1);
  hingeKillOutwardTangential(h0,px,py,-1);
}
// ---- 渲染 ----
// 轻绳：比杆更细的墨线；松弛时下垂（松弛量越大垂得越深），绷直（d ≥ len）时画直线。
// 轻绳无质量 ⇒ 松弛绳形在静力学上不定（没有自重就没有悬链线），下垂只是「绳是软的」的惯用画法。
// 第二个实参 extraSlack 是纯渲染的附加垂度（px，默认 0），只给落点虚影用 —— 同一份画线代码，
//   「虚影所见 = 松手所得」结构性成立。
function drawRope(B,extraSlack){
  var x0=B.e0.x,y0=B.e0.y,x1=B.e1.x,y1=B.e1.y;
  var dx=x1-x0,dy=y1-y0,L=Math.hypot(dx,dy)||1;
  var slack=Math.max(0,B.len-L)+(extraSlack>0?extraSlack:0);
  var col='rgba(38,34,28,0.85)';
  cvx.strokeStyle=col;cvx.lineWidth=1.7;cvx.lineJoin='round';cvx.lineCap='round';
  cvx.beginPath();
  cvx.moveTo(x0,y0);
  if(B.nodes&&B.nodes.length){
    // 柔性绳：按真实链形状画（含阻断/耷拉/搭在物体上）。
    // 用过相邻中点的二次曲线平滑（节点当控制点）：直接 lineTo 时短绳只有几段，任何垂度都像折线。
    //   直绳时控制点共线仍画直线；松弛时是光滑垂弧；只平滑、不改点，形状仍忠实于链。
    var rp=[[x0,y0]];
    for(var rn=0;rn<B.nodes.length;rn++)rp.push([B.nodes[rn].x,B.nodes[rn].y]);
    rp.push([x1,y1]);
    cvx.moveTo(rp[0][0],rp[0][1]);
    for(var rs=1;rs<rp.length-1;rs++){
      var rmx=(rp[rs][0]+rp[rs+1][0])/2,rmy=(rp[rs][1]+rp[rs+1][1])/2;
      cvx.quadraticCurveTo(rp[rs][0],rp[rs][1],rmx,rmy);
    }
    cvx.lineTo(x1,y1);
  }else if(slack>0.5){
    var sag=Math.min(slack*0.55,90);        // 垂度上限：太长的绳不画成一口深井
    cvx.quadraticCurveTo((x0+x1)/2,(y0+y1)/2+sag,x1,y1);
  }else{
    cvx.lineTo(x1,y1);
  }
  cvx.stroke();
  cvx.fillStyle=col;
  for(var a=0;a<2;a++){
    if(!B.anc[a])continue;                  // 只有拴住的一端才画锚点（与弹簧同一口径）
    cvx.beginPath();cvx.arc(a?x1:x0,a?y1:y0,3.6,0,6.2832);cvx.fill();
  }
}
// 光滑铰链：一个销钉（实心小圆 + 外圈）；两锚点还没重合时用两条细臂连到各自锚点，
// 让「谁连在哪儿」看得见。有一端没锚时，自由端的 e 是上一帧的陈迹（没人再同步），
// 销心取有锚端的位置（e0 同步自宿主，是唯一可靠的坐标）。
function drawHinge(B){
  var x0=B.e0.x,y0=B.e0.y,x1=B.e1.x,y1=B.e1.y;
  var cx=(x0+x1)/2,cy=(y0+y1)/2;
  var col='rgba(38,34,28,0.85)';
  // 细臂只在至少有一端还没锚上时画：两端都锚住时语义是「两锚点重合」，画面上 d>1.5 只可能是求解滞后
  //   或宿主被顶开的瞬态，画成长臂会被读成「铰链脱开还拖着一根线」。半连接状态才需要臂交代销还挂在哪个点。
  //   不要反过来收紧成「双锚才画」：anc=[null,null] 的桩对象（虚影）会画不出臂。
  var bothAnc=!!(B.anc&&B.anc[0]&&B.anc[1]);
  if(!bothAnc&&Math.hypot(x1-x0,y1-y0)>1.5){
    cvx.strokeStyle=col;cvx.lineWidth=1.4;cvx.lineCap='round';
    cvx.beginPath();cvx.moveTo(x0,y0);cvx.lineTo(cx,cy);cvx.lineTo(x1,y1);cvx.stroke();
  }
  cvx.beginPath();cvx.arc(cx,cy,4.6,0,6.2832);cvx.fillStyle=col;cvx.fill();
  cvx.beginPath();cvx.arc(cx,cy,7.2,0,6.2832);
  cvx.strokeStyle=col;cvx.lineWidth=1.5;cvx.stroke();
}
/* ================= 器件「地面 / 墙面」 =================
 * 一个器件：一块可任意摆角的静态板，转 90° 自然读作墙面。可拖动、悬浮旋转（45° 吸附），
 * 拖两端改长度，参数里可调长度和角度。
 * 性质与地面/边界一致：fixed=true + Matter static ⇒ 外部支撑源（与 railHostSupported / hostIsAnvil 口径一致，
 * 物件可以被它挡住、站上去、被弹簧顶住），默认固定。
 * 外观：上边 = 一条实线（受力面），下方 = 一排斜杠（工程制图的地面符号），两者都落在 mkBoundary 建出的
 * 矩形内部 ⇒ 看到的即能挡能站的。 */
// GROUND_SPAWN_LEN 声明在 PX_PER_M / CONV_DEF 那一区：参数表 gndlen 的 def 在字面量求值时就要拿到值
//   （var 提升只提升声明）。不要在这里重复声明。
var GROUND_TH=18;              // 厚度（px）：碰撞箱就是这个矩形，刚好罩住斜杠
var GROUND_MIN_LEN=60, GROUND_MAX_LEN=1600;   // 与带子同量级（太短则两端手柄重叠没法拖）
function makeGround(cx,cy,len){
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
function setGroundEnds(B,x0,y0,x1,y1,force){
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
function groundDragEnds(B,g,px,py,force){
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
function setGroundAngle(B,th){
  if(!B||!B.gnd)return;
  B.th=shortAng(th);
  if(MW&&B.mb){Matter.Body.setAngle(B.mb,B.th);Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});}
}
/* 外观（上边实线 + 下方斜杠）—— 与 drawBoundaries 的通用描线互斥，调用处直接 continue
 * （同传送带，否则矩形框会被画两遍、盖掉符号）。 */
var GROUND_HATCH_STEP=18;
function drawGroundBody(B,hov){
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
var DEVICES=[
  {id:'spring',name:'弹簧',len:SPR_SPAWN_LEN},
  {id:'rod',name:'轻质杆',len:ROD_SPAWN_LEN},
  {id:'belt',name:'传送带',len:BELT_SPAWN_LEN},
  {id:'ground',name:'地面/墙面',len:GROUND_SPAWN_LEN},
  {id:'hinge',name:'光滑铰链',len:0},
  {id:'rope',name:'轻绳',len:ROPE_SPAWN_LEN}
];
function deviceById(id){
  for(var i=0;i<DEVICES.length;i++)if(DEVICES[i].id===id)return DEVICES[i];
  return null;
}
// 唯一创建入口：面板拖出、器件模式点画布等所有入口都走这里，
// 保证「拖出来的」与「点出来的」逐字段相同。
function placeDevice(id,cx,cy){
  var d=deviceById(id);
  if(!d)return null;
  var B=null;
  if(d.id==='spring'){
    var half=d.len/2;
    B=makeSpring(cx-half,cy,cx+half,cy);
  }else if(d.id==='rod'){
    // 轻质杆走同一个 makeRod（与 vt 拼接逐字段相同），长度以 DEVICES 表为准。
    // 改长度只走 setRodLen；MW 未就绪时它只写 B.len/B.hw+refresh，镜像板留给 stepMatter 懒建。
    B=makeRod(cx,cy,0,0);
    if(B.len!==d.len)setRodLen(B,d.len,false);
  }else if(d.id==='belt'){
    // 传送带走 makeBelt。落点 = 质心（矩形以 cx,cy 为中心）。
    B=makeBelt(cx,cy);
  }else if(d.id==='ground'){
    // 落点 = 质心（矩形以 cx,cy 为中心），默认固定、默认水平
    B=makeGround(cx,cy,d.len);
  }else if(d.id==='hinge'){
    // 铰链的落点 = 销钉位置（两锚点都在这里，还没接任何东西）。
    B=makeHinge(cx,cy);
  }else if(d.id==='rope'){
    // 轻绳与弹簧同款 —— 以落点为中心水平摆开，长度取表（拖出来 == 参数面板里的值）。
    var rl=d.len/2;
    B=makeRope(cx-rl,cy,cx+rl,cy);
  }
  if(B){
    // 杆放下时立刻尝试连到附近物体；必须放在这个唯一创建入口里，面板拖出（endDeviceOut）与
    //   器件模式点画布（toolTap）两条入口才同时生效。springTryAnchorByHost 里的 rodTryAnchor 只处理
    //   「把物体拖到杆上」，反方向「把杆拖到物体上」需要这里扫杆自己的两个端点，否则永远连不上，
    //   物体只被杆的镜像板推着走。弹簧/绳/铰链的落点锚定在 pointerup 的 'S' 分支（springTryAnchor）。
    if(d.id==='rod'&&typeof rodTryAnchor==='function')rodTryAnchor(B);
    B.pop=1;B.orbPulse=1;ringGo(B.x,B.y);
  }   // 与 spawnWhole / copyBody 一致的落体动画
  return B;
}
// 面板拖出时跟随指针的落点虚影。不复制线圈几何：drawSpring 只读 B.e0 / B.e1 / B.len / B.anc，
// 喂一个桩对象即可画出相同线圈；anc=[null,null] ⇒ 两端不画锚点，即「还没接上」的模样。
// 同一份渲染代码保证「虚影所见 = 松手所得」。
function drawDeviceGhost(id,cx,cy){
  var d=deviceById(id);
  if(!d)return;
  if(d.id==='spring'){
    var half=d.len/2;
    drawSpring({e0:{x:cx-half,y:cy},e1:{x:cx+half,y:cy},len:d.len,anc:[null,null]});
  }else if(d.id==='rod'){
    // 落点虚影 = drawRodPlank 喂桩对象（th=0 平放、len 取表），与 makeRod 造的杆同一份画线代码。
    drawRodPlank({x:cx,y:cy,th:0,len:d.len});
  }else if(d.id==='belt'){
    // 虚影 = drawBeltBody 喂桩对象（矩形框 + 会走的纹路），与 makeBelt 造出的带子同一套渲染。
    drawBeltBody({x:cx,y:cy,th:0,hw:d.len/2,hh:BELT_TH/2,conv:CONV_DEF,belt:true},false);
  }else if(d.id==='hinge'){
    // 虚影 = drawHinge 喂桩对象（同一份画线代码）。
    drawHinge({e0:{x:cx,y:cy},e1:{x:cx,y:cy},anc:[null,null]});
  }else if(d.id==='rope'){
    var rl2=d.len/2;
    // 虚影额外喂 ROPE_GHOST_SAG 垂度 ⇒ 画成弯曲的绳（与 chip 的波浪单线同义），而不是像杆的直线。
    //   落点、长度、锚点不变。
    drawRope({e0:{x:cx-rl2,y:cy},e1:{x:cx+rl2,y:cy},len:d.len,anc:[null,null]},ROPE_GHOST_SAG);
  }
}
// 吸附点标记（一个圈 + 一个圆心点），只在正在拖器件时出现；松手后它变成真正的锚点，标记自然消失。
// 配色用与墨色明显区分的砖红（#CE4A2C ≈ rgba(206,74,44)），表示「提示」而非实体。
function drawSnapMarker(x,y){
  cvx.beginPath();cvx.arc(x,y,6,0,6.2832);
  cvx.strokeStyle='rgba(206,74,44,0.92)';cvx.lineWidth=1.6;cvx.stroke();
  cvx.beginPath();cvx.arc(x,y,1.9,0,6.2832);
  cvx.fillStyle='rgba(206,74,44,0.95)';cvx.fill();
}
// 器件落点虚影的两个端点（与 drawDeviceGhost 几何同源：同一张 DEVICES 表、同一个水平摆开规则）
function devEndsLocal(id,cx,cy,len){
  if(id!=='spring'&&id!=='rope'&&id!=='rod')return null;   // 传送带/铰链没有可吸附的端点
  var h=(len||110)/2;
  return [{x:cx-h,y:cy},{x:cx+h,y:cy}];
}
/*
 * 吸附提示：把「将要连到哪里」提前画出来。覆盖器件正在被拖的两种情形：
 *   ① TOOL.devDrag（从面板拖出、还没放下）—— 用虚影端点；
 *   ② grab.kind==='body' 且抓的是器件（拖已存在的弹簧/杆）—— 用它真实的 e0/e1。
 * 候选判定与真正落锚共用同一份逻辑，「看见哪儿、就吸到哪儿」结构性成立。
 */
/* 「哪两端参与吸附提示」的唯一判定，标记与磁吸共用（各处各写一份会口径不一：
 * 轻绳不出标记、杆看见却不吸）。返回 {ends, anc, skip} 或 null。
 * hinge 排除：两锚点恒重合，且落锚要经 hingeSurfacePoint 挪到碰撞面上，
 * 标记点与最终锚点会差一个 BND_INK。 */
function devSnapEnds(B){
  if(!B||B.dead)return null;
  if(B.kind==='S'&&!B.hinge&&B.e0&&B.e1)
    return {ends:[{x:B.e0.x,y:B.e0.y},{x:B.e1.x,y:B.e1.y}],anc:B.anc,skip:B,owner:B};
  if(B.kind==='T'&&typeof rodEndWorld==='function')
    return {ends:[rodEndWorld(B,0),rodEndWorld(B,1)],anc:B.anc,skip:B,owner:B};
  return null;
}
/* 边中点候选的唯一判定（标记 / 磁吸 / 其他入口都走这里）：
 *   ① 在 bodies 里找离端点最近的宿主，且距离 ≤ SPR_PAD（端点得贴着它）；
 *   ② 该宿主用 hostMidSnapPoint 给出最近的边中点，且中点距离 ≤ SPR_MID_ZONE。
 * 返回 {q:{x,y}, hit:宿主, d:端点到中点的距离} 或 null。 */
function midSnapCandidate(ex,ey,skip){
  var hit=null,bd=SPR_PAD;
  for(var i=0;i<bodies.length;i++){
    var h=bodies[i];
    if(h.dead||h===skip)continue;
    var dd=distToHost(h,ex,ey);
    if(dd<bd){bd=dd;hit=h;}
  }
  if(!hit)return null;
  var q=hostMidSnapPoint(hit,ex,ey);
  if(!q)return null;
  return {q:q,hit:hit,d:Math.hypot(ex-q.x,ey-q.y)};
}
/* 拖动期的边中点磁吸位移。渐进拉法：位移 = 残差 × (1 − d/SPR_MID_ZONE)。
 *   d→0 时系数→1 ⇒ 收敛锁死（无需「吸住」状态，纯位置投影、幂等）；
 *   d=SPR_MID_ZONE 时系数=0 ⇒ 进入作用圈时连续、不瞬移（硬阈值会在边界跳变）。返回 {dx,dy,d} 或 null。 */
/* 统一吸附候选：质心 / 角 / 边中点，渐进拉法、作用于未锚定端、红点提示均与中点吸附相同。
 *   ① 质心（仅轻质杆 T；端点在质心带内 dc ≤ 0.7×半径）
 *   ② 角（独立铰链与杆都参与；hostCornerSnapPoint）
 *   ③ 边中点（杆参与；独立铰链不参与）
 * 角与边中点按「离端点更近」胜出，同距时才按「角 > 中点」定序。不要写成角短路：
 *   宿主 60×40 时角与边中点只相距 30px，而 CORNER_ZONE=26、SPR_MID_ZONE=30 作用圈必然重叠，
 *   拖到下边中点旁 6px 也会被判成角（端点停在离中点 10.8px 处）。
 * 质心带仍短路优先（插到中心就是要锚中心），它与角/中点几何上互斥。 */
function snapPickCandidate(ex,ey,skip,B){
  var hit=null,bd=SPR_PAD,i,h,dd;
  for(i=0;i<bodies.length;i++){
    h=bodies[i];
    if(h.dead||h===skip||h.kind!=='W')continue;
    dd=distToHost(h,ex,ey);
    var _dc=Math.hypot(ex-h.x,ey-h.y);
    var _rad=(h.wshape==='circle'&&h.rad)?h.rad:Math.min(h.hw||30,h.hh||24);
    var inside=(_dc<_rad);
    if(dd<bd||inside){bd=inside?0:dd;hit=h;}
  }
  if(!hit)return null;
  var isRod=!!(B&&B.kind==='T');
  var isHinge=!!(B&&B.kind==='S'&&B.hinge);
  /* ① 质心（仅杆）—— 与 springAnchorOffset 的质心带同口径（0.7×半径）。保留短路：带内点离角
   * 必然 > 0.3×半径，短边宿主也不会与角/中点重叠。 */
  if(isRod){
    var _cr=(hit.wshape==='circle'&&hit.rad)?hit.rad:Math.min(hit.hw||30,hit.hh||24);
    if(Math.hypot(ex-hit.x,ey-hit.y)<=_cr*0.7)
      return {q:{x:hit.x,y:hit.y},hit:hit,d:Math.hypot(ex-hit.x,ey-hit.y)};
  }
  /* ② 角 与 ③ 边中点：各自算距离，最近的胜（角短路会在短边宿主上抢走中点）。
   * 独立铰链不参与边中点。 */
  var qc=hostCornerSnapPoint(hit,ex,ey);
  var qm=isHinge?null:hostMidSnapPoint(hit,ex,ey);
  if(qc&&qm){
    var dc=Math.hypot(ex-qc.x,ey-qc.y),dm=Math.hypot(ex-qm.x,ey-qm.y);
    /* 同距（含浮点几乎相等）时才让角优先。 */
    return (dc<=dm)?{q:qc,hit:hit,d:dc}:{q:qm,hit:hit,d:dm};
  }
  if(qc)return {q:qc,hit:hit,d:Math.hypot(ex-qc.x,ey-qc.y)};
  if(qm)return {q:qm,hit:hit,d:Math.hypot(ex-qm.x,ey-qm.y)};
  return null;
}
function midMagnetDelta(ex,ey,skip,owner){
  var _ow=(owner!==undefined)?owner:((typeof grab!=='undefined'&&grab)?grab.obj:null);
  var c=snapPickCandidate(ex,ey,skip,_ow);
  if(!c)return null;
  var dx=c.q.x-ex,dy=c.q.y-ey,d=Math.hypot(dx,dy);
  if(d<0.05)return null;
  var k=1-Math.min(1,d/SPR_MID_ZONE);
  if(k<=0)return null;
  return {dx:dx*k,dy:dy*k,d:d};
}
/* 对正被抓着的元件做磁吸（逐子步调用，见 stepMatter 子步循环）。
 * 杆：先搬杆自己 → 再 rodDragPinHosts 把已锚宿主钉回杆端（顺序不能反）；
 * S 族：交给 springMoveRig（搬两端 + 所有非铁砧宿主，并清速度 ⇒ 不攒松手弹飞的动能）。
 * 只搬自由端（已锚端位置由宿主决定，抢它就是过约束）。 */
function midMagnetPullRig(B){
  if(!B||B.dead)return false;
  var ep=devSnapEnds(B);
  if(!ep)return false;
  for(var j=0;j<2;j++){
    if(ep.anc&&ep.anc[j])continue;
    var e=ep.ends[j];if(!e)continue;
    var m=midMagnetDelta(e.x,e.y,B,B);
    if(!m)continue;
    if(B.kind==='T'){
      B.x+=m.dx;B.y+=m.dy;
      rodDragPinHosts(B);
      if(B.mb){Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th||0);}
    }else{
      springMoveRig(B,m.dx,m.dy);
    }
    return true;
  }
  return false;
}
/* 对从面板拖出、还没放下的虚影做磁吸（同款判定、同款拉法）。
 * 虚影位置在 TOOL.devDrag.x/y —— 搬它，落点（placeDevice 用的坐标）自然吸到目标，与松手后的锚点一致。 */
function midMagnetPullGhost(){
  if(typeof TOOL==='undefined'||!TOOL||!TOOL.devDrag||!TOOL.devDrag.moved||!TOOL.devDrag.id)
    return false;
  var d=deviceById(TOOL.devDrag.id);
  var ends=devEndsLocal(TOOL.devDrag.id,TOOL.devDrag.x,TOOL.devDrag.y,d?d.len:110);
  if(!ends)return false;
  /* 给候选一个器件身份（杆 = T、铰链 = S+hinge），否则统一候选拿不到类型，虚影磁吸失效。 */
  var _ghostOwner=(TOOL.devDrag.id==='rod')?{kind:'T'}:((TOOL.devDrag.id==='hinge')?{kind:'S',hinge:true}:null);
  for(var j=0;j<2;j++){
    var m=midMagnetDelta(ends[j].x,ends[j].y,null,_ghostOwner);
    if(!m)continue;
    TOOL.devDrag.x+=m.dx;TOOL.devDrag.y+=m.dy;
    return true;
  }
  return false;
}
function drawDeviceSnapHints(){
  var pairs=[];
  if(typeof TOOL!=='undefined'&&TOOL&&TOOL.devDrag&&TOOL.devDrag.moved&&TOOL.devDrag.id){
    var d=deviceById(TOOL.devDrag.id);
    var ends=devEndsLocal(TOOL.devDrag.id,TOOL.devDrag.x,TOOL.devDrag.y,d?d.len:110);
    if(ends)pairs.push({ends:ends,anc:null});
  }else if(typeof grab!=='undefined'&&grab&&grab.kind==='body'&&grab.obj){
    // 用 devSnapEnds（与磁吸/落锚同一份判定）：绳的两端 e0/e1 与弹簧同构，同样参与提示。
    var pe=devSnapEnds(grab.obj);
    if(pe)pairs.push(pe);
  }
  for(var k=0;k<pairs.length;k++){
    var P=pairs[k];
    for(var j=0;j<2;j++){
      if(P.anc&&P.anc[j])continue;              // 这一端已经拴住了 ⇒ 不再提示
      var e=P.ends[j];if(!e)continue;
      /* 红点也走同一个统一候选（红点 = 将要吸附的位置，二者不分叉） */
      var c=snapPickCandidate(e.x,e.y,P.skip,(P&&P.owner)?P.owner:((typeof grab!=='undefined'&&grab)?grab.obj:null));
      if(c)drawSnapMarker(c.q.x,c.q.y);
    }
  }
}
