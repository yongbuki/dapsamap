// Run: node tests/walking.cjs (requires Playwright and Chromium).
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
  const server = http.createServer((req,res) => { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(html); });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),headless:true,args:['--no-sandbox']});
    const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const errors = []; page.on('pageerror',e => errors.push(e.message));
    await page.route('https://**',r => r.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/?debug`);
    await page.waitForFunction(() => window.__dbg && /기록 0곳/.test(document.querySelector('#stat').textContent));
    const checks = await page.evaluate(() => {
      const d = __dbg, c = {lng:129.06,lat:35.16}, L = d.mkLocal(c.lng,c.lat);
      const line = (pts,steps=false) => ({pts:pts.map(p=>L.b(...p)),steps});
      const poi = (x,y,name='가게') => { const [lng,lat] = L.b(x,y); return {cat:'shop',name,lng,lat}; };
      const data = (lines,pois) => ({lines,pois,src:'osm'});
      const check = (v,msg) => { if(!v) throw new Error(msg); };
      const near = (r,cat='shop') => r.rows.find(x=>x.id===cat);
      const long = data([line([[-500,0],[500,0]])],[poi(100,0)]);
      const mid = d.walkCompute(c,long,false,()=>0);
      check(near(mid).near && Math.abs(near(mid).path.len-100)<0.1,'Street midpoint forced a detour');
      check(Math.abs(near(mid).near.t-d.walkTime(100,0,false,false))<0.01,'Street midpoint time inaccurate');
      check(mid.entryDistance<0.01,'Street entry should be at origin');
      const pathPoints = near(mid).path.ll.map(p=>L.f(...p));
      check(pathPoints.every(p=>p[0]>=-0.1 && p[0]<=100.1),'Route doubles back to original endpoints');
      const slow = d.walkCompute(c,long,true,()=>0);
      check(Math.abs(near(slow).near.t/near(mid).near.t-1.45)<0.001,'Slow pace multiplier wrong');
      const offset = d.walkCompute(c,data([line([[-500,20],[500,20]])],[poi(100,20)]),false,()=>0);
      check(Math.abs(offset.entryDistance-20)<0.01 && Math.abs(near(offset).path.len-120)<0.1,'Origin connector missing from route');
      const entrance = d.walkCompute(c,data([line([[-500,0],[500,0]])],[poi(100,-85)]),false,()=>0);
      check(near(entrance).near && Math.abs(near(entrance).path.len-185)<0.1,'Facility entrance search misses streets within 90m across grid cells');

      const alternatives = data([
        line([[0,0],[400,0]],true),
        line([[0,0],[0,200],[400,200],[400,0]]),
      ],[poi(400,0)]);
      const stairs = d.walkCompute(c,alternatives,false,()=>0);
      const stepFree = d.walkCompute(c,alternatives,false,()=>0,{avoidSteps:true});
      check(Math.abs(near(stairs).path.len-400)<0.1,'Stair shortcut not used');
      check(Math.abs(near(stepFree).path.len-800)<0.1,'Step exclusion failed to use detour');
      check(stepFree.steps===0 && stepFree.avoidSteps,'Excluded stairs remain in graph');
      check(d.walkCompute(c,data([line([[0,0],[400,0]],true)],[]),false,()=>0,{avoidSteps:true})===null,'Stair-only network should have no route');
      const disconnected = d.walkCompute(c,data([
        line([[0,0],[200,0]]),line([[0,30],[200,30]]),
      ],[poi(100,30)]),false,()=>0);
      check(near(disconnected).near===null,'Jumped to unconnected parallel street');
      const far = d.walkCompute(c,data([line([[-500,400],[500,400]])],[]),false,()=>0);
      check(far===null,'Origin more than 300m from a street should be rejected');

      const missing = d.walkCompute(c,long,false,()=>null);
      check(missing.terrainCoverage===0,'Missing elevation treated as measured flat terrain');
      const uphill = d.walkCompute(c,long,false,x=>x*0.1);
      check(near(uphill).near.t>near(mid).near.t,'Uphill should take longer');
      check(Math.abs(near(uphill).path.up-10)<0.05,'Uphill climb missing');
      const hill = d.walkCompute(c,long,false,x=>Math.max(0,10-Math.abs(x-50)*0.2));
      check(near(hill).path.up>7.5,'Climb over a hill between endpoints ignored');
      const network = d.walkNetworkFeatures(mid);
      check(network.length>2 && network.every(f=>f.properties.t<=900),'Invalid map time bands');
      check(mid.net.some(e=>e[4]>300) && mid.net.some(e=>e[4]<300),'Long road does not show time progression');
      check(mid.bands[0].area<=mid.bands[1].area+1 && mid.bands[1].area<=mid.bands[2].area+1,'Walking ranges should grow with time');

      const view = {left:0,top:60,right:390,bottom:780,width:390,height:720};
      const pad = d.fitPadding(view,{left:0,right:390,top:520,bottom:780},false);
      check(pad.bottom===276,'Padding does not use actual panel overlap');
      const short = d.fitPadding({...view,height:170,bottom:230},{left:0,right:390,top:70,bottom:230},false);
      check(short.top+short.bottom<=90,'Landscape padding leaves no usable map');

      d.S.mapReady = false; d.S.radiusRes = missing; d.openPanel('studio');
      check(d.walkCardHTML().includes('평지로 계산'),'Missing terrain not explained');
      const normalSVG = new DOMParser().parseFromString(d.walkSVG(mid),'image/svg+xml');
      check(!normalSVG.querySelector('parsererror'),'Invalid SVG export');
      stepFree.sel='shop'; window.testWalk = stepFree;
      const selectedSVG = new DOMParser().parseFromString(d.walkSVG(stepFree),'image/svg+xml');
      check(!selectedSVG.querySelector('parsererror') && selectedSVG.documentElement.textContent.includes('계단 제외'),'Export does not preserve step exclusion');
      d.S.radiusRes=stepFree; d.openPanel('studio');
      return {time:near(mid).near.t,length:near(mid).path.len,stairLength:near(stairs).path.len,detourLength:near(stepFree).path.len};
    });
    assert.ok(checks.time>60 && checks.time<90);
    console.log('PASS: midpoint, connector distance, slow pace, stairs detour, disconnected roads, elevation and map time bands',checks);

    const route = page.locator('.walk-route[data-cat="shop"]');
    await route.scrollIntoViewIfNeeded(); await route.click();
    assert.equal(await route.getAttribute('aria-pressed'),'false'); // fixture began selected; first tap hides it
    await route.click();
    assert.equal(await route.getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#panel').evaluate(el=>el.classList.contains('map-focus')),true);
    const compact = await page.locator('#panel').boundingBox();
    await page.locator('[data-act="mapFocus"]').click();
    const expanded = await page.locator('#panel').boundingBox();
    assert.ok(expanded.height>compact.height+100,'Expand results did not enlarge the mobile panel');
    assert.ok(await page.locator('#panel .scroll').evaluate(el=>el.scrollWidth-el.clientWidth<=1),'Analysis panel has horizontal overflow');

    await page.evaluate(() => {
      const d=__dbg, ctl=new AbortController(); d.WALK.ctl=ctl; d.WALK.busy=true;
      const seq=d.WALK.seq; d.selectSite('another-site');
      if(!ctl.signal.aborted || d.WALK.seq<=seq || d.S.radiusRes!==null || d.WALK.busy) throw new Error('Site switch did not invalidate analysis');
      d.S.radiusRes=window.testWalk; d.WALK.busy=true; d.walkClear();
      if(d.S.radiusRes || d.S.mapFocus || d.WALK.busy) throw new Error('Clear did not reset analysis state');
    });
    await page.setViewportSize({width:320,height:568});
    await page.evaluate(() => { __dbg.S.radiusRes=window.testWalk; __dbg.openPanel('studio'); });
    assert.ok(await page.locator('#panel .scroll').evaluate(el=>el.scrollWidth-el.clientWidth<=1),'320px analysis overflow');
    assert.deepEqual(errors,[]);
    console.log('PASS: route selection, mobile map/results toggle, narrow panel, cancellation and site invalidation');
  } finally {
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(e=>{ console.error(e); process.exitCode=1; });
