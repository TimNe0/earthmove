/* Follow-ups: 'simple dispatch, not optimised' labels and comparison warning, the Stockpile demo, and the default-rates notes, tags and screen.
 * Runs inside the zenika/alpine-chrome:with-node image (Chrome on 127.0.0.1:9222, the `ws` package installed).
 * usage: node drive_followups.js <url-of-earthmove.html> [outdir] */
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
  const tab = name => ev("(()=>{const b=[...document.querySelectorAll('#tabs button')].find(x=>x.textContent.startsWith('" + name + "'));if(!b)return false;b.click();return true})()");
  const body = () => ev("document.getElementById('tabbody').textContent");
  const clean = t => !/\bnull\b|\bundefined\b|NaN|\[object/.test(t);
  const hook = () => ev("(()=>{window.__blobs=[];const o=URL.createObjectURL;URL.createObjectURL=b=>{b.text().then(t=>window.__blobs.push(t));return o.call(URL,b)};})()"); // the page reloads between examples, so this is installed after each load

  // 1. labels
  await load('#example=simple'); await tab('Results');
  let t = await body();
  check('Results says "simple dispatch, not optimised" for a scenario never optimised', /Simple dispatch, not optimised/.test(t));
  check('the header badge says it too', /Simple dispatch, not optimised/.test(await ev("document.getElementById('modbadge').textContent")));
  check('the Results tab has no stray null/undefined/NaN', clean(t));

  // 2. scenario comparison warning
  await load('#example=modules'); await tab('Scenarios');
  await ev("document.getElementById('savename').value='first'; [...document.querySelectorAll('#tabbody button')].find(b=>/Save the current/.test(b.textContent)).click()"); await sleep(400);
  await tab('Scenarios');
  await ev("(()=>{const s=[...document.querySelectorAll('#tabbody select')];s[0].value=s[0].options[1].value;s[0].dispatchEvent(new Event('change'));})()"); await sleep(400);
  t = await body();
  check('comparing two scenarios that were never optimised warns about it', /Neither scenario has been optimised/.test(t), t.slice(t.indexOf('Neither'), t.indexOf('Neither') + 40));
  check('the comparison table shows the dispatch label for both', (t.match(/Simple dispatch, not optimised/g) || []).length >= 2);

  // 3. Stockpile demo: optimise, the route appears, the label changes
  await load('#example=stockpile');
  check('the Stockpile demo loads from the example link', /^Stockpile demo/.test(await ev("window.__earthmove.scn.name")));
  t = await optimise('Earliest overall completion');
  check('the optimiser keeps a plan on the Stockpile demo and says it matches plain dispatch', /Result for/.test(t) && /matches plain dispatch/.test(t), t.slice(0, 100));
  await ev("[...document.querySelectorAll('#optpanel button')].find(b=>/Use this plan/.test(b.textContent)).click()"); await sleep(600);
  await tab('Results'); t = await body();
  check('after using the plan the label reads "Optimised plan"', /Optimised plan: Earliest overall completion/.test(t));
  check('the stockpile took 400 t in and 400 t out (800 handling cost)', /400 t in \/ 400 t out/.test(t) && /800/.test(t));
  check('the plan is in the scenario: cut to pile and pile to fill', await ev("(()=>{const a=window.__earthmove.scn.plan.arcs;return a.some(x=>x.from==='cut'&&x.to==='K:pile')&&a.some(x=>x.from==='K:pile'&&x.to==='fill')})()"));
  check('the Results tab has no stray null/undefined/NaN after optimising', clean(t));

  // 4. default rates on the Commercial demo
  await load('#example=commercial'); await tab('Cost');
  check('rate inputs still at their defaults are tinted and tagged', await ev("document.querySelectorAll('#compane input.dflt').length") === 8 && await ev("document.querySelectorAll('#compane .dtag').length") === 8);
  await tab('Results'); t = await body();
  check('Results shows "using default rates" beside cost and carbon', /using default rates \(cost rates, fuel burn\)/.test(t));
  const rep = await ev("window.__earthmove.buildReport().textContent");
  check('the printed report says it uses default rates', /using default rates \(cost rates, fuel burn\)/.test(rep) && clean(rep));
  await hook(); await ev("[...document.querySelectorAll('#tabbody button')].find(b=>/Export results CSV/.test(b.textContent)).click()"); await sleep(500);
  let csv = await ev("window.__blobs[window.__blobs.length-1]||''");
  check('the results CSV header says it uses default rates and is not optimised', /# Results are using default rates/.test(csv) && /# Simple dispatch, not optimised/.test(csv), csv.split('\n').slice(0, 5).join(' | ').slice(0, 160));
  check('the Default rates tab is there with a count', await tab('Default rates (8)'));
  await shot('default_rates'); t = await body();
  check('it lists every placeholder in one table (5 cost + 3 fuel burn) with a default tag', /Lorry hire/.test(t) && /Lorry fuel burn/.test(t) && await ev("document.querySelectorAll('#ratetable input').length") === 8 && clean(t));
  check('every row shows a Status of "default" until entered', await ev("[...document.querySelectorAll('#ratetable tbody tr')].filter(r=>r.querySelector('input')).every(r=>/default/.test(r.children[4].textContent))"));
  await ev("(()=>{const i=document.querySelector('#ratetable input[data-cell=\"mod:E1:lorryRate\"]');i.value='52';i.dispatchEvent(new Event('input',{bubbles:true}));})()"); await sleep(400);
  check('typing a real number marks that row as yours and updates the count', /7 of 8/.test(await body()) && await ev("/yours/.test(document.querySelector('#ratetable input[data-cell=\"mod:E1:lorryRate\"]').closest('tr').children[4].textContent)") && await ev("window.__earthmove.scn.modules.E1.lorryRate") === 52);
  await ev("[...document.querySelectorAll('#tabbody button')].find(b=>/Confirm all the rest/.test(b.textContent)).click()"); await sleep(500);
  check('"Confirm all the rest" clears every placeholder and the tab becomes "Rates"', await tab('Rates') && /All 8 values/.test(await body()));
  await tab('Results'); t = await body();
  check('once confirmed the Results note is gone', !/using default rates/.test(t));
  check('...and so is the report note', !/using default rates/.test(await ev("window.__earthmove.buildReport().textContent")));
  await tab('Cost');
  check('...and the inputs are no longer tinted', await ev("document.querySelectorAll('#compane input.dflt').length") === 0);

  // 5. default rates on the Risk demo
  await load('#example=risk'); await tab('Weather');
  check('weather inputs are tagged (12 months + breakdown chance)', await ev("document.querySelectorAll('#riskpane input.dflt').length") === 13);
  await ev("document.getElementById('riskrun').click()");
  await waitFor("document.getElementById('riskresult') && /50% confidence/.test(document.getElementById('riskresult').textContent)", 60000, 'the risk result');
  t = await ev("document.getElementById('riskresult').textContent");
  check('the risk result says it uses default rates (weather and breakdowns)', /using default rates \(weather and breakdowns\)/.test(t) && clean(t));
  check('no page errors during the whole run', errs.length === 0, errs.join(' | '));
  console.log(results.every(Boolean) ? 'ALL PASSED' : 'FAILED ' + results.filter(x => !x).length);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(2); });
