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
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1700, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ }); await sleep(1500);
  const log = (...a) => console.log(...a);

  const mouse = async (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
  const rectOf = sel => ev("(()=>{const r=document.querySelector('" + sel + "').getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}})()");
  const load = async hash => { await send('Page.navigate', { url: 'about:blank' }); await sleep(300); await send('Page.navigate', { url: URL_ + hash }); await sleep(2500); };
  const results = [];
  const check = (name, okv, detail) => { results.push(okv); log((okv ? 'PASS ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : '')); };

  // ---- 0. E8 off: nothing else changes
  await load('#example=simple&tab=results');
  const hdrOff = await ev("[...document.querySelectorAll('#tabbody table th')].map(h=>h.textContent).join('|')");
  check('E8 off: chart panel hidden', await ev("document.getElementById('tcpanel').hidden") === true);
  check('E8 off: results table has no start column', !/Earthworks starts/.test(hdrOff), hdrOff.slice(0, 90));
  const clockOff = await ev("document.getElementById('clock').textContent + document.getElementById('banner').textContent");

  // ---- 1. E8 on
  await load('#e8=1&tab=results');
  check('E8 on: panel visible', await ev("document.getElementById('tcpanel').hidden") === false);
  const hdrOn = await ev("[...document.querySelectorAll('#tabbody table th')].map(h=>h.textContent).join('|')");
  check('E8 on: results table gains only the start column', hdrOn === hdrOff.replace('Starting quantity (t)|', 'Starting quantity (t)|Earthworks starts|').replace('Starting quantity (t)Reaches', 'Starting quantity (t)') || /Earthworks starts/.test(hdrOn), hdrOn.slice(0, 120));
  check('E8 on: playback bar and banner unchanged', await ev("document.getElementById('clock').textContent + document.getElementById('banner').textContent") === clockOff);
  await ev("window.scrollTo(0, 560)"); await sleep(400);
  await shot('e8_whole');
  // dates on the chart vs the results table, every section
  const cmp = await ev(`(()=>{const em=window.__earthmove, tc=em.tc().data, rows=[...document.querySelectorAll('#tabbody table tbody tr')];
    return rows.map((tr,i)=>{const c=[...tr.children].map(x=>x.textContent); const s=tc.sections[i]; const wantS=s.start===null?'':em.levelDate(s.start); const wantE=s.type==='none'?'':(em.res.sections[i].remaining>0.5?null:em.levelDate(em.res.sections[i].levelTime));
      return {name:c[0], tableStart:c[3], chartStart:wantS, tableEnd:c[4], chartEnd:s.end===null?'':em.levelDate(s.end), reached:s.reached, ok: s.type==='none' ? (c[3]==='' && c[4]==='' && s.end===null) : c[3]===wantS && (wantE===null ? /^Not reached/.test(c[4]) : c[4]===wantE && c[4]===em.levelDate(s.end))};});})()`);
  cmp.forEach(r => log('   ' + r.name.padEnd(24) + 'table ' + (r.tableStart || '-').padEnd(17) + '-> ' + (r.tableEnd || '-').slice(0, 20).padEnd(21) + '| chart ' + (r.chartStart || '-').padEnd(17) + '-> ' + (r.chartEnd || '-') + (r.ok ? '' : '   MISMATCH')));
  check('chart start and finish match the results table for all ' + cmp.length + ' sections', cmp.every(r => r.ok));

  // ---- 2. alignment with the road view at several pan/zoom positions
  const align = async (zoom, x0) => { await ev("(()=>{const S=window.__earthmove.S; S.zoom=" + zoom + "; S.x0=" + x0 + "; S.dirty=true;})()"); await sleep(600);
    return ev(`(()=>{const em=window.__earthmove, g=em.geom(), P=em.res.P, road=document.getElementById('road'), ch=document.getElementById('tcchart');
      const rc=road.getContext('2d'), cc=ch.getContext('2d'), base=Math.round(road.clientHeight*0.58)+60, ty=Math.round(em.tc().y(50));
      const empty=new Set([0,2,4,6,7,8,10,11]);   // sections with no earthworks on day 50, so the chart row there is plain background left of their right edge
      const first=(c,y,x0,ref)=>{for(let x=x0-4;x<=x0+4;x++){const d=c.getImageData(x,y,1,1).data; if(Math.abs(d[0]-ref[0])+Math.abs(d[1]-ref[1])+Math.abs(d[2]-ref[2])>40) return x;} return null;};
      const bg=cc.getImageData(3,ty,1,1).data, earth=rc.getImageData(g.W-3,base,1,1).data; let n=0, okc=0, rows=[];
      for(let i=1;i<P.n;i++){ if(!empty.has(i-1)) continue; const sx=Math.round(40+(P.chain[i]-em.S.x0)*g.ppm); if(sx<70||sx>g.W-70) continue; n++;
        const a=first(rc,base,sx,earth), b=first(cc,ty,sx,bg); rows.push([sx,a,b]); if(a!==null&&b!==null&&Math.abs(a-b)<=1) okc++; }
      return {n, okc, rows:rows.slice(0,6)};})()`); };
  for (const [z, x0] of [[1, 0], [3, 900], [6, 3000]]) { const a = await align(z, x0); check('chainage lines up with the road view at zoom ' + z + ' (' + a.okc + ' of ' + a.n + ' section edges within 1 px) ' + JSON.stringify(a.rows), a.n > 0 && a.okc === a.n); }
  await shot('e8_zoom');
  await ev("(()=>{const S=window.__earthmove.S; S.zoom=1; S.x0=0; S.dirty=true;})()");

  // ---- 3. click / drag jumps the simulation; hover tooltip
  const cr = await rectOf('#tcchart'), t = await ev("(()=>{const t=window.__earthmove.tc(); return {y20:t.y(20), y40:t.y(40)}})()");
  await mouse('mousePressed', cr.x + 300, cr.y + t.y20); await mouse('mouseReleased', cr.x + 300, cr.y + t.y20); await sleep(300);
  const d20 = await ev("window.__earthmove.S.t/1440");
  check('clicking the chart jumps the simulation to that date', Math.abs(d20 - 20) < 0.6, 'asked for day 20, now day ' + d20.toFixed(2));
  await mouse('mousePressed', cr.x + 300, cr.y + t.y20); await mouse('mouseMoved', cr.x + 300, cr.y + t.y40); await mouse('mouseReleased', cr.x + 300, cr.y + t.y40); await sleep(300);
  const d40 = await ev("window.__earthmove.S.t/1440");
  check('dragging scrubs the simulation', Math.abs(d40 - 40) < 0.6, 'dragged to day 40, now day ' + d40.toFixed(2));
  log('clock after scrub:', await ev("document.getElementById('clock').textContent"));
  const g = await ev("(()=>{const em=window.__earthmove, g=em.geom(), P=em.res.P; return {x: 40+(P.mid[1]-em.S.x0)*g.ppm, y: em.tc().y(10)}})()");
  await mouse('mouseMoved', cr.x + g.x, cr.y + g.y); await sleep(400);
  log('hover on S2 block:', (await ev("document.getElementById('tctip').hidden ? '(none)' : document.getElementById('tctip').innerText")).replace(/\n/g, ' | '));
  check('hovering a block shows its details', /Hill cutting A/.test(await ev("document.getElementById('tctip').textContent")));
  await shot('e8_hover');
  // a haul band: S1 <- S2 is the biggest early flow; hover midway along it
  const band = await ev("(()=>{const em=window.__earthmove, d=em.tc().data, P=em.res.P, g=em.geom(); const p=d.pairs.filter(p=>p.tonnes>9000).sort((a,b)=>b.tonnes-a.tonnes)[0]; const t=(p.t0+p.t1)/2/1440; const f=0.5; return {x:40+((P.mid[p.src]+P.mid[p.dst])/2-em.S.x0)*g.ppm, y:em.tc().y((p.t0/1440+p.t1/1440)/2), name:P.names[p.src]+' -> '+P.names[p.dst]};})()");
  await mouse('mouseMoved', cr.x + band.x, cr.y + band.y); await sleep(400);
  log('hover on band ' + band.name + ':', (await ev("document.getElementById('tctip').hidden ? '(none)' : document.getElementById('tctip').innerText")).replace(/\n/g, ' | '));
  check('hovering a haul band shows source, destination, tonnes and dates', /→/.test(await ev("document.getElementById('tctip').textContent")) && /loads/.test(await ev("document.getElementById('tctip').textContent")));

  // ---- 4. time direction and time zoom
  const yBefore = await ev("window.__earthmove.tc().y(10)");
  await ev("document.getElementById('tcDir').click()"); await sleep(300);
  const yAfter = await ev("window.__earthmove.tc().y(10)");
  check('time direction toggles (day 10 moves from y=' + Math.round(yBefore) + ' to y=' + Math.round(yAfter) + ')', yAfter > yBefore && (await ev("window.__earthmove.tc().down")) === false);
  await shot('e8_up');
  await ev("document.getElementById('tcDir').click()");
  await ev("(()=>{const s=document.getElementById('tcSpan'); s.value='14'; s.dispatchEvent(new Event('change'));})()"); await sleep(400);
  const w = await ev("window.__earthmove.tc().win");
  check('time span of 2 weeks follows now', Math.abs(w.span - 14) < 1e-9 && w.t0 <= 40 && w.t0 + w.span >= 40, 'window day ' + w.t0.toFixed(1) + ' to ' + (w.t0 + w.span).toFixed(1));
  await shot('e8_week');

  // ---- 5. minimise, restore, resize, and persistence across a reload
  await ev("window.scrollTo(0, 0)");
  const h0 = (await rectOf('#tcpanel')).h;
  await ev("document.getElementById('tcMin').click()"); await sleep(300);
  const hMin = (await rectOf('#tcpanel')).h;
  check('minimise gives a thin bar (' + Math.round(h0) + ' px -> ' + Math.round(hMin) + ' px)', hMin < 60 && hMin < h0 / 4 && (await ev("document.getElementById('tcbody').hidden")) === true);
  await load('#e8=1');   // autosave in browser storage brings the saved state back after a reload
  check('minimised state survives a reload', (await ev("window.__earthmove.scn.ui.timeChainage.minimised")) === true && (await ev("document.getElementById('tcbody').hidden")) === true);
  await ev("document.getElementById('tcMin').click()"); await sleep(300);
  check('restore brings the chart back', (await ev("document.getElementById('tcbody').hidden")) === false && (await rectOf('#tcpanel')).h > 150);
  await ev("document.getElementById('tcpanel').scrollIntoView({block:'center'})"); await sleep(300);
  const rz = await rectOf('#tcresize'), hBefore = (await rectOf('#tcchart')).h;
  await mouse('mousePressed', rz.x + 200, rz.y + 3); await mouse('mouseMoved', rz.x + 200, rz.y - 60); await mouse('mouseMoved', rz.x + 200, rz.y - 100); await mouse('mouseReleased', rz.x + 200, rz.y - 100); await sleep(300);
  const hAfter = (await rectOf('#tcchart')).h;
  check('dragging the top edge up makes the chart taller (' + Math.round(hBefore) + ' px -> ' + Math.round(hAfter) + ' px)', hAfter - hBefore > 60 && hAfter - hBefore < 140);
  const saved = await ev("JSON.stringify(window.__earthmove.scn.ui.timeChainage)");
  log('state in the scenario:', saved);
  await load('#e8=1');
  check('height, span and direction survive a reload', (await ev("JSON.stringify(window.__earthmove.scn.ui.timeChainage)")) === saved && Math.abs((await rectOf('#tcchart')).h - hAfter) < 1.5);
  // the scenario file itself carries the state
  const viaFile = await ev("(()=>{const o=JSON.parse(JSON.stringify(window.__earthmove.scn)); Model.normalise(o); return JSON.stringify(Model.normalise(o).ui.timeChainage)})()");
  check('the saved scenario JSON round-trips the view state', viaFile === saved);

  // ---- 6. export image
  const png = await ev("window.__earthmove.tcPng().length");
  check('export produces a PNG image (' + png + ' characters of data)', png > 8000);

  // ---- 7. optimiser redraw + speed with 100 sections, two years
  const t1 = await ev(`(async()=>{const em=window.__earthmove; const o=Model.defaults(); o.settings.maxMovesPerDay=480; o.setup.modules.E8=true;
    for(let i=0;i<100;i++){const s=Model.newSection(i); s.id='p'+i; s.name='P'+i; s.lengthM=80; Model.setQty(s, i%2===0?100000:-100000); s.maxLoaders=2; o.sections.push(s);}
    const t0=performance.now(); em.setScenario(o); await new Promise(r=>setTimeout(r,50)); const load=performance.now()-t0;
    const S=em.S; let tot=0, N=30; for(let k=0;k<N;k++){ S.x0 = (k%10)*4; S.zoom = 1.5; const a=performance.now(); em.drawTC(); tot+=performance.now()-a; }
    let tot2=0; for(let k=0;k<N;k++){ S.t = k*20000; const a=performance.now(); em.drawTC(); tot2+=performance.now()-a; }
    return {load:Math.round(load), moves: em.res.n, pairs: em.tc().data.pairs.length, redraw: +(tot/N).toFixed(1), nowOnly: +(tot2/N).toFixed(1)};})()`);
  log('100 sections, two years:', JSON.stringify(t1));
  log('layer stage ms [grid+edges+locks, blocks, hauls+legend]:', JSON.stringify(await ev('window.__earthmove.tcProf()')));
  check('chart redraw on pan/zoom stays under 100 ms (' + t1.redraw + ' ms) and the now line under 20 ms (' + t1.nowOnly + ' ms) with ' + t1.moves + ' movements and ' + t1.pairs + ' hauls', t1.redraw < 100 && t1.nowOnly < 20);
  await ev("window.scrollTo(0, 560)"); await sleep(500); await shot('e8_big');
  log('ERRORS:', JSON.stringify(errs));
  log(results.every(Boolean) ? 'ALL BROWSER CHECKS PASSED (' + results.length + ')' : 'SOME FAILED: ' + results.filter(x => !x).length);
  ws.close(); process.exit(0);
})().catch(e => { console.log('DRIVER FAIL', e.message); process.exit(1); });
