/* 画布尺寸、每帧绘制、悬停检测 */
import Matter from 'matter-js';
import { app } from '../state.js';
import { beltEndWorld } from '../bodies/belt.js';
import { arcEndWorld, drawBoundaries, nearInk } from '../bodies/boundary.js';
import { ROD_SNAP_PREVIEW, drawRodPlank, rodEndWorld, rodSnapPreviewScan } from '../bodies/rod.js';
import { ark, cv, handle, rodh, rszHandle } from '../core/dom.js';
import { clamp, cubE, eOut, popScale, segPointDist } from '../core/math.js';
import { bodies, freeL } from '../core/world.js';
import { drawHinge } from '../devices/hinge.js';
import { drawDeviceSnapHints } from '../devices/placement.js';
import { drawRope } from '../devices/rope.js';
import { drawSpring, springCanRotate } from '../devices/spring.js';
import { drawBlackHole } from '../effects/blackhole.js';
import { drawParticles } from '../effects/particles.js';
import { formulas } from '../effects/text.js';
import { SPR_GRAB, grab, pointer, trashDrag } from '../input/pointer.js';
import { BAR } from '../letters/glyph.js';
import { boxExtentAlong, place, placeLetter, slot } from '../letters/layout.js';
import { findMergeTarget, findSolidBodyAt } from '../letters/merge.js';
import { MW } from '../physics/matter.js';
import { G_RANGE, celCenterY } from '../physics/step.js';
import { drawToolPreview } from '../tools/draw.js';
import { TOOL } from '../ui/toolbar.js';

