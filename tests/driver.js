/* 回归测试驱动：起一个注入 prelude.js 的静态服务器，用无界面 Chrome 运行场景并采样。 */
const http=require('http'),fs=require('fs'),path=require('path'),puppeteer=require('puppeteer-core');
// Chrome 路径：优先环境变量 CHROME_PATH，否则按平台取默认安装位置
const CHROME=process.env.CHROME_PATH||({darwin:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32:'C:/Program Files/Google/Chrome/Application/chrome.exe',linux:'/usr/bin/google-chrome'})[process.platform];
const PRELUDE=fs.readFileSync(path.join(__dirname,'prelude.js'),'utf8');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
function serve(root){return new Promise(res=>{const srv=http.createServer((req,resp)=>{
  let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/favicon.ico'){resp.writeHead(204);return resp.end();}
  if(p==='/__prelude.js'){resp.writeHead(200,{'content-type':MIME['.js']});return resp.end(PRELUDE);}
  if(p.endsWith('/'))p+='index.html'; const f=path.join(root,p);
  if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){resp.writeHead(404);return resp.end();}
  let body=fs.readFileSync(f); const ext=path.extname(f);
  if(ext==='.html')body=Buffer.from(body.toString('utf8').replace(/<head([^>]*)>/i,m=>m+'<script src="/__prelude.js"></script>'));
  resp.writeHead(200,{'content-type':MIME[ext]||'application/octet-stream','cache-control':'no-store'});resp.end(body);});
  srv.listen(0,'127.0.0.1',()=>res(srv));});}

async function runScenario(browser,url,scen,opts={}){
  const page=await browser.newPage(); await page.setViewport({width:1024,height:768,deviceScaleFactor:1});
  const errors=[]; page.on('pageerror',e=>errors.push('pageerror: '+e.message)); page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
  await page.setRequestInterception(true); page.on('request',r=>{const u=r.url(); if(u.startsWith(url.replace(/\/[^/]*$/,''))||u.startsWith('data:'))r.continue(); else {errors.push('blocked external request: '+u);r.abort();}});
  if(opts.coverage)await page.coverage.startJSCoverage({resetOnNavigation:false,reportAnonymousScripts:false,includeRawScriptCoverage:true});
  await page.goto(url,{waitUntil:'load'});
  const samples=[]; const EVERY=opts.every||5;
  const h={
    page,
    async step(n){const s=await page.evaluate((n,e)=>__H.step(n,e),n,EVERY);samples.push(...s);},
    async sample(tag){samples.push((tag?tag+'=':'')+await page.evaluate(()=>__H.sample()));},
    async center(sel,text){return page.evaluate((sel,text)=>{const els=[...document.querySelectorAll(sel)].filter(e=>text==null||e.textContent.trim()===text);
      const e=els[0]; if(!e)throw new Error('no element '+sel+' '+(text||''));const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};},sel,text);},
    async move(x,y,steps=1,framesPer=1){const m=page.mouse;const from=h._p||{x,y};for(let i=1;i<=steps;i++){await m.move(from.x+(x-from.x)*i/steps,from.y+(y-from.y)*i/steps);if(framesPer)await h.step(framesPer);}h._p={x,y};},
    async down(x,y,button='left'){await page.mouse.move(x,y);h._p={x,y};await page.mouse.down({button});await h.step(1);},
    async up(button='left'){await page.mouse.up({button});await h.step(1);},
    async drag(x1,y1,x2,y2,steps=12,button='left'){await h.down(x1,y1,button);await h.move(x2,y2,steps);await h.up(button);},
    async click(x,y,button='left'){await h.down(x,y,button);await h.up(button);},
    async dblclick(x,y){await page.mouse.click(x,y,{clickCount:1});await page.mouse.click(x,y,{clickCount:2});h._p={x,y};await h.step(1);},
    async clickEl(sel,text){const c=await h.center(sel,text);await h.click(c.x,c.y);},
    async dragChar(ch,x,y){const c=await h.center('.panel .char',ch);await h.drag(c.x,c.y,x,y,14);},
    async tools(){const open=await page.evaluate(()=>document.getElementById('tools').classList.contains('open')||!!document.querySelector('#trow.on'));if(!open)await h.clickEl('#ttoggle');},
    async eval(fn,...a){return page.evaluate(fn,...a);},
  };
  let fail=null;
  try{await scen(h);}catch(e){fail=e.stack||String(e);}
  let cov=null; if(opts.coverage)cov=await page.coverage.stopJSCoverage();
  const dom=opts.keepDom?await page.evaluate(()=>__H.dom()):null;
  await page.close();
  return {samples,errors,fail,cov,dom};
}
async function withBrowser(fn){const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--disable-gpu','--force-color-profile=srgb','--font-render-hinting=none','--disable-lcd-text']});try{return await fn(b);}finally{await b.close();}}
module.exports={serve,runScenario,withBrowser};
