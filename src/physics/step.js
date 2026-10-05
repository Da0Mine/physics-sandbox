/* 帧级物理：字母/公式体积分、墙与地面、手写碰撞、引力与场 */
import Matter from 'matter-js';
import { beltDragMatter, beltTract } from '../bodies/belt.js';
import { killLetter } from '../bodies/body.js';
import { ROD_PAD, bndHit, bndSolidHit } from '../bodies/boundary.js';
import { rodLenFrozen, rodMassOf } from '../bodies/rod.js';
import { lastDt } from '../core/loop.js';
import { clamp } from '../core/math.js';
import { bodies, freeL } from '../core/world.js';
import { spawnFormula, spawnText } from '../effects/text.js';
import { grab } from '../input/pointer.js';
import { F, killG } from '../letters/glyph.js';
import { isMVR } from '../letters/layout.js';
import { isGravityLetterOnly } from '../letters/merge.js';
import { freeLetter } from '../letters/panel.js';
import { GRAV } from '../params/defs.js';
import { pairOvAB } from '../params/panel.js';
import { BND_INK } from './matter.js';
import { A_FORCE, W, groundY } from '../render/render.js';
import { ringGo } from '../ui/menu.js';

export const AACC=1300;
export const Q_FORCE=2.2;
/* 带电 W 体（矩形/圆形/三角形器件）在场里的施力系数。
 * Matter 的 applyForce 在帧级调用只影响 4 个子步中的 1 个，且 body.force 每步末清零，
 * 所以不能照抄 applyGivenAccel 的逐子步口径 /1e6。
 * 此值为实测标定（非推导）：去摩擦测加速度，/1e6 → 比值 0.013、/12500 → 比值 9.0
 * （eacc=0.05 小倍率，避开速度上限与右墙），线性外推到实测 a == E_FIELD_ACC 得 /112500。 */
export const QFIELD_K=112500;
export const E_FIELD_ACC=1500;   // E field: SQUARE range (half-side 160), uniform direction (th), F=qE
export const SHATTER_SPEED=1100;
/* 杆的接触半厚（walls() 的地面/边缘夹子用它）。屏幕上画的线是 BND_INK=2.325 半厚，差 0.325px 肉眼不可见。
 * 夹子不反弹（e=0）：带 0.5 恢复系数时杆会在地面上 12Hz 弹跳（y 峰峰 3.73px）。 */
export const ROD_HH=2;
/* 顶部天花板（Matter 静态体 MW.wt）内缘的内缩量。内缘取 −(BND_INK+CEL_INSET)：物体真的越出画布
 * （墨迹完全离开可视区上缘）才碰到它 —— 与左右墙的离屏语义同款，只是窄一些，避免物体在屏幕里
 * 被看不见的墙挡住。内缘随视口走、与 groundY 无关。 */
export const CEL_INSET=24;
/* wt 内缘恒 = celInnerY()；wt 半高 300 ⇒ 中心 = celInnerY()−300。resize() 每帧按视口重算。
 * 必须惰性求值，不要写成 var CEL_INNER=-(BND_INK+CEL_INSET)：BND_INK 在后面才赋值，此处取到 undefined
 * ⇒ NaN ⇒ Bodies.rectangle 的 bounds 塌掉 ⇒ 顶墙存在、isStatic，却什么都挡不住。 */
export function celInnerY(){return -(BND_INK+CEL_INSET);}
export function celCenterY(){return celInnerY()-300;}
/* 被 a 赋予「持续加速度」的物体每帧受力（v += a·dt），与重力同量级持续作用；时间静止时本函数不跑 ⇒ 自然停住。 */
/* 必须逐子步调用（在 stepMatter 的子步循环里），不能每帧一次。
 * 系数 _m*ax/1e6 按 1000/240 子步标定：Matter 的 Δv[px/s] = force/mass · dt_ms² · 240 ⇒ 要得到 ax px/s²，
 * force/mass 须为 ax/1e6。Matter 每次 Engine.update 后清掉 body.force，每帧只施力一次时
 * 4 个子步里只有第 1 个吃到 ⇒ 实际加速度只有 1/4（面板上限 6000≈23 m/s² 实际 ≈5.8 < g，物体飞不起来）。
 * dt 形参不用（量纲已含在系数里）。 */
