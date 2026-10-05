/* 字母合并 / 拆分 / 赋予（a、v、q 等）以及 t、kx 组合 */
import Matter from 'matter-js';
import { BODY, killBody, killLetter } from '../bodies/body.js';
import { makeRod, tAnchor } from '../bodies/rod.js';
import { bossTryPlace } from '../boss/boss.js';
import { clamp } from '../core/math.js';
import { bodies, freeL } from '../core/world.js';
import { distToHost } from '../devices/anchor.js';
import { makeSpring } from '../devices/spring.js';
import { killFieldBody } from '../effects/blackhole.js';
import { burstParticles } from '../effects/particles.js';
import { pointer } from '../input/pointer.js';
import { F, GD, HALF, MU, isMass } from './glyph.js';
import { initWorld, place, refresh, slot } from './layout.js';
import { dockLetter, freeLetter } from './panel.js';
import { specIdForLetter } from '../params/defs.js';
import { MW } from '../physics/matter.js';
import { groundY } from '../render/render.js';
import { ringGo } from '../ui/menu.js';
import { vLightReject } from '../ui/toolbar.js';

// promote a FREE (unmerged) letter in place to a single-letter body at its current position,
// so right-clicking any free adjustable letter (r/g/a/v/μ…) can open the param panel.
// Note: for SHATTER-derived stray letters this may feel invasive; we keep it minimal and
// only lift letters that carry an adjustable param (specIdForLetter != null).
export function promoteFreeLetter(d){
  if(!d||d.dead)return null;
  if(d.body)return d.body;
  if(!specIdForLetter(d))return null;
  /* 赋予型字符（v/a/q/t）promote 后只当参数宿主、不进 B.mem，保持自由、可反复赋予：
   * 并入 mem 后它不再是自由字符，松手时「实心命中 ⇒ 赋予」分支就不再命中。 */
  var _sid=specIdForLetter(d);
  var _giveType=(_sid==='vsize'||_sid==='asize'||_sid==='qcharge'||_sid==='tscale');
  var x=d.wx!==undefined?d.wx:d.el.offsetLeft;
  var y=d.wy!==undefined?d.wy:d.el.offsetTop;
  var B=BODY(x,y);
  d.pop=0;d.body=B;d.inBody=true;
  /* 按目标类型分流：
   *  · 目标是由字符组成的体（massG / glyphs / mem 里有字母，即表达式）⇒ 正常并入（ma、mc 这类组合）；
   *  · 目标是纯形状物体（方框/圆等，无字形）⇒ 走「赋予」（不进 mem）。 */
  var _targetIsFormula=!!(B&&(B.massG||(B.glyphs&&B.glyphs.length)||(B.mem&&B.mem.length)));
  if(_giveType&&!_targetIsFormula){
    /* 赋予型字符：不并入 mem（否则后续无法再赋予），也不占 glyphs；state 必须是 'free'（可继续拖动/再次右键）。
     * BODY(x,y) 已把临时宿主注册进 bodies，必须立即从场上摘除（含 Matter 体）：否则场上多一个看不见的体，
     * 参与碰撞、挡住点击、把字符带飞（a 拖不动/落地消失）。 */
    /* inBody 必须置 false：placeLetter()/syncGlyphs() 对 inBody && body 的字母按宿主槽位 slot(B,g) 摆位，
     * 而 _paramOnly 宿主已摘除、永不移动 ⇒ DOM 元素会被钉死在 promote 时的位置、与 wx/wy 脱钩，
     * 表现为字符抓不动，且钉住的元素还会吃掉画布的 pointerdown。
     * 面板（dock）里的字符被右键时保持 'dock'，不能变成 'free'：否则面板槽位变空（sortPanel/dockedTwins 都按 'dock' 认）。 */
    var _wasDock=(d.state==='dock');
    d.state=_wasDock?'dock':'free';
    d.inBody=false;
    try{
      var _bi=bodies.indexOf(B);
      if(_bi>=0){
        if(B.mb&&MW&&MW.engine&&Matter&&Matter.Composite&&Matter.Composite.remove)
          Matter.Composite.remove(MW.engine.world,B.mb);
        bodies.splice(_bi,1);
      }
      B._paramOnly=true;
      B.dead=false;
    }catch(_e){}
    return B;
  }
  B.mem.push(d);
  if(isMass(d)){
    B.massG=d;B.glyphs=[d];
  }else{
    B.glyphs=[d];
    // set the letter's local offset straight from its current world position (no refresh):
    // layoutBody would crash on an isolated non-formula letter (a/v/r/μ…), so we place it
    // manually and let the param panel work off the body reference alone.
    var dx=x-B.x,dy=y-B.y;
    d.sx=dx;d.sy=dy;d.w=d.el.offsetWidth||F*0.7;d.h=d.el.offsetHeight||F;
    if(d.type==='r')B.hasR=true;else if(d.type==='v')B.hasV=true;
    else if(d.type==='g')B.hasG=true;else if(d.type==='a')B.hasA=true;
    else if(d.type===MU)B.hasMu=true;
    // box = the letter's own INK, not the whole F-tall em box (that one made a lone letter
    // hover ~13px above the ground). Symmetric about B.x/B.y, so the glyph never has to move.
    var mm=d.m||{w:d.w,top:-F/2,bot:F/2};
    B.hw=Math.max(6,Math.max(6,(mm.w||d.w)/2)+BOX_PAD);
    B.hh=Math.max(6,Math.max(Math.abs(mm.top),Math.abs(mm.bot==null?F/2:mm.bot))+BOX_PAD);
    initWorld(B);
    place(d,x,y,0,1,true);
  }
  var fi=freeL.indexOf(d);if(fi>=0)freeL.splice(fi,1);
  B.vx=0;B.vy=0;
  return B;
}
// 孤立的 g（唯一字形是 g、不是质量体、没有 kind）= 重力参数的可视化控件，浮空不落。
export function isGravityLetterOnly(B){
  return !!(B&&!B.kind&&!B.massG&&B.glyphs&&B.glyphs.length===1
           &&B.glyphs[0]&&B.glyphs[0].type==='g');
}
export function findTComboTarget(L){
  // t combines with: a field 'q' -> becomes I (current); a body with 'g' -> gt -> v; a
  // body with 'v' (and no g) -> vt -> plank/rod. Also a FREE lowercase v near the t -> vt -> rod,
  // so "v单独落下再放t" also works (no body needed). Only simple targets, never formulas.
  // IMPORTANT: combos ONLY trigger for the letter 't' — other letters must never be hijacked
  // (e.g. dropping a 2nd 'v' onto mv must make mv², not turn the body into a rod).
  if(!L||L.dead)return null;
  // 组合不分先后：L 是 v/g 且旁边有自由的 t 时同样触发组合，端点取两者中点
  // （否则 v 拖到孤立的 t 上只会叠在一起往下掉）。
  if(L.type!=='t'){
    if(L.type!=='v'&&L.type!=='g')return null;
    var ft=null,ftg=1e9;
    for(var fti=0;fti<freeL.length;fti++){
      var FT=freeL[fti];
      if(FT.type!=='t'||FT===L||FT.dead)continue;
      // 同时用指针落点判：自由字母坠落位移、面板拖出的落点偏移都会拉开字母间距，
      // 而用户是瞄着看得见的字母松手的；取两者中更近的。两者都用盒距（固定 150px 半径会吸来很远的字母）。
      var gap=Math.min(twoLetterGap(L,FT),
                       ptToGlyphGap(pointer.x,pointer.y,FT.wx,FT.wy,lw(FT),lh(FT)));
      if(gap<ftg){ftg=gap;ft=FT;}
    }
    if(!ft||ftg>MERGE_PAD)return null;
    if(L.type==='v')return {fv:L,other:ft,kind:'vt',rev:true};
    // g 拖到 free 的 t 上：gt -> v（和正向的 gt 一致），字母落点取两者中点
    return {B:null,freeG:L,other:ft,kind:'gtFree',rev:true};
  }
  var best=null,bg=1e9;
  // free v letter nearby -> make a rod on the spot
  for(var fvi=0;fvi<freeL.length;fvi++){
    var FV=freeL[fvi];
    if(FV.type!=='v'||FV===L||FV.dead)continue;
    var gap=Math.min(twoLetterGap(L,FV),
                     ptToGlyphGap(pointer.x,pointer.y,FV.wx,FV.wy,lw(FV),lh(FV)));
    if(gap<bg){bg=gap;best={fv:FV,kind:'vt'};}
  }
  if(!best){
    for(var i=0;i<bodies.length;i++){
      var B=bodies[i];
      if(B.massG===L||B.mem.indexOf(L)>=0)continue;
      var a=tAnchor(B);
      // 宿主这一路也用盒距（tAnchor 只是锚点）
      var gp=ptToGlyphGap(L.wx,L.wy,a.x,a.y,(B.hw||26)*2,(B.hh||26)*2);
      if(gp>bg)continue;
      var ok=false,kind='';
      if(B.kind==='q'){ok=true;kind='qt';}
      else if(B.kind&&B.kind!=='T'){continue;}
      else if(B.hasG&&B.mem.length<=2&&!B.hasGrav){ok=true;kind='gt';}
      else if((B.kind==='T')||(B.hasV&&!B.hasG&&!B.hasR&&!B.hasGrav&&B.mem.length<=1)){ok=true;kind='vt';}
      if(ok&&gp<bg){bg=gp;best={B:B,kind:kind};}
    }
  }
  return bg<=MERGE_PAD?best:null;
}
export function applyTCombo(L,c){
  var B=c.B;
  if(c.kind==='vt'&&c.fv){
    // free v + t -> rod right here (no pre-existing body)
    // 反向（v 拖到自由 t 上）取两者中点，正向仍以 t 的位置为锚
    var rx=c.rev?((c.fv.wx+L.wx)/2):L.wx;
    var ry=c.rev?((c.fv.wy+L.wy)/2):L.wy;
    var rod=makeRod(rx,ry,0,0);
    // 反向时 c.fv 就是被拖的 L，另一个字母在 c.other 里，两个都要收掉，
    // 否则画布上会留下一个孤零零的 t。
    killLetter(c.fv===L&&c.other?c.other:c.fv);
    killLetter(L);
    ringGo(rod.x,rod.y);
    return;
  }
  if(c.kind==='gtFree'){
    // g 拖到自由的 t 上 = gt → v（与正向 gt 同结果，只是没有宿主体）
    var vx2=(L.wx+c.other.wx)/2,vy2=(L.wy+c.other.wy)/2;
    killLetter(c.other);killLetter(L);
    var vf=GD('v');
    freeLetter(vf,vx2,vy2,0,0,true);
    ringGo(vx2,vy2);
    return;
  }
  if(c.kind==='qt'){
    // current: t dropped onto a field q -> q becomes I (current symbol). "qt组合变成I"
    if(B.fg){B.fg.body=null;B.fg.inBody=false;killLetter(B.fg);B.fg=null;}
    B.kind='I';B.Isign=1;
    var ng=GD('I');ng.pop=0;ng.body=B;ng.inBody=true;B.fg=ng;
    killLetter(L);
    refresh(B);ringGo(B.x,B.y);
  }else if(c.kind==='gt'){
    // gt -> v : remove the g and the t, add a v (g·t = v)
    for(var qi=B.mem.length-1;qi>=0;qi--){
      if(B.mem[qi].type==='g'){var gi2=B.mem[qi];B.mem.splice(qi,1);killLetter(gi2);}
    }
    killLetter(L);
    var vg=GD('v');vg.pop=0;vg.body=B;vg.inBody=true;B.mem.push(vg);
    refresh(B);ringGo(B.x,B.y);
  }else if(c.kind==='vt'){
    // vt -> plank: the mass-v body becomes a solid rod (like the ground but movable/rotatable)
    for(var jj=B.glyphs.length-1;jj>=0;jj--){
      var og=B.glyphs[jj];
      if(og.body===B){og.body=null;og.inBody=false;killLetter(og);}
    }
    for(var mmi=B.mem.length-1;mmi>=0;mmi--){var mo2=B.mem[mmi];B.mem.splice(mmi,1);killLetter(mo2);}
    killLetter(L);
    B.massG=null;
    B.hasG=true;B.hasV=false;B.kind='T';B.fg=null;
    B.len=170;B.php=F*0.55;
    refresh(B);ringGo(B.x,B.y);
  }
}
/* 「把字母给谁」的凸包命中判定只对跨度不超过此值（px）的图形生效。
 420 ≈ 画布短边量级：合上的圆/方/三角都在内；横贯屏幕的长线条不适用（见 bodyFillHit）。 */
