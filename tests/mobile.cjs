// Run: node tests/mobile.cjs. Optional: SCREENSHOT_DIR=/tmp/mobile-previews
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless:true, args:['--no-sandbox']});
    for(const [width, height] of (process.argv.includes('--landscape') ? [[844,390]] : [[320,568],[390,844],[844,390],[1280,800]])){
      const mobile = width < 900;
      const context = await browser.newContext({viewport:{width,height}, isMobile:mobile, hasTouch:mobile});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('https://**', r => r.abort());
      await page.goto(`http://127.0.0.1:${server.address().port}/?debug`);
      await page.waitForFunction(() => window.__dbg && /기록 0곳/.test(document.querySelector('#stat').textContent));
      const reachable = async selector => {
        const result = await page.locator(selector).evaluate(el => {
          const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return {width:r.width,height:r.height,visible:r.top >= -1 && r.bottom <= innerHeight+1 && r.left >= -1 && r.right <= innerWidth+1,hit:hit === el || el.contains(hit),rect:{x:r.x,y:r.y},cover:hit && hit.outerHTML.slice(0,200)};
        });
        assert.equal(result.visible, true, `${width}: ${selector} outside screen`);
        assert.equal(result.hit, true, `${width}: ${selector} covered ${JSON.stringify(result)}`);
        if(mobile){ assert.ok(result.width >= 44, selector+' too narrow'); assert.ok(result.height >= 44, selector+' too short'); }
      };
      for(const id of ['#bStudio','#bSearch','#bList','#bMenu','#addBtn']) await reachable(id);
      if(mobile){
        await page.locator('#toolsToggle').click();
        assert.equal(await page.locator('#toolsToggle').getAttribute('aria-expanded'), 'true');
        for(const id of ['#tMeas','#tSun','#tMe','#tFit']){
          await page.locator(id).scrollIntoViewIfNeeded(); await reachable(id);
        }
        await page.locator('#toolsToggle').click();
        assert.equal(await page.locator('#mapTools').isVisible(), false);
        await page.locator('#toolsToggle').click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#mapTools').isVisible(), false);
      } else {
        assert.equal(await page.locator('#toolsToggle').isVisible(), false);
        assert.equal(await page.locator('#mapTools').isVisible(), true);
      }
      await page.locator('#addBtn').click();
      assert.equal(await page.locator('#addBtn').getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#addMenu').isVisible(), false);

      for(const [id,kind] of [['#bSearch','search'],['#bList','list'],['#bMenu','menu'],['#bStudio','studio']]){
        await page.locator(id).click();
        assert.equal(await page.locator(id).getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('#panel').getAttribute('data-kind'), kind);
        const overflow = await page.locator('#panel .scroll').evaluate(el => el.scrollWidth-el.clientWidth);
        assert.ok(overflow <= 1, `${width}: ${kind} horizontal overflow ${overflow}px`);
        await reachable('#panel .p-head [data-act="close"]');
        await page.locator('#panel .p-head [data-act="close"]').click();
      }

      await page.evaluate(() => { __dbg.S.draft = __dbg.blankObsDraft(); __dbg.openPanel('edit'); });
      if(mobile){
        assert.equal(await page.locator('#bMenu').isDisabled(), true);
        assert.equal(await page.locator('#f-name').evaluate(el => getComputedStyle(el).fontSize), '16px');
      }
      await reachable('#saveBtn');
      await page.locator('#f-name').fill('모바일 관찰 기록');
      await page.locator('#f-memo').fill('메모 입력 후 키보드가 열려도 저장할 수 있어야 합니다.');
      assert.equal(await page.locator('#f-memo').inputValue(), '메모 입력 후 키보드가 열려도 저장할 수 있어야 합니다.');

      if(mobile && height > 500){
        await page.locator('#f-memo').focus();
        await page.evaluate(() => {
          Object.defineProperty(visualViewport, 'height', {configurable:true, get:() => innerHeight-260});
          visualViewport.dispatchEvent(new Event('resize'));
        });
        await page.waitForFunction(() => document.body.classList.contains('keyboard-open'));
        assert.equal(await page.locator('.primary-nav').isVisible(), false);
        const save = await page.locator('#saveBtn').boundingBox();
        assert.ok(save.y+save.height <= height-260+1, 'save button hidden by simulated keyboard');
        if(process.env.SCREENSHOT_DIR){
          fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});
          await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`keyboard-${width}.png`)});
        }
        await page.evaluate(() => { delete visualViewport.height; document.activeElement.blur(); visualViewport.dispatchEvent(new Event('resize')); });
        await page.waitForFunction(() => !document.body.classList.contains('keyboard-open'));
      }
      await page.locator('#panel .p-head [data-act="close"]').click();
      assert.equal(await page.locator('#bMenu').isEnabled(), true);
      await page.locator('#bMenu').click();
      if(process.env.SCREENSHOT_DIR){
        fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`settings-${width}.png`)});
      }
      assert.deepEqual(errors, []);
      console.log(`PASS: ${width}×${height} navigation, toolbar, panel overflow, input and save controls${mobile && height>500 ? ', simulated keyboard' : ''}`);
      await context.close();
    }
  } finally {
    if(browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
