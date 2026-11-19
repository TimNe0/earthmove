'use strict';
/* Plain-job speed of an engine directory. Prints the fastest and the median of many runs for a 12-section job and a 100-section job,
 * with and without the movement log. Compare two engines by running this for each, alternately, several times
 * (this machine's timings swing about 2x between runs, so judge by the minimum and only differences larger than the noise).
 *   node tests/perf.js .baseline/src      node tests/perf.js src
 */
const path = require('path');
const dir = path.resolve(process.argv[2] || 'src');
const E = require(path.join(dir, 'engine.js')), M = require(path.resolve(__dirname, '../src/model.js'));
function big() {
  const o = M.defaults(); o.settings.maxMovesPerDay = 480;
  for (let i = 0; i < 100; i++) { const s = M.newSection(i); s.id = 'p' + i; M.setQty(s, (i % 2 ? -1 : 1) * 40000); o.sections.push(s); }
  return M.normalise(o);
}
function bench(name, scn, n, opts) {
  const P = E.prepare(scn), t = []; let moves = 0;
  for (let k = 0; k < n; k++) { const a = process.hrtime.bigint(); const r = E.simulate(scn, Object.assign({ P }, opts)); moves = r.n; t.push(Number(process.hrtime.bigint() - a) / 1e6); }
  t.sort((x, y) => x - y);
  return name + ' (' + moves + ' moves) min ' + t[0].toFixed(2) + ' med ' + t[n >> 1].toFixed(2);
}
const s12 = M.exampleSimple(), s100 = big();
console.log(path.relative(process.cwd(), dir).padEnd(14), '|', bench('S12 noLog', s12, 150, { noLog: true }), '|', bench('S12 log', s12, 60, {}), '|', bench('S100 noLog', s100, 15, { noLog: true }));
