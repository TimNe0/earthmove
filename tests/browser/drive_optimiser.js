/* Optimiser end to end in the worker, with materials, a stockpile and cost/carbon goals.
 * Runs inside the zenika/alpine-chrome:with-node image (Chrome on 127.0.0.1:9222, the `ws` package installed).
 * usage: node drive_optimiser.js <url-of-earthmove.html> [outdir] */
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
  const waitFor = async (expr, ms, label) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(300); } throw new Error('timeout waiting for ' + label); };
  const optimise = async (goalText) => {
    await ev("(()=>{const p=document.getElementById('optpanel'); if(p.hidden) document.getElementById('bOpt').click();})()"); await sleep(400);
    await ev("(()=>{const sels=[...document.querySelectorAll('#optpanel select')];const g=sels[0];const o=[...g.options].find(x=>x.textContent.startsWith('" + goalText + "'));g.value=o.value;g.dispatchEvent(new Event('change'));const e=sels[1];e.selectedIndex=0;e.dispatchEvent(new Event('change'));})()"); await sleep(300);
    await ev("document.querySelector('#optpanel button.primary').click()");
    await waitFor("/Result for|No better plan found/.test(document.getElementById('optpanel').textContent)", 90000, 'the optimiser result');
    return ev("document.getElementById('optpanel').textContent");
  };
  await load('#example=materials');
  let t = await optimise('Lowest total tonne-km');
  check('the optimiser finishes on the Materials example (stockpile, import, export) and reports before and after', /Last soil tipped/.test(t) && /Total tonne-km/.test(t), t.slice(0, 80));
  check('the result panel shows no stray null/undefined/NaN', !/\bnull\b|\bundefined\b|NaN/.test(t));
  await load('#example=commercial');
  t = await optimise('Lowest total cost');
  check('the cost goal runs and the result shows cost and carbon rows', /Total cost/.test(t) && /Carbon/.test(t), t.slice(0, 80));
  await ev("document.querySelector('#optpanel button.primary') && [...document.querySelectorAll('#optpanel button')].find(b=>/Use this plan/.test(b.textContent)) && [...document.querySelectorAll('#optpanel button')].find(b=>/Use this plan/.test(b.textContent)).click()"); await sleep(600);
  check('an optimised plan can be applied, and the page keeps working', await ev("!!window.__earthmove.res") === true);
  check('no page errors during the whole run', errs.length === 0, errs.join(' | '));
  console.log(results.every(Boolean) ? 'ALL PASSED' : 'FAILED ' + results.filter(x => !x).length);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(2); });
