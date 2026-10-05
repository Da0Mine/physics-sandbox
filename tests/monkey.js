/* Seeded random-action scenarios. Deterministic per seed; targets real ink pixels and visible UI. */
const W=1024,H=768,GY=Math.round(H*0.8);
function rng(seed){let s=seed>>>0;return ()=>{s=(s+0x6D2B79F5)>>>0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const CHARS=['m','M','g','a','v','r','½','μ','c','G','t','B','E','q','I','k','x'];
const SHAPES=['rect','circle','ring','tri','trough','tub','arc'];
const DEVICES=['spring','rod','belt','hinge','rope','ground'];
const ACTS=['fix','copy','param','dirlock','rodlock'];
async function inkPts(h){return h.eval(()=>{const cv=document.getElementById('cv');const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;const out=[];
  for(let y=60;y<cv.height-40;y+=5)for(let x=20;x<cv.width-20;x+=5){const i=(y*cv.width+x)*4;if(d[i+3]>140&&d[i]<120)out.push([x,y]);}return out;});}
async function freeChars(h){return h.eval(()=>[...document.querySelectorAll('.char')].filter(e=>!e.closest('.panel')&&e.offsetParent!==null).map(e=>{const r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];}).filter(p=>p[1]>40&&p[1]<730&&p[0]>10&&p[0]<1010));}
async function visible(h,sel){return h.eval(sel=>[...document.querySelectorAll(sel)].filter(e=>{const s=getComputedStyle(e);const r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0.05&&r.width>0;}).map(e=>{const r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];}),sel);}
async function tool(h,name){await h.tools();await h.clickEl(`.tbtn[data-tool="${name}"]`);}
async function closeTools(h){await h.eval(()=>{if(document.getElementById('trow').classList.contains('on'))document.getElementById('ttoggle').click();});await h.step(1);}
async function escapeUI(h){await h.eval(()=>{for(const id of ['pclose','fmclose','sclose','bugclose']){const e=document.getElementById(id);if(e&&e.offsetParent!==null)e.click();}});await h.step(1);}
function make(seed,n=70){return async function(h){
  const R=rng(seed),pick=a=>a[Math.floor(R()*a.length)],rx=()=>60+R()*(W-160),ry=()=>90+R()*(GY-140);
  await h.step(10);
  for(let k=0;k<n;k++){
    const r=R();
    try{
    if(r<0.13){await closeTools(h);await h.dragChar(pick(CHARS),rx(),ry());}
    else if(r<0.25){const s=pick(SHAPES);await tool(h,'shape');await h.clickEl(`#tsub .tbtn[data-shape="${s}"]`);const x=rx(),y=ry()*0.7;await h.drag(x,y,x+30+R()*110,y+30+R()*90,8);await closeTools(h);}
    else if(r<0.34){const d=pick(DEVICES);let pt=[rx(),ry()];if(d==='hinge'){const ink=await inkPts(h);if(ink.length)pt=pick(ink);}await tool(h,'device');await h.clickEl(`#dsub .tbtn[data-device="${d}"]`);await h.click(pt[0],pt[1]);await closeTools(h);}
    else if(r<0.52){const ink=await inkPts(h);if(ink.length){const a=pick(ink);let b=R()<0.45&&ink.length?pick(ink):[rx(),ry()];await h.drag(a[0],a[1],b[0],b[1],6+Math.floor(R()*8));}}
    else if(r<0.62){const ink=await inkPts(h);if(ink.length){const a=pick(ink);await h.click(a[0],a[1],'right');await h.step(2);const act=pick(ACTS);
        const ok=await h.eval(a=>{const m=document.getElementById('menu');const it=m.querySelector(`.menu-item[data-act="${a}"]`);return getComputedStyle(m).display!=='none'&&it&&!it.classList.contains('hide');},act);
        if(ok){await h.clickEl(`#menu .menu-item[data-act="${act}"]`);await h.step(2);
          if(act==='param'){const n=await h.eval(()=>document.querySelectorAll('#pbox input[type=number]').length);for(let j=0;j<Math.min(n,3);j++){const ix=Math.floor(R()*n),val=(R()*4).toFixed(2);await h.eval((ix,val)=>{const e=document.querySelectorAll('#pbox input[type=number]')[ix];if(!e)return;e.focus();e.value=val;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.blur();},ix,val);await h.step(3);}
            const sl=await h.eval(()=>document.querySelectorAll('#pbox input[type=range]').length);if(sl){const ix=Math.floor(R()*sl),f=R();await h.eval((ix,f)=>{const e=document.querySelectorAll('#pbox input[type=range]')[ix];e.value=String(+e.min+(+e.max-+e.min)*f);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},ix,f);await h.step(3);}
            const dd=await visible(h,'#pbox .pdd,#pbox button:not(.pclose)');if(dd.length){const p=pick(dd);await h.click(p[0],p[1]);await h.step(3);}
            await h.step(20);await escapeUI(h);}}
        else await escapeUI(h);}}
    else if(r<0.72){const fc=await freeChars(h);if(fc.length){const a=pick(fc);const ink=await inkPts(h);const tgt=R()<0.5&&fc.length>1?pick(fc):(ink.length&&R()<0.7?pick(ink):[rx(),ry()]);await h.drag(a[0],a[1],tgt[0]+(R()-0.5)*30,tgt[1],8);}}
    else if(r<0.78){const hs=await visible(h,'#handle,.arknob,.rodlen,#fresize');if(hs.length){const a=pick(hs);await h.drag(a[0],a[1],a[0]+(R()-0.5)*160,a[1]+(R()-0.5)*160,8);}else{const ink=await inkPts(h);if(ink.length){const a=pick(ink);await h.page.mouse.move(a[0],a[1]);await h.step(3);const hs2=await visible(h,'#handle,.arknob,.rodlen,#fresize');if(hs2.length){const b=pick(hs2);await h.drag(b[0],b[1],b[0]+(R()-0.5)*160,b[1]+(R()-0.5)*160,8);}}}}
    else if(r<0.83){const all=(await inkPts(h)).concat(await freeChars(h));if(all.length){const a=pick(all);await h.dblclick(a[0],a[1]);}}
    else if(r<0.87){await tool(h,'formula');await h.step(2);await h.clickEl(`.fmitem[data-ix="${Math.floor(R()*10)}"]`);await closeTools(h);const p=[W/2,H/2];await h.drag(p[0],p[1],rx(),ry(),8);}
    else if(r<0.90){const ink=await inkPts(h);if(ink.length){const a=pick(ink);const t=await h.center('#trash');await h.drag(a[0],a[1],t.x,t.y,10);}}
    else if(r<0.92){await tool(h,'settings');await h.step(1);await h.clickEl(`.sbtn[data-mode="${R()<0.5?'high':'uni'}"]`);await escapeUI(h);await closeTools(h);}
    else if(r<0.94){await tool(h,'brush');const x=rx(),y=ry()*0.7;await h.down(x,y);for(let i=1;i<8;i++)await h.move(x+i*12,y+(R()-0.5)*30,1);await h.up();await closeTools(h);}
    }catch(e){ if(!/no element|no free char/.test(e.message))throw e; }
    await h.step(5+Math.floor(R()*50));
  }
  await h.step(120);
};}
module.exports={make};
