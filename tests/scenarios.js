/* 回归场景：每个场景都在全新页面上运行，按固定间隔采样「画布像素 + DOM」的指纹。
 * 坐标都写死：运行是确定性的（见 prelude.js），同一版本每次得到完全相同的画面。 */
const W=1024,H=768,GY=Math.round(H*0.8);
async function tool(h,name){await h.tools();await h.clickEl(`.tbtn[data-tool="${name}"]`);}
async function shape(h,s,x1,y1,x2,y2){await tool(h,'shape');await h.clickEl(`#tsub .tbtn[data-shape="${s}"]`);await h.drag(x1,y1,x2,y2,10);await h.step(2);}
async function device(h,d,x,y){await tool(h,'device');await h.clickEl(`#dsub .tbtn[data-device="${d}"]`);await h.click(x,y);await h.step(2);}
async function formula(h,ix){await tool(h,'formula');await h.step(2);await h.clickEl(`.fmitem[data-ix="${ix}"]`);await h.step(2);}
async function closeTools(h){await h.eval(()=>{const t=document.getElementById('ttoggle');if(document.getElementById('trow').classList.contains('on'))t.click();});await h.step(1);}
async function freeChar(h,ch,nth=0){return h.eval((ch,nth)=>{const e=[...document.querySelectorAll('.char')].filter(x=>x.textContent===ch&&!x.closest('.panel'))[nth];if(!e)throw new Error('no free char '+ch);const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};},ch,nth);}
async function menu(h,x,y,act){await h.click(x,y,'right');await h.step(2);const vis=await h.eval(a=>{const m=document.querySelector(`#menu .menu-item[data-act="${a}"]`);return m&&!m.classList.contains('hide')&&getComputedStyle(document.getElementById('menu')).display!=='none';},act);if(vis)await h.clickEl(`#menu .menu-item[data-act="${act}"]`);else await h.eval(()=>document.body.click());await h.step(2);}
async function settings(h){await tool(h,'settings');await h.step(2);}
async function closeSettings(h){await h.clickEl('#sclose');await h.step(1);}

