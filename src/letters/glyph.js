/* 字形：度量、创建字形元素（GD），以及面板上 17 个符号的单例 */
import { app } from '../state.js';
import { ALL, bodies, freeG } from '../core/dom.js';
import { gdDown } from '../input/pointer.js';
import { F, HALF, MU, promoteFreeLetter } from './merge.js';
import { openMenu } from '../ui/menu.js';

export let ctx2d;
export const MT={};
export function met(ch,size){
  size=size||F;
  var key=ch+'@'+size;
  if(MT[key])return MT[key];
  ctx2d.font='italic '+size+'px Georgia,"Times New Roman",serif';
  var q=ctx2d.measureText(ch);
  var fba=q.fontBoundingBoxAscent||q.actualBoundingBoxAscent||60;
  var fbd=q.fontBoundingBoxDescent||q.actualBoundingBoxDescent||20;
  var ia=q.actualBoundingBoxAscent||0;
  var id=q.actualBoundingBoxDescent||0;
  var bl=(size-(fba+fbd))/2+fba;
  // il/ir: the INK's horizontal extent relative to the glyph's own centre (the element is
  // centred on the advance width q.width). The advance box carries side bearings, so its
  // edges are ~1px outside the ink — good enough for layout, but for collision it means a
  // contact would stop 1px early on each side. Fall back to ±w/2 when the ink metric is
  // missing or clearly bogus.
  var w2=q.width/2,aL=q.actualBoundingBoxLeft,aR=q.actualBoundingBoxRight;
  var il=(aL==null)?(-w2):(-aL-w2), ir=(aR==null)?w2:(aR-w2);
  if(!(il<ir)||il<-w2-8||ir>w2+8||ir-il<=0){il=-w2;ir=w2;}
  MT[key]={top:bl-ia-size/2,bot:bl+id-size/2,w:q.width,il:il,ir:ir};
  return MT[key];
}
export function isMass(d){var t=(typeof d==='string')?d:d.type;return t==='m'||t==='M';}
export function GD(ch,sc){
  sc=sc||1;
  var sz=F*sc;
  var el=document.createElement('div');
  el.className='char';
  el.style.fontSize=sz+'px';
  el.textContent=ch;
  document.body.appendChild(el);
  var d={el:el,ch:ch,type:ch,clone:false,body:null,sx:0,sy:0,w:el.offsetWidth,h:el.offsetHeight,wx:0,wy:0,vx:0,vy:0,anim:0,rung:false,pop:0,r:0,dead:false,m:met(ch,sz)};
  ALL.push(d);
  el._letterRef=d;   // 反向指针：吃进面板时据此从 .char 找回字母
  el.addEventListener('pointerdown',function(e){gdDown(e,d);});
  el.addEventListener('contextmenu',function(e){
    e.preventDefault();
    if(d.dead)return;
    var mb=d.body;
    if(mb&&mb.glyphs&&mb.glyphs.indexOf(d)>=0){openMenu(e.clientX,e.clientY,mb,d);return;}
    /* 赋予型字符（v/a/q/t）promote 后有宿主但不在 glyphs/mem 里，上面两个分支都不走；
     * 只要有宿主就照常弹菜单（参数面板读它自己的赋值字段），否则右键失灵。 */
    if(mb){openMenu(e.clientX,e.clientY,mb,d);return;}
    // a FREE (unmerged) letter has no body — promote it IN PLACE to a single-letter body so
    // right-clicking it (r, g, a, v, μ …) opens the param panel like any merged letter.
    if(!mb&&(d.state==='free'||d.state==='grab'||d.state==='idle')){
      var B=promoteFreeLetter(d);
      if(B)openMenu(e.clientX,e.clientY,B,d);
    }
    /* 面板（dock）里的字符右键也弹菜单：用 promoteFreeLetter 造一个临时参数宿主，
     * 立即从 bodies 摘掉（只作菜单/参数载体，不上场）。 */
    if(!mb&&d.state==='dock'){
      var B2=promoteFreeLetter(d);
      if(B2){
        var bi2=bodies.indexOf(B2);if(bi2>=0)bodies.splice(bi2,1);
        /* 临时宿主已从 bodies 摘除，必须把 d.body 清回 null：promoteFreeLetter 开头是 if(d.body)return d.body，
         * 不清的话下次右键会复用这个不在场上的孤儿宿主。openMenu 自己持有 B2 引用；state 仍为 'dock'，面板槽位不变。 */
        d.body=null;
        openMenu(e.clientX,e.clientY,B2,d);
      }
    }
  });
  return d;
}
export function killG(g){
  if(!g||g.dead)return;
  g.dead=true;
  if(g.el&&g.el.parentNode)g.el.parentNode.removeChild(g.el);
  if(g.body){var k=g.body.glyphs.indexOf(g);if(k>=0)g.body.glyphs.splice(k,1);}
  g.body=null;
}
export function stGD(ch,sc){
  var d=GD(ch,sc||1);
  d.stk=true;
  d.s=1;
  return d;
}
export function metS(ch,size){
  ctx2d.font='italic '+size+'px Georgia,"Times New Roman",serif';
  var q=ctx2d.measureText(ch);
  var fba=q.fontBoundingBoxAscent||size*0.8,fbd=q.fontBoundingBoxDescent||size*0.25;
  var ia=q.actualBoundingBoxAscent||0,id=q.actualBoundingBoxDescent||0;
  var bl=(size-(fba+fbd))/2+fba;
  return {top:bl-ia-size/2,bot:bl+id-size/2,w:q.width};
}

export function setupLettersGlyph(){
  ctx2d=document.createElement('canvas').getContext('2d');
  app.mO=GD('m');
  app.gO=GD('g');
  app.aO=GD('a');
  app.vO=GD('v');
  app.rO=GD('r');
  app.M2O=GD('M');
  app.halfO=GD(HALF);
  app.muO=GD(MU);
  app.cO=GD('c');
  app.GO=GD('G');
  app.tO=GD('t');
  app.BO=GD('B');
  app.qO=GD('q');
  app.IO=GD('I');
  app.EO=GD('E');
  app.kO=GD('k');
  app.xO=GD('x');
  app.gO.el.style.zIndex='5';
  app.aO.el.style.zIndex='5';
  app.vO.el.style.zIndex='5';
  app.rO.el.style.zIndex='5';
  app.M2O.el.style.zIndex='5';
  app.halfO.el.style.zIndex='5';
  app.muO.el.style.zIndex='5';
  app.cO.el.style.zIndex='5';
  app.GO.el.style.zIndex='5';
  app.tO.el.style.zIndex='5';
  app.BO.el.style.zIndex='5';
  app.qO.el.style.zIndex='5';
  app.IO.el.style.zIndex='5';
  app.EO.el.style.zIndex='5';
  app.kO.el.style.zIndex='5';
  app.xO.el.style.zIndex='5';
  freeG.push(app.gO,app.aO,app.vO,app.rO,app.M2O,app.halfO,app.muO,app.cO,app.GO,app.tO,app.BO,app.qO,app.IO,app.EO,app.kO,app.xO);
}
