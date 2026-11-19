const WebSocket = require('ws'), http = require('http'), fs = require('fs');
const URL_ = process.argv[2], OUT = '/out';
const get = u => new Promise((res, rej) => http.get(u, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let targets; for (let i = 0; i < 30; i++) { try { targets = await get('http://127.0.0.1:9222/json'); if (targets.length) break; } catch (e) { } await sleep(300); }
  const page = targets.find(t => t.type === 'page'); const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pend = {}, errs = [];
  ws.on('message', m => { const d = JSON.parse(m); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errs.push('EXC ' + JSON.stringify(d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('CONSOLE ' + d.params.args.map(a => a.value || a.description).join(' ')); });
  const send = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception.description)); return r.result.result.value; };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + name + '.png', Buffer.from(r.result.data, 'base64')); };
  const waitFor = async (expr, ms, label) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(250); } throw new Error('timeout waiting for ' + label); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ }); await sleep(1500);
  const log = (...a) => console.log(...a);

  const load = async hash => { await send('Page.navigate', { url: 'about:blank' }); await sleep(300); await send('Page.navigate', { url: URL_ + hash }); await sleep(2200); };
  const bg = () => ev("getComputedStyle(document.body).backgroundColor");
  const res = [];
  const check = (n, v, d) => { res.push(v); log((v ? 'PASS ' : 'FAIL ') + n + (d ? ' (' + d + ')' : '')); };
  // pretend the operating system is in dark mode: this is what the user has
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await ev("try{localStorage.clear()}catch(e){}");
  await load('#e8=1');
  const first = await bg();
  check('first visit on a dark-mode system opens in LIGHT', first === 'rgb(244, 241, 234)', first + ', button: ' + await ev("document.getElementById('btnTheme').textContent"));
  await shot('theme_light_on_dark_os');
  await ev("document.getElementById('btnTheme').click()"); await sleep(500);
  const d = await bg(); check('switch -> Dark', d === 'rgb(29, 27, 23)', d + ', ' + await ev("document.getElementById('btnTheme').textContent"));
  await shot('theme_dark');
  await ev("document.getElementById('btnTheme').click()"); await sleep(500);
  const a = await bg(); check('switch -> Auto follows the (dark) system', a === 'rgb(29, 27, 23)', await ev("document.getElementById('btnTheme').textContent"));
  await ev("document.getElementById('btnTheme').click()"); await sleep(500);
  check('switch -> back to Light', (await bg()) === 'rgb(244, 241, 234)');
  await ev("document.getElementById('btnTheme').click()"); await sleep(300);
  await load('#e8=1');
  check('choice is remembered after a reload (Dark)', (await bg()) === 'rgb(29, 27, 23)' && (await ev("localStorage.getItem('earthmove.theme')")) === 'dark');
  // canvases follow the theme: sample the road canvas sky colour
  const sky = ev("(()=>{const c=document.getElementById('road').getContext('2d').getImageData(20,Math.round(document.getElementById('road').clientHeight*0.58)+30,1,1).data; return [c[0],c[1],c[2]].join(',')})()");
  check('canvases repaint in the chosen theme (road ground colour ' + await sky + ')', (await sky) === '74,58,38');
  await ev("document.getElementById('btnTheme').click()"); await ev("document.getElementById('btnTheme').click()"); await sleep(600); // dark -> auto -> light
  const sky2 = await ev("(()=>{const c=document.getElementById('road').getContext('2d').getImageData(20,Math.round(document.getElementById('road').clientHeight*0.58)+30,1,1).data; return [c[0],c[1],c[2]].join(',')})()");
  check('and repaint when switched back to light (ground ' + sky2 + ')', sky2 === '107,83,54');
  log('ERRORS:', JSON.stringify(errs)); log(res.every(Boolean) ? 'ALL PASSED (' + res.length + ')' : 'SOME FAILED');
  ws.close(); process.exit(0);
})().catch(e => { console.log('DRIVER FAIL', e.message); process.exit(1); });