const {make}=require('./monkey');
module.exports={
  monkey1:make(1),monkey2:make(2),monkey3:make(3),monkey4:make(4),monkey5:make(5),monkey6:make(6),

  async combos(h){
    await h.step(10);
    await h.dragChar('g',300,250);await h.step(5);let g=await freeChar(h,'g');await h.dragChar('t',g.x+26,g.y);await h.step(60);
    await h.dragChar('k',600,250);await h.step(5);let k=await freeChar(h,'k');await h.dragChar('x',k.x+26,k.y);await h.step(120);
    await h.dragChar('G',200,200);await h.step(5);let G=await freeChar(h,'G');await h.dragChar('M',G.x+26,G.y);await h.step(60);
    let gt=await freeChar(h,'t');await h.dblclick(gt.x,gt.y);await h.step(60);
    let x=await freeChar(h,'x');await h.drag(x.x,x.y,x.x+80,x.y-120,10);await h.step(120);
  },
  async hinge(h){
    await h.step(10);
    await shape(h,'rect',300,450,420,520);await shape(h,'rect',430,450,550,520);await closeTools(h);await h.step(90);
    const yTop=await h.eval(()=>{const cv=document.getElementById('cv'),d=cv.getContext('2d').getImageData(360,0,1,cv.height).data;for(let y=100;y<cv.height;y++)if(d[y*4+3]>140&&d[y*4]<120)return y;return 0;});
    await device(h,'hinge',360,yTop);await closeTools(h);await h.step(5);
    await h.drag(360,yTop,490,yTop,10);await h.step(60);
    await device(h,'rope',360,250);await closeTools(h);await h.drag(305,250,360,yTop,10);await h.step(30);await h.drag(415,250,490,yTop,10);await h.step(120);
    await h.drag(480,yTop,560,yTop-150,12);await h.step(150);
    await device(h,'spring',700,300);await closeTools(h);await h.step(5);
    await shape(h,'circle',740,350,800,410);await closeTools(h);await h.step(60);
    const cy=await h.eval(()=>{const cv=document.getElementById('cv'),d=cv.getContext('2d').getImageData(770,0,1,cv.height).data;for(let y=330;y<cv.height;y++)if(d[y*4+3]>140&&d[y*4]<120)return y;return 0;});
    await h.drag(755,300,770,cy,10);await h.step(30);
    await menu(h,770,cy,'copy');await h.step(90);
    await menu(h,770,cy,'param');await h.step(5);
    await h.eval(()=>{for(const e of document.querySelectorAll('#pbox input[type=number]')){e.value='1';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}});await h.step(5);
    await h.eval(()=>{const e=document.getElementById('pclose');e&&e.click();});await h.step(200);
  },
  async deviceOut(h){
    await h.step(10);await tool(h,'device');
    for(const [d,x,y] of [['spring',300,300],['rod',500,300],['rope',700,250],['ground',500,450]]){const c=await h.center(`#dsub .tbtn[data-device="${d}"]`);await h.drag(c.x,c.y,x,y,16);await h.step(20);}
    await closeTools(h);await h.step(150);
  },
  async touchLong(h){
    await h.step(10);await settings(h);await h.clickEl('.ubtn[data-ui="touch"]');await closeSettings(h);await h.step(5);
    await shape(h,'rect',400,300,500,380);await closeTools(h);await h.step(90);
    await h.page.touchscreen.touchStart(450,GY-80);for(let i=0;i<50;i++)await h.step(1);await h.page.touchscreen.touchEnd();await h.step(20);
    const pt=await h.center('#panelToggle');await h.page.touchscreen.tap(pt.x,pt.y);await h.step(10);
    const c=await h.center('.panel .char','g');await h.page.touchscreen.tap(c.x,c.y);await h.step(3);
    await h.page.touchscreen.touchStart(300,200);await h.step(2);for(let i=1;i<=6;i++){await h.page.touchscreen.touchMove(300+i*20,200+i*10);await h.step(1);}await h.page.touchscreen.touchEnd();await h.step(60);
  },
  async letters(h){
    await h.step(20);
    await h.dragChar('m',300,250);await h.dragChar('g',420,250);await h.step(10);
    let g=await freeChar(h,'g'),m=await freeChar(h,'m');await h.drag(g.x,g.y,m.x+28,m.y,10);await h.step(60);
    await h.dragChar('M',600,200);await h.dragChar('v',700,200);await h.step(5);
    let v=await freeChar(h,'v'),M=await freeChar(h,'M');await h.drag(v.x,v.y,M.x+30,M.y,10);await h.step(40);
    const L=['a','r','½','μ','c','G','t','I','k','x'];for(let i=0;i<L.length;i++)await h.dragChar(L[i],120+i*48,260+(i%3)*80);   // 留在符号面板左侧，免得被收回面板
    await h.step(30);
    let k=await freeChar(h,'k'),x=await freeChar(h,'x');await h.drag(x.x,x.y,k.x+26,k.y,10);await h.step(60);
    let a=await freeChar(h,'a');m=await freeChar(h,'m');await h.drag(a.x,a.y,m.x+40,m.y,10);await h.step(90);
    let t=await freeChar(h,'t');await h.dblclick(t.x,t.y);await h.step(30);
  },
  async shapes(h){
    await h.step(10);
    const S=['rect','circle','ring','tri','trough','tub','arc'];
    for(let i=0;i<S.length;i++){const x=110+i*125;await shape(h,S[i],x,140+(i%2)*60,x+80,200+(i%2)*60);}
    await closeTools(h);await h.step(120);
    await tool(h,'brush');await h.down(300,120);for(let i=0;i<12;i++)await h.move(300+i*15,120+Math.sin(i/2)*20,1);await h.up();await h.step(80);
    await closeTools(h);
    await h.drag(150,GY-30,500,300,14);await h.step(60);   // drag a body
    await h.dblclick(400,GY-40);await h.step(30);
    await h.drag(700,GY-30,720,GY-200,8);await h.step(120);
  },
  async devices(h){
    await h.step(10);
    await shape(h,'rect',200,300,280,360);await shape(h,'rect',420,300,500,360);await shape(h,'circle',650,200,710,260);
    await closeTools(h);await h.step(60);
    for(const [d,x,y] of [['spring',340,250],['rod',560,200],['belt',300,500],['hinge',760,300],['rope',150,200],['ground',600,520]]){await device(h,d,x,y);await h.step(30);}
    await closeTools(h);await h.step(180);
    await h.drag(240,GY-30,330,200,12);await h.step(120);
    await h.drag(560,200,600,150,8);await h.step(120);
  },
  async menus(h){
    await h.step(10);
    await shape(h,'rect',300,200,400,280);await shape(h,'circle',600,200,680,280);await closeTools(h);await h.step(90);
    await menu(h,350,GY-40,'fix');await h.step(20);
    await menu(h,640,GY-40,'copy');await h.step(60);
    await menu(h,640,GY-40,'param');await h.step(10);
    const n=await h.eval(()=>document.querySelectorAll('#prows input[type=number]').length);
    for(let i=0;i<Math.min(n,6);i++){await h.eval(i=>{const e=document.querySelectorAll('#prows input[type=number]')[i];e.focus();e.value=String((+e.value||1)*1.5);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},i);await h.step(10);}
    await h.eval(()=>{const s=document.querySelector('#pbox select,#pbox .pdd');if(s)s.click();});await h.step(10);
    await h.step(90);
    await h.clickEl('#pclose');await h.step(10);
    await h.dragChar('μ',640,GY-60);await h.step(60);
    await h.dragChar('a',350,GY-60);await h.step(60);
  },
  async formulas(h){
    await h.step(10);
    for(const ix of [0,1,2,3,4,6,9]){await formula(h,ix);const p={x:W/2,y:H/2};await h.drag(p.x,p.y,120+ix*90,180,10);await h.step(40);}
    await h.step(200);
  },
  async explosion(h){
    await h.step(10);await shape(h,'rect',380,200,460,260);await shape(h,'circle',560,200,620,260);await closeTools(h);await h.step(30);
    await formula(h,8);await h.step(600);
  },
  async blackhole(h){
    await h.step(10);await shape(h,'rect',200,200,280,260);await shape(h,'circle',760,200,820,260);await closeTools(h);
    await h.dragChar('m',300,150);await h.dragChar('g',700,150);await h.step(30);
    await formula(h,7);await h.step(900);
    await h.dragChar('q',512,300);await h.step(600);
  },
  async fields(h){
    await h.step(10);
    await h.dragChar('E',300,300);await h.dragChar('B',700,300);await h.step(30);
    await h.dragChar('q',250,200);await h.dragChar('q',650,200);await h.step(200);
    await shape(h,'circle',280,150,330,200);await closeTools(h);await h.step(30);
    await h.dragChar('q',305,GY-60);await h.step(200);
    await h.dragChar('G',500,250);await h.dragChar('m',560,250);await h.step(200);
  },
  async boss(h){
    await h.step(10);
    const v=await h.center('.panel .char','v');await h.click(v.x,v.y,'right');await h.step(2);
    await h.clickEl('#menu .menu-item[data-act="param"]');await h.step(5);
    await h.eval(()=>{const e=document.querySelector('#prows input[type=number]');e&&e.focus();});await h.page.keyboard.press('c');await h.step(5);
    await h.clickEl('#pclose');await h.step(5);
    await formula(h,5);await h.step(30);
    for(let i=0;i<3;i++){const c=await h.center('.panel .char','v');await h.drag(c.x,c.y,W/2,H/2,14);await h.step(120);}
    await h.step(1500);
  },
  async trash(h){
    await h.step(10);await shape(h,'rect',300,200,380,260);await shape(h,'circle',500,200,560,260);await closeTools(h);await h.step(60);
    await h.dragChar('m',600,300);await h.step(10);
    const t=await h.center('#trash');await h.drag(340,GY-30,t.x,t.y,14);await h.step(60);
    await h.dblclick(t.x,t.y);await h.step(120);
    await h.dragChar('g',400,300);await h.dblclick(700,300);await h.step(60);
  },
  async settingsHigh(h){
    await h.step(10);await settings(h);await h.clickEl('.sbtn[data-mode="high"]');await h.step(5);
    await h.eval(()=>{const q=document.getElementById('qphys');q&&q.dispatchEvent(new MouseEvent('mouseenter'));});await h.step(5);
    await closeSettings(h);
    await shape(h,'circle',300,150,360,210);await shape(h,'rect',500,150,600,230);await shape(h,'trough',650,300,850,450);await closeTools(h);
    await device(h,'spring',420,300);await closeTools(h);
    await h.step(300);
    await h.dragChar('a',330,GY-60);await h.step(200);
    await settings(h);await h.clickEl('.sbtn[data-mode="uni"]');await closeSettings(h);await h.step(120);
  },
  async touch(h){
    await h.step(10);await settings(h);await h.clickEl('.ubtn[data-ui="touch"]');await closeSettings(h);await h.step(10);
    const pt=await h.center('#panelToggle');await h.click(pt.x,pt.y);await h.step(10);
    const c=await h.center('.panel .char','m');await h.page.touchscreen.tap(c.x,c.y);await h.step(5);await h.page.touchscreen.tap(400,300);await h.step(30);
    await shape(h,'rect',500,200,600,280);await closeTools(h);await h.step(60);
    await h.page.touchscreen.touchStart(550,GY-30);await h.step(1);for(let i=1;i<=8;i++){await h.page.touchscreen.touchMove(550+i*10,GY-30-i*15);await h.step(1);}await h.page.touchscreen.touchEnd();await h.step(90);
    await settings(h);await h.clickEl('.ubtn[data-ui="auto"]');await closeSettings(h);await h.step(10);
  },
  async record(h){
    await h.step(10);await settings(h);await h.clickEl('#recbtn');await closeSettings(h);
    await shape(h,'rect',300,200,380,260);await closeTools(h);await h.dragChar('m',600,300);await h.step(120);
    await settings(h);await h.clickEl('#recbtn');await h.step(10);
    await h.eval(()=>{const d=document.getElementById('bugdesc');if(d)d.value='harness';});
    await h.clickEl('#bugclose');await h.step(10);
    await tool(h,'fullscreen');await h.step(10);
  },
};
