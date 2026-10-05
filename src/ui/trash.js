/* 垃圾桶、清屏、删除 */
import Matter from 'matter-js';
import { app } from '../state.js';
import { killBody, killLetter } from '../bodies/body.js';
import { bossAbort } from '../boss/boss.js';
import { DD, bodies, formulas, freeL, panel, particles, trash } from '../core/dom.js';
import { overlap, segPointDist } from '../core/math.js';
import { springDisconnectAtPoint } from '../devices/spring.js';
import { resetTrashPos } from '../effects/blackhole.js';
import { killFormula } from '../effects/text.js';
import { SPR_GRAB, dblState, grab, trashDrag } from '../input/pointer.js';
import { GD } from '../letters/glyph.js';
import { fixPanelSlot, sortPanel } from '../letters/panel.js';
import { MW, removeMatterBody } from '../physics/matter.js';
import { uiTouch } from './touch.js';

export function inTrash(x,y){
  var r=trash.getBoundingClientRect();
  return x>r.left-10&&x<r.right+10&&y>r.top-10&&y<r.bottom+10;
}
export function inPanel(x,y){
  var r=panel.getBoundingClientRect();
  return x>r.left-12&&x<r.right+12&&y>r.top-12&&y<r.bottom+12;
}
export function clearAll(){
  /* 清屏必须把黑洞特效状态一并复位（粒子/终局态），否则粒子残留。 */
  try{
    if(particles&&particles.length)particles.length=0;
    app.BH_FINALE=null;
    /* 清屏会重新 dockLetter，布局回到默认 ⇒ 必须重跑 fixPanelSlot 重新施加面板排布。 */
    setTimeout(fixPanelSlot,0);
  }catch(e){}
  /* 清空必须连约束一起清：clearAll 不走 killBody，那里的约束清理跑不到，
   铰链的真 Constraint 会残留并累积。体都没了，直接清空世界的 constraints 列表。 */
  if(MW&&MW.engine&&MW.engine.world&&typeof Matter!=='undefined'&&Matter.Composite){
    var _cs2=Matter.Composite.allConstraints(MW.engine.world);
    for(var _cj=_cs2.length-1;_cj>=0;_cj--)Matter.Composite.remove(MW.engine.world,_cs2[_cj]);
  }
  // if the black-hole finale is mid-flight, drop its letters and put the bin back home
  if(app.BH_FINALE){
    for(var fz=0;fz<app.BH_FINALE.letters.length;fz++){
      var Lz=app.BH_FINALE.letters[fz];
      if(!Lz.arr){Lz.arr=true;if(Lz.el&&Lz.el.parentNode)Lz.el.parentNode.removeChild(Lz.el);}
    }
    app.BH_FINALE=null;
  }
  resetTrashPos();
  for(var i=bodies.length-1;i>=0;i--){
    var B=bodies[i];
    for(var j=0;j<B.glyphs.length;j++){
      var g=B.glyphs[j];
      if(g.body===B){g.body=null;g.inBody=false;killLetter(g);}
    }
    B.glyphs=[];B.mem=[];
    if(B.bh)B.bh.dead=true;
    removeMatterBody(B);
    bodies.splice(i,1);
  }
  if(MW)Matter.Composite.clear(MW.wLayer,false);   // W bodies & rod mirrors; static frame stays
  // 恢复面板单例：活着的回 dock；死掉的（被黑洞吞掉）从头重建，避免面板残缺。
  var kids=[app.mO,app.M2O,app.gO,app.aO,app.vO,app.rO,app.halfO,app.muO,app.cO,app.GO,app.tO,app.BO,app.EO,app.qO,app.IO,app.kO,app.xO];
  var names=['mO','M2O','gO','aO','vO','rO','halfO','muO','cO','GO','tO','BO','EO','qO','IO','kO','xO'];
  for(var i2=0;i2<kids.length;i2++){
    var d=kids[i2];
    var fi=freeL.indexOf(d);if(fi>=0)freeL.splice(fi,1);
    if(d.dead){
      var nd=GD(d.ch);
      switch(names[i2]){
        case 'mO':app.mO=nd;break;case 'M2O':app.M2O=nd;break;case 'gO':app.gO=nd;break;case 'aO':app.aO=nd;break;
        case 'vO':app.vO=nd;break;case 'rO':app.rO=nd;break;case 'halfO':app.halfO=nd;break;case 'muO':app.muO=nd;break;
        case 'cO':app.cO=nd;break;case 'GO':app.GO=nd;break;case 'tO':app.tO=nd;break;case 'BO':app.BO=nd;break;
        case 'EO':app.EO=nd;break;case 'qO':app.qO=nd;break;case 'IO':app.IO=nd;break;
        case 'kO':app.kO=nd;break;case 'xO':app.xO=nd;break;
      }
      d=nd;
    }
    if(d.body){d.body=null;}
    d.inBody=false;d.state='dock';d.pop=0;d.vx=0;d.vy=0;d.fade=null;d.bhShed=0;d.bhFade=null;
    if(d.el&&d.el.parentNode!==panel)panel.appendChild(d.el);
    if(d.el){d.el.style.display='';d.el.style.fontSize='34px';
             d.el.style.left='';d.el.style.top='';d.el.style.transform='';d.el.style.opacity='';}
  }
  for(var k=freeL.length-1;k>=0;k--){killLetter(freeL[k]);freeL.splice(k,1);}
  for(var f=formulas.length-1;f>=0;f--){killFormula(formulas[f]);formulas.splice(f,1);}
  panel.style.opacity='';   // un-fade the panel after panel-eating has punched it
  // 清掉 dock 异常遗留的重复克隆：面板只保留规范单例，每格一个。
  var canon=[app.mO,app.M2O,app.gO,app.aO,app.vO,app.rO,app.halfO,app.muO,app.cO,app.GO,app.tO,app.BO,app.EO,app.qO,app.IO,app.kO,app.xO];
  [].slice.call(panel.querySelectorAll('.char')).forEach(function(e){
    var keep=false;
    for(var ci=0;ci<canon.length;ci++)if(canon[ci].el===e){keep=true;break;}
    if(!keep&&e.parentNode===panel)panel.removeChild(e);
  });
  sortPanel();
  /* 清屏时一并收掉 boss。bossFinish 本身调用 clearAll()，所以要容忍 BOSS 已被置 null
   * （bossAbort 开头 if(!BOSS)return）；手动清屏时必须撤掉平台/遮罩/冻结的原型体。 */
  try{ bossAbort(); }catch(e){}
}
/* 触屏：dblclick 不可靠 ⇒ 用两次 tap（<450ms）触发清屏；
 * 单指按住拖动 = 拖垃圾桶（trashDrag 由 pointerdown 启动）。 */
