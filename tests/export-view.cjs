// Exercise the actual export functions with a deterministic map and data source.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const original = {center:[129.1,35.2],zoom:16.3,bearing:37,pitch:58,padding:{top:40,bottom:20,left:10,right:350}};
let camera, downloads, error = false;
const copy = value => JSON.parse(JSON.stringify(value));
const bounds = {getWest:()=>129,getEast:()=>129.001,getSouth:()=>35,getNorth:()=>35.001};
const map = {
  stop(){}, getCenter(){return {lng:camera.center[0],lat:camera.center[1]};},
  getZoom:()=>camera.zoom, getBearing:()=>camera.bearing, getPitch:()=>camera.pitch,
  getPadding:()=>camera.padding, jumpTo(c){camera=copy(c);},
};
const ctx = vm.createContext({map, console:{error(){}}, Blob, Number, Math, Date,
  toast(){}, exportArea:()=>({bounds,center:{lng:129,lat:35},site:null}),
  async viewBounds(){camera={center:[129,35],zoom:17.6,bearing:0,pitch:0,padding:{top:1}}; if(error) throw Error('tile failure');},
  async demPrefetchB(){}, collectContext:()=>({bldgs:[],parcels:[],roads:[],contours:[{line:[[129,35],[129.001,35.001]],ele:100}]}),
  needEarcut:async()=>null, tm5187:(x,y)=>[x*100,y*100], mkLocal:()=>({b:(x,y)=>[129+x/100,35+y/100]}),
  elevF:()=>100, visible:()=>[], hasLoc:()=>true, S:{}, curSite:()=>null,
  fileStamp:()=> 'test', download(blob,name){downloads.push({blob,name});},
});
const writer=html.slice(html.indexOf('function dxfText('),html.indexOf('let mapExportBusy'));
const dxf=html.slice(html.indexOf('let mapExportBusy'),html.indexOf('let earcutP'));
const obj=html.slice(html.indexOf('async function exportOBJ(){'),html.indexOf('/* ---------- observation helpers ---------- */'));
vm.runInContext(writer+dxf+obj,ctx);
(async()=>{
  for(const fn of ['exportDXF()', 'exportOBJ()']){
    camera=copy(original);downloads=[];error=false;
    await vm.runInContext(fn,ctx);
    assert.deepEqual(camera,original,`${fn} changed camera`);
    assert.equal(downloads.length,1);
    const text=await downloads[0].blob.text();
    assert.ok(text.includes(fn.includes('DXF')?'POLYLINE':'g terrain'));
    if(fn.includes('DXF')) assert.ok(text.includes('$INSUNITS\r\n70\r\n6\r\n'), 'map DXF must declare meters');
    camera=copy(original);downloads=[];error=true;
    await vm.runInContext(fn,ctx);
    assert.deepEqual(camera,original,`${fn} failed to restore camera on error`);
    assert.equal(downloads.length,0);
  }
  console.log('PASS: DXF/OBJ generation and exact camera restoration on success and tile failure');
  error=false;camera=copy(original);
  let release;
  ctx.hold=()=>new Promise(resolve=>release=resolve);
  const first=vm.runInContext('withExportView(hold)',ctx);
  let secondRan=false;ctx.second=()=>{secondRan=true;};
  await vm.runInContext('withExportView(second)',ctx);
  assert.equal(secondRan,false);
  release();await first;
  assert.deepEqual(camera,original);
  console.log('PASS: concurrent map exports cannot overwrite each other\'s camera');
})().catch(e=>{console.error(e);process.exitCode=1;});
