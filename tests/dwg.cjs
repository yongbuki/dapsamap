// Requires DXF2DWG and @mlightcad/libredwg-web for independent binary readback.
const fs=require('node:fs');
const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 assert.ok(process.env.DXF2DWG,'Set DXF2DWG to the tested LibreDWG dxf2dwg binary');
 const server=spawn('python',['server/cad_server.py','--port','8021'],{cwd:path.join(__dirname,'..'),stdio:'ignore'});let browser;
 try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:8021/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage();await page.route('https://**',r=>r.abort());await page.goto('http://127.0.0.1:8021/?debug');
  const bytes=await page.evaluate(async()=>{const {toDXF,rectangle}=await import('./studio-editor.mjs'),{dxfToDWG}=await import('./dwg-export.mjs');return Array.from(await dxfToDWG(toDXF([{id:'w',name:'wall',type:'wall',points:rectangle(0,0,6,.2),floors:1,fh:3,base:0,openings:[{kind:'door',offset:1,width:.9,height:2.1,sill:0}]}])));});
  assert.equal(Buffer.from(bytes).subarray(0,6).toString(),'AC1015');
  const entry=path.resolve(path.dirname(require.resolve('@mlightcad/libredwg-web')),'../lib/index.js'),{LibreDwg,Dwg_File_Type}=await import(entry);
  const lib=await LibreDwg.create(path.resolve(path.dirname(entry),'../wasm')+'/');const array=Uint8Array.from(bytes),ptr=lib.dwg_read_data(array.buffer,Dwg_File_Type.DWG);assert.ok(ptr);
  try{const db=lib.convert(ptr);assert.equal(db.entities.length,2);assert.deepEqual(db.entities.map(e=>e.layer).sort(),['DOOR','WALL']);for(const e of db.entities)assert.equal(e.vertices.length,4);assert.ok(Math.abs(db.entities[0].vertices[0].x+3)<1e-8);}finally{lib.dwg_free(ptr);}
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),writer=new Function(html.slice(html.indexOf('function dxfText('),html.indexOf('let mapExportBusy'))+'; return dxfText;')();
  const mapDXF=writer([{t:'pl',layer:'CONTOUR',pts:[[200000,300000],[200010,300020]],z:100},{t:'tx',layer:'LABEL',x:200005,y:300005,h:1,s:'test'}],[['CONTOUR',30],['LABEL',7]],6);
  const response=await fetch('http://127.0.0.1:8021/api/dwg',{method:'POST',body:mapDXF});assert.equal(response.status,200);
  const mapPtr=lib.dwg_read_data(await response.arrayBuffer(),Dwg_File_Type.DWG);assert.ok(mapPtr);
  try{const db=lib.convert(mapPtr);assert.equal(db.entities.length,2);const contour=db.entities.find(e=>e.layer==='CONTOUR');assert.equal(contour.elevation,100);assert.equal(contour.vertices[0].x,200000);assert.ok(db.entities.some(e=>e.type==='TEXT'));}finally{lib.dwg_free(mapPtr);}
  assert.equal((await fetch('http://127.0.0.1:8021/api/dwg',{method:'POST',body:'invalid'})).status,422);
  assert.equal((await fetch('http://127.0.0.1:8021/api/dwg',{method:'POST',headers:{Origin:'https://untrusted.invalid'},body:'invalid'})).status,403);
  assert.equal((await fetch('http://127.0.0.1:8021/.git/config')).status,404);
  console.log('PASS: browser DXF→DWG service, real AC1015 binary, readback of geometry/layers, invalid input/origin and private-file rejection');
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
