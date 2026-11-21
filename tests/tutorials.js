'use strict';
/* Structural tests for the tutorials (no browser needed). They read src/tutorials.js and src/tutorial.js as data:
 *   node tests/tutorials.js
 * The browser run-through is tests/browser/drive_tutorial.js. */
const fs = require('fs'), path = require('path');
const Modules = require('../src/modules.js');
const Tut = require('../src/tutorials.js');
const Runner = require('../src/tutorial.js');

let pass = 0, fail = 0;
const t = (name, ok, detail) => { if (ok) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? ' (' + detail + ')' : '')); } };
const steps = Tut.list.reduce((a, x) => a.concat(x.steps.map((s, i) => ({ tut: x, s, i }))), []);
const where = o => o.tut.id + ' step ' + (o.i + 1);

console.log('tutorial data');
t('the four guided tutorials exist', ['quick', 'whatif', 'optimise', 'further'].every(id => Tut.byId[id] && Tut.byId[id].group === 'start'));
t('tutorial ids are unique', new Set(Tut.list.map(x => x.id)).size === Tut.list.length);
const missing = Modules.list.filter(m => !Tut.byModule[m.id]).map(m => m.id);
t('every module in the setup list has a tutorial (' + Modules.list.length + ' modules)', Modules.list.length === 29 && !missing.length, 'missing: ' + missing.join(', '));
const extra = Object.keys(Tut.byModule).filter(id => !Modules.byId[id]);
t('no tutorial is for a module that does not exist', !extra.length, extra.join(', '));
const badLen = Tut.list.filter(x => x.module && (x.steps.length < 3 || x.steps.length > 5)).map(x => x.id + ':' + x.steps.length);
t('each module tutorial has three to five steps', !badLen.length, badLen.join(', '));
t('the Quick start has between 10 and 14 steps', Tut.byId.quick.steps.length >= 10 && Tut.byId.quick.steps.length <= 14, String(Tut.byId.quick.steps.length));
t('every tutorial has a title, a blurb and a known example', Tut.list.every(x => x.title && x.blurb && ['simple', 'modules', 'materials', 'site', 'risk', 'commercial', 'stockpile'].includes(x.scenario.example)));
t('module tutorials switch their own module on', Tut.list.filter(x => x.module).every(x => (x.scenario.modules || []).includes(x.module)));
t('a module tutorial names its module in its title', Tut.list.filter(x => x.module).every(x => x.title.indexOf(x.module + ' ') === 0));

console.log('steps');
t('every step has a title and plain text of at most 320 characters', steps.every(o => o.s.title && o.s.text && o.s.text.length <= 320), steps.filter(o => !o.s.title || !o.s.text || o.s.text.length > 320).map(where).join('; '));
t('every step has a target (or null for a centred card)', steps.every(o => o.s.target === null || (typeof o.s.target === 'string' && o.s.target.length)), steps.filter(o => o.s.target === undefined).map(where).join('; '));
const bad = [];
steps.forEach(o => {
  if (o.s.target === null) return;
  const p = Runner.parseTarget(o.s.target);
  if (p.kind === 'tab' && !Runner.TAB_KEYS.includes(p.value)) bad.push(where(o) + ' tab ' + p.value);
  if (p.kind === 'card' && !Modules.byId[p.value]) bad.push(where(o) + ' card ' + p.value);
  if (p.kind === 'mod' && !Modules.byId[p.value]) bad.push(where(o) + ' mod ' + p.value);
  if (p.kind === 'level' && !Modules.LEVELS[p.value]) bad.push(where(o) + ' level ' + p.value);
  if ((p.kind === 'stat' || p.kind === 'css') && !p.value.trim()) bad.push(where(o) + ' empty');
});
t('every named target (tab, card, mod, level, stat) is one the page can resolve', !bad.length, bad.join('; '));
const unknown = steps.filter(o => o.s.done && !(Runner.parseCheck(o.s.done).name in Runner.checks)).map(where);
t('every "done" names a check the runner implements', !unknown.length, unknown.join('; '));
t('every check the data documents is implemented', Object.keys(Tut.CHECKS).every(k => k in Runner.checks));
const noTry = steps.filter(o => o.s.done && (!o.s.tryIt || !Array.isArray(o.s.auto) || !o.s.auto.length)).map(where);
t('every step that completes itself has a try-it line and an auto action', !noTry.length, noTry.join('; '));
const badAuto = steps.filter(o => (o.s.auto || []).some(a => !(('click' in a) || ('set' in a && 'value' in a) || ('pick' in a && 'text' in a) || ('check' in a && 'on' in a)))).map(where);
t('every auto action is click, set, pick or check', !badAuto.length, badAuto.join('; '));
const badShow = steps.filter(o => o.s.show && Object.keys(o.s.show).some(k => !['tab', 'screen', 'opt', 'tc', 'details'].includes(k))).map(where);
t('every show action is one the runner knows', !badShow.length, badShow.join('; '));
const badTab = steps.filter(o => o.s.show && o.s.show.tab && !Runner.TAB_KEYS.includes(o.s.show.tab)).map(where);
t('every tab a step opens exists', !badTab.length, badTab.join('; '));
const badEns = steps.filter(o => (o.s.ensure || []).some(id => !Modules.byId[id])).map(where);
t('every module a step ensures exists', !badEns.length, badEns.join('; '));

