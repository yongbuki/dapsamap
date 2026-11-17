const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const g=await import('../cad-tools.mjs');
 assert.deepEqual(g.snapPoint([3.02,2.03],{step:.1,anchor:[0,0],ortho:true}),[3,0]);
 assert.deepEqual(g.snapPoint([1.02,1.01],{vertices:[[1,1]]}),[1,1]);
 assert.throws(()=>g.checkPolygon([[0,0],[4,4],[0,4],[4,0]]));
 const wall={id:'w',type:'wall',name:'=test',points:g.wallFromAxis([0,0],[6,0],.2),floors:1,fh:3,base:0,openings:[{width:1,height:2}]};
 assert.ok(Math.abs(g.quantities([wall])[0].volume-3.2)<1e-8);
 assert.ok(g.quantityCSV([wall]).includes("'=test"));
 const root=path.join(__dirname,'..'),server=http.createServer((req,res)=>{const name=req.url.split('?')[0],f=/^\/[a-z-]+\.(mjs|css)$/.test(name)?name.slice(1):'index.html';res.setHeader('Content-Type',f.endsWith('.mjs')?'text/javascript':f.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(fs.readFileSync(path.join(root,f)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',r=>r.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/?debug`);await page.waitForFunction(()=>window.__dbg&&/기록 0곳/.test(document.querySelector('#stat').textContent));
  await page.evaluate(async()=>{const d=__dbg,L=d.mkLocal(129.06,35.16),ring=[[-15,-15],[15,-15],[15,15],[-15,15],[-15,-15]].map(p=>L.b(...p));await d.saveSite({id:'cad',name:'CAD BIM',area:900,polys:[{ring}],masses:[],objects:[],updatedAt:Date.now()});d.selectSite('cad');d.openPanel('studio');});
  await page.locator('[data-act=designEditor]').first().click();let dlg=page.locator('.design-editor');
  const point=async(x,y)=>{await dlg.locator('[data-cad=x]').fill(String(x));await dlg.locator('[data-cad=y]').fill(String(y));await dlg.locator('[data-do=point]').click();};
  await dlg.locator('[data-do=polygon]').click();
  await dlg.locator('[data-k=level]').fill('1층');await dlg.locator('[data-k=material]').fill('콘크리트');
  for(const p of [[0,0],[8,0],[8,4],[3,4],[3,7],[0,7]])await point(...p);
  await dlg.locator('[data-do=finish]').click();assert.equal(await dlg.locator('.de-shape').count(),1);
  await dlg.locator('[data-do=wall]').click();await point(0,0);await point(8,0);
  assert.equal(await dlg.locator('.de-shape').count(),2);
  await dlg.locator('[data-do=undo]').click();assert.equal(await dlg.locator('.de-shape').count(),1);
  await dlg.locator('[data-do=redo]').click();assert.equal(await dlg.locator('.de-shape').count(),2);
  await dlg.locator('[data-select-object]').selectOption({index:2});await dlg.locator('[data-do=holeAdd]').click();assert.equal(await dlg.locator('.de-hole-list button').count(),1);
  let pending=page.waitForEvent('download');await dlg.locator('[data-do=schedule]').click();let dl=await pending;const csv=fs.readFileSync(await dl.path(),'utf8');assert.ok(csv.includes('콘크리트')&&csv.includes('net_volume_m3'));
  pending=page.waitForEvent('download');await dlg.locator('[data-do=ifc]').click();dl=await pending;const ifc=fs.readFileSync(await dl.path(),'utf8');assert.ok(ifc.includes('IFCMATERIAL(')&&ifc.includes('IFCRELASSOCIATESMATERIAL')&&ifc.includes('NetVolume'));fs.writeFileSync('/tmp/dapsamap-cad-bim.ifc',ifc);
  const svg=dlg.locator('.de-plan'),beforeZoom=await svg.getAttribute('viewBox'),box=await svg.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-100);
  assert.notEqual(await svg.getAttribute('viewBox'),beforeZoom);
  const beforePan=await svg.getAttribute('viewBox');await page.mouse.down({button:'middle'});await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2+20);await page.mouse.up({button:'middle'});
  assert.notEqual(await svg.getAttribute('viewBox'),beforePan);
  if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'cad-bim.png')});}
  await dlg.locator('[data-do=save]').click();await page.waitForFunction(()=>document.querySelector('.de-status').textContent.includes('대지에 저장했어요'));
  await dlg.locator('[data-do=close]').click();await page.reload();await page.waitForFunction(()=>window.__dbg&&__dbg.S.sites.length);
  const saved=await page.evaluate(()=>__dbg.S.sites.find(s=>s.id==='cad').architecture.elements);
  assert.equal(saved.length,2);assert.equal(saved[0].points.length,6);assert.equal(saved[0].material,'콘크리트');assert.equal(saved[1].level,'1층');assert.equal(saved[1].openings.length,1);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{__dbg.selectSite('cad');__dbg.openPanel('studio');});await page.locator('[data-act=designEditor]').first().click();dlg=page.locator('.design-editor');await dlg.waitFor();
  assert.equal(await dlg.locator('.de-shape').count(),2);assert.ok(await dlg.locator('[data-do=dwg]').count());
  assert.deepEqual(errors,[]);console.log('PASS: CAD snapping, concave floor, axis wall, opening, undo/redo, BIM schedule, IFC material, persisted level/material and mobile reopen');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
