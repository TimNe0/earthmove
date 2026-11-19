/* Phase 6 browser checks: the Weather & risk tab, a real risk run in the worker, cancel, stale results.
 * Runs inside the zenika/alpine-chrome:with-node image (Chrome on 127.0.0.1:9222, the `ws` package installed).
 * usage: node drive_risk.js <url-of-earthmove.html> [outdir] */
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
  const waitFor = async (expr, ms, label) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(250); } throw new Error('timeout waiting for ' + label); };

  await load('#example=simple');
  check('simple example: no Weather & risk tab', !(await ev("[...document.querySelectorAll('#tabs button')].some(b=>/Weather/.test(b.textContent))")));
  await load('#example=risk');
  check('risk demo: Weather & risk tab is present', await ev("[...document.querySelectorAll('#tabs button')].some(b=>/Weather & risk/.test(b.textContent))"));
  await tab('Weather'); await sleep(400);
  check('risk pane renders with twelve monthly inputs', await ev("document.querySelectorAll('#riskpane input[data-cell^=\"mod:D1:lost\"]').length") === 12);
  check('the winter shutdown fields are shown (it is ticked in the demo)', await ev("!!document.querySelector('#riskpane input[data-cell=\"mod:D1:winterFrom\"]')"));
  check('risk pane shows no stray null/undefined/NaN', await noStray('#riskpane'));
  // a real run, in the worker
  await ev("(()=>{window.__earthmove.scn.modules.D2.runs=60;window.__earthmove.recompute(true)})()"); await sleep(400);
  await ev("document.getElementById('riskrun').click()");
  await waitFor("/50% confidence completion/.test(document.getElementById('riskresult').textContent)", 60000, 'the risk result');
  const rt = await ev("document.getElementById('riskresult').textContent");
  check('the risk run shows the 50% and 80% dates', /50% confidence completion/.test(rt) && /80% confidence completion/.test(rt) && /Runs that finished the job/.test(rt), (rt.match(/\d+ runs, [\d.]+ s/) || [''])[0]);
  check('a histogram and a per-section table are shown', await ev("document.querySelectorAll('#riskresult .hist i').length") > 3 && await ev("document.querySelectorAll('#riskresult tbody tr').length") >= 10);
  check('the result shows no stray null/undefined/NaN', await noStray('#riskresult'));
  await shot('risk-result');
  // editing an input makes the result stale
  await ev("(()=>{window.__earthmove.scn.modules.D1.lostDays[0]=9;window.__earthmove.recompute(true)})()"); await sleep(500);
  await tab('Weather'); await sleep(300);
  check('changed inputs mark the old analysis as out of date', await ev("/inputs have changed since this analysis/.test(document.getElementById('riskresult').textContent)"));
  // cancel a long run
  await ev("(()=>{window.__earthmove.scn.modules.D2.runs=5000;window.__earthmove.recompute(true)})()"); await sleep(400);
  await ev("document.getElementById('riskrun').click()"); await sleep(600);
  check('while running a progress bar and a Cancel button show', await ev("!!document.querySelector('#riskresult .bar') && [...document.querySelectorAll('#riskresult button')].some(b=>b.textContent==='Cancel')"));
  await ev("[...document.querySelectorAll('#riskresult button')].find(b=>b.textContent==='Cancel').click()");
  await waitFor("/Cancelled after/.test(document.getElementById('riskresult').textContent)", 20000, 'cancel');
  check('cancel stops the run and says how many runs were done', await ev("/Cancelled after \\d+ runs/.test(document.getElementById('riskresult').textContent)"));
  check('the run button is usable again after a cancel', await ev("document.getElementById('riskrun').disabled") === false);
  // validation links to the right field
  await ev("(()=>{window.__earthmove.scn.modules.D2.runs=5;window.__earthmove.recompute(true)})()"); await sleep(400);
  await tab('Messages'); await sleep(300);
  check('too few runs is reported in plain English', await ev("/between 10 and 5000/.test(document.getElementById('tabbody').textContent)"));
  await ev("[...document.querySelectorAll('#tabbody a')].find(a=>/Go to it/.test(a.textContent)).click()"); await sleep(600);
  check('"Go to it" opens the Weather & risk tab and focuses the field', await ev("document.activeElement && document.activeElement.getAttribute('data-cell')") === 'mod:D2:runs');
  // E8 shows lost days; the road announces a day off
  await ev("(()=>{window.__earthmove.scn.modules.D2.runs=200;window.__earthmove.scn.setup.modules.E8=true;window.__earthmove.recompute(true)})()"); await sleep(1200);
  check('weather is in the engine as days off', await ev("(()=>{const P=window.__earthmove.res.P;return !!P.cal && P.cal.dayOff.some(x=>x===1)})()"));
  await tab('Sections');
  check('no page errors during the whole run', errs.length === 0, errs.join(' | '));
  console.log(results.every(Boolean) ? 'ALL PASSED' : 'FAILED ' + results.filter(x => !x).length);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(2); });
