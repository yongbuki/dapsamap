const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');
(async () => {
  const root = path.join(__dirname, '..');
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace('window.__dbg = {', 'window.__dbg = {DB, photoURL, resizeImage, blankDraft, saveDraft, cancelEdit, doSearch, getSearch: () => searchPlaces, setSearch: fn => searchPlaces = fn,'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://**', route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/?debug`);
    await page.waitForFunction(() => window.__dbg && /기록 0곳/.test(document.querySelector('#stat').textContent));
    await page.evaluate(async () => {
      const check = (ok, msg) => { if(!ok) throw Error(msg); };
      const {doSearch, openPanel, getSearch, setSearch} = window.__dbg;
      const original = getSearch(), pending = new Map();
      try {
        setSearch((q, signal) => new Promise((resolve, reject) => pending.set(q, {resolve, reject, signal}))); 
        openPanel('search');
        const old = doSearch('old'), latest = doSearch('latest');
        check(pending.get('old').signal.aborted, 'old request was not cancelled');
        pending.get('latest').resolve([{name:'latest result', addr:'new', lat:35, lng:129}]);
        await latest;
        pending.get('old').reject(Error('late failure'));
        await old;
        check(document.querySelector('.res').textContent.includes('latest result'), 'late error replaced new results');
        const slow = doSearch('slow');
        await doSearch('');
        pending.get('slow').resolve([{name:'stale result'}]);
        await slow;
        check(!document.querySelector('.res').textContent, 'cleared search was repopulated');
      } finally { setSearch(original); }
    });
    console.log('PASS: overlapping searches, late failure, cancellation and clearing pending search');
    await page.evaluate(async () => {
      const {DB, S, blankDraft, saveDraft, cancelEdit} = window.__dbg;
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(...args){
        const req = original.apply(this, args);
        if(this.name === 'recs') req.addEventListener('success', () => this.transaction.abort(), {once:true});
        return req;
      };
      let rejected = false;
      try { await DB.putRec({id:'must-rollback'}); } catch { rejected = true; }
      finally { IDBObjectStore.prototype.put = original; }
      if(!rejected || (await DB.allRecs()).some(r => r.id === 'must-rollback')) throw Error('aborted write reported success');
      const d = S.draft = {...blankDraft(), name:'double click', lat:35, lng:129};
      const put = DB.putRec; let release, calls = 0;
      DB.putRec = async rec => { calls++; await new Promise(resolve => release = resolve); await put.call(DB, rec); };
      try {
        const first = saveDraft();
        await saveDraft();
        await cancelEdit();
        if(calls !== 1 || S.draft !== d) throw Error('duplicate save or cancel while saving');
        release(); await first;
        if((await DB.allRecs()).length !== 1 || S.draft) throw Error('record not saved once');
      } finally { DB.putRec = put; }
    });
    console.log('PASS: transaction abort detection, duplicate-save prevention and cancellation during save');
    await page.evaluate(async () => {
      const {DB, photoURL} = window.__dbg;
      await DB.putPhoto('shared', new Blob(['image']));
      const urls = await Promise.all([photoURL('shared'), photoURL('shared'), photoURL('shared')]);
      if(new Set(urls).size !== 1) throw Error('duplicate photo URLs');
      await DB.delPhoto('shared');
      if(await photoURL('shared')) throw Error('deleted photo cached');
      let revoked = false; try { await fetch(urls[0]); } catch { revoked = true; }
      if(!revoked) throw Error('deleted photo memory not released');
    });
    console.log('PASS: shared photo URLs and release of deleted photo memory');
    await page.evaluate(async () => {
      const {resizeImage} = window.__dbg;
      const cv = document.createElement('canvas'); cv.width = 2; cv.height = 2;
      const file = await new Promise(resolve => cv.toBlob(resolve, 'image/png'));
      const create = window.createImageBitmap, make = URL.createObjectURL, revoke = URL.revokeObjectURL;
      let made = 0, released = 0;
      try {
        window.createImageBitmap = async () => { throw Error('force fallback'); };
        URL.createObjectURL = function(blob){ made++; return make.call(this, blob); };
        URL.revokeObjectURL = function(url){ released++; return revoke.call(this, url); };
        const result = await resizeImage(file);
        if(result.type !== 'image/jpeg') throw Error('image conversion failed');
        let failed = false;
        try { await resizeImage(new Blob(['bad image'])); } catch { failed = true; }
        if(!failed || made !== 2 || released !== 2) throw Error('image URL leak on success or failure');
      } finally { window.createImageBitmap = create; URL.createObjectURL = make; URL.revokeObjectURL = revoke; }
    });
    console.log('PASS: fallback image conversion and memory cleanup on success and invalid image');
    assert.deepEqual(errors, []);
  } finally { if(browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