console.log('copy rules');
const srcs = ['tutorials.js', 'tutorial.js'].map(f => ({ f, s: fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8') }));
t('no em dashes in the tutorial copy or code', srcs.every(x => x.s.indexOf('—') < 0));
t('the tutorial source is plain ASCII (no invisible or bidirectional characters)', srcs.every(x => !/[^\x00-\x7f]/.test(x.s)), srcs.filter(x => /[^\x00-\x7f]/.test(x.s)).map(x => x.f).join(', '));
t('no step text is a bare placeholder', steps.every(o => !/TODO|XXX|lorem/i.test(o.s.title + o.s.text + (o.s.tryIt || ''))));

console.log('checks (pure)');
const C = Runner.checks, mk = (o) => Object.assign({ st: { tab: 'sections', screen: 'main', zoom: 1, x0: 0, speedV: 45, cmpA: 'cur', cmpB: 'cur' }, scn: { saved: [], setup: { level: 'simple', modules: {} }, settings: { speedKph: 5 }, sections: [{ id: 's1', lines: [{ qty: 5 }] }] }, res: { summary: { completion: 100 } }, doc: { querySelector: () => null } }, o);
const e0 = mk();
t('valueChanged fires only when the value at the path changes', (() => { const b = C.valueChanged.init('settings.speedKph', e0); const e1 = mk(); e1.scn.settings.speedKph = 5; const e2 = mk(); e2.scn.settings.speedKph = 9; return !C.valueChanged.test('settings.speedKph', e1, b) && C.valueChanged.test('settings.speedKph', e2, b); })());
t('valueChanged sees a change deep in a table', (() => { const b = C.valueChanged.init('sections', e0); const e1 = mk(); e1.scn.sections[0].lines[0].qty = 6; return C.valueChanged.test('sections', e1, b); })());
t('viewChanged and speedChanged compare against the starting point', (() => { const b = C.viewChanged.init('', e0), s = C.speedChanged.init('', e0); const e1 = mk(); e1.st.zoom = 2; const e2 = mk(); e2.st.speedV = 80; return !C.viewChanged.test('', e0, b) && C.viewChanged.test('', e1, b) && !C.speedChanged.test('', e0, s) && C.speedChanged.test('', e2, s); })());
t('completionChanged ignores a model that is blocked (no results)', (() => { const b = C.completionChanged.init('', e0); const e1 = mk({ res: null }); const e2 = mk(); e2.res.summary.completion = 120; return !C.completionChanged.test('', e1, b) && C.completionChanged.test('', e2, b); })());
t('savedCount needs one more saved scenario than at the start', (() => { const b = C.savedCount.init('', e0); const e1 = mk(); e1.scn.saved = [{}]; return !C.savedCount.test('', e0, b) && C.savedCount.test('', e1, b); })());
t('tabIs, screenIs, levelIs and moduleOn read the current state', C.tabIs.test('sections', e0) && !C.tabIs.test('results', e0) && C.screenIs.test('main', e0) && C.levelIs.test('simple', e0) && !C.moduleOn.test('B3', e0));
t('parseCheck splits at the first colon only', JSON.stringify(Runner.parseCheck('fieldChanged:#a:b')) === JSON.stringify({ name: 'fieldChanged', arg: '#a:b' }));

console.log('stored progress');
const mem = (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; })();
t('with nothing stored the record is empty', JSON.stringify(Runner.readRecord(mem)) === JSON.stringify(Runner.emptyRecord()));
t('a record survives a write and a read', (() => { const r = Runner.emptyRecord(); r.done.quick = true; r.resume = { id: 'optimise', step: 3 }; r.declined = true; Runner.writeRecord(mem, r); const b = Runner.readRecord(mem); return b.done.quick === true && b.resume.step === 3 && b.declined === true; })());
t('a damaged record is ignored rather than breaking the page', (() => { mem.setItem(Runner.KEY, '{not json'); return JSON.stringify(Runner.readRecord(mem)) === JSON.stringify(Runner.emptyRecord()); })());

console.log(pass + ' passed, ' + fail + ' failed');
console.log(fail ? 'FAILED' : 'ALL PASSED');
process.exit(fail ? 1 : 0);
