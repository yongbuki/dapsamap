const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const g=await import('../studio-editor.mjs'),a=await import('../architectural-model.mjs');
 const wall={id:'w',type:'wall',name:'벽',points:g.rectangle(0,0,6,.2,30),floors:1,fh:3,base:0,openings:[{kind:'door',offset:1,width:.9,height:2.1,sill:0},{kind:'window',offset:3,width:1.2,height:1.2,sill:1}]};
 g.validate([wall]);const solids=a.elementSolids(wall),volume=solids.reduce((v,p)=>v+Math.abs(g.signedArea(p.points))*p.fh,0);
 assert.ok(Math.abs(volume-(6*.2*3-.9*2.1*.2-1.2*1.2*.2))<1e-8);
 assert.throws(()=>g.validate([{...wall,openings:[...wall.openings,{kind:'window',offset:1,width:1,height:1,sill:1}]}]));
 assert.throws(()=>g.validate([{...wall,fh:2}]));
 const slab={id:'s',type:'slab',points:g.rectangle(0,0,8,6),floors:1,fh:.2,base:3};g.validate([slab]);assert.ok(g.toOBJ([wall,slab]).includes('panel_'));assert.ok(g.toDXF([wall,slab]).includes('\nWINDOW\n'));
 console.log('PASS: rotated wall openings remove exact volume, overlap and out-of-bounds rejection, slab thickness, DXF/OBJ');
 const root=path.join(__dirname,'..'),server=http.createServer((req,res)=>{const name=req.url.split('?')[0],file=['/studio-editor.mjs','/architectural-model.mjs','/studio-editor.css'].includes(name)?name.slice(1):'index.html';res.setHeader('Content-Type',file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(fs.readFileSync(path.join(root,file)));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/?debug`);await page.waitForFunction(()=>window.__dbg&&/기록 0곳/.test(document.querySelector('#stat').textContent));
 await page.evaluate(async()=>{const d=__dbg,L=d.mkLocal(129.06,35.16),ring=[[-15,-15],[15,-15],[15,15],[-15,15],[-15,-15]].map(p=>L.b(...p));await d.saveSite({id:'elements',name:'건축 요소 테스트',polys:[{ring}],area:900,masses:[],objects:[],updatedAt:Date.now()});d.selectSite('elements');d.openPanel('studio');});
 await page.locator('[data-act="designEditor"]').first().click();const dlg=page.locator('.design-editor');await dlg.waitFor();
 await dlg.locator('[data-k="type"]').selectOption('wall');await dlg.locator('[data-do="add"]').click();await dlg.locator('[data-do="holeAdd"]').click();assert.equal(await dlg.locator('.de-opening').count(),1);
 await dlg.locator('[data-hole="kind"]').selectOption('window');await dlg.locator('[data-hole="offset"]').fill('3');await dlg.locator('[data-do="holeAdd"]').click();assert.equal(await dlg.locator('.de-opening').count(),2);
 await dlg.locator('[data-k="angle"]').fill('45');await dlg.locator('[data-do="apply"]').click();assert.equal(await dlg.locator('.de-opening').count(),2);
 await dlg.locator('[data-k="type"]').selectOption('slab');await dlg.locator('[data-do="add"]').click();
 await dlg.locator('[data-do="save"]').click();await page.waitForFunction(()=>!document.querySelector('[data-do="save"]').disabled);assert.match(await dlg.locator('.de-status').textContent(),/대지에 저장/);
 const saved=await page.evaluate(()=>{const s=__dbg.curSite();return {elements:s.architecture.elements,masses:s.masses,models:s.objects.filter(o=>o.source==='architecture'),clean:__dbg.cleanSite(JSON.parse(JSON.stringify(s)))};});
 assert.equal(saved.elements.length,2);assert.equal(saved.elements[0].openings.length,2);assert.equal(saved.masses.length,0);assert.equal(saved.models.length,1);assert.equal(saved.clean.architecture.elements[0].openings.length,2);assert.equal(saved.clean.objects[0].source,'architecture');
 await dlg.locator('[data-do="close"]').click();await page.locator('[data-act="designEditor"]').first().click();await dlg.waitFor();assert.equal(await dlg.locator('.de-shape').count(),2);
 await dlg.locator('.de-shape').first().dispatchEvent('pointerdown',{button:0,clientX:150,clientY:250,pointerId:1});assert.equal(await dlg.locator('.de-opening').count(),2);
 await dlg.locator('[data-do="view3d"]').click();await page.waitForFunction(()=>/마우스·손가락|3D를 불러오지/.test(document.querySelector('.de-status').textContent),null,{timeout:45000});assert.ok(await dlg.locator('.de-three canvas').count(),'3D preview failed');
 await dlg.locator('[data-do="close"]').click();await page.reload();await page.waitForFunction(()=>window.__dbg&&__dbg.S.sites.some(s=>s.id==='elements'));assert.equal(await page.evaluate(()=>__dbg.S.sites.find(s=>s.id==='elements').architecture.elements.length),2);
 assert.deepEqual(errors,[]);console.log('PASS: mobile wall/door/window/slab editing, hosted rotation, save/reopen, backup fields, map model and 3D preview');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
