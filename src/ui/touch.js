/* 电脑 / 触屏交互模式与触屏点选、长按 */
import Matter from 'matter-js';
import { app } from '../state.js';
import { DD, bodies, freeL } from '../core/dom.js';
import { segPointDist } from '../core/math.js';
import { distToHost } from '../devices/anchor.js';
import { SPR_GRAB, grab, pointer } from '../input/pointer.js';
import { promoteFreeLetter } from '../letters/merge.js';
import { alignPanelToggle, fixPanelSlot } from '../letters/panel.js';
import { hoverB } from '../render/render.js';
import { openMenu } from './menu.js';

/* 设备模式：'auto'（自动识别）/ 'desktop'（电脑版）/ 'touch'（触屏版），设置里可强制切换，存 localStorage。
 * 触屏版交互：
 *  · 拖动（pointermove）保留；
 *  · 点选放置：点一下选中（高亮），再点另一处 ⇒ 把选中体搬到该处（补偿手指粗、精细拖拽难）；
 *  · 长按 = 右键（450ms 未移动 ⇒ 弹菜单）。 */
export let UI_MODE='auto';
export function isTouchDevice(){
  return (('ontouchstart' in window)||(navigator.maxTouchPoints>0)||(navigator.msMaxTouchPoints>0));
}
export function uiTouch(){return UI_MODE==='touch'||(UI_MODE==='auto'&&isTouchDevice());}
export function setUIMode(m){
  UI_MODE=m;try{localStorage.setItem('sandbox_ui_mode',m);}catch(e){}
  /* 触屏模式的 body 级样式（显示面板收起把手） */
  if(uiTouch()){DD.body.classList.add('touch-ui');DD.body.classList.add('touch-panel-folded');}
  else{DD.body.classList.remove('touch-ui');DD.body.classList.remove('touch-panel-folded');}
}
/* 初始化时按当前模式挂 body 类（面板把手/折叠） */
export function applyUIModeClasses(){
  if(uiTouch()){DD.body.classList.add('touch-ui');DD.body.classList.add('touch-panel-folded');}
  else{DD.body.classList.remove('touch-ui');DD.body.classList.remove('touch-panel-folded');}
  fixPanelSlot();
  alignPanelToggle();
}
export function touchClearSel(){
  if(app.TOUCH_SEL&&!app.TOUCH_SEL.dead&&app.TOUCH_SEL.el)app.TOUCH_SEL.el.classList&&app.TOUCH_SEL.el.classList.remove('touch-sel');
  app.TOUCH_SEL=null;
}
export function touchMoveSelTo(x,y){
  if(!app.TOUCH_SEL||app.TOUCH_SEL.dead||!app.TOUCH_SEL.mb)return;
  Matter.Body.setPosition(app.TOUCH_SEL.mb,{x:x,y:y});
  Matter.Body.setVelocity(app.TOUCH_SEL.mb,{x:0,y:0});
  app.TOUCH_SEL.x=x;app.TOUCH_SEL.y=y;
  if(app.TOUCH_SEL.mb)Matter.Sleeping.set(app.TOUCH_SEL.mb,false);
  touchClearSel();
}
/* 「触摸长按 = 右键菜单」的动作体，画布与字符两条入口共用：手指压在小字形上时 .char 自己吃掉
 * pointerdown，只挂在 cv 上的话长按无反应。两条入口共用计时器 TOUCH_LP，
 * 因此 pointermove / pointerup 里的 clearTimeout(TOUCH_LP) 对两者都有效。 */
export function touchLongPressStart(cand){
  if(app.TOUCH_LP)clearTimeout(app.TOUCH_LP);
  app.TOUCH_LP=setTimeout(function(){touchLongPressFire(cand);},450);
}
export function touchLongPressFire(cand){
  app.TOUCH_LP=null;
  if(grab&&grab.kind){grab.kind=null;grab.obj=null;}
  /* 触摸端没有 hover ⇒ hoverB 恒空，必须按按下坐标主动扫墨线命中，否则长按菜单不会弹出。 */
  /* 长按自由字符也要弹菜单（不只扫 bodies）。 */
  /* 按下就命中的那个字符直接当候选，不能只靠「按下坐标 ±26px 扫描」：自由字符有速度，
   * 450ms 长按期间可能飞出扫描半径，导致字符刚动过时长按永远不弹菜单。 */
  var _fl=null;
  if(cand&&cand.ch&&!cand.dead&&freeL.indexOf(cand)>=0)_fl=cand;
  if(!_fl)for(var _fi=0;_fi<freeL.length;_fi++){
    var _L=freeL[_fi];
    if(!_L||_L.dead)continue;
    if(Math.hypot((_L.wx||0)-pointer.x,(_L.wy||0)-pointer.y)<26){_fl=_L;break;}
  }
  if(_fl){
    var _fb=_fl.body||promoteFreeLetter(_fl);
    if(_fb){openMenu(pointer.x,pointer.y,_fb,_fl);if(grab){grab.kind=null;grab.obj=null;}return;}
  }
  var _mb=hoverB||((cand&&!cand.ch&&!cand.dead)?cand:null)||null;
  if(!_mb){
    for(var _mi=0;_mi<bodies.length;_mi++){
      var _B2=bodies[_mi];
      /* 触摸放宽：手指粗 ⇒ 用「距表面 <15px」，不用严格的墨线命中（差 2px 就漏） */
      if(_B2&&!_B2.dead&&_B2.kind==='W'&&distToHost(_B2,pointer.x,pointer.y)<15){_mb=_B2;break;}
    }
    if(!_mb){
      for(_mi=0;_mi<bodies.length;_mi++){
        _B2=bodies[_mi];
        if(_B2&&!_B2.dead&&_B2.kind==='S'&&segPointDist(_B2.e0.x,_B2.e0.y,_B2.e1.x,_B2.e1.y,pointer.x,pointer.y)<SPR_GRAB){_mb=_B2;break;}
      }
    }
  }
  if(_mb&&!_mb.dead){openMenu(pointer.x,pointer.y,_mb,null);}
}

export function setupUiTouch1(){
  try{var _um=localStorage.getItem('sandbox_ui_mode');if(_um==='desktop'||_um==='touch')UI_MODE=_um;}catch(e){}
}

export function setupUiTouch2(){
  applyUIModeClasses();
}
