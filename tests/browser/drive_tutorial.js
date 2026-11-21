/* Tutorials end to end in a real page: every tutorial run start to finish, the user's own scenario left exactly as it was,
 * the first-visit and module offers, the Tutorials menu, keys, replay mode, and a step whose target is missing.
 * Runs against Chrome on 127.0.0.1:9222 with the `ws` package (the same set-up as the other drivers in this folder).
 * usage: node drive_tutorial.js <url-of-earthmove.html> [tutorial-id ...]     (ids limit the run-through; the other checks always run) */
const WebSocket = require('ws'), http = require('http');
const URL_ = process.argv[2], ONLY = process.argv.slice(3);
const get = u => new Promise((res, rej) => http.get(u, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let targets; for (let i = 0; i < 30; i++) { try { targets = await get('http://127.0.0.1:9222/json'); if (targets.length) break; } catch (e) { } await sleep(300); }
  const page = targets.find(t => t.type === 'page'); const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pend = {}, errs = [], warns = [];
  ws.on('message', m => {
    const d = JSON.parse(m); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') errs.push('EXC ' + JSON.stringify((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description) || d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled') {
      const txt = d.params.args.map(a => a.value || a.description).join(' ');
      if (d.params.type === 'error') errs.push('CONSOLE ' + txt);
      if (d.params.type === 'warning' && /\[tutorial\]/.test(txt)) warns.push(txt);
    }
  });
  const send = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails.text)); return r.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  const results = []; const check = (name, okv, detail) => { results.push(!!okv); console.log((okv ? 'PASS ' : 'FAIL ') + name + (detail !== undefined && !okv ? ' (' + detail + ')' : '')); };
  const load = async (hash, clear) => {
    await send('Page.navigate', { url: 'about:blank' }); await sleep(250);
    if (clear) { await send('Page.navigate', { url: URL_ }); await sleep(1500); await ev('localStorage.clear(); 1'); await send('Page.navigate', { url: 'about:blank' }); await sleep(250); }
    await send('Page.navigate', { url: URL_ + (hash || '') }); await sleep(2200);
  };
  const key = k => send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: { Escape: 27, ArrowRight: 39, ArrowLeft: 37 }[k] }).then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: { Escape: 27, ArrowRight: 39, ArrowLeft: 37 }[k] }));

  // Runs inside the page. Plays one tutorial from the first step to the end, checking each step as it goes.
  const RUN = `(async (tid) => {
    const T = window.Tutorial.api, sleep = ms => new Promise(r => setTimeout(r, ms)), out = { id: tid, steps: [], problems: [] };
    if (!T.start(tid)) { out.problems.push('could not start'); return out; }
    let guard = 0;
    while (T.active() && guard++ < 60) {
      const a = T.active(), s = a.step, n = a.idx + 1, rec = { n, title: s.title }; out.steps.push(rec);
      let vis = !s.target, t0 = Date.now(), el = null;
      while (!vis && Date.now() - t0 < 3000) { await sleep(120); el = T.resolve(s.target); if (el) { const r = el.getBoundingClientRect(); vis = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; } }
      if (!vis) out.problems.push('step ' + n + ' (' + s.title + '): target ' + s.target + (el ? ' is off screen' : ' not found'));
      await sleep(150);
      const card = document.querySelector('.tut-card'); const txt = card ? card.textContent : '';
      if (!card || !txt.includes(s.title)) out.problems.push('step ' + n + ': card missing or wrong');
      if (/null|undefined|NaN/.test(txt)) out.problems.push('step ' + n + ': stray null/undefined/NaN on the card');
      if (a.pre) out.problems.push('step ' + n + ': already done on arrival');
      if (s.done) {
        for (const act of s.auto) if (!T.perform(act)) out.problems.push('step ' + n + ': auto action found nothing ' + JSON.stringify(act));
        const t1 = Date.now(); while (T.active() && T.active().idx === a.idx && Date.now() - t1 < 30000) await sleep(100);
        rec.advanced = !T.active() || T.active().idx !== a.idx;
        if (!rec.advanced) out.problems.push('step ' + n + ' (' + s.title + '): doing it did not move on');
      } else { T.next(); await sleep(60); }
    }
    out.finished = !T.active(); out.count = out.steps.length;
    return out;
  })`;

  // ---- 1. every tutorial, start to finish ----
  await load('#example=simple', true);
  const ids = await ev('Tutorials.list.map(t => t.id)');
  const counts = await ev('Object.fromEntries(Tutorials.list.map(t => [t.id, t.steps.length]))');
  for (const tid of ids) {
    if (ONLY.length && !ONLY.includes(tid)) continue;
    const before = warns.length;
    const r = await ev(RUN + '(' + JSON.stringify(tid) + ')');
    const skipped = warns.slice(before);
    check('tutorial ' + tid + ': every step\'s target is on screen, every try-it moves on, and it finishes (' + r.count + ' of ' + counts[tid] + ' steps)',
      r.finished && r.count === counts[tid] && !r.problems.length && !skipped.length, r.problems.concat(skipped).join(' | ') || ('ran ' + r.count + ', finished ' + r.finished));
  }
  check('after all of them the tutorials are ticked in the record', await ev('Object.keys(Tutorial.api.record().done).length') === (ONLY.length || ids.length));

  // ---- 2. the user's own scenario is untouched by a tutorial that is left partway ----
  const SNAP = `(() => { const em = window.__earthmove; return JSON.stringify({ raw: localStorage.getItem('earthmove.scenario.v1'), scn: JSON.stringify(em.scn), view: em.tutorial.view(), skip: localStorage.getItem('earthmove.skip'),
    speed: document.getElementById('speed').value, skipBox: document.getElementById('skipIdle').checked, name: document.getElementById('scnname').value, tab: em.S.tab, screen: em.S.screen, badge: document.getElementById('modbadge').textContent, optHidden: document.getElementById('optpanel').hidden }); })()`;
  async function prepareOwn() {
    await load('#example=modules', true);
    await ev(`(async () => { const em = window.__earthmove, q = s => document.querySelector(s), sl = ms => new Promise(r => setTimeout(r, ms));
      em.S.tab = 'scenarios'; em.recompute(true); await sl(200);
      q('#savename').value = 'Mine one'; q('#savebtn').click(); await sl(200); q('#savename').value = 'Mine two'; q('#savebtn').click(); await sl(200);
      const sec = em.scn.sections[2]; sec.name = 'My own edit'; em.scn.settings.maxMovesPerDay = 137; em.recompute(true); await sl(300);
      em.S.zoom = 2; em.S.x0 = 1500; em.S.t = 40000; em.S.tab = 'fleet'; em.recompute(true);
      const sp = q('#speed'); sp.value = 72; sp.dispatchEvent(new Event('input', { bubbles: true }));
      const sk = q('#skipIdle'); sk.checked = false; sk.dispatchEvent(new Event('change', { bubbles: true }));
      await sl(300); return 1; })()`);
  }
  async function partway(tid, upToStep, label) {
    await prepareOwn();
    const before = JSON.parse(await ev(SNAP));
    check(label + ': the stored scenario equals the live one before starting (so the comparison is fair)', before.raw === before.scn);
    await ev(`(async () => { const T = Tutorial.api, sl = ms => new Promise(r => setTimeout(r, ms)); T.start(${JSON.stringify(tid)});
      while (T.active() && T.active().idx < ${upToStep}) { await sl(200); const a = T.active(), s = a.step; if (s.done) { s.auto.forEach(T.perform); const t0 = Date.now(); while (T.active() && T.active().idx === a.idx && Date.now() - t0 < 30000) await sl(100); } else T.next(); }
      await sl(300); return 1; })()`);
    const mid = JSON.parse(await ev(SNAP));
    check(label + ': while the tutorial runs, nothing is written to the stored scenario', mid.raw === before.raw);
    check(label + ': the tutorial really is running on its own example', (await ev('window.__earthmove.scn.name')) !== 'My own edit' && (await ev('Tutorial.api.active() && Tutorial.api.active().idx')) === upToStep);
    await key('Escape'); await sleep(700);
    check(label + ': Escape closes the tutorial', (await ev('Tutorial.api.active()')) === null && (await ev('!document.getElementById("tutroot")')));
    const after = JSON.parse(await ev(SNAP));
    check(label + ': my scenario is identical afterwards (' + before.scn.length + ' characters, 2 saved scenarios, my edits)', after.scn === before.scn, 'differs');
    check(label + ': the stored copy is byte-identical', after.raw === before.raw);
    check(label + ': my view is as I left it (time, zoom, position, tab, speed, skip, optimiser, comparison)', JSON.stringify(after.view) === JSON.stringify(before.view) && after.tab === before.tab && after.speed === before.speed && after.skipBox === before.skipBox && after.skip === before.skip && after.screen === before.screen && after.optHidden === before.optHidden, JSON.stringify(after.view).slice(0, 200) + ' vs ' + JSON.stringify(before.view).slice(0, 200));
    check(label + ': the top bar line and name are mine again', after.badge === before.badge && after.name === before.name);
    return before;
  }
  await partway('quick', 8, 'quick start left at step 9');
  await partway('whatif', 5, 'what-if left at step 6');
  const own = await partway('optimise', 6, 'optimising left after "Use this plan"');
  await ev('Tutorial.api.start("quick"); 1'); await sleep(500); await key('Escape'); await sleep(500);

  // ---- 3. leaving the page partway, then carrying on ----
  await prepareOwn();
  const keep = JSON.parse(await ev(SNAP));
  await ev(`(async () => { const T = Tutorial.api, sl = ms => new Promise(r => setTimeout(r, ms)); T.start('quick');
    while (T.active() && T.active().idx < 4) { await sl(200); const a = T.active(), s = a.step; if (s.done) { s.auto.forEach(T.perform); const t0 = Date.now(); while (T.active() && T.active().idx === a.idx && Date.now() - t0 < 30000) await sl(100); } else T.next(); }
    await sl(300); return 1; })()`);
  await send('Page.navigate', { url: URL_ }); await sleep(2500); // the page again, without the example link
  const rawAfterReload = await ev('localStorage.getItem("earthmove.scenario.v1")');
  check('closing the page during a tutorial leaves my stored scenario unchanged', rawAfterReload === keep.raw);
  check('the page remembers where I stopped', await ev('JSON.stringify(Tutorial.api.record().resume)') === '{"id":"quick","step":4}');
  await ev('document.getElementById("btnHelp").click(); 1'); await sleep(200);
  check('the Tutorials menu offers to carry on from that step', await ev('(document.querySelector(".tut-resume .tut-nm") || {}).textContent') === 'Carry on: Quick start (step 5 of 13)');
  await ev('document.querySelector(".tut-resume").click(); 1'); await sleep(900);
  check('carrying on resumes at step 5', await ev('Tutorial.api.active() && Tutorial.api.active().idx') === 4);
  await key('Escape'); await sleep(500);
  check('and leaving again still restores my scenario', (await ev('localStorage.getItem("earthmove.scenario.v1")')) === keep.raw && (await ev('JSON.stringify(window.__earthmove.scn)')) === keep.scn);

  // ---- 4. first visit, "no thanks", and the offer for a module ----
  await load('', true);
  await sleep(1200);
  check('first visit: the Quick start is offered', await ev('!!document.querySelector(".tut-offer") && /Quick start/.test(document.querySelector(".tut-offer").textContent)'));
  await ev('[...document.querySelectorAll(".tut-offer button")].find(b => b.textContent === "No thanks").click(); 1'); await sleep(200);
  check('"No thanks" closes it and is remembered', (await ev('!document.querySelector(".tut-offer")')) && (await ev('Tutorial.api.record().declined')) === true);
  await send('Page.reload'); await sleep(3000);
  check('it does not come back on the next visit', await ev('!document.querySelector(".tut-offer")'));
  await load('#example=simple', true); await sleep(1500);
  check('opening with a link that has start-up options does not offer it', await ev('!document.querySelector(".tut-offer")'));
  await ev('document.getElementById("btnSetup").click(); 1'); await sleep(200);
  await ev('document.querySelector("#screenSetup [data-mod=B3] input").click(); 1'); await sleep(600);
  check('switching a module on offers its tutorial', await ev('!!document.querySelector(".tut-offer") && /B3/.test(document.querySelector(".tut-offer").textContent)'));
  await ev('[...document.querySelectorAll(".tut-offer button")].find(b => b.textContent === "Show me").click(); 1'); await sleep(900);
  check('"Show me" starts that module\'s tutorial', await ev('Tutorial.api.active() && Tutorial.api.active().id') === 'mod-B3');
  await key('Escape'); await sleep(500);
  check('my setup screen and my ticked module are back after it', (await ev('window.__earthmove.S.screen')) === 'setup' && (await ev('window.__earthmove.scn.setup.modules.B3')) === true);
  await ev('document.querySelector("#screenSetup [data-mod=B3] input").click(); 1'); await sleep(300);
  await ev('document.querySelector("#screenSetup [data-mod=B3] input").click(); 1'); await sleep(600);
  check('the same module is not offered twice', await ev('!document.querySelector(".tut-offer")'));
  await ev('document.querySelector("#screenSetup [data-level=detailed]").click(); 1'); await sleep(600);
  check('a level that switches on many modules at once offers nothing', await ev('!document.querySelector(".tut-offer")'));

  // ---- 5. the Tutorials menu, the keys, a missing target ----
  await load('#example=simple', true);
  await ev('document.getElementById("btnHelp").click(); 1'); await sleep(200);
  const menuIds = await ev('[...document.querySelectorAll("#helpmenu .tut-item[data-tut]")].map(b => b.dataset.tut).filter(x => x !== "resume")');
  check('the Tutorials menu lists every tutorial (' + ids.length + ')', ids.every(x => menuIds.includes(x)) && menuIds.length === ids.length);
  await ev('document.getElementById("btnSetup").click(); 1'); await sleep(200);
  const rows = await ev('[...document.querySelectorAll("#screenSetup [data-mod]")].map(r => r.dataset.mod)');
  check('every module row on the Setup screen has a tutorial in the Tutorials menu (' + rows.length + ' rows)', rows.length === 29 && rows.every(m => menuIds.includes('mod-' + m)));
  await ev('document.getElementById("btnSetup").click(); document.getElementById("helpmenu") && document.getElementById("helpmenu").remove(); 1');
  await ev('Tutorial.api.start("quick"); 1'); await sleep(500);
  await key('ArrowRight'); await sleep(200);
  check('the right arrow key goes to the next step', await ev('Tutorial.api.active().idx') === 1);
  await key('ArrowLeft'); await sleep(200);
  check('the left arrow key goes back', await ev('Tutorial.api.active().idx') === 0);
  check('Back is not available on the first step', await ev('document.querySelector(".tut-back").disabled'));
  check('the card shows the step number and the tutorial name', await ev('/Step 1 of 13/.test(document.querySelector(".tut-card").textContent) && /Quick start/.test(document.querySelector(".tut-card").textContent)'));
  await ev('document.querySelector(".tut-next").click(); 1'); await sleep(200);
  await ev('(async () => { const T = Tutorial.api; while (T.active().idx < 8) { const a = T.active(); if (a.step.done) { a.step.auto.forEach(T.perform); const t0 = Date.now(); while (T.active() && T.active().idx === a.idx && Date.now() - t0 < 20000) await new Promise(r => setTimeout(r, 100)); } else T.next(); } return 1; })()');
  await ev('document.getElementById("counter").style.display = "none"; 1'); // the spotlighted thing vanishes
  const w0 = warns.length;
  await ev('Tutorial.api.next(); 1'); await sleep(500);
  check('a step whose target is gone is skipped, with a warning in the console', (await ev('Tutorial.api.active().step.title')) === 'The daily chart' && warns.length === w0 + 1 && /Daily movements|#counter/.test(warns[warns.length - 1]), warns.slice(w0).join('|'));
  await ev('Tutorial.api.exit(); 1'); await sleep(400);

  await ev('document.getElementById("btnHelp").click(); 1'); await sleep(200);
  check('a finished tutorial can be started again from the menu', await ev('(async () => { const T = Tutorial.api; T.start("mod-B1"); await new Promise(r => setTimeout(r, 300)); T.next(); T.exit(); T.start("mod-B1"); await new Promise(r => setTimeout(r, 300)); const ok = T.active() && T.active().id === "mod-B1"; T.exit(); return ok; })()'));
  await ev('Tutorial.api.openMenu(); 1'); await sleep(200);
  await ev('document.querySelector(".tut-reset").click(); 1'); await sleep(300);
  check('"Reset tutorial progress" clears the ticks, the declined flag and the offers', await ev('JSON.stringify(Tutorial.api.record())') === '{"declined":false,"firstOffered":false,"done":{},"resume":null,"offered":{}}');

  // ---- 6. replay mode ----
  await load('#replay=1', true); await sleep(800);
  check('replay mode: the Tutorials button is hidden', await ev('getComputedStyle(document.getElementById("btnHelp")).display') === 'none');
  check('replay mode: a tutorial refuses to start', (await ev('Tutorial.api.start("quick")')) === false && (await ev('Tutorial.api.active()')) === null);
  check('replay mode: nothing is offered', await ev('!document.querySelector(".tut-offer")'));

  check('no page errors during the whole run', errs.length === 0, errs.slice(0, 5).join(' | '));
  console.log(results.every(Boolean) ? 'ALL PASSED' : 'FAILED ' + results.filter(x => !x).length);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(2); });
