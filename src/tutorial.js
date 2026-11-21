/* Earthmove tutorial runner. It shows the tutorials listed in tutorials.js, one spotlighted step at a time.
 *
 * It changes nothing in the simulation. It uses only window.__earthmove.tutorial (small hooks in ui.js) and the
 * public scenario, and it works on its own copy of an example. While a tutorial runs, ui.js is told not to write to
 * the stored scenario ("sandbox"), and when the tutorial ends the user's own scenario and view are put back exactly.
 *
 * Stored in localStorage under earthmove.tutorial.v1: { declined, firstOffered, done: {id: true}, resume: {id, step}, offered: {moduleId: true} }.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.Tutorial = factory();
    if (typeof document !== 'undefined' && root.__earthmove && root.Tutorials) root.Tutorial.init();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const KEY = 'earthmove.tutorial.v1', SCN_KEY = 'earthmove.scenario.v1', SKIP_KEY = 'earthmove.skip';

  // ---------- pure helpers (also used by the node tests) ----------
  const getPath = (o, p) => String(p).split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const J = v => JSON.stringify(v === undefined ? null : v);
  const parseCheck = s => { const i = String(s).indexOf(':'); return i < 0 ? { name: String(s), arg: '' } : { name: s.slice(0, i), arg: s.slice(i + 1) }; };
  const TARGET_KINDS = ['tab', 'card', 'stat', 'mod', 'level'];
  const TAB_KEYS = ['sections', 'fleet', 'materials', 'site', 'risk', 'commercial', 'rates', 'actuals', 'masshaul', 'results', 'log', 'scenarios', 'messages'];
  const parseTarget = t => { const m = /^(tab|card|stat|mod|level):(.*)$/.exec(String(t)); return m ? { kind: m[1], value: m[2] } : { kind: 'css', value: String(t) }; };
  const completionOf = e => (e.res && e.res.summary ? e.res.summary.completion : null);

  // A check is { init(arg, env) -> baseline, test(arg, env, baseline) -> bool }. env = { st: ui state, scn, res, doc }.
  const checks = {
    playing: { test: (a, e) => !!e.st.playing },
    viewChanged: { init: (a, e) => [e.st.zoom, e.st.x0], test: (a, e, b) => e.st.zoom !== b[0] || e.st.x0 !== b[1] },
    speedChanged: { init: (a, e) => e.st.speedV, test: (a, e, b) => e.st.speedV !== b },
    optOpen: { test: (a, e) => !!e.st.optOpen },
    optimiserDone: { test: (a, e) => e.st.optState === 'done' },
    planApplied: { test: (a, e) => !!e.st.optApplied },
    riskDone: { test: (a, e) => !!e.st.riskDone },
    completionChanged: { init: (a, e) => completionOf(e), test: (a, e, b) => !!e.res && completionOf(e) !== b },
    savedCount: { init: (a, e) => (e.scn.saved || []).length, test: (a, e, b) => (e.scn.saved || []).length > b },
    cmpChanged: { init: (a, e) => [e.st.cmpA, e.st.cmpB], test: (a, e, b) => e.st.cmpA !== b[0] || e.st.cmpB !== b[1] },
    tabIs: { test: (a, e) => e.st.tab === a },
    screenIs: { test: (a, e) => e.st.screen === a },
    levelIs: { test: (a, e) => e.scn.setup.level === a },
    moduleOn: { test: (a, e) => !!e.scn.setup.modules[a] },
    valueChanged: { init: (a, e) => J(getPath(e.scn, a)), test: (a, e, b) => J(getPath(e.scn, a)) !== b },
    fieldChanged: { init: (a, e) => { const f = e.doc.querySelector(a); return f ? f.value : null; }, test: (a, e, b) => { const f = e.doc.querySelector(a); return !!f && f.value !== b; } },
    exists: { test: (a, e) => !!e.doc.querySelector(a) }
  };

  function emptyRecord() { return { declined: false, firstOffered: false, done: {}, resume: null, offered: {} }; }
  function readRecord(storage) {
    try { const o = JSON.parse(storage.getItem(KEY)); if (o && typeof o === 'object') return Object.assign(emptyRecord(), o, { done: o.done || {}, offered: o.offered || {} }); } catch (e) { }
    return emptyRecord();
  }
  function writeRecord(storage, rec) { try { storage.setItem(KEY, JSON.stringify(rec)); } catch (e) { } }

  // ---------- the runner (browser only) ----------
  function init() {
    const em = window.__earthmove, api = em.tutorial, T = window.Tutorials, M = window.Model, doc = document;
    const ls = (() => { try { return window.localStorage; } catch (e) { return { getItem: () => null, setItem: () => { }, removeItem: () => { } }; } })();
    let rec = readRecord(ls), active = null, menu = null, offerEl = null, toastEl = null, toastTimer = null;
    const save = () => writeRecord(ls, rec);

    function h(tag, attrs) { // text nodes only, never innerHTML
      const e = doc.createElement(tag);
      for (const k in attrs || {}) {
        const v = attrs[k];
        if (k === 'class') e.className = v; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
        else if (k === 'disabled' || k === 'hidden') e[k] = v; else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
      }
      for (let i = 2; i < arguments.length; i++) for (const c of [].concat(arguments[i]).flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : doc.createTextNode(c));
      return e;
    }
    const env = () => ({ st: api.state(), scn: em.scn, res: em.res, doc });
    const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const firstVisible = list => { for (const e of list) if (visible(e)) return e; return null; };

    function resolve(target) {
      const t = parseTarget(target);
      try {
        if (t.kind === 'tab') return firstVisible(doc.querySelectorAll('#tabs [data-tab="' + t.value + '"]'));
        if (t.kind === 'card') return firstVisible(doc.querySelectorAll('#tabbody [data-card="' + t.value + '"]'));
        if (t.kind === 'mod') return firstVisible(doc.querySelectorAll('#screenSetup [data-mod="' + t.value + '"]'));
        if (t.kind === 'level') return firstVisible(doc.querySelectorAll('#screenSetup [data-level="' + t.value + '"]'));
        if (t.kind === 'stat') return firstVisible(Array.from(doc.querySelectorAll('#tabbody .stat')).filter(e => { const s = e.querySelector('span'); return s && s.textContent.indexOf(t.value) === 0; }));
        return firstVisible(doc.querySelectorAll(t.value));
      } catch (e) { return null; }
    }

    // What the "auto" actions can do. Also what the browser tests use to play a tutorial through.
    function perform(a) {
      const q = s => doc.querySelector(s), fire = (e, n) => e.dispatchEvent(new Event(n, { bubbles: true }));
      if (a.click) { const e = q(a.click); if (!e) return false; e.click(); return true; }
      if (a.set) { const e = q(a.set); if (!e) return false; e.value = a.value; fire(e, 'input'); fire(e, 'change'); return true; }
      if (a.pick) { const e = q(a.pick); const o = e && Array.from(e.options).find(x => x.textContent.indexOf(a.text) === 0); if (!o) return false; e.value = o.value; fire(e, 'change'); return true; }
      if (a.check) { const e = q(a.check); if (!e) return false; if (e.checked !== a.on) { e.checked = !!a.on; fire(e, 'change'); } return true; }
      return false;
    }

    // ---------- the overlay ----------
    function buildOverlay() {
      const shades = ['t', 'b', 'l', 'r'].map(k => h('div', { class: 'tut-shade', 'data-k': k }));
      const ring = h('div', { class: 'tut-ring' });
      const card = h('div', { class: 'tut-card', role: 'dialog', 'aria-live': 'polite', 'aria-label': 'Tutorial' });
      const rootEl = h('div', { id: 'tutroot' }, shades, ring, card);
      doc.body.append(rootEl);
      return { rootEl, shades, ring, card, key: '' };
    }
    const css = (e, o) => { const s = 'left:' + o.l + 'px;top:' + o.t + 'px;width:' + o.w + 'px;height:' + o.h + 'px'; if (e._s !== s) { e.style.cssText = s; e._s = s; } };

    function renderCard() {
      const A = active, s = A.step, n = A.tut.steps.length, card = A.ov.card;
      card.replaceChildren(...[ // native replaceChildren prints null as text, so the empty slot is dropped
        h('div', { class: 'tut-meta' }, h('span', {}, 'Step ' + (A.idx + 1) + ' of ' + n), h('span', {}, A.tut.title)),
        h('div', { class: 'tut-bar' }, h('i', { style: 'width:' + Math.round((A.idx + 1) / n * 100) + '%' })),
        h('h3', {}, s.title), h('p', {}, s.text),
        s.tryIt ? h('p', { class: 'tut-try' }, h('b', {}, 'Try it: '), s.tryIt, ' ', h('span', { class: 'tut-ok', hidden: true }, '')) : null,
        h('div', { class: 'tut-btns' },
          h('button', { class: 'tut-back', onclick: () => go(-1), disabled: A.idx === 0 }, 'Back'),
          h('button', { class: 'tut-next primary', onclick: () => next(true) }, A.idx === n - 1 ? 'Finish' : 'Next'),
          h('button', { class: 'tut-exit', onclick: () => exit(false) }, 'Exit'))].filter(Boolean));
    }
    function noteDone(text) { const o = active.ov.card.querySelector('.tut-ok'); if (o) { o.textContent = text; o.hidden = !text; } }

    function layout(now) {
      const A = active, s = A.step, vw = window.innerWidth, vh = window.innerHeight, pad = 12, card = A.ov.card;
      let el = s.target ? resolve(s.target) : null;
      if (s.target && !el) { // gone from the screen (a tab changed, a panel re-drew): bring it back
        if (now - A.lastHeal > 600) { A.lastHeal = now; prep(s); }
        el = s.target ? resolve(s.target) : null;
      }
      const cw = card.offsetWidth, ch = card.offsetHeight;
      if (!el) { // nothing to spotlight: dim everything, card in the middle
        css(A.ov.shades[0], { l: 0, t: 0, w: vw, h: vh }); A.ov.shades.slice(1).forEach(e => css(e, { l: 0, t: 0, w: 0, h: 0 })); css(A.ov.ring, { l: 0, t: 0, w: 0, h: 0 });
        card.style.left = Math.max(pad, (vw - cw) / 2) + 'px'; card.style.top = Math.max(pad, (vh - ch) / 2) + 'px'; return;
      }
      let r = el.getBoundingClientRect();
      const tall = r.height > vh - 160;
      if ((tall ? (r.top > vh * 0.7 || r.bottom < 60) : (r.top < 50 || r.bottom > vh - 10)) && now - A.lastScroll > 500) {
        A.lastScroll = now; el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest' }); r = el.getBoundingClientRect();
      }
      const x1 = Math.max(0, r.left - 6), y1 = Math.max(0, r.top - 6), x2 = Math.min(vw, r.right + 6), y2 = Math.min(vh, r.bottom + 6);
      css(A.ov.shades[0], { l: 0, t: 0, w: vw, h: y1 }); css(A.ov.shades[1], { l: 0, t: y2, w: vw, h: Math.max(0, vh - y2) });
      css(A.ov.shades[2], { l: 0, t: y1, w: x1, h: Math.max(0, y2 - y1) }); css(A.ov.shades[3], { l: x2, t: y1, w: Math.max(0, vw - x2), h: Math.max(0, y2 - y1) });
      css(A.ov.ring, { l: x1, t: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) });
      const clampX = x => Math.max(pad, Math.min(vw - cw - pad, x)), clampY = y => Math.max(pad, Math.min(vh - ch - pad, y));
      let x, y;
      if (vh - y2 >= ch + pad * 2) { x = clampX(x1); y = y2 + pad; }
      else if (y1 >= ch + pad * 2) { x = clampX(x1); y = y1 - ch - pad; }
      else if (vw - x2 >= cw + pad * 2) { x = x2 + pad; y = clampY(y1); }
      else if (x1 >= cw + pad * 2) { x = x1 - cw - pad; y = clampY(y1); }
      else { x = vw - cw - pad; y = vh - ch - pad; }
      card.style.left = Math.round(x) + 'px'; card.style.top = Math.round(y) + 'px';
    }

    // ---------- steps ----------
    function prep(s) { // open whatever the step needs on screen
      if (s.ensure) api.ensure(s.ensure);
      const sh = s.show || {}, st = api.state();
      if (sh.screen && st.screen !== sh.screen) api.showScreen(sh.screen);
      if (sh.tab && api.state().tab !== sh.tab) api.setTab(sh.tab);
      if ('opt' in sh && api.state().optOpen !== !!sh.opt) api.openOpt(sh.opt);
      if (sh.tc) api.tcExpand();
      if (sh.details) { const d = doc.querySelector(sh.details); if (d && !d.open) d.open = true; }
    }
    function enter(i, dir, from) {
      const A = active, steps = A.tut.steps;
      clearTimeout(A.adv);
      while (i >= 0 && i < steps.length) {
        prep(steps[i]);
        if (!steps[i].target || resolve(steps[i].target)) break;
        console.warn('[tutorial] skipped ' + A.tut.id + ' step ' + (i + 1) + ': target not found (' + steps[i].target + ')');
        i += dir;
      }
      if (i >= steps.length) return finish();
      if (i < 0) return enter(from == null ? 0 : from, 1);
      A.idx = i; A.step = steps[i]; A.done = false; A.autoRan = false; A.lastHeal = performance.now(); A.lastScroll = 0;
      const e = env(), c = A.step.done ? parseCheck(A.step.done) : null, impl = c && checks[c.name];
      if (c && !impl) console.warn('[tutorial] unknown check "' + A.step.done + '" in ' + A.tut.id + ' step ' + (i + 1));
      A.check = impl ? c : null; A.token = impl && impl.init ? impl.init(c.arg, e) : null;
      A.pre = !!(impl && impl.test(c.arg, e, A.token)); // already true on arrival (for instance after Back): do not skip past it
      rec.resume = { id: A.tut.id, step: i }; save();
      renderCard(); if (A.pre) noteDone('Already done');
    }
    function go(dir) { if (!active) return; clearTimeout(active.adv); enter(active.idx + dir, dir, active.idx); }
    function next(manual) {
      const A = active; if (!A) return;
      if (manual && A.step.autoOnNext && A.step.auto && A.check && !A.done && !A.pre && !A.autoRan) { A.autoRan = true; noteDone('Doing that for you...'); A.step.auto.forEach(perform); return; }
      go(1);
    }
    function poll() {
      const A = active; if (!A || !A.check || A.done || A.pre) return;
      const impl = checks[A.check.name];
      if (impl.test(A.check.arg, env(), A.token)) {
        A.done = true; noteDone('Done'); clearTimeout(A.adv);
        A.adv = setTimeout(() => { if (active === A && A.done) go(1); }, A.step.autoOnNext ? 500 : 900);
      }
    }
    function frame(now) {
      if (!active) return;
      layout(now); if (now - active.lastPoll > 150) { active.lastPoll = now; poll(); }
      active.raf = requestAnimationFrame(frame);
    }

    // ---------- start, finish, exit ----------
    function buildScenario(tut) {
      const sc = M.EXAMPLES[tut.scenario.example](), ids = tut.scenario.modules || [];
      ids.forEach(id => { sc.setup.modules[id] = true; });
      if (ids.length) sc.setup.level = 'custom';
      return sc;
    }
    function start(id, step) {
      const tut = T.byId[id]; if (!tut) return false;
      const st = api.state();
      if (st.replay) { toast('Tutorials are not available in replay mode.'); return false; }
      if (api.busy()) { toast('The optimiser or the risk analysis is still running. Wait for it to finish, then start the tutorial.'); return false; }
      if (active) exit(false);
      closeMenu(); closeOffer();
      const snap = { raw: ls.getItem(SCN_KEY), json: JSON.stringify(em.scn), view: api.view(), skipKey: ls.getItem(SKIP_KEY) };
      api.sandbox(true);
      api.enter(buildScenario(tut));
      active = { tut, snap, idx: 0, step: tut.steps[0], ov: buildOverlay(), lastPoll: 0, lastHeal: 0, lastScroll: 0, adv: 0, raf: 0 };
      const at = Math.max(0, Math.min(tut.steps.length - 1, step | 0));
      for (let j = 0; j < at; j++) if (tut.steps[j].ensure) api.ensure(tut.steps[j].ensure); // resuming: what the earlier steps needed
      enter(at, 1);
      if (active) active.raf = requestAnimationFrame(frame);
      return true;
    }
    function teardown() {
      const A = active; active = null;
      cancelAnimationFrame(A.raf); clearTimeout(A.adv); A.ov.rootEl.remove();
      em.setScenario(JSON.parse(A.snap.json)); api.restore(A.snap.view); // the user's own scenario and view, exactly as they were
      if (ls.getItem(SCN_KEY) !== A.snap.raw) { try { if (A.snap.raw === null) ls.removeItem(SCN_KEY); else ls.setItem(SCN_KEY, A.snap.raw); } catch (e) { } }
      try { if (A.snap.skipKey === null) ls.removeItem(SKIP_KEY); else ls.setItem(SKIP_KEY, A.snap.skipKey); } catch (e) { }
      api.sandbox(false);
      return A;
    }
    function exit(finished) {
      if (!active) return;
      const A = teardown();
      if (finished) { rec.done[A.tut.id] = true; rec.resume = null; } else if (A.idx === 0) rec.resume = null;
      save();
      toast(finished ? 'Tutorial finished. Your own scenario is back as you left it.' : 'Tutorial closed. Your own scenario is back as you left it. You can carry on from the Help menu.');
    }
    function finish() { exit(true); }

    // ---------- small messages and offers ----------
    function toast(text) {
      if (toastEl) toastEl.remove(); clearTimeout(toastTimer);
      toastEl = h('div', { class: 'tut-toast', role: 'status' }, text); doc.body.append(toastEl);
      toastTimer = setTimeout(() => { if (toastEl) toastEl.remove(); toastEl = null; }, 5000);
    }
    function closeOffer() { if (offerEl) offerEl.remove(); offerEl = null; }
    function offer(text, yesLabel, noLabel, onYes, onNo) {
      closeOffer();
      offerEl = h('div', { class: 'tut-offer', role: 'dialog', 'aria-label': 'Tutorial offer' }, h('p', {}, text),
        h('div', { class: 'tut-btns' }, h('button', { class: 'primary', onclick: () => { closeOffer(); onYes(); } }, yesLabel), h('button', { onclick: () => { closeOffer(); if (onNo) onNo(); } }, noLabel)));
      doc.body.append(offerEl);
    }

    // ---------- the Help menu ----------
    function closeMenu() { if (menu) menu.remove(); menu = null; }
    function item(t) {
      return h('button', { class: 'tut-item', 'data-tut': t.id, onclick: () => start(t.id) },
        h('span', { class: 'tut-tick' }, rec.done[t.id] ? '\u2713' : ''), h('span', { class: 'tut-nm' }, t.title), h('small', {}, t.minutes ? t.minutes + ' min' : ''));
    }
    function openMenu() {
      closeMenu();
      const kids = [], r = rec.resume && T.byId[rec.resume.id];
      if (r) kids.push(h('button', { class: 'tut-item tut-resume', 'data-tut': 'resume', onclick: () => start(r.id, rec.resume.step) }, h('span', { class: 'tut-tick' }, '\u25b6'), h('span', { class: 'tut-nm' }, 'Carry on: ' + r.title + ' (step ' + (rec.resume.step + 1) + ' of ' + r.steps.length + ')')));
      kids.push(h('h4', {}, 'Getting started'), T.list.filter(t => t.group === 'start').map(item));
      const G = (window.Modules && window.Modules.GROUPS) || {};
      kids.push(h('h4', {}, 'Optional modules'));
      Object.keys(G).forEach(g => { kids.push(h('h5', {}, G[g])); kids.push(T.list.filter(t => t.module && t.module[0] === g).map(item)); });
      kids.push(h('p', { class: 'tut-note' }, 'Tutorials run on their own example. Your scenario is never changed.'));
      menu = h('div', { id: 'helpmenu', role: 'menu' }, kids);
      const b = doc.getElementById('btnHelp').getBoundingClientRect();
      menu.style.top = Math.round(b.bottom + 4) + 'px'; menu.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - 336, b.left))) + 'px';
      doc.body.append(menu);
    }

    // ---------- wiring ----------
    const helpBtn = doc.getElementById('btnHelp');
    if (helpBtn) helpBtn.addEventListener('click', ev => { ev.stopPropagation(); if (menu) closeMenu(); else if (!active) openMenu(); });
    doc.addEventListener('click', ev => { if (menu && !menu.contains(ev.target)) closeMenu(); });
    window.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { if (active) { ev.preventDefault(); exit(false); } else { closeMenu(); closeOffer(); } return; }
      if (!active || ev.altKey || ev.ctrlKey || ev.metaKey || /^(INPUT|SELECT|TEXTAREA)$/.test((ev.target || {}).tagName || '')) return;
      if (ev.key === 'ArrowRight') { ev.preventDefault(); next(true); } else if (ev.key === 'ArrowLeft') { ev.preventDefault(); go(-1); }
    }, true);
    new MutationObserver(() => { if (active && doc.body.classList.contains('replay')) exit(false); }).observe(doc.body, { attributes: true, attributeFilter: ['class'] });

    // a module ticked on by hand: offer its tutorial once
    doc.addEventListener('earthmove:module-on', ev => {
      const id = ev.detail && ev.detail.id, t = id && T.byModule[id];
      if (!t || active || api.state().replay || rec.offered[id] || rec.done[t.id]) return;
      rec.offered[id] = true; save();
      offer('Show me how ' + t.title.replace(/^\w+ /, '') + ' (' + id + ') works? It takes about ' + t.minutes + ' minutes.', 'Show me', 'Not now', () => start(t.id));
    });

    // first visit: offer the Quick start once, with a "no thanks" that is remembered
    if (!rec.firstOffered && !rec.declined && !rec.resume && !location.hash && !api.state().replay && Object.keys(rec.done).length === 0) {
      rec.firstOffered = true; save();
      setTimeout(() => { if (!active && !api.state().replay) offer('New to Earthmove? Take the 5 minute Quick start. It runs on its own example, so your own work is never touched.', 'Start the Quick start', 'No thanks', () => start('quick'), () => { rec.declined = true; save(); }); }, 900);
    }

    window.Tutorial.api = {
      start, exit, next: () => next(true), back: () => go(-1), perform, resolve, openMenu, closeMenu, record: () => rec,
      active: () => (active ? { id: active.tut.id, idx: active.idx, count: active.tut.steps.length, step: active.step, done: active.done, pre: active.pre } : null),
      resetRecord: () => { rec = emptyRecord(); save(); }
    };
  }

  return { init, checks, getPath, parseCheck, parseTarget, emptyRecord, readRecord, writeRecord, TARGET_KINDS, TAB_KEYS, KEY };
});