export const B_FIELD_RANGE=320;
export const A_FORCE=900;
export const E_FIELD_RANGE=320;
export let arcHov=null;   // 手柄当前归属的弧（refreshHover 每帧更新）
export let rodHov=null;   // 长度手柄当前归属的杆（refreshHover 每帧更新）
export let W=0, H=0, groundY=0;
export let handleBody=null;
// 旋转手柄驻留：手柄显示过之后即使 hover 丢失也再保留一段时间，让指针来得及挪到手柄上
export let handleKeep=null, handleLinger=0;
export const HANDLE_LINGER=900;   // 驻留时长 ms
export let dpr;
export let cvx;
export let hoverB=null;
export function refreshHover(){
  // W 体的悬浮命中在这里每帧算一次，不只在 pointermove 里：画笔落笔期间 pointermove 被 TOOL.stroke 挡掉，
  // 松手后指针不动又没有新的 pointermove，刚画完的东西指针停在上面也不发光。
  // 判定为「贴着线才算」（nearInk），空心图形的内部空白不响应。
  app.hoverW=null;
  // 旋转手柄悬在物体上边缘再往外 26px，在「只有线才响应」的命中区之外：指针一移到手柄上 hoverW/hoverB 就变空，
  // 手柄的 pointerdown（要读 hoverB）拿不到宿主。所以先判指针是否压在手柄命中框内，是则把上一帧宿主
  // 继续当悬浮目标。handleBody 在下方放置手柄时写入。
  var onRotHandle=false;
  if(handleBody&&handle.classList.contains('on')){
    var hr0=handle.getBoundingClientRect();
    onRotHandle=(pointer.x>=hr0.left-4&&pointer.x<=hr0.right+4
                 &&pointer.y>=hr0.top-4&&pointer.y<=hr0.bottom+4);
  }
  // 杆两端的长度手柄同样悬在命中带之外（长杆端点远在悬浮半径 rr 之外），指针挪上去 hoverB 就空、手柄消失。
  // 与 onRotHandle 同一解法：指针压在已显示的手柄上时继续把上一帧的宿主 rodHov 当悬浮目标。
  var onRodHandle=false;
  for(var ri0=0;ri0<2;ri0++){
    if(!rodh[ri0]||!rodh[ri0].classList.contains('on'))continue;
    var rr0=rodh[ri0].getBoundingClientRect();
    if(pointer.x>=rr0.left-4&&pointer.x<=rr0.right+4
       &&pointer.y>=rr0.top-4&&pointer.y<=rr0.bottom+4){onRodHandle=true;break;}
  }
  if(!grab.kind&&!TOOL.stroke&&!TOOL.drag&&!trashDrag.active){
    if(onRotHandle&&handleBody.kind==='W')app.hoverW=handleBody;
    else for(var wi=0;wi<bodies.length;wi++){
      var WB=bodies[wi];
      if(WB.kind!=='W'||WB.dead)continue;
      if(nearInk(WB,pointer.x,pointer.y)){app.hoverW=WB;continue;}
      if(WB.ell){   // 弧的两个黄色端点手柄直径 18px，要够好点中
        for(var we=0;we<2;we++){
          var wep=arcEndWorld(WB,we);
          if(Math.hypot(pointer.x-wep.x,pointer.y-wep.y)<16){app.hoverW=WB;break;}
        }
      }
    }
  }
  hoverB=null;
  if(grab.kind==='body'){hoverB=grab.obj;}
  else{
    var best=null,bd=1e9;
    for(var i=0;i<bodies.length;i++){
      var B=bodies[i];
      var s=(B.kind==='T')?{x:B.x,y:B.y}:(B.massG?slot(B,B.massG):{x:B.x,y:B.y});
      var dx=pointer.x-s.x,dy=pointer.y-s.y;
      if(B.kind==='E'){
        // The E-field floating rotate button must appear while the pointer is ANYWHERE
        // inside the field BOX (possibly asymmetric edges), not only when it sits on the
        // E glyph — same box test as stepField / drawFieldE so the hover area matches.
        // +8 edge tolerance: the resize bar hangs just OUTSIDE the edge, so the pointer on
        // the bar must still register the field as hovered (hover reaching the handle).
        var erH=B.er||{l:(B.fieldR||E_FIELD_RANGE)/2,r:(B.fieldR||E_FIELD_RANGE)/2,t:(B.fieldR||E_FIELD_RANGE)/2,b:(B.fieldR||E_FIELD_RANGE)/2};
        if(dx>=-erH.l-8&&dx<=erH.r+8&&dy>=-erH.t-8&&dy<=erH.b+8){
          var dE=Math.max(Math.max(-dx+erH.l,dx-erH.r),Math.max(-dy+erH.t,dy-erH.b));
          if(dE<bd){bd=dE;best=B;}
        }
        continue;
      }
      if(B.kind==='B'){
        // B-circle hover covers the whole disc (the resize handle lives on the rim, so the
        // pointer must register the body while ON the boundary too).
        var rBH=B.fieldR||B_FIELD_RANGE;
        var dBH=Math.hypot(dx,dy);
        if(dBH<=rBH+8){
          if(dBH<bd){bd=dBH;best=B;}
        }
        continue;
      }
      if(B.kind==='W'){
        // 空心图形只在「线」上响应，内部空白既不高亮也不可抓。
        if(!nearInk(B,pointer.x,pointer.y))continue;
        var dW=Math.sqrt(dx*dx+dy*dy);
        if(dW<bd){bd=dW;best=B;}
        continue;
      }
      if(B.kind==='S'){
        // 弹簧只有线圈本身响应悬浮，不能用下面那个 max(34,hw)+18 的大圆：弹簧很长，那个圆会把 100px 外的空白也算进去。
        if(segPointDist(B.e0.x,B.e0.y,B.e1.x,B.e1.y,pointer.x,pointer.y)>SPR_GRAB)continue;
        var dS=Math.sqrt(dx*dx+dy*dy);
        if(dS<bd){bd=dS;best=B;}
        continue;
      }
      var rr=Math.max(34,(B.hw||30))+18;
      var d=Math.sqrt(dx*dx+dy*dy);
      if(d<rr&&d<bd){bd=d;best=B;}
    }
    hoverB=best;
    // 见 refreshHover 开头 onRotHandle / onRodHandle 的说明（DOM 手柄悬空 → 用上一帧宿主顶住）
    if(!hoverB&&onRodHandle&&rodHov&&!rodHov.dead&&bodies.indexOf(rodHov)>=0)hoverB=rodHov;
    if(!hoverB&&onRotHandle)hoverB=handleBody;
  }
  // ------ field-area resize handle (or resizing): pointer on the E-square / B-circle border ------
  var rszT=null;
  if(grab.kind==='resizeE'||grab.kind==='resizeB'){
    rszT={kind:grab.obj.kind,B:grab.obj,edge:grab.rszEdge||'x',side:grab.rszSide};
  }else if(!grab.kind&&hoverB){
    if(hoverB.kind==='E'){
      // resize handle appears on ANY edge point (the pointer-side one); the rotate handle
      // also stays visible — the resize bar is pushed aside near the rotate knob in the
      // positioning block below, so the two never overlap.
      var er2=hoverB.er||{l:(hoverB.fieldR||E_FIELD_RANGE)/2,r:(hoverB.fieldR||E_FIELD_RANGE)/2,t:(hoverB.fieldR||E_FIELD_RANGE)/2,b:(hoverB.fieldR||E_FIELD_RANGE)/2};
      var pxE=pointer.x-hoverB.x,pyE=pointer.y-hoverB.y;
      if(Math.abs(Math.abs(pxE)-er2.r)<=8&&Math.abs(pxE)>=er2.r-8&&pyE>=-er2.t-8&&pyE<=er2.b+8)rszT={kind:'E',B:hoverB,edge:'x',side:(pxE>0)?'r':'l'};
      else if(Math.abs(Math.abs(pyE)-er2.b)<=8&&Math.abs(pyE)>=er2.b-8&&pxE>=-er2.l-8&&pxE<=er2.r+8)rszT={kind:'E',B:hoverB,edge:'y',side:(pyE>0)?'b':'t'};
    }else if(hoverB.kind==='B'){
      var rB=hoverB.fieldR||B_FIELD_RANGE;
      var dB=Math.hypot(pointer.x-hoverB.x,pointer.y-hoverB.y);
      if(dB>=rB-8&&dB<=rB+8)rszT={kind:'B',B:hoverB,edge:'rad'};
    }
  }
  if(rszT){
    rszHandle.classList.add('on');
    var rszTh=rszT.B.th||0;
    // rotate knob sits on the E box edge along the knob direction (sin th, -cos th),
    // measured with the SAME per-edge helper as the render — never the l/r average,
    // which made the knob drift while an edge was being dragged.
    var rEr=rszT.B.er||{l:(rszT.B.fieldR||320)/2,r:(rszT.B.fieldR||320)/2,t:(rszT.B.fieldR||320)/2,b:(rszT.B.fieldR||320)/2};
    var kux=Math.sin(rszTh),kuy=-Math.cos(rszTh);
    var rExt=boxExtentAlong(kux,kuy,rEr);
    var rotHx=rszT.B.x+kux*rExt,rotHy=rszT.B.y+kuy*rExt;
    var bx=pointer.x,by=pointer.y;
    if(rszT.kind==='E'){
      // anchor the bar on the DRAGGED EDGE (side-aware for asymmetric boxes); it slides
      // ALONG that edge to keep clear of the rotate knob — never leaves the edge band.
      var ex0,ey0,ex1,ey1,alongX;   // edge endpoints
      if(rszT.side==='l'||rszT.side==='r'){
        var ex=rszT.B.x+(rszT.side==='r'?rEr.r:-rEr.l);
        ex0=ex;ey0=rszT.B.y-rEr.t;ex1=ex;ey1=rszT.B.y+rEr.b;alongX=false;
      }else{
        var ey=rszT.B.y+(rszT.side==='b'?rEr.b:-rEr.t);
        ex0=rszT.B.x-rEr.l;ey0=ey;ex1=rszT.B.x+rEr.r;ey1=ey;alongX=true;
      }
      // pointer's natural anchor on the edge
      var pxT=clamp(pointer.x,Math.min(ex0,ex1),Math.max(ex0,ex1));
      var pyT=clamp(pointer.y,Math.min(ey0,ey1),Math.max(ey0,ey1));
      // slide along the edge away from the rotate knob (min gap 40px). On a horizontal
      // edge (t/b) we can only slide x; on a vertical edge (l/r) we slide y — clamping to
      // the edge line would otherwise undo the shift.
      var gap=40;
      if(alongX){
        if(Math.abs(pxT-rotHx)<gap)pxT=(pxT<rotHx)?rotHx-gap:rotHx+gap;
        pxT=clamp(pxT,Math.min(ex0,ex1),Math.max(ex0,ex1));
      }else{
        if(Math.abs(pyT-rotHy)<gap)pyT=(pyT<rotHy)?rotHy-gap:rotHy+gap;
        pyT=clamp(pyT,Math.min(ey0,ey1),Math.max(ey0,ey1));
      }
      bx=pxT;by=pyT;
    }
    rszHandle.style.left=(bx-9)+'px';
    rszHandle.style.top=(by-9)+'px';
    cv.classList.add(rszT.kind==='E'?(rszT.edge==='y'?'cur-ns':'cur-ew'):'cur-ew');
    // while the resize handle is up, the ROTATE handle stays visible beside it (the resize
    // bar slides along the edge to keep clear, so they coexist without overlapping)
    handle.classList.remove('hideRot');
  }else{
    rszHandle.classList.remove('on');
    cv.classList.remove('cur-ew','cur-ns');
    handle.classList.remove('hideRot');
  }
  // the rotate knob stays up while resizing a field too (grab.obj fallback), so the whole
  // edge affordance does not blink off the moment the pointer drifts past the +8 tolerance
  var hov2=hoverB||((grab.kind==='resizeE'||grab.kind==='resizeB')?grab.obj:null);
  if(grab.kind==='rot'&&grab.obj)hov2=grab.obj;   // 拖旋转手柄期间手柄必须一直亮着（此时 hoverB 为空）
  // 手柄驻留期：弹簧/固定体的旋转手柄悬在线外 ~56px，而悬浮命中带只有 SPR_GRAB=16px，指针从线圈挪到手柄
  // 要跨过一段「真空区」，hover 一丢手柄就没了。显示过就再留 HANDLE_LINGER 毫秒，期间指针到了手柄上
  // （onRotHandle -> hoverB=handleBody）会刷新计时；驻留期内宿主被删/解散则立即消失。
  var nowMs=performance.now();
  /* 含字母 a 的表达式体（ma / Ma / ma²…）不显示旋转手柄，角度由 a 的参数面板调。判据要覆盖所有组成方式：
   * glyphs（组合出的 ma 没有 accGive，glyphs 如 ["m","(","a","+","m",")"]）、mem、massG（m 并入 a 时 a 是宿主、
   * 不在 mem 里），以及 a 的加速度语义（accGive / accX / accY）。 */
  var _hasA=!!(hov2&&((hov2.glyphs&&hov2.glyphs.some(function(x){return x&&(x.ch==='a'||x.type==='a');}))
              ||(hov2.mem&&hov2.mem.some(function(x){return x&&(x.ch==='a'||x.type==='a');}))
              ||(hov2.massG&&(hov2.massG.ch==='a'||hov2.massG.type==='a'))
              ||hov2.accGive!=null||hov2.accX!=null||hov2.accY!=null));
  if(hov2&&!_hasA&&(hov2.hasA||hov2.kind==='T'||hov2.kind==='E'||springCanRotate(hov2)
            ||(hov2.kind==='W'&&hov2.fixed))){
    // 驻留只给手柄悬在命中带之外的类型（弹簧贴线带 16px、固定 W 的贴线带）；
    // E/B/T 的手柄本来就在命中区内部，随显随收（离开场方块立即消失）。
    if(springCanRotate(hov2)||(hov2.kind==='W'&&hov2.fixed)){
      handleKeep=hov2;handleLinger=nowMs+HANDLE_LINGER;
    }
  }else if(handleKeep&&nowMs<handleLinger&&!handleKeep.dead&&bodies.indexOf(handleKeep)>=0){
    hov2=handleKeep;
  }else handleKeep=null;
  if(hov2&&(hov2.hasA||hov2.kind==='T'||hov2.kind==='E'||springCanRotate(hov2)
            ||(hov2.kind==='W'&&hov2.fixed))){
    var s2=hov2.massG?slot(hov2,hov2.massG):{x:hov2.x,y:hov2.y};
    var th=hov2.th||0;
    // E field: the rotate handle rides on the FIELD BOX edge in the knob direction
    var hh=Math.max(30,(hov2.hh||24))+26;
    if(hov2.kind==='E'){
      var erK=hov2.er||{l:(hov2.fieldR||E_FIELD_RANGE)/2,r:(hov2.fieldR||E_FIELD_RANGE)/2,t:(hov2.fieldR||E_FIELD_RANGE)/2,b:(hov2.fieldR||E_FIELD_RANGE)/2};
      hh=boxExtentAlong(Math.sin(th),-Math.cos(th),erK);
    }
    handle.style.left=(s2.x+Math.sin(th)*hh-15)+'px';
    handle.style.top=(s2.y-Math.cos(th)*hh-15)+'px';
    handle.classList.add('on');
    handleBody=hov2;   // 手柄的宿主：下一帧 onRotHandle 命中时用它顶住 hover（见 refreshHover 开头）
  }else{handle.classList.remove('on');handleBody=null;}
  // ------ 圆弧端点手柄（悬浮弧上出现；拖动中跟随）；固定体的旋转手柄已在上面放行 ------
  arcHov=null;
  var showArc=null;
  if(grab.kind==='arcedit'){showArc=grab.obj;arcHov=grab.obj;}
  else if(!grab.kind&&app.hoverW&&app.hoverW.wshape==='arc'&&app.hoverW.ell&&!app.hoverW.dead){showArc=app.hoverW;arcHov=app.hoverW;}
  if(showArc&&!showArc.dead&&showArc.ell){
    for(var ai=0;ai<2;ai++){
      var ep=arcEndWorld(showArc,ai);
      ark[ai].style.left=(ep.x-9)+'px';
      ark[ai].style.top=(ep.y-9)+'px';
      ark[ai].classList.add('on');
    }
  }else{
    ark[0].classList.remove('on');ark[1].classList.remove('on');
  }
  // ------ 轻质杆两端的长度手柄（悬浮杆上出现；拖动中跟随） ------
  // 与圆弧端点手柄同构：DOM 小圆点钉在端点世界坐标上，按住哪一端就拖哪一端（另一端钉死）。
  var showRod=null;
  if(grab.kind==='rodlen')showRod=grab.obj;                       // 拖动中必须一直亮（hoverB 此刻为空）
  // 传送带也用这套两端长度手柄：手柄元素、命中判定、按下/移动/松手全是同一套，
  // 只有取端点和写回端点按宿主分派（rodEndWorld / beltEndWorld 与 setBeltEnds）。
  else if(!grab.kind&&hoverB&&!hoverB.dead
          &&(hoverB.kind==='T'||(hoverB.kind==='W'&&(hoverB.belt||hoverB.gnd))))showRod=hoverB;
  if(showRod&&!showRod.dead&&bodies.indexOf(showRod)>=0){
    var ew=showRod.belt?beltEndWorld:rodEndWorld;
    for(var ri1=0;ri1<2;ri1++){
      var rp=ew(showRod,ri1);
      rodh[ri1].style.left=(rp.x-9)+'px';
      rodh[ri1].style.top=(rp.y-9)+'px';
      /* 已锚定端不显示长度手柄：长度由约束决定，且拖它会干扰双击解除。 */
      var _endAnc=showRod.anc&&showRod.anc[ri1];
      if(_endAnc)rodh[ri1].classList.remove('on');
      else rodh[ri1].classList.add('on');
    }
    rodHov=showRod;                                               // 手柄 pointerdown 读它取宿主
  }else{
    rodh[0].classList.remove('on');rodh[1].classList.remove('on');
    rodHov=null;
  }
}
// full-screen reach: pull tapers linearly to 0 at the screen's diagonal so the influence
// feels whole-screen but is exactly 0 at the rim and stronger the closer it is to the hole
export let BH_REACH=2000;
/* 磁场方向画法：bz<0 画 ⊗（场穿入纸面），bz>0 画 ⊙（场穿出纸面），与 Bz>0 为 +z 出屏一致。 */
export function drawFieldDots(cx,cy,R,bz){
  var into=(bz!=null&&bz<0);                 /* 场背向观察者 ⇒ 叉 */
  var col='rgba(38,34,28,0.16)',colS='rgba(38,34,28,0.28)';
  cvx.fillStyle=col;cvx.strokeStyle=colS;cvx.lineWidth=1.3;
  var sp=26;
  for(var gx=-R;gx<=R;gx+=sp){
    for(var gy=-R;gy<=R;gy+=sp){
      if(gx*gx+gy*gy<=R*R){
        var px=cx+gx,py=cy+gy;
        if(!into){
          cvx.beginPath();
          cvx.arc(px,py,1.7,0,6.2832);
          cvx.fill();
        }else{
          /* 叉只画两笔交叉，不加外圈圆（标准 ⊗ 画法）。 */
          var k=4.6;
          cvx.lineWidth=1.6;
          cvx.beginPath();
          cvx.moveTo(px-k,py-k);cvx.lineTo(px+k,py+k);
          cvx.moveTo(px+k,py-k);cvx.lineTo(px-k,py+k);
          cvx.stroke();
          cvx.lineWidth=1.3;
        }
      }
    }
  }
  cvx.strokeStyle='rgba(38,34,28,0.10)';
  cvx.lineWidth=1;
  cvx.beginPath();
  cvx.arc(cx,cy,R,0,6.2832);
  cvx.stroke();
}
export function drawFieldE(cx,cy,R,th,B){
  // E field: a (possibly asymmetric) RANGE crossed by parallel arrows whose arrowheads
  // TOUCH the dashed border on BOTH ends. The 4 edges live in B.er {l,r,t,b} (half-extents
  // from the centre), so dragging ONE edge only stretches that side. The arrow slab is
  // clipped to the ACTUAL asymmetric rect — never to a symmetric superset — otherwise the
  // arrows would run past the shorter edges (that was the "线条和边界错位" bug).
  /* eacc（电场强度）的符号在物理里已生效（a=E_FIELD_ACC*eacc*qsign），绘制也要跟着：eacc<0 时箭头方向翻转 180°。 */
  if(B&&B.eacc!=null&&B.eacc<0)th=th+Math.PI;
  var er=B&&B.er?B.er:{l:R/2,r:R/2,t:R/2,b:R/2};
  var hsL=er.l,hsR=er.r,hsT=er.t,hsB=er.b;   // half-extents per side
  var dx=Math.cos(th),dy=Math.sin(th);        // field direction
  var px=-dy,py=dx;                           // perpendicular (spacing direction)
  var ah=Math.atan2(dy,dx);
  // asymmetric rect used as the clip window
  var x0=cx-hsL,x1=cx+hsR,y0=cy-hsT,y1=cy+hsB;
  // spread the arrows over the box's TRUE perpendicular extent (asymmetric-aware)
  var ePos=boxExtentAlong(px,py,er),eNeg=boxExtentAlong(-px,-py,er);
  var span=Math.max(40,ePos+eNeg),mid=(ePos-eNeg)/2;
  var n=Math.max(4,Math.round(span/46));
  var margin=3,al=11;
  cvx.strokeStyle='rgba(38,34,28,0.18)';
  cvx.fillStyle='rgba(38,34,28,0.18)';
  cvx.lineWidth=1.4;cvx.lineCap='round';
  for(var i=0;i<n;i++){
    var off=mid+((n===1)?0:(i-(n-1)/2)*(span/n));
    var ox=cx+px*off,oy=cy+py*off;
    // clip the infinite line through (ox,oy) along (dx,dy) to the asymmetric rect (slab test)
    var t0=-1e9,t1=1e9,okk=true;
    if(Math.abs(dx)>1e-6){
      var a1=(x0-ox)/dx,a2=(x1-ox)/dx;
      t0=Math.max(t0,Math.min(a1,a2));t1=Math.min(t1,Math.max(a1,a2));
    }else if(ox<x0||ox>x1)okk=false;
    if(okk){
      if(Math.abs(dy)>1e-6){
        var b1=(y0-oy)/dy,b2=(y1-oy)/dy;
        t0=Math.max(t0,Math.min(b1,b2));t1=Math.min(t1,Math.max(b1,b2));
      }else if(oy<y0||oy>y1)okk=false;
    }
    if(!okk||t1-t0<26)continue;
    var ax=ox+dx*(t0+margin),ay=oy+dy*(t0+margin);
    var bx=ox+dx*(t1-margin),by=oy+dy*(t1-margin);
    cvx.beginPath();cvx.moveTo(ax,ay);cvx.lineTo(bx,by);cvx.stroke();
    cvx.beginPath();
    cvx.moveTo(bx,by);
    cvx.lineTo(bx-al*Math.cos(ah-0.42),by-al*Math.sin(ah-0.42));
    cvx.lineTo(bx-al*Math.cos(ah+0.42),by-al*Math.sin(ah+0.42));
    cvx.closePath();cvx.fill();
  }
  // asymmetric dashed border: 4 edges each at its own half-extent
  cvx.strokeStyle='rgba(38,34,28,0.12)';
  cvx.lineWidth=1.2;
  cvx.setLineDash([7,6]);
  cvx.beginPath();
  cvx.moveTo(cx-hsL,cy-hsT);cvx.lineTo(cx+hsR,cy-hsT);
  cvx.lineTo(cx+hsR,cy+hsB);cvx.lineTo(cx-hsL,cy+hsB);
  cvx.closePath();cvx.stroke();
  cvx.setLineDash([]);
}
export function resize(){
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
export function arrow(B,gx,gy,Cx,Cy,ddn){
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
export function orbGeom(B){
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
export function tickOrbs(dt){
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
/* 带电荷的物体在质心画 +/− 符号（正负取决于 B.charge）。 */
export function drawChargeMark(){
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
export function drawPendingHint(){
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
export function render(){
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
      if(app.TIME_SCALE<=0&&scb<0.6)scb=1;
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
export function syncGlyphs(){
  var i,j,k;
  for(i=0;i<bodies.length;i++){
    var B=bodies[i];
    var bar=B.st.bar;
    if(bar&&!bar.dead)bar.el.style.display='none';
      var extra=(B.pop&&B.pop>0)?popScale(B.pop):1;
      var sc2=extra*(B.sc||1)*(B.infl||1);
      /* 时间静止时缩放可能被算成极小值（合成链上的缩放累积依赖 dt），保底到 1。 */
      if(app.TIME_SCALE<=0&&sc2<0.6)sc2=1;
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
export function cursorTick(){
  if(grab.kind==='body'){cv.style.cursor='grabbing';return;}
  if(grab.kind==='letter'){cv.style.cursor=findMergeTarget(grab.obj)?'copy':'grabbing';return;}
  if(grab.kind==='rot'){cv.style.cursor='grabbing';return;}
  cv.style.cursor='default';
}

export function setupRenderRender(){
  dpr=window.devicePixelRatio||1;
  cvx=cv.getContext('2d');
}