export const BODY_FILL_MAX=420;
// k 与 x 拼起来 = 弹簧。和 t 的组合同理，不分先后（见 findTComboTarget 里的说明）。
export function findKXCombo(L){
  if(!L||L.dead)return null;
  var t=L.type;
  if(t!=='k'&&t!=='x')return null;
  var other=(t==='k')?'x':'k';
  var best=null,bg=1e9;
  for(var i=0;i<freeL.length;i++){
    var F=freeL[i];
    if(F.type!==other||F===L||F.dead)continue;
    // 同 findTComboTarget：字母到字母、指针到字母，取更近的（指针落点更能表达「我就想拼这两个」）。
    // 两个都是盒距，不用固定半径（见 MERGE_PAD 处的说明）。
    var gap=Math.min(twoLetterGap(L,F),
                     ptToGlyphGap(pointer.x,pointer.y,F.wx,F.wy,lw(F),lh(F)));
    if(gap<bg){bg=gap;best={free:F};}
  }
  return bg<=MERGE_PAD?best:null;
}
export function applyKXCombo(L,c){
  if(!c||!c.free)return;
  var F=c.free;
  /* kx 合成的弹簧初始方向恒水平（不取两字母连线，否则斜着/上下拖出 k 和 x 会合成斜弹簧/竖弹簧）。
   * 中点取两字母中点（弹簧出现在松手处），长度仍按两字母间距（makeSpring 的 110~340 钳制）。
   * 高中模式的方向吸附因此天然一致，dirLock 记的就是水平轴。 */
  var cx=(L.wx+F.wx)/2, cy=(L.wy+F.wy)/2;
  var d=Math.hypot(F.wx-L.wx,F.wy-L.wy);
  var half=clamp(d,110,340)/2;
  killLetter(F);killLetter(L);
  var S=makeSpring(cx-half,cy,cx+half,cy);
  ringGo(S.x,S.y);
}
export const BOX_PAD=2;   // px of slack kept between the visible ink and the collision box
/* 字符 v / q 拖到物体上 ⇒ 赋予该物体属性（不并入 mem）：
 *   v = 赋初速度（大小 B.vGive、方向 B.vAng，默认水平向右）；q = 赋电荷量（B.charge）。
 *   时间静止（TIME_SCALE=0）时赋的速度不立刻生效，时间恢复后才动。
 *   赋予后字符播放「注入」消失动画（dockLetter 回面板 + burst 粒子）。 */
