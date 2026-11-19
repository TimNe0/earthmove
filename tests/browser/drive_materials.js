/* Phase 4 browser checks: the Materials & sites tab, soil-line editor, results, E8 colours, road markers.
 * Runs inside the zenika/alpine-chrome:with-node image (Chrome on 127.0.0.1:9222, the `ws` package installed).
 * usage: node drive_materials.js <url-of-earthmove.html> [outdir] */
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

  // 1. plain scenarios are unchanged: no materials tab, no new columns
  await load('#example=simple');
  check('simple example: no Materials tab', !(await ev("[...document.querySelectorAll('#tabs button')].some(b=>/Materials/.test(b.textContent))")));
  check('simple example: sections table keeps a single soil input per row', await ev("document.querySelectorAll('#sectable td.lines').length") === 0);
  check('simple example: no page errors', errs.length === 0, errs.join(' | '));

  // 2. the Materials demo
  await load('#example=materials');
  const tabs = await ev("[...document.querySelectorAll('#tabs button')].map(b=>b.textContent).join('|')");
  check('materials demo: Materials & sites tab is present', /Materials & sites/.test(tabs), tabs);
  check('materials demo: badge lists A1-A5', await ev("/A1, A2, A3, A4, A5/.test(document.getElementById('modbadge').textContent)"), await ev("document.getElementById('modbadge').textContent"));
  check('sections table: soil-line editor in each row (12 rows)', await ev("document.querySelectorAll('#sectable td.lines').length") === 12);
  check('section S2 has three soil lines', await ev("document.querySelectorAll('#sectable tr[data-row=s2] td.lines select').length") === 3);
  await tab('Materials'); await sleep(400);
  check('materials pane renders', await ev("!!document.getElementById('matpane')"));
  check('materials pane shows no stray "null" or "undefined" text', await ev("!/\\bnull\\b|\\bundefined\\b|NaN/.test(document.getElementById('matpane').textContent)"));
  check('four soil types listed', await ev("document.querySelectorAll('#matpane table')[0].querySelectorAll('tbody tr').length") === 4);
  check('A2 grid is 4 x 4 with ticked, disabled diagonal', await ev("(()=>{const t=document.querySelectorAll('#matpane table')[1];return t.querySelectorAll('tbody tr').length===4 && t.querySelectorAll('input[disabled]:checked').length===4})()"));
  check('A4 table lists the export and the import', await ev("document.querySelectorAll('#matpane table')[2].querySelectorAll('tbody tr').length") === 2);
  check('A5 table lists the stockpile', await ev("document.querySelectorAll('#matpane table')[3].querySelectorAll('tbody tr').length") === 1);
  await shot('materials-tab');

  // 3. editing: add a soil type and a stockpile, then remove them
  await ev("[...document.querySelectorAll('#matpane button')].find(b=>/Add soil type/.test(b.textContent)).click()"); await sleep(300);
  check('adding a soil type adds a row and a column', await ev("document.querySelectorAll('#matpane table')[0].querySelectorAll('tbody tr').length") === 5 && await ev("document.querySelectorAll('#matpane table')[1].querySelectorAll('tbody tr').length") === 5);
  await ev("[...document.querySelectorAll('#matpane button')].find(b=>/Add stockpile/.test(b.textContent)).click()"); await sleep(300);
  check('adding a stockpile adds a row', await ev("document.querySelectorAll('#matpane table')[3].querySelectorAll('tbody tr').length") === 2);
  const stk = await ev("window.__earthmove.scn.modules.A5.stockpiles.length");
  check('the scenario holds both stockpiles', stk === 2, stk);
  await ev("window.__earthmove.scn.modules.A5.stockpiles.pop(); window.__earthmove.recompute(true)"); await sleep(300);

  // 4. validation links to the right field
  await ev("(()=>{const s=window.__earthmove.scn;s.modules.A1.bodyM3=0;window.__earthmove.recompute(true)})()"); await sleep(400);
  await tab('Messages'); await sleep(300);
  check('a bad body volume is reported in plain English', await ev("/body volume must be more than 0/.test(document.getElementById('tabbody').textContent)"));
  await ev("[...document.querySelectorAll('#tabbody a')].find(a=>/Go to it/.test(a.textContent)).click()"); await sleep(600);
  check('"Go to it" opens the Materials tab and focuses the field', await ev("document.activeElement && document.activeElement.getAttribute('data-cell')") === 'mod:A1:bodyM3');
  await ev("(()=>{window.__earthmove.scn.modules.A1.bodyM3=14;window.__earthmove.recompute(true)})()"); await sleep(400);

  // 5. results and movement log
  await tab('Results'); await sleep(400);
  const txt = await ev("document.getElementById('tabbody').textContent");
  check('results show the materials block', /Materials, imports and stockpiles/.test(txt) && /Soil placed in fills/.test(txt) && /Topsoil bank/.test(txt), txt.length);
  check('results show no stray "null" or "undefined" text', !/\bnull\b|\bundefined\b|NaN/.test(txt), (txt.match(/.{20}(null|undefined|NaN).{10}/) || [''])[0]);
  await shot('results');
  await tab('Movement log'); await sleep(300);
  check('movement log has a Soil column', await ev("[...document.querySelectorAll('#tabbody th')].some(t=>t.textContent==='Soil')"));

  // 6. road view and E8 chart
  await ev("(()=>{window.__earthmove.scn.setup.modules.E8=true;window.__earthmove.recompute(true)})()"); await sleep(1200);
  await tab('Sections'); await sleep(300);
  check('E8 chart data carries a material on each band', await ev("(()=>{const d=window.__earthmove.tc().data;return d && d.pairs.length>0 && d.pairs.every(p=>!!p.mat)})()"));
  check('E8 bands include nodes (export / stockpile)', await ev("(()=>{const P=window.__earthmove.res.P,d=window.__earthmove.tc().data;return d.pairs.some(p=>p.dst>=P.n||p.src>=P.n)})()"));
  await ev("(()=>{window.__earthmove.S.t=1440*20+600; window.__earthmove.S.dirty=true})()"); await sleep(1000);
  await shot('road-and-e8');
  check('no page errors during the whole run', errs.length === 0, errs.join(' | '));
  console.log(results.every(Boolean) ? 'ALL PASSED' : 'FAILED ' + results.filter(x => !x).length);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(2); });