export function applyGivenAccel(dt){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B||B.dead||!B.accGive||!B.mb||B.mb.isStatic)continue;
    var ax=B.accX||0, ay=B.accY||0;
    if(!isFinite(ax)||!isFinite(ay))continue;
    /* 通过 Matter 的力通道（applyForce）驱动，不自己维护速度、不反复唤醒：
     * 每帧 setVelocity + Sleeping.set(false) 会覆盖 Matter 刚积分出的速度并重置睡眠计时，表现为一卡一卡。 */
    var _m=B.mb.mass||1;
    Matter.Body.applyForce(B.mb,{x:B.mb.position.x,y:B.mb.position.y},{x:_m*ax/1e6,y:_m*ay/1e6});
    if(B.mb.isSleeping)Matter.Sleeping.set(B.mb,false);
  }
}
export function stepPhysics(dt){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.kind==='B'||B.kind==='E')continue;
    if(B.bh)continue;   // black holes (any stage) are handled by stepBlackHole, not normal physics
    if(grab.kind==='body'&&grab.obj===B)continue;
    // 拖长度手柄期间杆的位姿归指针：重力、a 推力、阻尼、积分全部让位（否则按住端点不动杆也会往下掉）。
    if(rodLenFrozen(B))continue;
    if(B.kind==='W')continue;   // boundaries are integrated by the Matter layer (stepMatter)
    if(B.shatterBlast){
      // mc² explosion blast: the whole body shatters into its own letters (already flung out
      // with a big outward kick whose speed decays fast via B.decay)
      B.shatterBlast=false;
      shatter(B,'split');   // letters inherit the outward kick; freeL damping decays it fast
      continue;
    }
    // 孤立的 g（只有 g 一个字形、不是质量体、也没有 kind）是重力参数的可视化控件，不受重力，保持浮空
    // （与孤立的 r/a/v/m/μ 一致）。不要改 hasG 本身：promoteFreeLetter 会给含 g 的体置 hasG，
    // 但 hasG 还兼职「g + t -> gt」的组合判定（见 findTComboTarget）。
    // 轻质杆（kind==='T'）质量可忽略，同样不受重力：rodIntegrate 不含重力，这里是杆唯一的重力来源，
    // 摘这一处即可，不要改 makeRod 的 hasG。杆仍保留阻尼与碰撞，松手后停在原位。
    // 去掉杆的重力也消除了锚定端抽搐（重力每子步给 vy 加一点、锚点投影又吃掉这份位移的对拉）。
    if(B.hasG&&B.kind!=='T'&&!isGravityLetterOnly(B))B.vy+=((B.grav!=null)?B.grav:GRAV)*dt;
    if(B.hasA){
      var th=B.th||0;
      var aA=(B.acc!=null)?B.acc:AACC;
      B.vx+=-aA*Math.cos(th)*dt;
      B.vy+=-aA*Math.sin(th)*dt;
    }
    /* q（右键 promote 的电荷体、spawnField('q') 生成的场源体）没有重力，必须有阻尼，否则甩出去零衰减一路滑到底。
     * 用与自由字符同一套阻尼 0.94^(dt·60)（≈5.4%/帧），其它体维持 0.9992（近乎无阻尼）。
     * B/E 场源在函数开头已 continue。 */
    var damp=(B.kind==='q')?Math.pow(0.94,dt*60):Math.pow(0.9992,dt*60);
    B.vx*=damp;B.vy*=damp;
    // 杆的位置积分只归 rodIntegrate（240Hz 子步），这里不搬杆的位置。
    // 两处都积分会让杆速度约为正常的两倍，且与锚点约束永久对拉（锚端残差峰值 = v/60）。
    // 重力与阻尼仍在本函数（rodIntegrate 不含重力）。
    if(B.kind!=='T'){B.x+=B.vx*dt;B.y+=B.vy*dt;}
    walls(B);
  }
    for(var k=0;k<freeL.length;k++){
    var d=freeL[k];
    /* 被拖的字符（grab.obj===d）一律跳过自身积分，不能只看 d.state==='grab'：gdDown 给自由字符设的是
     * state='free'，条件几乎永不成立，字符会带着上次抛出的残余速度从指针下滑走。
     * 与 body 分支（grab.obj===B ⇒ continue）同一语义：拖拽期间位置归指针。 */
    if(grab.kind==='letter'&&grab.obj===d)continue;
    var massless=!!d.massless;
    var fdmp=massless?Math.pow(0.45,dt):Math.pow(0.94,dt*60);
    d.vx*=fdmp;d.vy*=fdmp;
    d.x2=d.wx+d.vx*dt;d.y2=d.wy+d.vy*dt;
    d.wx=d.x2;d.wy=d.y2;
    if(d.wx<20){d.wx=20;d.vx=Math.abs(d.vx)*0.6;}
    if(d.wx>W-20){d.wx=W-20;d.vx=-Math.abs(d.vx)*0.6;}
    if(d.wy<20){d.wy=20;d.vy=Math.abs(d.vy)*0.6;}
    if(!massless&&d.wy>groundY-8){d.wy=groundY-8;d.vy=-Math.abs(d.vy)*0.6;}
    // 自由字母（k / x / ½ / c / G / t … 没有参数面板、不会 promote 成 body 的符号）与 W 体 / 杆 / 弹簧的接触：
    // n 由边界指向字母，沿 n 推出 ov 解重叠，再抹掉法向速度（停在表面上被挡住）。
    // 已 promote 的符号走 collideBodies 的 bndHit 通道。
    // 注意：这里不加重力 —— 符号是浮空标签，给重力会让字母一松手就掉走，多字母公式（GMm / mv²r）拼不起来。
    var _noBound=(d.ch==='v'||d.ch==='q'||d.ch==='t'||d.ch==='a');   // 四类赋予型字符不受物体边界影响
    if(!massless&&!_noBound){
      var fc=freeLetterContact(d);
      if(fc){
        d.wx+=fc.nx*fc.ov;d.wy+=fc.ny*fc.ov;
        var fvn=(d.vx||0)*fc.nx+(d.vy||0)*fc.ny;
        if(fvn<0){d.vx-=fc.nx*fvn;d.vy-=fc.ny*fvn;}
      }
    }
  }
}
// 自由字母 vs 实体（W 体 / T 杆 / S 弹簧）的最深接触。bndHit 要一个带 glyphs 的
// 「另一侧」对象，这里复用同一个壳子只改字段，避免每帧每字母都新建字面量。
export const _flProxy={x:0,y:0,th:0,sc:1,glyphs:[null],kind:null,bh:null,vx:0,vy:0,hw:12,hh:11};
export function freeLetterContact(d){
  if(!d||d.dead)return null;
  var mm=d.m||null;
  var iw=mm?((mm.ir!=null&&mm.il!=null)?(mm.ir-mm.il):(mm.w||16)):((d.el&&d.el.offsetWidth)||16);
  var ih=mm?((mm.bot!=null&&mm.top!=null)?(mm.bot-mm.top):((d.el&&d.el.offsetHeight)||22)):22;
  _flProxy.x=d.wx;_flProxy.y=d.wy;_flProxy.vx=d.vx||0;_flProxy.vy=d.vy||0;
  _flProxy.hw=Math.max(4,iw/2);_flProxy.hh=Math.max(4,ih/2);
  _flProxy.glyphs[0]=d;
  var best=null;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B||B.dead)continue;
    // 只认 W 体：bndHit 第一参数要过 bndSegs→bndPts（读 B.pts），T 杆 / S 弹簧没有 pts，
    // 传进去会抛 "Cannot read properties of undefined (reading 'length')"。
    if(B.kind!=='W'||!B.pts||B.pts.length<2)continue;
    var wr=bndHit(B,_flProxy);
    if(wr&&(!best||wr.ov>best.ov))best=wr;
  }
  _flProxy.glyphs[0]=null;
  return best;
}
export function shatter(B,mode){
  var i=bodies.indexOf(B);if(i>=0)bodies.splice(i,1);
  var cx=B.x,cy=B.y;
  var S=Math.hypot(B.vx,B.vy)||1;
  var ux=-B.vx/S,uy=-B.vy/S;
  var px=-uy,py=ux;
  var base=S*0.275,spread=S*0.275;
  // structural glyphs (brackets / superscripts / bars) are always discarded
  for(var sk=B.glyphs.length-1;sk>=0;sk--){if(B.glyphs[sk].stk)killG(B.glyphs[sk]);}
  var lets=[];
  if(B.massG)lets.push(B.massG);
  for(var j2=0;j2<B.mem.length;j2++)if(B.mem[j2]!==B.massG)lets.push(B.mem[j2]);
  if(mode==='split'){
    // the body breaks into ITS OWN letters (e.g. mv² -> m, v, v) — reusable pieces
    for(var q=0;q<lets.length;q++){
      var L=lets[q];
      if(L.body===B){L.body=null;L.inBody=false;}
      L.pop=0;
      var off=(q-(lets.length-1)/2)*28;
      freeLetter(L,cx+px*off,cy+py*off, ux*base+px*spread*off/28, uy*base+py*spread*off/28, false);
    }
  }else{
    for(var j=0;j<lets.length;j++){
      var g=lets[j];
      if(g.body===B){g.body=null;g.inBody=false;killLetter(g);}
    }
  }
  B.glyphs=[];B.mem=[];
  if(mode==='formula'){
    // ½mv² wall smash — three preset outcomes by probability:
    //  0.4  full elastic-collision pair (v₁′/v₂′ with (m₁−m₂)v₁+2m₂v₂ numerators)
    //  0.3  simplified pair: v₁′=(m₁−m₂)/(m₁+m₂)·v₁  and  v₂′=2m₁/(m₁+m₂)·v₁
    //  0.3  single common-velocity formula v_共=(m₁v₁+m₂v₂)/(m₁+m₂), flying back the way it came
    var roll=Math.random();
    if(roll<0.4){
      spawnFormula(1,cx+px*26,cy+py*26, ux*base+px*spread, uy*base+py*spread);
      spawnFormula(2,cx-px*26,cy-py*26, ux*base-px*spread, uy*base-py*spread);
    }else if(roll<0.7){
      spawnFormula(3,cx+px*26,cy+py*26, ux*base+px*spread, uy*base+py*spread);
      spawnFormula(4,cx-px*26,cy-py*26, ux*base-px*spread, uy*base-py*spread);
    }else{
      // 原路返回: (ux,uy) already points AGAINST the incoming velocity, i.e. back along
      // the way the body came — fly the single formula back out along that path.
      spawnFormula(5,cx,cy,ux*base*0.8,uy*base*0.8);
    }
  }else if(mode==='labels'){
    spawnText('m₁v₁′',cx+px*26,cy+py*26, ux*base+px*spread, uy*base+py*spread);
    spawnText('m₂v₂′',cx-px*26,cy-py*26, ux*base-px*spread, uy*base-py*spread);
  }
  ringGo(cx,cy);
}
export function walls(B){
  if(B.kind){
    if(B.kind!=='T')return;
    // t-rod: a solid plank — rest on the ground, bounce off the screen edges, keep rotation
    // 杆没有 Matter 体，地面/屏幕边缘对杆的支撑只在这里：半高用 ROD_HH（不是 B.hh=4，否则杆悬在离地 2px 处），且不反弹。
    var lenh=B.len/2,c=Math.abs(Math.cos(B.th)),s=Math.abs(Math.sin(B.th));
    var ex=lenh*c+ROD_HH*s,ey=lenh*s+ROD_HH*c;
    if(B.y-ey<-8){B.y=-8+ey;B.vy=Math.abs(B.vy)*0.5;if(Math.abs(B.vy)<60)B.vy=0;}
    if(B.y+ey>groundY){B.y=groundY-ey;if(B.vy>0)B.vy=0;}
    if(B.x-ex<-8){B.x=-8+ex;B.vx=Math.abs(B.vx)*0.5;if(Math.abs(B.vx)<60)B.vx=0;}
    if(B.x+ex>W+8){B.x=W+8-ex;B.vx=-Math.abs(B.vx)*0.5;if(Math.abs(B.vx)<60)B.vx=0;}
    return;
  }
  var sc=B.sc||1;
  var hw=(B.hw||20)*sc,hh=(B.hh||18)*sc;
  var el=B.hasV,e=el?0.92:0.28;
  if(B.bounc!=null)e=B.bounc;
  // mg 是「重力」预设（friction:0.01 → 地面摩擦极小，像冰面），m(g+gμ) 是默认摩擦。
  // 无论有没有 μ 字母，摩擦力都只在贴地/贴墙时施加，避免空中乱衰减。
  if(B.hasMu||B.frict!=null){
    var fk=(B.frict!=null)?B.frict:(B.hasMu?0.10:0);
    // 只有贴着地面/墙壁时摩擦才作用（判断四边接触）
    var touch=((cyp+hh)>=(groundY-0.5))||((cyp-hh)<=(-8+0.5))||((cxp-hw)<=(-8+0.5))||((cxp+hw)>=(W+8-0.5));
    if(touch){
      B.vx*=(1-fk);B.vy*=(1-fk);
    }
  }
  var ox=0,oy=0;
  if(B.orb&&B.orb.k>=0.02&&B.orb.gx!=null){ox=B.orb.gx-B.x;oy=B.orb.gy-B.y;}
  var cxp=B.x+ox,cyp=B.y+oy;
  function shatterIfFast(sp){
    if(sp<SHATTER_SPEED)return false;
    if(B.hasC&&B.cCount>=2){
      return false;   // mc² never shatters on a wall — it just bounces off (then inflates/explodes)
    }
    if(B.hasHalf&&B.vCount>=2){
      shatter(B,'formula');   // ½mv² keeps its elastic-collision formula shards (preset)
      return true;
    }
    // EVERY other lettered whole (mv, mv², mg, GMm/r² well, ...) breaks into its OWN letters
    if(B.massG||B.mem.length){
      shatter(B,'split');
      return true;
    }
    return false;
  }
  if(cyp-hh<-8){
    if(shatterIfFast(Math.abs(B.vy)))return;
    cyp=-8+hh;B.vy=Math.abs(B.vy)*e;if(!el)B.vx*=0.4;
  }
  if(cyp+hh>groundY){
    if(shatterIfFast(Math.abs(B.vy)))return;
    cyp=groundY-hh;B.vy=-Math.abs(B.vy)*e;if(!el)B.vx*=0.35;
  }
  if(cxp-hw<-8){
    if(shatterIfFast(Math.abs(B.vx)))return;
    cxp=-8+hw;B.vx=Math.abs(B.vx)*e;if(!el)B.vy*=0.55;
  }
  if(cxp+hw>W+8){
    if(shatterIfFast(Math.abs(B.vx)))return;
    cxp=W+8-hw;B.vx=-Math.abs(B.vx)*e;if(!el)B.vy*=0.55;
  }
  B.x=cxp-ox;B.y=cyp-oy;
}
/* 自研的边界判定也要跳过同碰撞组（铰链相连的两物体可相互重叠）：只在 Matter 的 collisionFilter 设组不够，
 * 自研碰撞会继续把它们推开 ⇒ 抽搐。 */
