/* Phase 7 browser checks: cost and carbon, results units, import, actuals, mass haul, report and replay.
 * Runs inside the zenika/alpine-chrome:with-node image (Chrome on 127.0.0.1:9222, the `ws` package installed).
 * usage: node drive_commercial.js <url-of-earthmove.html> [outdir] */
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
  const hasTab = t => ev("[...document.querySelectorAll('#tabs button')].some(b=>b.textContent.startsWith('" + t + "'))");

  await load('#example=simple');
  check('simple example: no Phase 7 tabs', !(await hasTab('Cost')) && !(await hasTab('Actual')) && !(await hasTab('Mass')));
  check('simple example: no import panel', await ev("!document.getElementById('imppanel')"));

  await load('#example=commercial');
  check('commercial demo: Cost & carbon, Actual progress and Mass haul tabs', await hasTab('Cost & carbon') && await hasTab('Actual progress') && await hasTab('Mass haul'));
  await tab('Cost'); await sleep(400);
  check('cost pane has the E1, E2 and E4 cards', await ev("document.querySelectorAll('#compane .group').length") === 3);
  check('cost pane has no stray null/undefined/NaN', await noStray('#compane'));
  check('the programme export button is there', await ev("[...document.querySelectorAll('#compane button')].some(b=>/Export programme CSV/.test(b.textContent))"));
  await shot('commercial-tab');

  // results: cost and carbon, and the separate results unit
  await tab('Results'); await sleep(500);
  let rt = await ev("document.getElementById('tabbody').textContent");
  check('results show cost and carbon', /Cost and carbon/.test(rt) && /Total cost/.test(rt) && /Cost per tonne placed/.test(rt) && /CO₂e/.test(rt) && /Fuel burned/.test(rt));
  check('results show no stray null/undefined/NaN', await noStray('#tabbody'));
  check('results are in tonnes by default', /Soil moved/.test(rt) && await ev("[...document.querySelectorAll('#tabbody .stat')].find(x=>/Soil moved/.test(x.textContent)).textContent.includes(' t')"));
  await ev("(()=>{const s=document.querySelector('select[data-cell=\"settings:resUnits\"]');s.value='m3';s.dispatchEvent(new Event('change'))})()"); await sleep(500);
  check('choosing cubic metres changes only how results are shown', await ev("[...document.querySelectorAll('#tabbody .stat')].find(x=>/Soil moved/.test(x.textContent)).textContent.includes('m³')") && await ev("window.__earthmove.scn.settings.units") === 'tonnes');
  await ev("(()=>{const s=document.querySelector('select[data-cell=\"settings:resUnits\"]');s.value='tonnes';s.dispatchEvent(new Event('change'))})()"); await sleep(300);

  // m3 inputs with A1 on: results stay in exact tonnes
  await ev("(()=>{const e=window.__earthmove;e.scn.settings.units='m3';e.scn.setup.modules.A1=true;e.recompute(true)})()"); await sleep(600);
  await tab('Results'); await sleep(300);
  check('with m3 inputs and A1 on the results are in tonnes with an explanation', await ev("/Results are shown in tonnes, which is exact/.test(document.getElementById('tabbody').textContent)") && await ev("[...document.querySelectorAll('#tabbody .stat')].find(x=>/Soil moved/.test(x.textContent)).textContent.includes(' t')"));
  await ev("(()=>{const e=window.__earthmove;e.scn.settings.units='tonnes';e.scn.setup.modules.A1=false;e.recompute(true)})()"); await sleep(400);

  // actual progress
  await tab('Actual'); await sleep(400);
  check('actuals table has the five entered days', await ev("document.querySelectorAll('#tabbody tbody')[0].querySelectorAll('tr').length") === 5);
  rt = await ev("document.getElementById('tabbody').textContent");
  check('planned versus actual and the re-forecast are shown', /Planned versus actual/.test(rt) && /Re-forecast finish/.test(rt) && /Planned finish/.test(rt) && /Against the plan/.test(rt));
  check('actuals tab shows no stray null/undefined/NaN', await noStray('#tabbody'));
  await ev("[...document.querySelectorAll('#tabbody button')].find(b=>/Add a day/.test(b.textContent)).click()"); await sleep(300);
  check('adding a day adds a row dated the day after the last', await ev("window.__earthmove.scn.modules.E6.actuals.length") === 6 && await ev("window.__earthmove.scn.modules.E6.actuals[5].date") === '2027-01-16');
  await ev("(()=>{window.__earthmove.scn.modules.E6.actuals.pop();window.__earthmove.recompute(true)})()"); await sleep(300);

  // mass haul diagram
  await tab('Mass'); await sleep(600);
  check('mass haul canvas draws something', await ev("(()=>{const c=document.getElementById('mhcanvas');if(!c||!c.width)return false;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0)n++;return n>1000})()"));
  check('mass haul tab shows no stray null/undefined/NaN', await noStray('#tabbody'));
  await shot('mass-haul');

  // import panel
  await tab('Sections'); await sleep(400);
  check('the import panel is on the Sections tab', await ev("!!document.getElementById('imppanel')"));
  await ev("(()=>{document.getElementById('imppanel').open=true;const t=document.getElementById('impText');t.value='Section\\tLength\\tQuantity\\nImported cut\\t500\\t3,000\\nImported fill\\t600\\t-3,000\\nBad row\\tabc\\t10';})()");
  await ev("[...document.querySelectorAll('#imppanel button')].find(b=>b.textContent==='Check').click()"); await sleep(300);
  const io = await ev("document.getElementById('impOut').textContent");
  check('the check lists the bad row and counts the good rows', /2 of 3 rows are ready to import/.test(io) && /Row 4: the length "abc" is not a number above 0/.test(io), io.slice(0, 120));
  await ev("[...document.querySelectorAll('#imppanel button')].find(b=>/Add to the table/.test(b.textContent)).click()"); await sleep(500);
  check('adding appends the two good sections (12 + 2)', await ev("window.__earthmove.scn.sections.length") === 14);
  await load('#example=commercial'); await tab('Sections'); await sleep(300);

  // optimiser goals follow the modules that are on
  await ev("document.getElementById('bOpt').click()"); await sleep(400);
  const goals = await ev("[...document.querySelectorAll('#optpanel select')][0].textContent");
  check('the optimiser offers lowest cost and lowest carbon when E1 and E2 are on', /Lowest total cost/.test(goals) && /Lowest carbon/.test(goals), goals.slice(0, 120));
  await ev("document.getElementById('bOpt').click()");
  await load('#example=simple'); await ev("document.getElementById('bOpt').click()"); await sleep(400);
  check('and not when they are off', !/Lowest total cost|Lowest carbon/.test(await ev("[...document.querySelectorAll('#optpanel select')][0].textContent")));
  await load('#example=commercial');

  // reporting: the report content and replay mode
  const rep = await ev("(()=>{const b=window.__earthmove.buildReport();return b.textContent})()");
  check('the printable report has the title, level and modules, key results and sections', /Earthmove summary/.test(rep) && /E1, E2, E3, E4, E5, E6, E7/.test(rep) && /Total cost/.test(rep) && /Overall completion/.test(rep) && /S1 Eastern approach/.test(rep) && /Mass haul/.test(rep));
  check('the report shows no stray null/undefined/NaN or object text', await ev("!/\\bnull\\b|\\bundefined\\b|NaN|\\[object/.test(document.getElementById('report').textContent)"));
  check('the report has the charts as images', await ev("document.querySelectorAll('#report img').length") >= 3);
  await tab('Results'); await sleep(300);
  check('Results offers Print report and Replay mode', await ev("[...document.querySelectorAll('#tabbody button')].some(b=>b.textContent==='Print report')") && await ev("[...document.querySelectorAll('#tabbody button')].some(b=>b.textContent==='Replay mode')"));
  await ev("[...document.querySelectorAll('#tabbody button')].find(b=>b.textContent==='Replay mode').click()"); await sleep(400);
  check('replay mode hides the editing controls', await ev("document.body.classList.contains('replay') && getComputedStyle(document.getElementById('tabs')).display==='none' && getComputedStyle(document.getElementById('btnSave')).display==='none' && getComputedStyle(document.getElementById('bOpt')).display==='none'"));
  check('replay mode keeps the playback controls and the charts', await ev("getComputedStyle(document.getElementById('bPlay')).display!=='none' && getComputedStyle(document.getElementById('road')).display!=='none'"));
  await shot('replay');
  await ev("document.getElementById('replayExit').click()"); await sleep(300);
  check('the exit button brings the controls back', await ev("!document.body.classList.contains('replay') && getComputedStyle(document.getElementById('tabs')).display!=='none'"));
  await load('#example=commercial&replay=1');
  check('a link with #replay=1 opens straight into replay mode', await ev("document.body.classList.contains('replay')"));
  await load('#example=simple');

  // Standard level includes the mass haul diagram (E3)
  await ev("document.getElementById('btnSetup').click()"); await sleep(400);
  await ev("[...document.querySelectorAll('#screenSetup .card')].find(c=>/Standard/.test(c.textContent)).click()"); await sleep(500);
  await ev("[...document.querySelectorAll('#screenSetup button')].find(b=>/Go to the model/.test(b.textContent)).click()"); await sleep(500);
  check('the Standard level turns on the mass haul diagram (E3) and the calendar (D4)', await hasTab('Mass haul') && await hasTab('Site'));
  check('no page errors during the whole run', errs.length === 0, errs.join(' | '));
  console.log(results.every(Boolean) ? 'ALL PASSED' : 'FAILED ' + results.filter(x => !x).length);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(2); });
