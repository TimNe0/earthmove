/* Phase 5 browser checks: the Site & calendar tab, Sections columns, results, road markers, E8 overlays.
 * Runs inside the zenika/alpine-chrome:with-node image (Chrome on 127.0.0.1:9222, the `ws` package installed).
 * usage: node drive_site.js <url-of-earthmove.html> [outdir] */
const WebSocket = require('ws'), http = require('http'), fs = require('fs');
const URL_ = process.argv[2], OUT = process.argv[3] || '/out';
const get = u => new Promise((res, rej) => http.get(u, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let targets; for (let i = 0; i < 30; i++) { try { targets = await get('http://127.0.0.1:9222/json'); if (targets.length) break; } catch (e) { } await sleep(300); }
  const page = targets.find(t => t.type === 'page'); const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pend = {}, errs = [];
  ws.on('message', m => { const d = JSON.parse(m); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errs.push('EXC ' + JSON.stringify((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description) || d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('CONSOLE ' + d.params.args.map(a => a.value || a.description).join(' ')); });
  const send = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails.text)); return r.result.result.value; };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + name + '.png', Buffer.from(r.result.data, 'base64')); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1500, deviceScaleFactor: 1, mobile: false });
  const results = []; const check = (name, okv, detail) => { results.push(okv); console.log((okv ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' (' + detail + ')' : '')); };
  const load = async hash => { await send('Page.navigate', { url: 'about:blank' }); await sleep(300); await send('Page.navigate', { url: URL_ + hash }); await sleep(3000); };
  const tab = t => ev("(()=>{const b=[...document.querySelectorAll('#tabs button')].find(b=>b.textContent.startsWith('" + t + "'));if(b){b.click();return true}return false})()");
  const noStray = sel => ev("!/\\bnull\\b|\\bundefined\\b|NaN/.test(document.querySelector('" + sel + "').textContent)");

  // 1. plain scenarios are unchanged
  await load('#example=simple');
  check('simple example: no Site & calendar tab', !(await ev("[...document.querySelectorAll('#tabs button')].some(b=>/Site & calendar/.test(b.textContent))")));
  check('simple example: no target-date inputs', await ev("document.querySelectorAll('#sectable input[data-cell$=\":d3target\"]').length") === 0);

  // 2. the Site demo
  await load('#example=site');
  const tabs = await ev("[...document.querySelectorAll('#tabs button')].map(b=>b.textContent).join('|')");
  check('site demo: Site & calendar tab is present', /Site & calendar/.test(tabs), tabs);
  check('badge lists C1-C5, D3, D4', await ev("/C1, C2, C3, C4, C5, D3, D4/.test(document.getElementById('modbadge').textContent)"), await ev("document.getElementById('modbadge').textContent"));
  check('sections table: a target-date input per section (12)', await ev("document.querySelectorAll('#sectable input[data-cell$=\":d3target\"]').length") === 12);
  check('sections table: layer columns for fill sections (vary by section)', await ev("document.querySelectorAll('#sectable input[data-cell$=\":c4layers\"]').length") > 0);
  await tab('Site'); await sleep(400);
  check('site pane renders', await ev("!!document.getElementById('sitepane')"));
  check('site pane shows no stray null/undefined/NaN', await noStray('#sitepane'));
  check('five cards plus the calendar (D4, C1, C2, C3, C4, C5)', await ev("document.querySelectorAll('#sitepane .group').length") === 6);
  check('the calendar lists the automatic UK bank holidays', await ev("/Good Friday/.test(document.getElementById('sitepane').textContent)"));
  check('C1 table has the river bridge', await ev("[...document.querySelectorAll('#sitepane .group')].find(g=>/C1/.test(g.textContent)).querySelectorAll('tbody tr').length") === 1);
  await shot('site-tab');

  // 3. editing
  await ev("[...document.querySelectorAll('#sitepane button')].find(b=>/Add a blockage/.test(b.textContent)).click()"); await sleep(300);
  check('adding a blockage adds a row', await ev("window.__earthmove.scn.modules.C1.blocks.length") === 2);
  await ev("[...document.querySelectorAll('#sitepane button')].find(b=>/Add a closed period/.test(b.textContent)).click()"); await sleep(300);
  check('adding a closed period adds a row', await ev("window.__earthmove.scn.modules.C3.periods.length") === 2);
  await ev("[...document.querySelectorAll('#sitepane button')].find(b=>/Edit the holiday list/.test(b.textContent)).click()"); await sleep(300);
  check('editing the holiday list switches off automatic holidays and fills the list', await ev("(()=>{const d=window.__earthmove.scn.modules.D4;return d.holidaysAuto===false && d.holidays.length>=20})()"));
  await ev("[...document.querySelectorAll('#sitepane button')].find(b=>/automatic UK list/.test(b.textContent)).click()"); await sleep(300);
  check('and back to the automatic list', await ev("window.__earthmove.scn.modules.D4.holidaysAuto") === true);
  await ev("(()=>{const m=window.__earthmove.scn.modules;m.C1.blocks.pop();m.C3.periods.pop();window.__earthmove.recompute(true)})()"); await sleep(300);

  // 4. validation links to the right field
  await ev("(()=>{window.__earthmove.scn.modules.C1.blocks[0].chainageM=99999;window.__earthmove.recompute(true)})()"); await sleep(400);
  await tab('Messages'); await sleep(300);
  check('a bad blockage chainage is reported in plain English', await ev("/chainage must be between/.test(document.getElementById('tabbody').textContent)"));
  await ev("[...document.querySelectorAll('#tabbody a')].find(a=>/Go to it/.test(a.textContent)).click()"); await sleep(600);
  check('"Go to it" opens the Site tab and focuses the field', await ev("document.activeElement && document.activeElement.getAttribute('data-cell')") === 'mod:C1:bridge:chainageM');
  await ev("(()=>{window.__earthmove.scn.modules.C1.blocks[0].chainageM=4900;window.__earthmove.recompute(true)})()"); await sleep(400);

  // 5. results
  await tab('Results'); await sleep(400);
  const txt = await ev("document.getElementById('tabbody').textContent");
  check('results list the target dates and the late section', /Target dates/.test(txt) && /Sections late against their target date/.test(txt) && /1 late/.test(txt), (txt.match(/\d of \d/) || [''])[0]);
  check('results show no stray null/undefined/NaN', !/\bnull\b|\bundefined\b|NaN/.test(txt));

  // 6. road view and E8 overlays at a time when the bridge is still closed
  await ev("(()=>{window.__earthmove.scn.setup.modules.E8=true;window.__earthmove.recompute(true)})()"); await sleep(1200);
  await tab('Sections'); await ev("(()=>{window.__earthmove.S.t=1440*7+600; window.__earthmove.S.dirty=true})()"); await sleep(1200);
  check('E8 chart draws with all Phase 5 overlays and no error', await ev("!!window.__earthmove.tc().data") && errs.length === 0, errs.join(' | '));
  await shot('site-road-e8');
  check('no page errors during the whole run', errs.length === 0, errs.join(' | '));
  console.log(results.every(Boolean) ? 'ALL PASSED' : 'FAILED ' + results.filter(x => !x).length);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(2); });
