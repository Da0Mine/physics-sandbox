/* 飘字公式（mc²、动量守恒等文字特效） */
import { DD, formulas } from '../core/dom.js';
import { clamp } from '../core/math.js';
import { pointer } from '../input/pointer.js';
import { metS } from '../letters/glyph.js';
import { F } from '../letters/merge.js';
import { W, groundY } from '../render/render.js';

export const SUB1='₁', SUB2='₂', PRIME='′';
export function mkFG(ch,size){
  var el=DD.createElement('div');
  el.className='char';
  el.style.fontSize=size+'px';
  el.style.pointerEvents='none';
  el.style.cursor='default';
  el.style.zIndex='8';
  el.textContent=ch;
  DD.body.appendChild(el);
  var m=metS(ch,size);
  el.style.display='none';
  // back-pointer so the black-hole panel-eating pass can find the letter that owns this .char
  var d={el:el,ch:ch,m:m,sx:0,sy:0,dead:false};
  el._letterRef=d;
  return d;
}
export function buildFormulaGlyphs(Fo,which){
  function tok(ch,sub){return {ch:ch,sub:sub?true:false};}
  var lhs,COM='共';
  var num,den;
  if(which===1){
    lhs=[tok('v'),tok(SUB1,true),tok(PRIME),tok('=')];
    num=[tok('('),tok('m'),tok(SUB1,true),tok('−'),tok('m'),tok(SUB2,true),tok(')'),tok('v'),tok(SUB1,true),tok('+'),tok('2'),tok('m'),tok(SUB2,true),tok('v'),tok(SUB2,true)];
    den=[tok('m'),tok(SUB1,true),tok('+'),tok('m'),tok(SUB2,true)];
  }else if(which===2){
    lhs=[tok('v'),tok(SUB2,true),tok(PRIME),tok('=')];
    num=[tok('('),tok('m'),tok(SUB2,true),tok('−'),tok('m'),tok(SUB1,true),tok(')'),tok('v'),tok(SUB2,true),tok('+'),tok('2'),tok('m'),tok(SUB1,true),tok('v'),tok(SUB1,true)];
    den=[tok('m'),tok(SUB2,true),tok('+'),tok('m'),tok(SUB1,true)];
  }else if(which===3){
    // v₁' = (m₁−m₂)/(m₁+m₂) · v₁
    lhs=[tok('v'),tok(SUB1,true),tok(PRIME),tok('=')];
    num=[tok('('),tok('m'),tok(SUB1,true),tok('−'),tok('m'),tok(SUB2,true),tok(')'),tok('v'),tok(SUB1,true)];
    den=[tok('m'),tok(SUB1,true),tok('+'),tok('m'),tok(SUB2,true)];
  }else if(which===4){
    // v₂' = 2m₁/(m₁+m₂) · v₁
    lhs=[tok('v'),tok(SUB2,true),tok(PRIME),tok('=')];
    num=[tok('2'),tok('m'),tok(SUB1,true),tok('v'),tok(SUB1,true)];
    den=[tok('m'),tok(SUB1,true),tok('+'),tok('m'),tok(SUB2,true)];
  }else{
    // v_共 = (m₁v₁+m₂v₂)/(m₁+m₂)   (common velocity, single formula)
    lhs=[tok('v'),tok(COM,true),tok('=')];
    num=[tok('m'),tok(SUB1,true),tok('v'),tok(SUB1,true),tok('+'),tok('m'),tok(SUB2,true),tok('v'),tok(SUB2,true)];
    den=[tok('m'),tok(SUB1,true),tok('+'),tok('m'),tok(SUB2,true)];
  }
  function sizeOf(t){return t.sub?F*0.62:F;}
  function run(tokens){
    var x=0,items=[];
    for(var i=0;i<tokens.length;i++){
      var t=tokens[i];
      var g=mkFG(t.ch,sizeOf(t));
      var w=g.m.w;
      items.push({g:g,x0:x,w:w,sub:t.sub});
      Fo.glyphs.push(g);
      x+=w+(i<tokens.length-1?3:0);
    }
    return {items:items,width:x};
  }
  var L=run(lhs),N=run(num),D=run(den);
  var fracW=Math.max(N.width,D.width)+14;
  var barGap=5;
  var nTop=1e9,nBot=-1e9;
  N.items.forEach(function(it){var s=it.sub?0.62:1;nTop=Math.min(nTop,it.g.m.top*s);nBot=Math.max(nBot,it.g.m.bot*s);});
  var nShift=-barGap-nBot;
  N.items.forEach(function(it){it.g.sx=(-N.width/2)+it.x0+it.w/2;it.g.sy=nShift;});
  var dTop=1e9,dBot=-1e9;
  D.items.forEach(function(it){var s=it.sub?0.62:1;dTop=Math.min(dTop,it.g.m.top*s);dBot=Math.max(dBot,it.g.m.bot*s);});
  var dShift=barGap-dTop;
  D.items.forEach(function(it){it.g.sx=(-D.width/2)+it.x0+it.w/2;it.g.sy=dShift;});
  var wholeTop=nTop+nShift, wholeBot=dBot+dShift;
  var cY=-(wholeTop+wholeBot)/2;
  N.items.forEach(function(it){it.g.sy+=cY;});
  D.items.forEach(function(it){it.g.sy+=cY;});
  var lhsX0=-(fracW/2)-8-L.width;
  L.items.forEach(function(it){it.g.sx=lhsX0+it.x0+it.w/2;it.g.sy=cY;});
  var totalL=lhsX0, totalR=fracW/2;
  var cX=-(totalL+totalR)/2;
  N.items.forEach(function(it){it.g.sx+=cX;});
  D.items.forEach(function(it){it.g.sx+=cX;});
  L.items.forEach(function(it){it.g.sx+=cX;});
  Fo.bar={x1:cX-fracW/2,y:cY,x2:cX+fracW/2};
  var extW=totalR-totalL,extH=wholeBot-wholeTop;
  Fo.sc=clamp(150/Math.max(extW,extH),0.55,1);
  Fo.hw=extW*Fo.sc/2;Fo.hh=extH*Fo.sc/2;
}
export function spawnFormula(which,x,y,bvx,bvy){
  var Fo={x:x,y:y,vx:bvx,vy:bvy,age:0,life:14,glyphs:[],alpha:1,dead:false,bar:null,sc:1,hw:60,hh:30,stoppedAt:null};
  buildFormulaGlyphs(Fo,which);
  var sc=Fo.sc||1;
  for(var i=0;i<Fo.glyphs.length;i++){
    var g=Fo.glyphs[i];
    g.el.style.display='';
    g.el.style.left=(x+g.sx*sc)+'px';
    g.el.style.top=(y+g.sy*sc)+'px';
    g.el.style.transform='translate(-50%,-50%) scale('+sc+')';
    g.el.style.transformOrigin='center';
    g.el.style.opacity='1';
  }
  formulas.push(Fo);
  return Fo;
}
export function spawnText(text,x,y,bvx,bvy){
  var Fo={x:x,y:y,vx:bvx,vy:bvy,age:0,life:14,glyphs:[],alpha:1,dead:false,bar:null,sc:1,hw:60,hh:30,stoppedAt:null};
  var g=mkFG(text,F*0.92);
  g.sx=0;g.sy=0;
  Fo.glyphs.push(g);
  var w=g.el.offsetWidth||120,h=g.el.offsetHeight||44;
  Fo.sc=clamp(150/Math.max(w,h),0.55,1);
  Fo.hw=w*Fo.sc/2;Fo.hh=h*Fo.sc/2;
  g.el.style.display='';
  g.el.style.left=x+'px';
  g.el.style.top=y+'px';
  g.el.style.transform='translate(-50%,-50%) scale('+Fo.sc+')';
  g.el.style.transformOrigin='center';
  g.el.style.opacity='1';
  formulas.push(Fo);
  return Fo;
}
export function stepFormulas(dt){
  for(var i=formulas.length-1;i>=0;i--){
    var F=formulas[i];
    F.age+=dt;
    if(F.hw&&pointer.x>F.x-F.hw&&pointer.x<F.x+F.hw&&pointer.y>F.y-F.hh&&pointer.y<F.y+F.hh){
      F.stoppedAt=null;
    }
    var damp=Math.pow(0.22,dt);
    F.vx*=damp;F.vy*=damp;
    F.x+=F.vx*dt;F.y+=F.vy*dt;
    var margin=22,e=0.9;
    if(F.x<margin){F.x=margin;if(F.vx<0)F.vx=-F.vx*e;}
    if(F.x>W-margin){F.x=W-margin;if(F.vx>0)F.vx=-F.vx*e;}
    if(F.y<margin){F.y=margin;if(F.vy<0)F.vy=-F.vy*e;}
    if(F.y>groundY-margin){F.y=groundY-margin;if(F.vy>0)F.vy=-F.vy*e;}
    var sp=Math.hypot(F.vx,F.vy);
    if(sp<26){ if(F.stoppedAt==null)F.stoppedAt=F.age; } else { F.stoppedAt=null; }
    var a=1;
    if(F.stoppedAt!=null){
      var idle=F.age-F.stoppedAt-3.0;
      if(idle>0){
        var blink=0.35+0.65*Math.abs(Math.sin(F.age*6));
        var fade=clamp(1-idle/2.0,0,1);
        a=blink*fade;
        if(idle>=2.0){ killFormula(F); formulas.splice(i,1); continue; }
      }
    }
    F.alpha=a;
    var sc=F.sc||1;
    for(var j=0;j<F.glyphs.length;j++){
      var g=F.glyphs[j];
      g.el.style.left=(F.x+g.sx*sc)+'px';
      g.el.style.top=(F.y+g.sy*sc)+'px';
      g.el.style.transform='translate(-50%,-50%) scale('+sc+')';
      g.el.style.opacity=a;
    }
    if(F.age>=F.life){
      killFormula(F);
      formulas.splice(i,1);
    }
  }
}
export function killFormula(F){
  for(var i=0;i<F.glyphs.length;i++){
    var g=F.glyphs[i];
    if(g.el&&g.el.parentNode)g.el.parentNode.removeChild(g.el);
  }
  F.glyphs=[];F.dead=true;
}
