require('../src/recognizer.js');
const kvg = require('../src/kvg.json');
const { Recognizer, judge } = globalThis.KanaRec;
const {distort,HIRA,KATA,rnd}=require('./synth.js');
const rec = new Recognizer(kvg);
for (const [name, set] of [['hira', HIRA], ['kata', KATA]]) {
  const cands = [...set];
  for (const level of [0.6, 1.0, 1.4]) {
    let top1 = 0, acc = 0, n = 0, falseAcc = 0, fn = 0; const conf = {}; const t0 = Date.now();
    for (const ch of cands) for (let k = 0; k < 3; k++) {
      const drawn = distort(kvg[ch], level);
      const ranked = rec.rank(drawn, cands); n++;
      if (ranked[0].ch === ch) top1++; else conf[ch + '→' + ranked[0].ch] = (conf[ch + '→' + ranked[0].ch] || 0) + 1;
      if (judge(ranked, ch, 1).ok) acc++;
      // ложный приём: нарисован другой символ (случайный), а ждали ch
      const other = cands[Math.floor(rnd() * cands.length)]; if (other !== ch) { fn++; const rk = rec.rank(distort(kvg[other], level), cands); if (judge(rk, ch, 1).ok) falseAcc++; }
    }
    console.log(name, 'level', level, 'top1', (top1 / n * 100).toFixed(1) + '%', 'accepted', (acc / n * 100).toFixed(1) + '%', 'false-accept', (falseAcc / fn * 100).toFixed(2) + '%', 'ms/char', ((Date.now() - t0) / n / 2).toFixed(1));
    console.log('  confusions:', Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 18).map(e => e.join(':')).join(' '));
  }
}
