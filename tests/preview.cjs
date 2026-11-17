const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const root=path.join(__dirname,'..'),server=http.createServer((req,res)=>{const name=req.url.split('?')[0],file=/^\/[a-z-]+\.(mjs|css)$/.test(name)?name.slice(1):'index.html';res.setHeader('Content-Type',file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':'text/html;charset=utf-8');let content=fs.readFileSync(path.join(root,file),'utf8');if(file==='studio-editor.mjs')content=content.replace('const draw=()=>renderer.render(scene,camera);', 'const draw=()=>{renderer.render(scene,camera);globalThis.__previewCapture?.(scene,camera);};').replace("renderer.setClearColor('#eef0eb');","if(globalThis.__failPreview)throw Error('simulated GPU setup failure');renderer.setClearColor('#eef0eb');");res.end(content);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',r=>r.request().url().includes('/three@')?r.continue():r.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/?debug`);
  await page.evaluate(async()=>{
   const T=await import('three');
   window.__previewCapture=function(scene,camera){const box=new T.Box3().setFromObject(scene),center=box.isEmpty()?new T.Vector3():box.getCenter(new T.Vector3()),corners=[];
    if(!box.isEmpty())for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(new T.Vector3(x,y,z).project(camera).toArray());
    window.preview={position:camera.position.toArray(),distance:camera.position.distanceTo(center),center:center.toArray(),corners,aspect:camera.aspect};
   };
   const {openEditor,rectangle}=await import('./studio-editor.mjs');
   openEditor({name:'3D regression',siteRings:[],items:[{id:'wide',type:'mass',name:'large offset model',points:rectangle(9000,9000,1600,400),floors:80,fh:10,base:100}],onSave:async()=>{}});
  });
  const dlg=page.locator('.design-editor');
  const stats=()=>page.evaluate(()=>window.preview);
  const fits=async()=>{const s=await stats();assert.equal(s.corners.length,8);for(const p of s.corners){assert.ok(p.every(Number.isFinite));assert.ok(Math.abs(p[0])<1.001&&Math.abs(p[1])<1.001&&p[2]>-1&&p[2]<1,JSON.stringify(s));}return s;};
  await dlg.locator('[data-do=view3d]').click();await page.waitForFunction(()=>document.querySelector('.de-status').textContent.includes('마우스·손가락'));await fits();
  const d0=(await stats()).distance;await dlg.locator('[data-do=in]').click();assert.ok((await stats()).distance<d0);await dlg.locator('[data-do=out]').click();assert.ok(Math.abs((await stats()).distance-d0)<.01);
  const orbitBefore=(await stats()).position;const canvas=dlg.locator('canvas'),box=await canvas.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2+80,{steps:5});await page.mouse.up();assert.notDeepEqual((await stats()).position,orbitBefore);
  const rotated=(await stats()).position;await dlg.locator('[data-do=iso3d]').click();assert.notDeepEqual((await stats()).position,rotated);await fits();
  await dlg.locator('[data-do=top3d]').click();let s=await fits();assert.ok(s.position[1]-s.center[1]>Math.abs(s.position[0]-s.center[0])*10);
  await dlg.locator('[data-do=front3d]').click();s=await fits();assert.ok(Math.abs(s.position[0]-s.center[0])<1e-6);
  await dlg.locator('[data-do=fit]').click();await fits();
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);await fits();
  await dlg.locator('[data-select-object]').selectOption('wide');await dlg.locator('[data-k=x]').fill('100');await dlg.locator('[data-do=apply]').click();await fits();
  await dlg.locator('[data-do=view3d]').click();assert.equal(await dlg.locator('.de-three').isVisible(),false);assert.equal(await dlg.locator('.de-plan').isVisible(),true);
  await dlg.locator('[data-do=view3d]').click();await page.waitForFunction(()=>document.querySelector('.de-status').textContent.includes('마우스·손가락'));await fits();
  if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'preview-fixed.png')});}
  assert.deepEqual(errors,[]);console.log('PASS: actual WebGL rendering, distant/large model frustum, desktop/mobile fit, zoom, orbit, orientation presets, model edits and repeated 2D/3D switching');
  // Simulate a renderer failure after modules loaded; the plan must remain usable.
  await dlg.locator('[data-do=view3d]').click();
  await page.evaluate(()=>{window.__failPreview=true;});
  await dlg.locator('[data-do=view3d]').click();await page.waitForFunction(()=>document.querySelector('.de-status').textContent.includes('3D를 불러오지'));
  assert.equal(await dlg.locator('.de-plan').isVisible(),true);assert.equal(await dlg.locator('.de-three').isVisible(),false);
  await dlg.locator('[data-do=fit]').click();console.log('PASS: failed GPU initialization restores the 2D editor');
  await page.evaluate(async()=>{document.querySelector('.design-editor').remove();window.__failPreview=false;const {openEditor}=await import('./studio-editor.mjs');openEditor({name:'empty model',siteRings:[],items:[],onSave:async()=>{}});});
  await dlg.locator('[data-do=view3d]').click();await page.waitForFunction(()=>document.querySelector('.de-status').textContent.includes('아직 3D 요소'));
  await fits();console.log('PASS: empty 3D model shows a framed reference grid and useful guidance');

 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
