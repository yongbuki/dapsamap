const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const root=path.join(__dirname,'..'),g=await import('../studio-editor.mjs');
 const rect=g.rectangle(2,3,8,6,37);assert.ok(Math.abs(g.signedArea(rect)-48)<1e-8);
 const concave=[[0,0],[4,0],[4,1],[1,1],[1,4],[0,4]],tris=g.triangulate(concave);
 assert.ok(Math.abs(tris.reduce((n,t)=>n+Math.abs(g.signedArea(t.map(i=>concave[i]))),0)-7)<1e-8);
 assert.throws(()=>g.triangulate([[0,0],[2,2],[0,2],[2,0]]));
 const o={id:'m1',name:'test',points:concave,floors:3,fh:3,base:1};
 assert.ok(g.toDXF([o]).includes('$INSUNITS\n70\n6'));
 const obj=g.toOBJ([o]);assert.equal(obj.split('\n').filter(x=>x.startsWith('v ')).length,12);
 assert.ok(obj.includes('v 0 10 0'));assert.throws(()=>g.validate([{...o,floors:0}]));
 console.log('PASS: rotated geometry, concave triangulation, invalid polygon rejection, DXF units and OBJ extrusion');
 const server=http.createServer((req,res)=>{const name=req.url.split('?')[0];const f=['/studio-editor.mjs','/architectural-model.mjs','/studio-editor.css'].includes(name)?name.slice(1):'index.html';res.setHeader('Content-Type',f.endsWith('.mjs')?'text/javascript':f.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(fs.readFileSync(path.join(root,f)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?debug`);await page.waitForFunction(()=>window.__dbg&&/기록 0곳/.test(document.querySelector('#stat').textContent));
  await page.evaluate(async()=>{const d=__dbg,L=d.mkLocal(129.06,35.16),ring=[[-15,-15],[15,-15],[15,15],[-15,15],[-15,-15]].map(p=>L.b(...p));await d.saveSite({id:'editor-site',name:'설계 실습',area:900,polys:[{ring}],masses:[],objects:[],updatedAt:Date.now()});d.selectSite('editor-site');d.openPanel('studio');});
  await page.locator('[data-act="designEditor"]').click();const dialog=page.locator('.design-editor');await dialog.waitFor();
  await dialog.locator('[data-do="add"]').click();assert.equal(await dialog.locator('.de-shape').count(),1);
  await dialog.locator('[data-k="w"]').fill('10');await dialog.locator('[data-k="floors"]').fill('4');await dialog.locator('[data-do="apply"]').click();
  await dialog.locator('[data-do="duplicate"]').click();assert.equal(await dialog.locator('.de-shape').count(),2);
  await dialog.locator('[data-do="undo"]').click();assert.equal(await dialog.locator('.de-shape').count(),1);
  await dialog.locator('[data-do="redo"]').click();assert.equal(await dialog.locator('.de-shape').count(),2);
  const download=page.waitForEvent('download');await dialog.locator('[data-do="obj"]').click();const dl=await download;assert.ok(fs.readFileSync(await dl.path(),'utf8').includes('v '));
  await dialog.locator('[data-do="save"]').click();await page.waitForFunction(()=>!document.querySelector('[data-do="save"]').disabled);assert.match(await dialog.locator('.de-status').textContent(),/대지에 저장했어요/);
  assert.equal(await page.evaluate(()=>__dbg.curSite().masses.length),2);
  const area=await page.evaluate(()=>__dbg.ringAreaM2(__dbg.curSite().masses[0].ring));assert.ok(Math.abs(area-60)<0.05);
  await dialog.locator('[data-do="view3d"]').click();await page.waitForFunction(()=>/마우스·손가락|3D를 불러오지/.test(document.querySelector('.de-status').textContent),null,{timeout:45000});
  const preview=await dialog.locator('.de-status').textContent();console.log('3D preview:',preview);
  const canvas=await dialog.locator('.de-three canvas').count();if(canvas)assert.ok(await dialog.locator('.de-three canvas').evaluate(c=>c.width>0&&c.height>0));
  await page.setViewportSize({width:844,height:390});const footer=await dialog.locator('.de-footer').boundingBox();assert.ok(footer.y+footer.height<=391,'Landscape footer off screen');await dialog.locator('[data-do="close"]').click();await page.reload();await page.waitForFunction(()=>window.__dbg&&__dbg.S.sites.some(s=>s.id==='editor-site'));
  assert.equal(await page.evaluate(()=>__dbg.S.sites.find(s=>s.id==='editor-site').masses.length),2);
  assert.deepEqual(errors,[]);console.log('PASS: mobile editing, dimension changes, duplicate, undo/redo, download, save and reload');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