export function sameRodGroup(A,B){
  /* 即时查连接关系，不依赖 _rcg 标记：标记可能从上一个场景残留，误把不该忽略的碰撞跳过（贴墙角穿透）。 */
  if(!A||!B)return false;
  /* 静态体（用户画的地面/墙/挡板）永远是边界，不参与「同组不碰撞」，与 rodSyncNoCollide 同口径；
   * 否则换个 kind 组合（例如公式体当宿主）会穿地。 */
  if((A.mb&&A.mb.isStatic)||(B.mb&&B.mb.isStatic))return false;
  for(var i=0;i<bodies.length;i++){
    var R=bodies[i];
    if(R.dead||!R.anc)continue;
    if(R.kind!=='T'&&!(R.kind==='S'&&R.hinge))continue;
    var h0=R.anc[0]?R.anc[0].B:null, h1=R.anc[1]?R.anc[1].B:null;
    if(!h0||!h1)continue;
    if((h0===A&&h1===B)||(h0===B&&h1===A))return true;
  }
  return false;
}
export function collideBodies(){
  function ext(B){
    var th=B.th||0,c=Math.abs(Math.cos(th)),s=Math.abs(Math.sin(th));
    // B.hw/B.hh live in LAYOUT units; B.sc shrinks big formulas (½mv²/r, GMm/r²…) to fit.
    // walls() already scales by it — do the same here, otherwise a shrunk formula collides
    // with a 1/sc times too large box (a plank would "hit" it from far away).
    var sc=B.sc||1;
    var hw=(B.hw||24)*sc,hh=(B.hh||18)*sc;
    return {ex:hw*c+hh*s,ey:hw*s+hh*c};
  }
  for(var i=0;i<bodies.length;i++){
    var A=bodies[i];
    // fields pass through; black holes are singularities (no solid box). 'W' boundaries ARE
    // solid — they are walls, so they take part in exactly the same contact pass as a rod.
    // B/E 是力场，保持透明；q（电荷）/I（电流）是有实体的粒子，要与公式体一样被挡住：
    // W-vs-q 走 bndHit（被画笔轨迹/轮廓挡住并弹开），q-vs-杆/弹簧/其它公式走各自分支。
    // 注意：!A.kind 必须放行 —— 公式体（mg / mv² / F=ma …）的 kind 为 null，漏掉会让 mg 不落在板面上。
    var AK=(!A.kind||A.kind==='T'||A.kind==='W'||A.kind==='S'||A.kind==='q'||A.kind==='I');
    if(!AK||A.bh)continue;
    if(grab.kind==='body'&&grab.obj===A)continue;
    var ea=ext(A);
    for(var j=i+1;j<bodies.length;j++){
      var B=bodies[j];
      // 同 A：让 q / I 也进入接触通道
      var BK=(!B.kind||B.kind==='T'||B.kind==='W'||B.kind==='S'||B.kind==='q'||B.kind==='I');
      if(!BK||B.bh)continue;
      if(grab.kind==='body'&&grab.obj===B)continue;
      var eb=ext(B);
      var aox=0,aoy=0; if(A.orb&&A.orb.k>=0.02&&A.orb.gx!=null){aox=A.orb.gx-A.x;aoy=A.orb.gy-A.y;}
      var box=0,boy=0; if(B.orb&&B.orb.k>=0.02&&B.orb.gx!=null){box=B.orb.gx-B.x;boy=B.orb.gy-B.y;}
      var dx=(B.x+box)-(A.x+aox),dy=(B.y+boy)-(A.y+aoy);
      var nx=0,ny=0,ov=0;
      var AT=(A.kind==='T'),BT=(B.kind==='T');
      var AW=(A.kind==='W'),BW=(B.kind==='W');
      // 弹簧（kind 'S'）：接触几何与 T 杆同型（细长条），走同一条 SAT 分支。
      // 弹簧在碰撞里不可推动（和杆/边界一样）：两端由锚点和指针决定，碰撞改 B.x 会被下一帧
      // refreshSpringGeom 覆盖，只会造成穿插。
      var AS=(A.kind==='S'),BS=(B.kind==='S');
      if(AW||BW){
        // ---- BOUNDARY contacts --------------------------------------------------------------
        // W-vs-W, W-vs-rod and W-vs-spring are owned by the Matter world (a real sequential-impulse
        // solver: stacking, momentum, resting stability). This hand-rolled pass keeps only the case
        // it is still needed for: a formula letter touching a boundary's solid edges.
        if((AW&&BW)||(AW&&B.kind==='T')||(BW&&A.kind==='T')
           ||(AW&&BS)||(BW&&AS)){
          // 这一族接触交给 Matter 求解器，但传送带的带面牵引必须在 continue 之前补上：
          // Matter 不知道带子在跑，continue 之后这对接触不再进任何手写通道。
          if(A.belt)beltDragMatter(A,B);
          if(B.belt)beltDragMatter(B,A);
          continue;
        }
        /* 同碰撞组（铰链相连）⇒ 直接跳过手写碰撞：它们允许互相重叠，只剩杆的约束把它们连在一起（消除接触/分离的边界抖动）。 */
        if(sameRodGroup(A,B))continue;
        var wr;
        if(AW&&!BW)wr=bndHit(A,B);                       // n already points A -> B
        else if(BW&&!AW){var wr2=bndHit(B,A);wr=wr2?{ov:wr2.ov,nx:-wr2.nx,ny:-wr2.ny}:null;}
        else wr=bndSolidHit(A,B);                        // (no longer reachable; kept as a guard)
        if(!wr)continue;
        ov=wr.ov;nx=wr.nx;ny=wr.ny;
        // 传送带表面牵引（唯一有效的写入点，见 beltTract 上方注释）。放在法向冲量之前：牵引只改切向，
        // 不影响 vn 判定。切向由法向转 90° 得到，法向取反时 vt 与 t 同时反号，牵引量不变 ⇒ 无需翻转。
        if(AW)beltTract(A,B,nx,ny,ov);else beltTract(B,A,nx,ny,ov);
      }else if(AT||BT||AS||BS){
        /* 杆—杆（T↔T）不做任何接触：杆没有碰撞箱（也没有 Matter 体），只对物体起约束作用。
         * 若在这条 SAT 通道里把两根杆当 2px 半厚的实心板互推：多杆链中两根杆锚在同一物体上、拖动时在其附近必然交叉，
         * rodDragPinChain 每子步把锚点残差拉到 0，帧末这里又把两杆各推开 ~7px，拉锯成恒定 7~10px 的「杆与物体分离」
         * （峰值随当帧交叉深度波动）。
         * 与弹簧一致（sameRodGroup 用负 group 排除铰链相连的一对）：约束件之间只剩几何约束。
         * 物品不能搁在杆上；杆被字符/公式体撞到属于 T↔非T，不受本条影响。 */
        if(AT&&BT)continue;
        // ---- ROD vs BODY: exact 2-D SAT between oriented boxes --------------------------
        // The rod is a THIN PLANK (half-length len/2, half-thickness 2) — the very same kind
        // of solid as the ground and the screen walls; a wall is just the axis-aligned special
        // case of this test.
        // IMPORTANT: a formula is NOT a filled rectangle. Its ink is a ROW OF GLYPH BOXES and
        // the glyphs never fill the corners of their union AABB — the 'm' of "mg" has no
        // descender at all. With a single AABB it is that EMPTY corner which touches a tilted
        // plank, so the nearest real ink stayed 10–25px away: the box was in perfect contact
        // (gap 0) while the user saw "隔着一段距离". So test the plank against EVERY glyph's
        // ink box and keep the deepest REAL contact. For axis-aligned contact (ground, flat
        // rod, vertical rod) the union of those boxes equals the old AABB, so nothing else
        // moves; a body with no glyphs (synthetic/test bodies) still uses its whole AABB.
        var seg,oth,isSegA;
        if(AT){seg=A;oth=B;isSegA=true;}else{seg=B;oth=A;isSegA=false;}
        // 弹簧不推它自己拴住的宿主。Matter 侧靠 SPR_CGROUP=-2 把「弹簧镜像板 ↔ 宿主」放进同一负 group
        // （板必然穿过锚在它身上的宿主，求解器强行分开会注入巨大能量），但字母刚体没有 Matter 体，
        // springSyncGroups 的 if(!a.B.mb)continue 会跳过它，必须在这条手写通道里排除；
        // 否则板（immA/immB 对 S 恒真）每帧沿法线推字母，而 e0/e1 锚在字母上跟着走，重叠永不消除，宿主自己爬走。
        // 排除后弹簧与宿主之间只剩弹力。
        if(seg.kind==='S'){
          var ah0=seg.anc[0],ah1=seg.anc[1];
          if((ah0&&ah0.B===oth)||(ah1&&ah1.B===oth))continue;
        }
        var sX2=seg.x,sY2=seg.y;
        var aTH=seg.th||0,aHW=Math.max(4,(seg.len||170)/2),aHH=2;
        var ae1x=Math.cos(aTH),ae1y=Math.sin(aTH),ae2x=-ae1y,ae2y=ae1x;
        var pieces=null;
        if(oth.glyphs&&oth.glyphs.length&&!oth.kind&&!oth.bh){
          var osc0=oth.sc||1,oTH=oth.th||0,oc0=Math.cos(oTH),os0=Math.sin(oTH);
          pieces=[];
          for(var pi=0;pi<oth.glyphs.length;pi++){
            var pg=oth.glyphs[pi];
            if(!pg||pg.dead||!pg.m)continue;
            var gtop=(pg.m.top==null?-F/2:pg.m.top),gbot=(pg.m.bot==null?F/2:pg.m.bot);
            var gw=(pg.m.w||F*0.6);
            var gil=(pg.m.il==null?-gw/2:pg.m.il),gir=(pg.m.ir==null?gw/2:pg.m.ir);
            var gx=(pg.sx||0)+(gil+gir)/2,gy=(pg.sy||0)+(gtop+gbot)/2;
            pieces.push({x:oth.x+(gx*oc0-gy*os0)*osc0,y:oth.y+(gx*os0+gy*oc0)*osc0,
                         hw:((gir-gil)/2)*osc0,hh:((gbot-gtop)/2)*osc0,th:oTH,pad:ROD_PAD});
          }
        }
        if(!pieces||!pieces.length){
          // no glyphs (synthetic bodies): keep the plain AABB, whose hw/hh already carry their
          // own padding from anchorBox -> pad 0 here.
          pieces=[{x:(oth===B)?(B.x+box):(A.x+aox),y:(oth===B)?(B.y+boy):(A.y+aoy),
                   hw:(oth.hw||24)*(oth.sc||1),hh:(oth.hh||18)*(oth.sc||1),th:oth.th||0,pad:0}];
        }
        // ---- CONTINUOUS (swept) contact along THIS FRAME'S MOTION -------------------------
        // The plank is only 2px half-thick, but a falling body covers ~17-20px in one 1/60s
        // frame, so a test of the CURRENT position alone can miss the plank entirely. And a miss
        // is not merely a missed hit: the very next frame the glyph's centre is already PAST the
        // rod's centre line, so the sign picked from `ad` flips and the body gets flung THROUGH
        // instead of stopped (measured: mg dropped on a plank jumped 39px per frame and went
        // straight through). So walk the swept path in <=3px sub-steps. The FIRST sub-step that
        // touches is shallow and still on the original side, which gives both a trustworthy
        // contact normal and a small penetration. At rest the sweep is ~0 -> K=1 -> the plain SAT.
        var mdx=(oth.vx||0)*lastDt,mdy=(oth.vy||0)*lastDt;
        var mlen=Math.sqrt(mdx*mdx+mdy*mdy);
        var K=(mlen>3)?Math.min(12,Math.ceil(mlen/3)):1;
        ov=0;nx=0;ny=0;
        for(var qi=0;qi<pieces.length;qi++){
          var PC=pieces[qi];
          var be1x=Math.cos(PC.th),be1y=Math.sin(PC.th),be2x=-be1y,be2y=be1x;
          var ax=[ae1x,ae1y,ae2x,ae2y,be1x,be1y,be2x,be2y];
          var hit=false,qnx=0,qny=0,qR=0;
          for(var kk=1;kk<=K&&!hit;kk++){
            var ft=kk/K;                               // 1 = where the body is NOW
            var pdx=PC.x-mdx*(1-ft)-sX2,pdy=PC.y-mdy*(1-ft)-sY2;
            var tmin=1e9,tnx=0,tny=0,tR=0,tsep=false;
            for(var ai=0;ai<8;ai+=2){
              var anx=ax[ai],any=ax[ai+1];
              var ra=aHW*Math.abs(anx*ae1x+any*ae1y)+aHH*Math.abs(anx*ae2x+any*ae2y);
              var rb=PC.hw*Math.abs(anx*be1x+any*be1y)+PC.hh*Math.abs(anx*be2x+any*be2y);
              var ad=pdx*anx+pdy*any;
              // PC.pad is applied ALONG THE CONTACT NORMAL (not per axis), so a 45 deg contact is
              // not inflated to 1.41x the intended clearance — that is what made the tilted rod
              // look like it had a gap while the flat rod looked right.
              var need=ra+rb+PC.pad,aov=need-Math.abs(ad);
              if(aov<=0){tsep=true;break;}             // a separating axis exists -> this glyph is clear
              if(aov<tmin){tmin=aov;var asg=(ad<0)?-1:1;tnx=asg*anx;tny=asg*any;tR=need;}
            }
            if(tsep)continue;
            hit=true;qnx=tnx;qny=tny;qR=tR;
          }
          if(!hit)continue;
          // qn points rod -> the side the glyph CAME FROM; push the body's real (current) centre
          // back out to that surface. If the sweep had to catch a jump this is > R, which is
          // exactly the correction that undoes the jump. Resting contact -> 0 (i.e. the MTV).
          var adv=(PC.x-sX2)*qnx+(PC.y-sY2)*qny;
          var ovc=qR-adv;
          if(ovc>ov){ov=ovc;nx=isSegA?qnx:-qnx;ny=isSegA?qny:-qny;}
        }
        if(ov<=0)continue;                             // no glyph is touching the plank
      }else{
        var ox=ea.ex+eb.ex-Math.abs(dx);
        if(ox<=0)continue;
        var oy=ea.ey+eb.ey-Math.abs(dy);
        if(oy<=0)continue;
        if(ox<oy){nx=(dx>0)?1:-1;ov=ox;}else{ny=(dy>0)?1:-1;ov=oy;}
      }
      // A gravity well (complete GMm/r²) and a boundary ('W') are STATIC BODIES: they
      // never move or gain velocity from impacts - an anvil, not a projectile. A boundary is still
      // allowed to FALL by gravity (stepPhysics) and to be pushed back out of whatever it landed
      // on (the block further down); what it never gets is a shove or a bounce. Once a well is
      // split (losing M or a 2nd r) it is no longer isWell and becomes a normal pushable body.
      // 杆不在此列：按自己的质量参与碰撞（默认 1kg，见 rodMassOf），否则重物砸杠杆撬不动，质量失效。
      // W 与 S（弹簧）保持不可推动：W 是用户画的地形，S 的两端由锚点决定，碰撞改位置会与每帧几何重建打架。
      var mA=(A.kind==='W'||A.kind==='S'?1e7:(A.kind==='T'?rodMassOf(A):(A.isWell?1e9:(A.bh?1e9:(A.mass||1))))),mB=(B.kind==='W'||B.kind==='S'?1e7:(B.kind==='T'?rodMassOf(B):(B.isWell?1e9:(B.bh?1e9:(B.mass||1))))),sum=mA+mB;
      var immA=(A.kind==='W')||(A.kind==='S')||A.isWell||!!A.bh, immB=(B.kind==='W')||(B.kind==='S')||B.isWell||!!B.bh;
      // n points A->B; B sits on the +n side. To SEPARATE: B along +n, A along -n.
      if(!immA){A.x-=nx*ov*(mB/sum);A.y-=ny*ov*(mB/sum);}
      if(!immB){B.x+=nx*ov*(mA/sum);B.y+=ny*ov*(mA/sum);}
      // 边界（W）一侧用 rvx/rvy：位姿差分求出的真实速度，带亚像素死区（见 stepMatter）。
      // Matter 的幻影 velocity 与复合体静置时的 1px 跳变会把静止的墙报成 ~150px/s，压在上面的物体每帧被 vn 反弹。
      var avx2=(A.kind==='W')?(A.rvx||0):A.vx, avy2=(A.kind==='W')?(A.rvy||0):A.vy;
      var bvx2=(B.kind==='W')?(B.rvx||0):B.vx, bvy2=(B.kind==='W')?(B.rvy||0):B.vy;
      // ---- 杆的接触点速度必须带上自身的转动 ------------------------------------
      // 杆是有质量、可转动的刚体；冲量收敛的前提是施加后 vn 不再为正。vn 只看质心速度的话，
      // 加到 om 上的角冲量永远不参与 vn，冲量每帧重来，杆被转成陀螺（ω 冲到 10+ rad/s）。
      //   接触点速度 = 质心速度 + ω × r，在本页的旋转约定下即 (vx − ω·rAy, vy + ω·rAx)。
      var rodT=null,othT=null;
      if(A.kind==='T'&&!immA){rodT=A;othT=B;}
      else if(B.kind==='T'&&!immB){rodT=B;othT=A;}
      var rAx=0,rAy=0,rr=0,rotI=0;
      if(rodT){
        var cthT=Math.cos(rodT.th||0),sthT=Math.sin(rodT.th||0);
        var LT=rodT.len||170,hlT=LT/2;
        // 接触点近似取「对方质心在杆轴上的投影」（细杆 + 点状对方，误差远小于杆长）
        var sT=(othT.x-rodT.x)*cthT+(othT.y-rodT.y)*sthT;
        if(sT>hlT)sT=hlT; if(sT<-hlT)sT=-hlT;
        rAx=cthT*sT;rAy=sthT*sT;
        rotI=(rodMassOf(rodT)*LT*LT)/12;         // 均匀细杆绕质心：I = mL²/12
        if(!(rotI>1e-9))rotI=0;
        if(rotI>0){
          var wT=rodT.om||0;
          if(rodT===A){avx2-=wT*rAy;avy2+=wT*rAx;}
          else{bvx2-=wT*rAy;bvy2+=wT*rAx;}
        }
      }
      var vn=(avx2-bvx2)*nx+(avy2-bvy2)*ny;
      if(vn>0){   // vn>0 = approaching (n points A->B); reflect the relative normal speed
        var eA=(A.bounc!=null)?A.bounc:(A.hasV?1:0.75);
        var eB=(B.bounc!=null)?B.bounc:(B.hasV?1:0.75);
        var e=(eA+eB)/2;
        // 配对表里为（这个物体 ↔ 这个物体）显式设过的弹性优先于默认合成规则。
        // 公式体没有 Matter 体，W↔公式体的接触完全走这条手写通道，覆盖必须在这里生效。
        var eov2=pairOvAB(A,B);
        if(eov2.e!=null)e=eov2.e;
        // 静止接触不该有弹性：墙（W）bounc=0，但 (eA+eB)/2 会混进对面的弹性（字母 0.75 → e=0.375），
        // 每帧重力加出的那点法向速度又被弹回，物体永远停在亚像素微弹里。相对法向速度小到只可能是
        // 「重力一帧加出来的」时按完全非弹性处理；真正撞上来照旧反弹。弹簧同理（bounc=0 的铁砧）。
        if((AW||BW||AS||BS)&&Math.abs(vn)<W_BOUNCE_MIN)e=0;
        // ---- 角冲量 ----------------------------------------------------
        // 标准刚体冲量：有效质量里加入转动项 (r×n)²/I，冲量按力矩 τ = r × F 折算成 Δω = τ/I。
        // 没有这一项杆只会平移、永远撬不起来；杆越轻越长越容易被撬动。
        var Kden=1/mA+1/mB;
        if(rotI>0){rr=rAx*ny-rAy*nx;Kden+=(rr*rr)/rotI;}   // (r×n) 的 z 分量
        var jimp=-(1+e)*vn/Kden;
        if(!immA){A.vx+=jimp*nx/mA;A.vy+=jimp*ny/mA;}
        if(!immB){B.vx-=jimp*nx/mB;B.vy-=jimp*ny/mB;}
        if(rotI>0){
          // 作用在杆上的冲量：杆是 A 时取 +n，是 B 时取 −n（与上面两行同符号）
          var sgnT=(rodT===A)?1:-1;
          rodT.om+=(rAx*(sgnT*jimp*ny)-rAy*(sgnT*jimp*nx))/rotI;
        }
      }
      // ---- a boundary that FELL onto a STATIC body still has to be able to LAND on it ---------
      // Both sides unpushable means the block above produced no response whatsoever, so an
      // outline falling onto a rod / another outline would sink straight through the very plank it
      // landed on. Give the boundary the single move it needs: back out along the normal, and kill
      // its landing speed. It is still never shoved sideways and never bounces (bounc=0), so
      // nothing can knock it about - weight, not inertia.
      if((AW||BW)&&immA&&immB){
        var half=(AW&&BW)?0.5:1;                       // two boundaries share the separation
        if(AW){
          A.x-=nx*ov*half;A.y-=ny*ov*half;
          var va=A.vx*nx+A.vy*ny;if(va>0){A.vx-=va*nx;A.vy-=va*ny;}
        }
        if(BW){
          B.x+=nx*ov*half;B.y+=ny*ov*half;
          var vb=-(B.vx*nx+B.vy*ny);if(vb>0){B.vx+=vb*nx;B.vy+=vb*ny;}
        }
      }
    }
  }
}
export const G_RANGE=360;
/* 真 GM/r²（Plummer 软化）的系数。标定：在 r=150px 处与旧的 G_PULL/(r+80) 加速度相等
 ⇒ G_PULL2 = 52000·(150+80)/150·(150²+80²)^1.5/… = 7.405e6
 （旧公式在 r=150、默认 M/3=1 时 a=52000/230=226.1 px/s²）。 */
export const G_PULL2=7.405e6;
export function stepGravity(dt){
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
export function stepField(dt){
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
         * 实际使用的 QFIELD_K=112500 是实测标定值（见本文件顶部 QFIELD_K 的说明）。 */
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
// 与墙接触时，相对法向速度低于此值算静止接触（恢复系数按 0 处理）。
// 一帧重力增速 GRAV*dt ≈ 43px/s，静止接触的 vn 即此量级；10px 高自由落体落地约 228px/s，真实撞击照旧反弹。
export const W_BOUNCE_MIN=140;
