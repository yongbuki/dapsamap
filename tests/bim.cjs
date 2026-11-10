const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const g=await import('../studio-editor.mjs'),b=await import('../bim-analysis.mjs');
 const wall=(id,x,y,w,angle=0,openings=[])=>({id,type:'wall',name:id,points:g.rectangle(x,y,w,.2,angle),floors:1,fh:3,base:0,openings});
 const floor={id:'floor',type:'slab',name:'바닥',points:g.rectangle(0,0,6,4),floors:1,fh:.2,base:0};
 const items=[wall('south',0,-2,6,0,[{kind:'window',offset:2,width:2,height:1.5,sill:1}]),wall('north',0,2,6),wall('east',3,0,4,90),wall('west',-3,0,4,90),{...floor,id:'roof',base:3},floor];
 const sun=[0,-1,.5],lit=b.directSunlight(items,'floor',sun);
 assert.ok(lit.litPercent>10&&lit.litPercent<60);assert.equal(lit.litPercent,lit.openingPercent);
 assert.equal(b.directSunlight(items,'floor',[1,0,.5]).litPercent,0);
 assert.equal(b.directSunlight(items,'floor',[0,0,-1]).litPercent,0);
 assert.equal(b.directSunlight(items.map(o=>o.id==='south'?{...o,openings:[]}:o),'floor',sun).litPercent,0);
 const blocker={id:'block',type:'mass',name:'차폐체',points:g.rectangle(0,-3,8,1),floors:2,fh:3,base:0};
 assert.equal(b.directSunlight([...items,blocker],'floor',sun).litPercent,0);
 assert.throws(()=>b.directSunlight(items,'south',sun));assert.throws(()=>b.directSunlight(items,'floor',sun,{maxSamples:Infinity}));
 const exportItems=structuredClone(items);exportItems[0].name="남쪽 벽 O'Brien";exportItems[0].openings=[{kind:'door',offset:.5,width:.9,height:2.1,sill:0},{kind:'window',offset:3,width:1.2,height:1.2,sill:1}];
 fs.writeFileSync('/tmp/dapsamap-bim-test.ifc',b.toIFC(exportItems,{name:'설계 검증',origin:{lng:129.06,lat:35.16}}));
 console.log('PASS: direct sun through window, closed-window control, directional shading, night, opaque obstruction and analysis bounds');
 const root=path.join(__dirname,'..'),server=http.createServer((req,res)=>{const q=req.url.split('?')[0],file=['/studio-editor.mjs','/architectural-model.mjs','/bim-analysis.mjs','/studio-editor.css'].includes(q)?q.slice(1):'index.html';res.setHeader('Content-Type',file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(fs.readFileSync(path.join(root,file)));});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?debug`);await page.waitForFunction(()=>window.__dbg&&/기록 0곳/.test(document.querySelector('#stat').textContent));
  await page.evaluate(async items=>{const d=__dbg,L=d.mkLocal(129.06,35.16),ring=[[-10,-10],[10,-10],[10,10],[-10,10],[-10,-10]].map(p=>L.b(...p));await d.saveSite({id:'bim',name:'채광 실습',polys:[{ring}],area:400,masses:[],objects:[],architecture:{origin:[129.06,35.16],elements:items},updatedAt:Date.now()});d.selectSite('bim');d.openPanel('studio');},items);
  await page.locator('[data-act="designEditor"]').first().click();const dlg=page.locator('.design-editor');await dlg.waitFor();await dlg.locator('[data-select-object]').selectOption('floor');await dlg.locator('[data-sun="date"]').fill('2026-12-22');await dlg.locator('[data-sun="time"]').fill('12:00');
  await dlg.locator('[data-do="sunAnalyze"]').click();await page.waitForFunction(()=>document.querySelector('.de-sun-result').textContent.includes('개구부 통과'));
  assert.ok(await dlg.locator('.de-sun-cell').count()>100);assert.match(await dlg.locator('.de-sun-result').textContent(),/KST/);
  let pending=page.waitForEvent('download');await dlg.locator('[data-do="sunCSV"]').click();let dl=await pending;const csv=fs.readFileSync(await dl.path(),'utf8');assert.ok(csv.includes('through_opening')&&csv.includes('2026-12-22'));
  pending=page.waitForEvent('download');await dlg.locator('[data-do="ifc"]').click();dl=await pending;assert.ok(fs.readFileSync(await dl.path(),'utf8').includes("FILE_SCHEMA(('IFC4'))"));
  await dlg.locator('[data-do="view3d"]').click();await page.waitForFunction(()=>/마우스·손가락|3D를 불러오지/.test(document.querySelector('.de-status').textContent),null,{timeout:45000});assert.ok(await dlg.locator('.de-three canvas').count(),'3D sunlight preview unavailable');
  await dlg.locator('[data-k="w"]').fill('7');await dlg.locator('[data-do="apply"]').click();assert.equal(await dlg.locator('.de-sun-cell').count(),0);assert.match(await dlg.locator('.de-sun-result').textContent(),/변경/);
  assert.deepEqual(errors,[]);console.log('PASS: mobile floor selection, KST solar input, sample map, CSV/IFC downloads and stale-result invalidation');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
