/* 轻绳（verlet 链） */
import Matter from 'matter-js';
import { BODY } from '../bodies/body.js';
import { _ropeHitBuf, bodies } from '../core/dom.js';
import { clamp } from '../core/math.js';
import { hostClosestPoint } from './anchor.js';
import { conProj, conPull } from './constraint.js';
import { ROPE_TAUT_EPS, refreshSpringGeom, springAnchoredWorld, springEnd, springSetEnd, springSyncEnds } from './spring.js';
import { GRAV } from '../params/defs.js';
import { cvx } from '../render/render.js';

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
export const ROPE_MIN_LEN=20, ROPE_MAX_LEN=2000;
// 轻绳/铰链的每帧位置修正步长：拖动端也参与位移分配（conPull 的 allowGrab，见 conMov），
//   一帧的修正能力必须盖得住指针一帧的位移。stepSprings 每帧只跑一次；实测 CON_MAXSTEP=12 时
//   30px/帧 的拖速会把 d 顶到 415px，取 48 时 d 全程 ≤ len+1.5。
export const CON_DRAG_STEP=48;
export function makeRope(ax,ay,bx,by){
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
export const ROPE_NODE_GAP=26;        // 节点平均间距（px）：链的空间分辨率（3~36 段自动适配绳长）
export const ROPE_VERLET_DAMP=0.95;   // 节点速度保留率：松弛链晃动 ~1s 内进冻结门（轻绳无质量、准静态，快安定更真实）
export const ROPE_COLLIDE_ITER=3;     // 段长约束+碰撞的迭代轮数
export const ROPE_SETTLE=0.03;        // 静止冻结门（px/帧）：最大节点位移低于此值即冻结
export function ropeSegCount(len){return clamp(Math.round((len||100)/ROPE_NODE_GAP),3,36);}
export function initRopeNodes(B){
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
export function ropeCollidables(B){           // 可碰撞实体：一切有 Matter 体的非 S 族（W/杆镜像/带子/字母刚体）
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
export function ropeVerletStep(B,dt){
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
              var qq=hostClosestPoint(hB3,nd3.x,nd3.y);
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
          var q=hostClosestPoint(hB,nd.px,nd.py);
          if(!q)q=hostClosestPoint(hB,nd.x,nd.y);
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
// 轻绳：单边约束（见上方语义段）。ux/uy 由 d>len 那一刻的连线定；d≈0 时用上一帧稳定轴。
export function ropeSolve(B,dt,h0,h1){
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
// ---- 渲染 ----
// 轻绳：比杆更细的墨线；松弛时下垂（松弛量越大垂得越深），绷直（d ≥ len）时画直线。
// 轻绳无质量 ⇒ 松弛绳形在静力学上不定（没有自重就没有悬链线），下垂只是「绳是软的」的惯用画法。
// 第二个实参 extraSlack 是纯渲染的附加垂度（px，默认 0），只给落点虚影用 —— 同一份画线代码，
//   「虚影所见 = 松手所得」结构性成立。
export function drawRope(B,extraSlack){
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