/* 可被赋予电荷的 W 体白名单：只看预设物体工具的 wshape，不做任何几何推断。
 *   rect（矩形器件）/ circle（圆形器件）/ tri（直角三角形器件）可赋电荷；
 *   其余一律不可：画笔随手画的方框（wshape 为空/poly，哪怕看着像矩形）、圆轨 ring、半凹槽 trough、滑梯 tub、圆弧 arc。
 *   原因：手绘笔画没有稳定的质心/惯量语义、形状可任意折返，在电磁场里受力后表现不可预期。
 *   不在白名单时 q 走兜底 spawnField('q') 生成场源体，不并进物体。 */
export const Q_GIVE_SHAPES={rect:1,circle:1,tri:1};
export function qGiveable(B){
  if(!B)return false;
  if(B.kind!=='W')return true;                 /* 公式体等照旧 */
  return !!Q_GIVE_SHAPES[B.wshape||''];
}
export function giveFromLetter(B,d){
  var t=d.type||d.ch;
  if(t==='q'&&!qGiveable(B))return false;      /* 形状不在白名单 ⇒ 交回上层走场源体兜底 */
  if(t==='v'){
    var sp=(d.vGive!=null)?d.vGive:300;
    var an=(d.vAng!=null)?d.vAng:0;                 // 0° = 水平向右
    var rr=an*Math.PI/180;
    var vx=Math.cos(rr)*sp, vy=Math.sin(rr)*sp;
    /* v 的赋予是叠加而非覆盖（第二次赋 6 是再加 6），与 a 的矢量累加同口径：
     *  · 动态体：读回当前 Matter 速度，加上增量再写回，并把 B.vx/vy 同步成真实值；
     *  · 固定体（B.fixed / isStatic）：Matter 不推动它，速度由 B.vx/vy 驱动（stepPhysics 的 fixed 分支），累加 B.vx/vy。
     * 单位：B.vx/vy 是 px/s，Matter 速度是 px/帧，差一个 /60。 */
    var _stat=!!B.fixed||(B.mb&&B.mb.isStatic);
    if(B.mb&&!_stat){
      var _cv=Matter.Body.getVelocity(B.mb)||{x:0,y:0};
      var _nx=_cv.x+vx/60,_ny=_cv.y+vy/60;
      Matter.Body.setVelocity(B.mb,{x:_nx,y:_ny});
      B.vx=_nx*60;B.vy=_ny*60;
    }else{
      B.vx=(B.vx||0)+vx;B.vy=(B.vy||0)+vy;
    }
    if(B.mb)Matter.Sleeping.set(B.mb,false);
    burstParticles(B.x,B.y,10,0.6);
    return 'v';
  }
  if(t==='a'){
    /* 矢量累加（不覆盖）：多次赋 a 做矢量合成，面板显示合成后的大小和角度。 */
    var aa=(d.aGive!=null)?d.aGive:1300, an2=(d.aAng!=null)?d.aAng:0, rr2=an2*Math.PI/180;
    B.accGive=aa;B.accAng=an2;
    B.accX=(B.accX||0)+Math.cos(rr2)*aa;
    B.accY=(B.accY||0)+Math.sin(rr2)*aa;
    B.accSumN=(B.accSumN||0)+1;
    if(B.mb)Matter.Sleeping.set(B.mb,false);
    burstParticles(B.x,B.y,10,0.6);
    return 'a';
  }
  if(t==='q'){
    var qv=(d.qCharge!=null)?d.qCharge:1;
    B.charge=(B.charge||0)+qv;
    burstParticles(B.x,B.y,10,0.6);
    return 'q';
  }
  return null;
}
/* 引力场强公式 GM/r²：与引力井 GMm/r² 只差一个小写 m，语义不同：
 *  · GMm/r²（well）= 两物体之间的力 ⇒ 引力井；
 *  · GM/r²（field）= 场源 M 在该处的场强 ⇒ 即 g。
 * 拼全时整个表达式化成一个 g 字符（吸收 G/M/r/r），落在原处、保持原速度；再把 m 拖上去即得 mg。
 * 判据用逐字母清点而不是 gravModeOf：'well' 要求同时有 M 和 m，'plain' 把有 G 的其它形状全算进去，
 * 这里要的是二者之间的空档（有 G、M、r²，没有 m、c、其它字母）。
 * massG 可以就是 M（M → G → r → r 起手），M 也可以在 mem 里。 */