export let trashTapT=0;
export function eraseUnderTrash(){
  var r=trash.getBoundingClientRect();
  var rcx=r.left+r.width/2, rcy=r.top+r.height/2;    // 弹簧/杆没有字形，要按线段判
  for(var i=freeL.length-1;i>=0;i--){
    var d=freeL[i];
    if(overlap(r,d.el.getBoundingClientRect()))killLetter(d);
  }
  for(var j=bodies.length-1;j>=0;j--){
    var B=bodies[j],hit=false;
    if(B.kind==='S'){
      // 弹簧没有字形（B.glyphs 为空），用线圈线段（带 SPR_GRAB 容差）+ 两端点做命中判定。
      hit=segPointDist(B.e0.x,B.e0.y,B.e1.x,B.e1.y,rcx,rcy)<SPR_GRAB
          ||overlap(r,{left:Math.min(B.e0.x,B.e1.x)-6,right:Math.max(B.e0.x,B.e1.x)+6,
                       top:Math.min(B.e0.y,B.e1.y)-6,bottom:Math.max(B.e0.y,B.e1.y)+6});
    }else if(B.kind==='T'){
      // 杆也没有字形，同理用它的线段
      var hl=(B.len||170)/2,cT=Math.cos(B.th||0),sT=Math.sin(B.th||0);
      var ax2=B.x-cT*hl,ay2=B.y-sT*hl,bx2=B.x+cT*hl,by2=B.y+sT*hl;
      hit=segPointDist(ax2,ay2,bx2,by2,rcx,rcy)<=8
          ||overlap(r,{left:Math.min(ax2,bx2)-6,right:Math.max(ax2,bx2)+6,
                       top:Math.min(ay2,by2)-6,bottom:Math.max(ay2,by2)+6});
    }else if(B.kind==='W'){
      // a boundary has no glyphs to overlap-test, so use its live bounding box
      hit=overlap(r,{left:B.x-B.hw,right:B.x+B.hw,top:B.y-B.hh,bottom:B.y+B.hh});
    }else{
      for(var k=0;k<B.glyphs.length;k++){
        if(B.glyphs[k].el&&overlap(r,B.glyphs[k].el.getBoundingClientRect())){hit=true;break;}
      }
    }
    if(hit)killBody(B);
  }
}

export function setupUiTrash(){
  trash.addEventListener('dblclick',function(e){e.preventDefault();clearAll();});
  /* 原生 dblclick 通道（捕获阶段）：双击锚定端/锚定点 ⇒ 断开该端锚定。
   * 不依赖 pointerdown 的 dblState 路径（手柄与其它分支会把它吃掉）。 */
  DD.addEventListener('dblclick',function(e){
    var x=e.clientX,y=e.clientY;
    if(springDisconnectAtPoint(x,y)){
      if(grab){grab.kind=null;grab.obj=null;}
      if(dblState){dblState.t=0;dblState.body=null;}
      e.preventDefault();e.stopPropagation();
    }
  },true);
  trash.addEventListener('pointerup',function(e){
    if(!uiTouch())return;
    var now=performance.now();
    if(now-trashTapT<450){e.preventDefault();clearAll();trashTapT=0;}
    else trashTapT=now;
  });
  trash.addEventListener('pointerdown',function(e){
    if(e.button!==0)return;
    e.preventDefault();e.stopPropagation();
    trashDrag.active=true;
    var r=trash.getBoundingClientRect();
    trash.style.right='auto';trash.style.bottom='auto';
    trash.style.left=r.left+'px';trash.style.top=r.top+'px';
    trash.classList.add('on');
  });
}
