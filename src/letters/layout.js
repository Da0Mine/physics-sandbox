/* 公式体的排版（分式、括号、引力式等） */
import { DD, bodies, panel } from '../core/dom.js';
import { clamp } from '../core/math.js';
import { refreshSpringGeom } from '../devices/spring.js';
import { isMass, killG, stGD } from './glyph.js';
import { BOX_PAD, F, HALF, MU } from './merge.js';
import { ringGo } from '../ui/menu.js';

export const OPEN='(', CLOSE=')', PLUS='+', SQ='²', BAR='-';
export function layoutField(B){
  if(B.kind==='S'){
    // 弹簧：没有字母、不排公式，几何完全由两端点决定（refreshSpringGeom 负责）
    B.fg=null;B.glyphs=[];B.sc=1;B.frac=false;B.subBar=null;
    refreshSpringGeom(B);
    return;
  }
  if(B.kind==='T'){
    B.fg=null;
    B.hw=B.len/2+2;B.hh=4;   // rod is a 3px thin line -> thin collision box (no float on the ground)
    B.sc=1;B.frac=false;B.subBar=null;
    return;
  }
  B.glyphs=[B.fg];
  B.fg.body=B;B.fg.inBody=true;B.fg.sx=0;B.fg.sy=0;
  B.hw=(B.fg.m.w/2)+8;B.hh=(B.fg.m.bot-B.fg.m.top)/2+4;B.sc=1;B.frac=false;B.subBar=null;
}
// 进圆轨道必须是完整的 mv²/r：除了 mem 里的 v,v,r，还必须有 m 或 M 作质量字母。
// 裸的 v²/r 只是加速度不是向心力，不能进圆轨道。
export function isMVR(B){
  return !!(B&&!B.kind&&B.hasV&&B.hasR&&B.vCount>=2&&B.massG&&isMass(B.massG.type));
}
export function setF(B){
  B.hasG=false;B.hasA=false;B.hasV=false;B.hasR=false;B.hasHalf=false;B.hasMu=false;B.hasC=false;B.hasGrav=false;
  for(var i=0;i<B.mem.length;i++){
    var tt=B.mem[i].type;
    if(tt==='g')B.hasG=true;
    else if(tt==='a')B.hasA=true;
    else if(tt==='v')B.hasV=true;
    else if(tt==='r')B.hasR=true;
    else if(tt===HALF)B.hasHalf=true;
    else if(tt===MU)B.hasMu=true;
    else if(tt==='c')B.hasC=true;
    else if(tt==='G')B.hasGrav=true;
  }
  B.family=(B.hasG||B.hasA||B.hasMu||B.hasC||B.hasGrav)?1:((B.hasV||B.hasR||B.hasHalf)?2:0);
  B.vCount=0;
  for(var k=0;k<B.mem.length;k++)if(B.mem[k].type==='v')B.vCount++;
  B.cCount=0;
  for(var k2=0;k2<B.mem.length;k2++)if(B.mem[k2].type==='c')B.cCount++;
  B.rCount=0;
  for(var rk=0;rk<B.mem.length;rk++)if(B.mem[rk].type==='r')B.rCount++;
  // ---- gravity formula shape (single source of truth) ----
  // 'schwarz' : 2GM/c²  -> needs G, a capital M and at least one c (no r). The small m is
  //             NOT part of this formula, so it is hidden rather than drawn on top of GM.
  // 'well'    : GMm/r²  -> needs G, a capital M AND the small m, plus r². A bare GM/r² is
  //             an incomplete formula: no ring, no gravity.
  // 'plain'   : incomplete gravity body, drawn as a plain product.
  B.gravMode=gravModeOf(B);
  B.isSchwarzschild=!!(B.gravMode==='schwarz'&&B.cCount>=2);
  B.isWell=!!(B.gravMode==='well');
  if(B.massG){
    var pvM=B.param&&B.param.mass!=null;
    B.mass=pvM?B.param.mass:((B.massG.type==='M')?3:1);
    // capital-M mass stored separately (param key 'massM') so M can be tuned independently
    var pvC=B.param&&B.param.massM!=null;
    B.massCap=pvC?B.param.massM:((B.massG.type==='M')?3:1);
  }
}
export function gravModeOf(B){
  if(!B.hasGrav)return 'plain';
  var Mtot=(B.massG&&B.massG.type==='M')?1:0,mtot=(B.massG&&B.massG.type==='m')?1:0;
  var rc=0,cc2=0;
  for(var i=0;i<B.mem.length;i++){
    var t=B.mem[i].type;
    if(t==='M')Mtot++;
    else if(t==='m')mtot++;
    else if(t==='r')rc++;
    else if(t==='c')cc2++;
  }
  if(Mtot>=1&&cc2>=1&&rc<2)return 'schwarz';
  if(Mtot>=1&&mtot>=1&&rc>=2)return 'well';
  return 'plain';
}
export function wLet(x){if(x==='g')return 0;if(x==='a')return 1;if(x==='v')return 2;return 3;}
export function ensureSt(B){
  var p1=(B.family===1&&B.mem.length>=2&&B.cCount<2&&!(B.hasGrav||B.hasR));
  var p2=(B.family===2&&B.vCount>=2);
  var pFrac=(B.family===2&&(B.hasR||B.hasHalf)&&B.vCount>=2)||(B.hasGrav&&B.hasR);
  var keeps=[];
  function live(k,ch,sc){
    if(!B.st[k]||B.st[k].dead){if(B.st[k])killG(B.st[k]);B.st[k]=stGD(ch,sc);}
    var g=B.st[k];
    if(B.glyphs.indexOf(g)<0)B.glyphs.push(g);
    g.body=B;g.s=1;keeps.push(g);
  }
  function dead(k){
    if(B.st[k]){killG(B.st[k]);B.st[k]=null;}
  }
  if(p1){live('open',OPEN);live('plus',PLUS);live('close',CLOSE);}
  else{dead('open');dead('plus');dead('close');}
  var gMode=gravModeOf(B);
  var pSq=(B.family===2&&B.vCount>=2)||(B.family===1&&B.cCount>=2&&!B.hasGrav)||(B.hasGrav&&B.rCount>=2)||(gMode==='schwarz'&&B.cCount>=2);
  if(pSq){live('sq',SQ,0.6);}
  else{dead('sq');}
  // a gravity body turns into a fraction as soon as its denominator letter (r or c) arrives,
  // so the letter can never sit on top of the numerator.
  var pFrac=(gMode==='schwarz')||(B.family===2&&(B.hasR||B.hasHalf)&&B.vCount>=2)||(B.hasGrav&&B.hasR);
  if(pFrac){live('bar',BAR);}
  else{dead('bar');}
  if(B.hasHalf||B.isSchwarzschild){live('h2','2');}
  else{dead('h1');dead('h2');}
  for(var i=B.glyphs.length-1;i>=0;i--){
    var g=B.glyphs[i];
    if(g.stk&&keeps.indexOf(g)<0){B.glyphs.splice(i,1);killG(g);}
  }
}
export function tokenSeq(B){
  var out=[B.massG];
  if(B.family===0){
    // pure mass stack (M+m): show all mem masses
    for(var mi0=0;mi0<B.mem.length;mi0++)if(isMass(B.mem[mi0]))out.push(B.mem[mi0]);
  }else if(B.family===1){
    if(B.mem.length===1)out.push(B.mem[0]);
    else if(B.cCount>=2){
      var c1=null;
      for(var ci=0;ci<B.mem.length;ci++){if(B.mem[ci].type==='c'){c1=B.mem[ci];break;}}
      if(c1)out.push(c1);
      if(B.st.sq)out.push(B.st.sq);
    }
    else{
      out.push(B.st.open);
      for(var i=0;i<B.mem.length;i++){
        if(i)out.push(B.st.plus);
        out.push(B.mem[i]);
      }
      out.push(B.st.close);
    }
  }else if(B.family===2){
    var vSeen=false;
    for(var j=0;j<B.mem.length;j++){
      var tt=B.mem[j].type;
      if(tt==='r')continue;
      if(tt==='v'){
        if(vSeen)continue;
        vSeen=true;
      }
      out.push(B.mem[j]);
    }
    if(B.vCount>=2)out.push(B.st.sq);
  }
  var fin=[];
  for(var k=0;k<out.length;k++)if(out[k])fin.push(out[k]);
  return fin;
}
export function kern(a,b){
  if(a===SQ||b===SQ)return 2;
  if(a===OPEN||b===CLOSE)return 4;
  return 5;
}
export function hRun(items){
  var x=0,parts=[];
  for(var i=0;i<items.length;i++){
    var it=items[i];
    var w=it.g.m.w*it.s;
    var gap=(i<items.length-1)?kern(it.g.type, items[i+1].g.type):0;
    parts.push({g:it.g,s:it.s,dy:it.dy,cx:x+w/2,w:w});
    x+=w+gap;
  }
  return {parts:parts,w:x};
}
export function placeRun(parts, runW, centerY){
  var top=1e9,bot=-1e9;
  for(var i=0;i<parts.length;i++){var p=parts[i];top=Math.min(top,p.dy+p.g.m.top*p.s);bot=Math.max(bot,p.dy+p.g.m.bot*p.s);}
  var dv=(top+bot)/2;
  for(var j=0;j<parts.length;j++){var q=parts[j];q.g.sx=q.cx-runW/2;q.g.sy=(q.dy-dv)+centerY;}
}
export function layoutRun(B, items){
  var run=hRun(items);
  placeRun(run.parts, run.w, 0);
  B.frac=false;
  var top=1e9,bot=-1e9;
  for(var i=0;i<run.parts.length;i++){var p=run.parts[i];top=Math.min(top,p.dy+p.g.m.top*p.s);bot=Math.max(bot,p.dy+p.g.m.bot*p.s);}
  B.hw=run.w/2+5;B.hh=(bot-top)/2+1;B.sc=1;B.subBar=null;
}
export function layoutBracket(B){
  var toks=tokenSeq(B);
  var items=[];for(var i=0;i<toks.length;i++)items.push({g:toks[i],s:1,dy:0});
  layoutRun(B,items);
}
export function layoutFrac(B, vG, rG){
  // 同 layoutBody：裸体（promoteFreeLetter 提升的非质量字母）的 massG 是 null，
  // 直接当分子基准会在 hRun 里读 null.m 崩掉；取一个安全基准，且不和 vG 重复。
  var base=B.massG||vG||rG||(B.mem&&B.mem[0])||(B.glyphs&&B.glyphs[0])||null;
  var num=[];
  if(base)num.push({g:base,s:1,dy:0});
  if(vG&&vG!==base)num.push({g:vG,s:1,dy:0});
  if(B.vCount>=2&&B.st.sq&&B.st.sq!==base&&B.st.sq!==vG)num.push({g:B.st.sq,s:1,dy:0});
  if(!num.length){B.hw=26;B.hh=26;return;}
  var numR=hRun(num);
  var nTop=1e9,nBot=-1e9;
  numR.parts.forEach(function(p){nTop=Math.min(nTop,p.dy+p.g.m.top*p.s);nBot=Math.max(nBot,p.dy+p.g.m.bot*p.s);});
  var rows=[];
  if(B.hasR&&rG){var rr=hRun([{g:rG,s:1,dy:0}]);rows.push(rr);}
  if(B.hasHalf){var rr2=hRun([{g:B.st.h2,s:1,dy:0}]);rows.push(rr2);}
  rows.forEach(function(r){r.top=1e9;r.bot=-1e9;r.parts.forEach(function(p){r.top=Math.min(r.top,p.dy+p.g.m.top*p.s);r.bot=Math.max(r.bot,p.dy+p.g.m.bot*p.s);});});
  var dGap=7, subGap=3;
  // 分母顶必须定在「线下方 dGap」，不能写成 nBot+dGap：nBot 是分子平移前的底度量（约 +17），
  // 分子随后被 numShift=-dGap-nBot 搬走、底已落到 -dGap；用旧 nBot 会把分母推到线下约 24px，
  // 而分子离线只有 7px。正确写法是 dShift = barGap - dTop。
  var denTop=dGap;
  var dTop,dBot,subBarY=null;
  if(rows.length===1){
    var r0=rows[0];var sh=denTop-r0.top;
    r0.parts.forEach(function(p){p.g.sy=sh+p.dy;});
    dTop=r0.top+sh;dBot=r0.bot+sh;
  }else{
    var A=rows[0],Bb=rows[1];
    var ah=A.bot-A.top;
    subBarY=denTop+ah+subGap/2;
    var shA=subBarY-subGap/2-A.bot;
    A.parts.forEach(function(p){p.g.sy=shA+p.dy;});
    var shB=subBarY+subGap/2-Bb.top;
    Bb.parts.forEach(function(p){p.g.sy=shB+p.dy;});
    dTop=A.top+shA;dBot=Bb.bot+shB;
  }
  var numShift=-dGap-nBot;
  numR.parts.forEach(function(p){p.g.sx=p.cx-numR.w/2;p.g.sy=numShift+p.dy;});
  rows.forEach(function(r){r.parts.forEach(function(p){p.g.sx=p.cx-r.w/2;});});
  var denW=0;rows.forEach(function(r){denW=Math.max(denW,r.w);});
  var fracW=Math.max(numR.w,denW)+14;
  B.st.bar.w=fracW;B.st.bar.h=2;B.st.bar.sx=0;B.st.bar.sy=0;
  var wholeTop=nTop+numShift, wholeBot=dBot;
  var shiftY=-(wholeTop+wholeBot)/2;
  numR.parts.forEach(function(p){p.g.sy+=shiftY;});
  rows.forEach(function(r){r.parts.forEach(function(p){p.g.sy+=shiftY;});});
  B.st.bar.sy=shiftY;
  if(subBarY!=null){B.subBar={y:subBarY+shiftY,w:Math.max(rows[0].w,rows[1].w)+6};}else{B.subBar=null;}
  B.hw=fracW/2+4;B.hh=(wholeBot-wholeTop)/2+2;
  var maxDim=Math.max(fracW,(wholeBot-wholeTop));
  B.sc=clamp(155/maxDim,0.5,1);
  B.frac=true;
}
export function gravParts(B){
  // collect the gravity formula's pieces by type so assembly order is irrelevant.
  // bigM = the capital-M letter (from base or mem), smallM = the lowercase-m letter.
  var Gg=null,bigM=null,smallM=null;
  for(var i=0;i<B.mem.length;i++){
    var t=B.mem[i].type;
    if(t==='G'){if(!Gg)Gg=B.mem[i];}
    else if(t==='M'){if(!bigM)bigM=B.mem[i];}
    else if(t==='m'){if(!smallM)smallM=B.mem[i];}
  }
  if(B.massG){
    if(B.massG.type==='M'){if(!bigM)bigM=B.massG;}
    else if(B.massG.type==='m'){if(!smallM)smallM=B.massG;}
  }
  return {Gg:Gg,bigM:bigM,smallM:smallM};
}
export function layoutGrav(B){
  var p=gravParts(B),Gg=p.Gg,bigM=p.bigM,smallM=p.smallM,rG=null;
  for(var i=0;i<B.mem.length;i++){if(B.mem[i].type==='r')rG=B.mem[i];}
  var cG=null;
  for(var ci=0;ci<B.mem.length;ci++){if(B.mem[ci].type==='c'){cG=B.mem[ci];break;}}
  var mode=gravModeOf(B);
  function gravItems(){
    var a=[];
    if(B.isSchwarzschild&&B.st.h2)a.push({g:B.st.h2,s:1,dy:0});   // automatic leading "2"
    if(Gg)a.push({g:Gg,s:1,dy:0});
    if(bigM)a.push({g:bigM,s:1,dy:0});
    // 2GM/c² has no lowercase m — it is not part of the formula (it stays hidden)
    if(smallM&&mode!=='schwarz')a.push({g:smallM,s:1,dy:0});
    return a;
  }
  // the denominator is r (GMm/r²) or c (2GM/c²) — as soon as the letter is there it goes
  // UNDER the fraction bar, so it can never overlap the numerator.
  var denMain=(B.hasR&&rG)?rG:((mode==='schwarz'&&cG)?cG:null);
  var gravBase=!!denMain;
  if(gravBase){
    var num=gravItems();
    var numR=hRun(num);
    var nTop=1e9,nBot=-1e9;
    numR.parts.forEach(function(p){nTop=Math.min(nTop,p.dy+p.g.m.top*p.s);nBot=Math.max(nBot,p.dy+p.g.m.bot*p.s);});
    var denMain=(B.hasR&&rG)?rG:((mode==='schwarz'&&cG)?cG:null);
    var den=[{g:denMain,s:1,dy:0}];
    if(B.st.sq&&(B.isSchwarzschild||B.rCount>=2)){
      // superscript ²: raise it so its BOTTOM sits 4px above the denominator main glyph's top
      // (proper exponent), derived from metrics.
      var sqM=B.st.sq.m||{bot:8,top:-12};
      var dySup=(denMain.m.top-sqM.bot)-4;
      den.push({g:B.st.sq,s:1,dy:dySup});
    }
    var dR=hRun(den);
    var dTop=1e9,dBot=-1e9;
    dR.parts.forEach(function(p){dTop=Math.min(dTop,p.dy+p.g.m.top*p.s);dBot=Math.max(dBot,p.dy+p.g.m.bot*p.s);});
    var dGap=7;
    // 同上：分母顶 = 线下 dGap，与分子对称（不要写成 nBot+dGap）
    var denTop=dGap;
    // 锚定的是整个分母块的顶（含上标 ²），不是 denMain 的顶：
    // 只用 denMain 时 r 贴到线下 7px，而 ² 比 r 高约 18px，会横跨分式线被劈成两半。
    // 分子那边是「整块分子的底离线 dGap」，分母也按整块来量。
    var shR=denTop-dTop;
    dR.parts.forEach(function(p){p.g.sx=p.cx-dR.w/2;p.g.sy=shR+p.dy;});
    var numShift=-dGap-nBot;
    numR.parts.forEach(function(p){p.g.sx=p.cx-numR.w/2;p.g.sy=numShift+p.dy;});
    var denW=dR.w;
    var fracW=Math.max(numR.w,denW)+14;
    B.st.bar.w=fracW;B.st.bar.h=2;B.st.bar.sx=0;B.st.bar.sy=0;
    // 分母刚被 shR 平移过，底是 dBot+shR；漏掉 shR 会让 wholeBot 偏小、shiftY 算错，
    // 整条分式在 body 里上下偏心（layoutFrac 那边 dBot 已含平移量）。
    var wholeTop=nTop+numShift, wholeBot=dBot+shR;
    var shiftY=-(wholeTop+wholeBot)/2;
    numR.parts.forEach(function(p){p.g.sy+=shiftY;});
    dR.parts.forEach(function(p){p.g.sy+=shiftY;});
    B.st.bar.sy=shiftY;
    B.subBar=null;
    B.hw=fracW/2+4;B.hh=(wholeBot-wholeTop)/2+2;
    var maxDim=Math.max(fracW,(wholeBot-wholeTop));
    B.sc=clamp(155/maxDim,0.5,1);
    B.frac=true;
  }else{
    // no r yet (and not on the 2GM/c² path): render as a plain product "GMm". EVERY letter
    // the user has glued on participates — in particular stray c's are laid out side by side
    // so they can never sit on top of the row (sx/sy unset -> body centre) and a second c
    // cannot silently drop the G and morph the body into an mc² look-alike.
    var items=gravItems();
    for(var xi=0;xi<B.mem.length;xi++){
      var xg=B.mem[xi];
      if(xg.type==='r')continue;
      var dup=false;
      for(var yj=0;yj<items.length;yj++)if(items[yj].g===xg){dup=true;break;}
      if(!dup)items.push({g:xg,s:1,dy:0});
    }
    var R=hRun(items);
    var top=1e9,bot=-1e9;
    R.parts.forEach(function(p){top=Math.min(top,p.dy+p.g.m.top);bot=Math.max(bot,p.dy+p.g.m.bot);});
    var dv=(top+bot)/2;
    R.parts.forEach(function(p){p.g.sx=p.cx-R.w/2;p.g.sy=(p.dy-dv);});
    B.frac=false;B.subBar=null;
    B.hw=R.w/2+5;B.hh=(bot-top)/2+1;
    B.sc=clamp(155/Math.max(R.w,(bot-top)),0.5,1);
    // glyph list must match exactly what was laid out (refresh skips tokList for these)
    B._plainGlyphs=[];
    for(var gi2=0;gi2<items.length;gi2++)B._plainGlyphs.push(items[gi2].g);
  }
}
export function layoutBody(B){
  B.mem.sort(function(x,y){return wLet(x.type)-wLet(y.type);});
  ensureSt(B);
  // promoteFreeLetter 提升的非质量字母（v/r/g/a/μ…）不会被赋值 massG，之后往这个裸体合字母时
  // 排版基准 B.massG 是 null，hRun 读 null.m.w 会抛错、整个排版中断。
  // 所以取安全基准：有 massG 用它，否则退回 mem[0] / glyphs[0]。
  var base=B.massG||(B.mem&&B.mem[0])||(B.glyphs&&B.glyphs[0])||null;
  if(!base){B.hw=26;B.hh=26;B.frac=false;B.subBar=null;return;}
  if(B.hasGrav){layoutGrav(B);return;}
  var isFrac=B.family===2&&(B.hasR||B.hasHalf)&&B.vCount>=2;
  var vG=null,rG=null;
  for(var i=0;i<B.mem.length;i++){if(B.mem[i].type==='v'&&!vG)vG=B.mem[i];if(B.mem[i].type==='r'&&!rG)rG=B.mem[i];}
  if(B.family===1){
    if(B.cCount>=2){
      var cg=null;
      for(var ci2=0;ci2<B.mem.length;ci2++){if(B.mem[ci2].type==='c'){cg=B.mem[ci2];break;}}
      var num=[{g:base,s:1,dy:0}];
      if(cg&&cg!==base)num.push({g:cg,s:1,dy:0});
      if(B.st.sq&&B.st.sq!==base)num.push({g:B.st.sq,s:1,dy:0});
      layoutRun(B,num);
      return;
    }
    layoutBracket(B);return;
  }
  if(isFrac){layoutFrac(B,vG,rG);return;}
  var num=[{g:base,s:1,dy:0}];
  if(vG&&vG!==base)num.push({g:vG,s:1,dy:0});
  if(B.vCount>=2&&B.st.sq&&B.st.sq!==base)num.push({g:B.st.sq,s:1,dy:0});
  if(B.family===0){
    // pure mass stack (e.g. M then m, no G/v/r yet): render every mass side by side
    for(var mq=0;mq<B.mem.length;mq++)if(isMass(B.mem[mq])&&B.mem[mq]!==base)num.push({g:B.mem[mq],s:1,dy:0});
  }
  layoutRun(B,num);
}
export function slot(B,g){
  var sc=B.sc||1;
  var co=Math.cos(B.th),si=Math.sin(B.th);
  return {x:B.x+(g.sx*co-g.sy*si)*sc,y:B.y+(g.sx*si+g.sy*co)*sc};
}
export function initWorld(B){
  for(var i=0;i<B.glyphs.length;i++){
    var s=slot(B,B.glyphs[i]);
    B.glyphs[i].wx=s.x;
    B.glyphs[i].wy=s.y;
  }
}
// ---- collision box == the VISIBLE formula -------------------------------------------------
// Every layout function writes hw/hh with its own ad-hoc padding (+4/+5/+6/+8) centred on
// B.x/B.y — but the glyphs are NOT symmetric about that origin (the r of GMm/r² hangs far
// below the bar, a superscript ² rides high, a subscript 2 sits low). The old box therefore
// floated above / stuck out past the letters, and a plank or the ground could "hit" the
// formula while still visually clear of it.
// Here we measure the real ink union of every glyph (plus the fraction bar), slide the whole
// glyph set so that union centre lands exactly on B.x/B.y, and set hw/hh to the union half
// extents + BOX_PAD. The AABB then *is* the formula, and it stays centred while it rotates.
export function anchorBox(B){
  if(!B.glyphs||!B.glyphs.length)return;
  var minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
  function put(cx,cy,w,t,b){
    if(cx-w/2<minx)minx=cx-w/2;
    if(cx+w/2>maxx)maxx=cx+w/2;
    if(cy+t<miny)miny=cy+t;
    if(cy+b>maxy)maxy=cy+b;
  }
  for(var i=0;i<B.glyphs.length;i++){
    var g=B.glyphs[i];
    if(!g||g.dead||!g.m)continue;
    put(g.sx||0,g.sy||0,g.m.w||F*0.6,
        (g.m.top==null?-F/2:g.m.top),(g.m.bot==null?F/2:g.m.bot));
  }
  if(B.frac&&B.st&&B.st.bar&&B.st.bar.w){
    var bh=(B.st.bar.h||2)/2;
    put(B.st.bar.sx||0,B.st.bar.sy||0,B.st.bar.w,-bh,bh);
  }
  if(minx>maxx)return;
  var ucx=(minx+maxx)/2,ucy=(miny+maxy)/2;
  if(ucx||ucy){   // re-anchor: glyphs + bars move together, so the box centre == ink centre
    for(var j=0;j<B.glyphs.length;j++){
      B.glyphs[j].sx=(B.glyphs[j].sx||0)-ucx;
      B.glyphs[j].sy=(B.glyphs[j].sy||0)-ucy;
    }
    if(B.st&&B.st.bar&&B.glyphs.indexOf(B.st.bar)<0){   // 若线已在 glyphs 里，上面的循环已经平移过它，再减一次会让分数线扎进分子
      B.st.bar.sx=(B.st.bar.sx||0)-ucx;B.st.bar.sy=(B.st.bar.sy||0)-ucy;}
    if(B.subBar)B.subBar.y-=ucy;
  }
  B.hw=Math.max(2,(maxx-minx)/2)+BOX_PAD;
  B.hh=Math.max(2,(maxy-miny)/2)+BOX_PAD;
}
export function refresh(B){
  if(B.kind){layoutField(B);return;}
  if(B.bh&&(B.bh.stage===1||B.bh.t>0.6)){
    // the formula is being/has been consumed by the hole — never rebuild its glyphs
    B.bh.fade=(B.bh.stage===1)?null:0;
    return;
  }
  setF(B);
  layoutBody(B);
  if(B.frac){
    if(B.hasGrav){
      B.glyphs=[];
      var gp=gravParts(B),Gg=gp.Gg,bigM=gp.bigM,smallM=gp.smallM,rGg=null,cGg=null;
      for(var q=0;q<B.mem.length;q++){
        var tq=B.mem[q].type;
        if(tq==='r')rGg=B.mem[q];
        else if(tq==='c'&&!cGg)cGg=B.mem[q];
      }
      if(gravModeOf(B)==='schwarz'){
        // 2GM/c²: automatic leading "2", G, M, bar, c, ² — the lowercase m is NOT part of
        // this formula, so it is left out of the glyph list (and stays hidden).
        if(B.isSchwarzschild&&B.st.h2)B.glyphs.push(B.st.h2);
        if(Gg)B.glyphs.push(Gg);
        if(bigM)B.glyphs.push(bigM);
        if(B.st.bar)B.glyphs.push(B.st.bar);
        if(cGg)B.glyphs.push(cGg);
        if(B.st.sq)B.glyphs.push(B.st.sq);
      }else{
        if(Gg)B.glyphs.push(Gg);
        if(bigM)B.glyphs.push(bigM);
        if(smallM)B.glyphs.push(smallM);
        if(rGg)B.glyphs.push(rGg);
        if(B.st.sq&&B.rCount>=2)B.glyphs.push(B.st.sq);
        if(B.st.bar)B.glyphs.push(B.st.bar);
      }
    }else{
      // 裸体（promoteFreeLetter 提升的非质量字母）massG 是 null：不能写成 B.glyphs=[B.massG]，
      // 否则塞进 null，下一行 B.glyphs[i].body=B 立刻崩，之后每帧 syncGlyphs 读 null.dead 连环报错。
      B.glyphs=[];
      if(B.massG)B.glyphs.push(B.massG);
      var vG=null,rG=null;
      for(var q2=0;q2<B.mem.length;q2++){if(B.mem[q2].type==='v'&&!vG)vG=B.mem[q2];if(B.mem[q2].type==='r'&&!rG)rG=B.mem[q2];}
      if(vG)B.glyphs.push(vG);
      if(B.st.sq)B.glyphs.push(B.st.sq);
      if(rG)B.glyphs.push(rG);
      if(B.hasHalf){if(B.st.h2)B.glyphs.push(B.st.h2);}
      if(B.st.bar)B.glyphs.push(B.st.bar);
    }
  }else if(B.hasGrav&&B._plainGlyphs){
    // incomplete gravity body: glyphs are exactly the letters layoutGrav placed in the row
    B.glyphs=B._plainGlyphs;
  }else{
    B.glyphs=tokList(B);
  }
  for(var i=0;i<B.glyphs.length;i++){B.glyphs[i].body=B;B.glyphs[i].inBody=true;}
  // any LETTER owned by this body that is NOT in B.glyphs must be hidden, INCLUDING the
  // base massG (e.g. the lowercase m that becomes a stray in the 2GM/c² formula — it is
  // not part of the schwarz layout and would otherwise sit on top of the capital M).
  for(var m=0;m<B.mem.length;m++){
    if(B.glyphs.indexOf(B.mem[m])<0)B.mem[m].el.style.display='none';
  }
  if(B.massG&&B.glyphs.indexOf(B.massG)<0)B.massG.el.style.display='none';
  // TIGHTEN: replace the layout's generous hw/hh with the true ink box (must run BEFORE the
  // scaleParam multiply below, so a scaled r still inflates the box for non-well bodies).
  anchorBox(B);
  if(B.orb&&!isMVR(B))B.orb=null;
  if(!B.orb&&isMVR(B)){B.orb={spin:0,age:0,pulse:0,ringPts:null,R:120,k:0,e:0,gx:B.x,gy:B.y,gs:1,ga:1};}
  // apply per-body scale (from r) — scale visual+collision box WITHOUT cumulative growth:
  // the layout functions just wrote the UNSCALED hw/hh; multiply once here.
  // EXCEPTION: a complete GMm/r² well keeps its COMPACT collision box — r scales ONLY the
  // attraction range (wellR) and the wireframe ring, never the physical AABB. Otherwise a
  // big r inflates the well's hitbox and shoves every body away ("式子卡在原地不动").
  if(B.scaleParam!=null&&B.scaleParam!==1){
    if(!B.isWell){B.hw=(B.hw||20)*B.scaleParam;B.hh=(B.hh||18)*B.scaleParam;}
    if(B.orb)B.orb.R=130*B.scaleParam;
  }else if(B.scaleParam===1){
    if(B.orb)B.orb.R=130;
  }
  // keep the current velocity on inflation start — mc² must stay pushable while it inflates.
  // A 2GM/c² formula (isSchwarzschild) does NOT explode — it collapses into a black hole.
  // A gravity body (G…) is never an mc² bomb: E=mc² needs mass + c² and NO G.
  if(B.family===1&&B.cCount>=2&&!B.hasGrav&&!B.isSchwarzschild&&!B.exploding&&!B.copied){B.exploding=true;B.explT=0;B.infl=1;}
  if(B.cCount<2||B.isSchwarzschild){B.exploding=false;B.infl=1;B.wob=0;}
  // 2GM/c² complete -> the whole formula COLLAPSES into a black hole (event horizon grows
  // outward, the letters get sucked in and vanish, the hole stays and devours everything).
  if(B.isSchwarzschild&&!B.bh){
    /* 不能同时召唤两个黑洞：出生处门控，场上已有黑洞时这个公式不坍缩（保持普通公式体）。
     * 从根上避免两个黑洞的场景，黑洞合并逻辑因此停用。 */
    var _hasBH=false;
    for(var _bi2=0;_bi2<bodies.length;_bi2++){
      var _B2=bodies[_bi2];
      if(_B2&&_B2!==B&&_B2.bh&&_B2.bh.stage>=1&&!_B2.dead){_hasBH=true;break;}
    }
    if(!_hasBH){
      B.bh={stage:0,r:0,R:210,t:0,age:0,spin:0,seed:Math.random()*1000,dead:false};
      ringGo(B.x,B.y);
    }
  }
  if(!B.isSchwarzschild&&B.bh&&B.bh.stage===0)B.bh=null;   // split mid-collapse: no hole
}
export function tokList(B){
  var t=tokenSeq(B);
  for(var i=0;i<t.length;i++){if(t[i]&&!t[i].body)t[i].body=B;}
  return t;
}
export function place(g,x,y,rot,sc,show){
  var e=g.el;
  if(!show){e.style.display='none';return;}
  e.style.display='';
  e.style.left=(x-g.w/2)+'px';
  e.style.top=(y-g.h/2)+'px';
  var t='rotate('+(rot||0)+'rad) scale('+(sc==null?1:sc)+')';
  if(e.style.transform!==t)e.style.transform=t;
}
export function placeLetter(d){
  if(d.state==='dock'){
    if(d.el.parentNode!==panel)panel.appendChild(d.el);
    d.el.style.display='';
    d.el.style.fontSize='34px';
    d.el.style.left='';d.el.style.top='';d.el.style.transform='';
    return;
  }
  if(d.el.parentNode!==DD.body)DD.body.appendChild(d.el);
  d.el.style.fontSize=F+'px';
  if(d.inBody&&d.body){
    var s=slot(d.body,d);
    place(d,s.x,s.y,d.body.th||0,1,true);
  }else if(d.state==='free'||d.state==='grab'){
    place(d,d.wx||0,d.wy||0,0,1,true);
  }
  // progressive fade while a free letter is being consumed by the black hole
  d.el.style.opacity=(d.fade!=null)?d.fade:'';
}
// Extent of an (asymmetric) E-box from its centre along the unit direction (ux,uy).
// e.g. u=(1,0) -> the +x edge (er.r); u=(0,-1) -> the TOP edge (er.t). Used so the arrow
// spread, the rotate knob and the resize bar all agree with the real per-edge geometry.
export function boxExtentAlong(ux,uy,er){
  if(Math.abs(ux)>=Math.abs(uy))return ux>=0?er.r:er.l;
  return uy>=0?er.b:er.t;
}