export function gravFieldShape(B){
  if(!B||B.dead||B.kind||!B.hasGrav)return false;
  if(B.bh||B.isSchwarzschild||B.isWell)return false;
  var Mtot=0,mtot=0,rc=0,cc2=0,other=0;
  var all=[];
  if(B.massG)all.push(B.massG);
  for(var m=0;m<B.mem.length;m++)if(all.indexOf(B.mem[m])<0)all.push(B.mem[m]);
  for(var i=0;i<all.length;i++){
    var t=all[i]&&all[i].type;
    if(t==='G')continue;          // 场源常数：必要但不计入"形状"
    else if(t==='M')Mtot++;
    else if(t==='m')mtot++;
    else if(t==='r')rc++;
    else if(t==='c')cc2++;
    else other++;
  }
  return mtot===0&&Mtot>=1&&rc>=2&&cc2===0&&other===0;
}
export function gravFieldToG(B){
  if(!gravFieldShape(B))return false;
  var x=B.x,y=B.y,vx=B.vx||0,vy=B.vy||0;
  var g=GD('g');
  if(!g)return false;
  g.pop=0;
  var msvx=vx,msvy=vy;
  killBody(B);                    // 吸收掉 G / M / r / r（killBody 只清 B.glyphs 里的，不碰新字形）
  freeLetter(g,x,y,msvx,msvy,false);
  /* 这里不加文字提示：变形本身（G/M/r/r 收成 g + 光环 + 粒子）已说明一切。 */
  ringGo(x,y);
  burstParticles(x,y,22,1.0);
  return true;
}
export function attach(B,d){
  /* BOSS 召唤：光速 v 落到 ½mv² 公式体上 ⇒ 转 bossTryPlace（前两次排斥、第三次融合）。
   * 必须抢在下面所有分支之前：½mv² 是由字符组成的表达式，会走到 mem 并入分支，一进去公式就毁了。
   * 判据用 bossIsEk() 精确判型，不是「有 v 就拦」。 */
  if(d&&d.ch==='v'&&d.vLight&&bossTryPlace(B,d))return;
  /* 光速 v 的其它落点一律拒绝：不并入 mem、不赋予速度，把 v 弹开并在落点显示 error。
   * 排在 bossTryPlace 之后，½mv² 的召唤通道先接。普通 v（vLight=false）不受影响。 */
  if(d&&d.ch==='v'&&d.vLight){if(vLightReject(B,d))return;}
  /* v / q 是赋予型字符：不并入物体，赋予完就回面板（播消失动画）。 */
  /* 目标是由字符组成的表达式 ⇒ 跳过赋予、直接走正常并入（组合）；只有纯形状物体才赋予。
   * 若无条件先执行 giveFromLetter，组合分支永远走不到（如 a 落到 m 上）。 */
  var _isFormulaTarget=!!(B&&(B.massG||(B.glyphs&&B.glyphs.length)||(B.mem&&B.mem.length)));
  if(!_isFormulaTarget){
    var _gave=giveFromLetter(B,d);
    if(_gave){
      d.pop=0;
      var mi2=freeL.indexOf(d);if(mi2>=0)freeL.splice(mi2,1);
      dockLetter(d);
      return;
    }
    /* q 落在不在白名单的形状上必须在这里中止：giveFromLetter 返回 false 后若继续往下走，
     * 会执行 B.mem.push(d) 把 q 并进物体。交回上层走场源体兜底。 */
    if((d.type||d.ch)==='q'&&!qGiveable(B))return;
  }
  if(B.mem.indexOf(d)>=0)return;
  var mi=freeL.indexOf(d);if(mi>=0)freeL.splice(mi,1);
  var pv=null;
  if(B.massG&&B.massG.sx!=null)pv={sx:B.massG.sx,sy:B.massG.sy};
  d.state='mem';
  B.mem.push(d);
  d.body=B;d.inBody=true;
  B.pop=1;
  refresh(B);
  var hh=Math.max(20,B.hh||18);
  if(B.y+hh>groundY){B.y=groundY-hh;B.vy=-Math.abs(B.vy)*0.5;}
  if(pv)keepMass(B,pv);
  ringGo(B.x,B.y);
  /* 拼接完成的最后一步：若这次并入刚好补成 GM/r²，整个表达式化成一个 g 字符。
   * 必须在 keepMass / ringGo 之后：它们要读 B.massG / B.x/y，而 gravFieldToG 会删除 B。 */
  if(gravFieldShape(B)){gravFieldToG(B);return;}
}
export function keepMass(B,pv){
  var m=B.massG;if(!m)return;
  var th=B.th||0,c=Math.cos(th),s=Math.sin(th);
  var dx=pv.sx-m.sx,dy=pv.sy-m.sy;
  B.x+=dx*c-dy*s;
  B.y+=dx*s+dy*c;
}
export function splitOne(B,d){
  var i=B.mem.indexOf(d);
  if(i<0){
    i=-1;
    for(var q=B.mem.length-1;q>=0;q--)if(B.mem[q].type==='v')i=q;
    if(i<0)i=B.mem.length-1;
    if(i<0)return;
    d=B.mem[i];
  }
  var out=[d];
  if(d.type==='v'&&B.vCount>=2&&(B.hasR||B.hasHalf)){
    for(var k=B.mem.length-1;k>=0;k--){
      var tk=B.mem[k].type;
      if((tk==='r'||tk===HALF)&&out.indexOf(B.mem[k])<0)out.push(B.mem[k]);
    }
  }
  var pv=null;
  if(B.massG&&B.massG.sx!=null)pv={sx:B.massG.sx,sy:B.massG.sy};
  var msvx=B.vx,msvy=B.vy;
  for(var j=0;j<out.length;j++){
    var g=out[j],mi2=B.mem.indexOf(g);
    if(mi2>=0)B.mem.splice(mi2,1);
    g.body=null;g.inBody=false;g.state='free';g.pop=0;
  }
  refresh(B);
  if(pv)keepMass(B,pv);
  var dir=Math.random()*6.2832, dx=Math.cos(dir), dy=Math.sin(dir), sep=75;
  B.vx=msvx+dx*sep; B.vy=msvy+dy*sep;
  for(var n=0;n<out.length;n++){
    var L=out[n], sp=slot(B,L);
    var fi=freeL.indexOf(L); if(fi>=0)freeL.splice(fi,1);
    freeLetter(L, sp.x, sp.y, msvx-dx*sep+(Math.random()*24-12), msvy-dy*sep+(Math.random()*24-12), false);
  }
}
export function canMerge(B,d){
  /* 已成表达式（mem ≥ 2）之后，禁止再并入常量/符号类字母（c/G/t/q/k/x 等）：
   * 它们只能作为表达式的起点（如 mc²、GMm），不能追加到已成形的表达式里（如 Gm + c）。 */
  /* c 只在表达式含小写 m 时拒绝追加；大写 M 的组合（GM…）允许，以便继续拼成 GM/c²。 */
  if(B&&B.mem&&B.mem.length>=2&&d&&d.ch==='c'){
    var _hasLittleM=false;
    for(var _mi=0;_mi<B.mem.length;_mi++){
      var _mm=B.mem[_mi];if(_mm&&(_mm.ch==='m'||_mm.type==='m')){_hasLittleM=true;break;}
    }
    if(B.massG&&(B.massG.ch==='m'||B.massG.type==='m'))_hasLittleM=true;
    if(_hasLittleM)return false;
  }
  if(!B||B.kind)return false; // field bodies (B/q/I) are not letter-merge targets
  if(B.bh)return false;       // a black hole devours letters — never merges with them
  var t=d.type;
  if(t==='t')return false;   // 't' only forms combos (gt→v, qt→I, vt→rod), never an inert formula letter
  // k / x 同理：只参与 k·x → 弹簧（见 applyKXCombo），绝不进公式；
  // 否则 k 会被 canMerge 末段当成「任意其它字母」并入单字母体（如 kv）。
  if(t==='k'||t==='x')return false;
  if(isMass(t)){
    var hasM=false,hasm=false;
    if(B.massG){if(B.massG.type==='M')hasM=true;else if(B.massG.type==='m')hasm=true;}
    for(var mi=0;mi<B.mem.length;mi++){
      var mt=B.mem[mi].type;
      if(mt==='M')hasM=true;else if(mt==='m')hasm=true;
    }
    // two IDENTICAL masses can never merge (mm / MM): every formula needs at most one M
    // and one m. Different masses (M+m) are still allowed so the build order stays free.
    if(t==='M'&&hasM)return false;
    if(t==='m'&&hasm)return false;
    var nM=(hasM?1:0)+(hasm?1:0);
    if(B.hasGrav){
      if(B.cCount>=1)return false;   // on the 2GM/c² path (G M c …) the masses are settled
      if(nM>=2)return false;         // GMm already has its two masses (M and m)
      if(B.mem.length>=5)return false;
      return true;
    }
    // before G is attached: allow stacking M+m (so m→M→G and M→m→G both work)
    if(nM>=2)return false;
    return true;
  }
  if(t==='c'){
    var cc=0;
    for(var cci=0;cci<B.mem.length;cci++)if(B.mem[cci].type==='c')cc++;
    if(cc>=2)return false;
    if(B.hasV||B.hasR||B.hasHalf)return false;
    // into a gravity body (GMc -> GMc², on the way to 2GM/c²): allow up to 2 c's
    if(B.hasGrav)return B.mem.length<4;
    // into a mass-only body (mc²): keep it small
    if(B.mem.length>=2)return false;
    return true;
  }
  if(t==='G'){
    if(B.hasGrav)return false;
    if(B.family===2)return false;          // don't drop G into a v/r formula
    // into an empty / mass-only body, or a mass-with-c body (M+c -> GMc -> GMc² -> 2GM/c²)
    if(B.hasC){if(B.mem.length>=1)return false;return true;}
    if(B.mem.length>=2)return false;
    return true;
  }
  var fam=(t==='g'||t==='a'||t===MU||t==='c'||t==='G')?1:2;
  if(B.family&&B.family!==fam&&!B.hasGrav)return false;
  if(t==='r'||t===HALF){
    if(t==='r'){if(B.hasGrav){if(B.rCount>=2)return false;if(B.mem.length>=5)return false;return true;}for(var i=0;i<B.mem.length;i++)if(B.mem[i].type==='r')return false;}
    else{for(var i2=0;i2<B.mem.length;i2++)if(B.mem[i2].type===HALF)return false;}
    if(B.vCount<2)return false;
    if(B.mem.length>=3)return false;
    return true;
  }
  if(t==='v'){
    if(B.vCount>=2)return false;
    if(B.mem.length>=3)return false;
    return true;
  }
  for(var k=0;k<B.mem.length;k++)if(B.mem[k].type===t)return false;
  if(B.mem.length>=2)return false;
  return true;
}
// 符号拼接必须交叠或非常靠近才发生，用盒距而不是以锚点为圆心的固定大半径（旧的 150/200px 会把远处的字母吸回去）。
// 盒距 = 两个字形盒之间的像素间隔（交叠/接触 = 0），盒外再容 MERGE_PAD。
// 对宿主逐字形取最小值，上标 ²、分母 r 也能正确命中。
export const MERGE_PAD=14;
export function lw(d){return d.w||30;}          // 字形的渲染宽/高（缺省按 F=48 的常规字母）
export function lh(d){return d.h||48;}
export function boxGap(ax,ay,aw,ah,bx,by,bw,bh){
  var dx=Math.abs(ax-bx)-(aw+bw)/2, dy=Math.abs(ay-by)-(ah+bh)/2;
  return Math.hypot(Math.max(0,dx),Math.max(0,dy));
}
export function ptToGlyphGap(x,y,cx,cy,cw,ch){return boxGap(x,y,0,0,cx,cy,cw,ch);}
export function twoLetterGap(a,b){return boxGap(a.wx,a.wy,lw(a),lh(a),b.wx,b.wy,lw(b),lh(b));}
// 落下的字母 d 到宿主任一字形盒的最短距离（没有字形就退回宿主包围盒）
export function bodyMergeGap(B,d){
  var sc=B.sc||1,i,best=1e9;
  if(B.glyphs&&B.glyphs.length){
    for(i=0;i<B.glyphs.length;i++){
      var g=B.glyphs[i];
      if(!g)continue;
      var s=slot(B,g);
      var gp=boxGap(d.wx,d.wy,lw(d),lh(d),s.x,s.y,(g.w||30)*sc,(g.h||48)*sc);
      if(gp<best)best=gp;
    }
    return best;
  }
  return boxGap(d.wx,d.wy,lw(d),lh(d),B.x,B.y,(B.hw||26)*2,(B.hh||26)*2);
}
/* 实心命中：点是否落在 W 体 B.pts 的凸包内（含 pad 容差）。
 * 用于 findSolidBodyAt 的补充判定（只决定把字母给谁，不改任何物理量）：
 *  · Matter.Query.point 只判碰撞多边形内部，空心形状（圆环/空心多边形）的环心是空的；
 *    distToHost 量的是到墨迹的距离，环心约一个半径，远超容差 ⇒ q 会退化成场源体。
 *  · 用凸包而不是原多边形：带洞形状用 even-odd 会把洞判成外部，凸包正好等于视觉上的实心区。
 *  · 凸包每次现算（n 只有几十、只在松手时调用），不缓存，不会存旧形状。 */
