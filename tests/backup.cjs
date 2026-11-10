// Run: node tests/backup.cjs (requires Playwright and Chromium).
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      headless: true, args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Backups must also work when map providers are unavailable.
    await page.route('https://**', route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/?debug`);
    await page.waitForFunction(() => window.__dbg && /기록 0곳/.test(document.querySelector('#stat').textContent));
    const rec = (id, updatedAt, extra = {}) => ({id, name: id, updatedAt, lat: null, lng: null, ...extra});
    const upload = async data => {
      await page.locator('#fImport').setInputFiles({name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data))});
      await page.waitForFunction(() => /새 기록|완료하지 못|기록 파일이 아니|파일을 읽지 못/.test(document.querySelector('#toast').textContent));
      return page.locator('#toast').textContent();
    };
    const read = () => page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('dapsa-map-3d', 2);
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      const result = {};
      for(const name of ['recs', 'sites', 'photos']) result[name] = await new Promise(resolve => {
        const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result);
      });
      db.close();
      return result;
    });

    await page.evaluate(() => {
      for(const value of [null, '', ' ', false, {}, [], 'NaN', 91]){
        const r = __dbg.cleanRec({id:'a', name:'a', lat:value, lng:181});
        if(r.lat !== null || r.lng !== null) throw new Error('Invalid coordinates accepted');
      }
      const zero = __dbg.cleanRec({id:'a', name:'a', lat:0, lng:'0'});
      if(zero.lat !== 0 || zero.lng !== 0) throw new Error('Valid zero lost');
      const r = __dbg.cleanRec({id:'a', name:'a', lat:'35.16', lng:'129.06', bld:{ring:[[null, 35], [129, 35], [129, 36], [130, 36]]}});
      if(r.lat !== 35.16 || r.lng !== 129.06 || r.bld !== null) throw new Error('Coordinate cleanup failed');
    });
    console.log('PASS: missing, invalid, numeric-string and zero coordinates');

    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    const site = {id:'site', name:'대지', updatedAt:30, polys:[{ring:[[129,35],[129.001,35],[129.001,35.001],[129,35]]}], masses:[null], parking:[null], parcels:[null], objects:[]};
    await upload({records:[rec('a',30,{memo:'latest', photos:[{id:'photo'}]}),rec('a',10,{memo:'old'}),rec('b',10),rec('b',40,{memo:'newer'})], photos:{photo:png}, sites:[site,{...site, updatedAt:10, name:'old site'}]});
    let data = await read();
    assert.equal(data.recs.length, 2);
    assert.equal(data.recs.find(r => r.id === 'a').memo, 'latest');
    assert.equal(data.recs.find(r => r.id === 'b').memo, 'newer');
    assert.equal(data.recs[0].lat, null);
    assert.equal(data.recs[0].lng, null);
    assert.equal(data.photos.length, 1);
    assert.equal(data.sites[0].name, '대지');
    console.log('PASS: duplicate records/sites preserve newest version; photos and malformed optional entries import');

    // Fail after record and photo writes have been queued, then verify rollback.
    await page.evaluate(() => {
      window.originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(...args){
        if(this.name === 'sites') throw new DOMException('Simulated storage failure', 'QuotaExceededError');
        return window.originalPut.apply(this, args);
      };
    });
    assert.match(await upload({records:[rec('rollback',50,{photos:[{id:'rollback-photo'}]})], photos:{'rollback-photo':png}, sites:[{...site,id:'rollback-site'}]}), /완료하지 못/);
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; });
    data = await read();
    assert.equal(data.recs.length, 2);
    assert.equal(data.sites.length, 1);
    assert.equal(data.photos.length, 1);
    console.log('PASS: storage failure rolls back records, sites and photos together');

    await page.evaluate(() => {
      IDBObjectStore.prototype.put = function(...args){
        const request = window.originalPut.apply(this, args);
        if(this.name === 'recs'){
          const tx = this.transaction;
          request.addEventListener('success', () => tx.abort(), {once:true});
        }
        return request;
      };
    });
    assert.match(await upload({records:[rec('async-abort',70)], photos:{}, sites:[{...site,id:'async-site'}]}), /완료하지 못/);
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; });
    assert.equal((await read()).recs.length, 2);
    assert.equal((await read()).sites.length, 1);
    console.log('PASS: transaction abort after request success still reports failure and rolls back');

    await upload({records:[rec('retry',60)]});
    assert.equal((await read()).recs.length, 3);
    await page.reload();
    await page.waitForFunction(() => window.__dbg && __dbg.S.recs.length === 3);
    assert.equal((await read()).recs.find(r => r.id === 'a').memo, 'latest');
    assert.match(await upload({records:[rec('a',10,{memo:'outdated'})]}), /이미 최신/);
    assert.equal((await read()).recs.find(r => r.id === 'a').memo, 'latest');
    assert.match(await upload({unexpected:true}), /기록 파일이 아니/);
    assert.equal((await read()).recs.length, 3);
    assert.deepEqual(errors, []);
    console.log('PASS: retry after failure, persistence after reload, no browser script errors');
  } finally {
    if(browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