export function bodyFillHit(B,x,y,pad){
  if(!B||!B.pts||B.pts.length<3)return false;
  var P=B.pts,_n=P.length,i;
  /* 适用于所有 W 体（含开放笔画）：V / C / S / 波浪线这类笔画的质心常落在空处，离任何一段墨迹都远，
   * 只认「离墨迹 ≤22px」会找不到用户瞄准的目标。
   * 护栏：凸包对角线 > BODY_FILL_MAX 的大跨度笔画不适用（否则横贯屏幕的长线会把整块空地算成内部），
   * 仍走离墨迹判定。 */
  var _minx=1e9,_maxx=-1e9,_miny=1e9,_maxy=-1e9;
  for(i=0;i<_n;i++){
    var _p=P[i];
    if(_p[0]<_minx)_minx=_p[0]; if(_p[0]>_maxx)_maxx=_p[0];
    if(_p[1]<_miny)_miny=_p[1]; if(_p[1]>_maxy)_maxy=_p[1];
  }
  if(Math.hypot(_maxx-_minx,_maxy-_miny)>BODY_FILL_MAX)return false;
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0),dx=x-B.x,dy=y-B.y;
  var lx=dx*c+dy*s, ly=-dx*s+dy*c;
  var uni=[];

  for(i=0;i<P.length;i++){
    var px=P[i][0],py=P[i][1],dup=false;
    for(var j=0;j<uni.length;j++)if(uni[j][0]===px&&uni[j][1]===py){dup=true;break;}
    if(!dup)uni.push([px,py]);
  }
  if(uni.length<3)return false;
  uni.sort(function(a,b){return (a[0]-b[0])||(a[1]-b[1]);});
  function cross(o,a,b){return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);}
  var lo=[],up=[],k;
  for(k=0;k<uni.length;k++){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],uni[k])<=0)lo.pop();lo.push(uni[k]);}
  for(k=uni.length-1;k>=0;k--){while(up.length>=2&&cross(up[up.length-2],up[up.length-1],uni[k])<=0)up.pop();up.push(uni[k]);}
  lo.pop();up.pop();
  var H=lo.concat(up);
  if(H.length<3)return false;
  /* 容差：把点向内/外扩 pad（凸包是凸的 ⇒ 「到凸包距离 ≤ pad」等价于「膨胀 pad 后的凸包含」） */
  var n=H.length,inPoly=false,px=0,py=0;
  for(i=0;i<n;i++){px+=H[i][0];py+=H[i][1];}
  function outEdge(ax,ay,bx,by,qx,qy){
    var ex=bx-ax,ey=by-ay,rel=(ex*(qx-ax)+ey*(qy-ay));
    if(rel<-pad)return -1;                         /* 在边外侧太远 */
    if(rel>pad)return 1;
    var L2=ex*ex+ey*ey;
    var t=(L2>1e-9)?((qx-ax)*ex+(qy-ay)*ey)/L2:0;  /* 投影参数 */
    t=(t<-pad/(Math.sqrt(L2)+1e-9))?-pad/(Math.sqrt(L2)+1e-9):
      (t>pad/(Math.sqrt(L2)+1e-9))?pad/(Math.sqrt(L2)+1e-9):t;
    return t;
  }
  for(i=0;i<n;i++){
    var a=H[i],b=H[(i+1)%n];
    var st=outEdge(a[0],a[1],b[0],b[1],lx,ly);
    if(st===0)return true;
    if(i===0&&st>0)inPoly=true;
    else if(i>0&&st<0)inPoly=false;
  }
  return inPoly;
}
/* 场源体 / 临时参数宿主的字形在被抓起时先摘成真正的自由字符：从宿主 glyphs 移除、inBody=false、body=null，
 * 宿主若已无字形则一并清掉。这样落点时能正常走赋予/合并，与从面板拖出的字符同权。
 * 背景：拖到空处的 q 会生成场源体，其字形 inBody=true、位置由 slot() 决定，看起来就是个 q；
 * 不摘的话再抓它实际是抓宿主，松手弹回宿主，什么也不发生。
 * 注意：场源体没有 Matter 体，录制器（if(!mb&&!_isRod)continue）会整类跳过它。 */
export function detachFieldGlyph(d){
  if(!d||!d.body)return false;
  var B=d.body;
  var isField=(B.kind==='B'||B.kind==='E'||B.kind==='q'||B.kind==='I');
  var inWorld=(bodies.indexOf(B)>=0);
  if(!isField&&inWorld)return false;      /* 正常公式体的字形：照旧，不动 */
  if(B.glyphs){var i=B.glyphs.indexOf(d);if(i>=0)B.glyphs.splice(i,1);}
  d.body=null;d.inBody=false;
  if(!B.glyphs||!B.glyphs.length){
    if(inWorld){try{killFieldBody(B,bodies.indexOf(B));}catch(e){}}
    else{try{if(B.mb&&MW)Matter.Composite.remove(MW.wLayer,B.mb);}catch(e2){}}
  }
  return true;
}
export function findSolidBodyAt(x,y){
  var best=null,bd=1e9;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B||B.dead)continue;
    /* 只排除 gnd / belt / bh（地面器件 / 传送带 / 黑洞）：否则在画布任何地方松手都会命中地面，字符被赋予后消失。
     * 不要排除 fixed / isStatic：右键固定过的普通物体仍要能接受电荷/速度（排除后 q 会退化成场源体）。
     * 墙和 ensureMatter 的 ground/wl/wr/wt 静态框不在 bodies[] 里，本函数天然看不见。 */
    if(B.gnd||B.belt||B.bh)continue;
    var inside=false;
    try{ if(B.mb&&MW&&MW.engine)
           inside=Matter.Query.point([B.mb],{x:x,y:y}).length>0; }catch(e){inside=false;}
    /* Matter.Query.point 对空心形状环心判否，补一层 W 体凸包内判定（含 22px 容差），否则 q 会退化成场源体。 */
    if(!inside){try{inside=bodyFillHit(B,x,y,22);}catch(e2){inside=false;}}
    var d2=distToHost(B,x,y);
    var gap=inside?0:d2;
    if(gap<bd){bd=gap;best=B;}
  }
  return bd<=22?best:null;   /* 容差 22px：实心区域整体算命中，不只认墨线 */
}
export function findMergeTarget(d){
  var best=null,bg=1e9;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.massG===d||B.mem.indexOf(d)>=0)continue;
    if(!canMerge(B,d))continue;
    var gap=bodyMergeGap(B,d);
    if(gap<bg){bg=gap;best=B;}
  }
  return bg<=MERGE_PAD?best:null;
}
// a loose mass letter on the canvas (left over from a shatter or a split) can be a merge
// target just like a body: drop another letter onto it and it is promoted to the base of a
// fresh body on the spot (instead of requiring the player to nudge it first).
export function findFreeMassTarget(d){
  var best=null,bg=1e9;
  for(var i=0;i<freeL.length;i++){
    var F=freeL[i];
    if(F===d||F.dead||F.state!=='free')continue;
    if(!isMass(F))continue;
    var gap=twoLetterGap(d,F);
    if(gap<bg){bg=gap;best=F;}
  }
  return bg<=MERGE_PAD?best:null;
}
export function findFreeLetterTarget(B){
  var best=null,bg=1e9;
  for(var i=0;i<freeL.length;i++){
    var L=freeL[i];
    if(!canMerge(B,L))continue;
    var gap=bodyMergeGap(B,L);
    if(gap<bg){bg=gap;best=L;}
  }
  return bg<=MERGE_PAD?best:null;
}
