// Синтетическая проверка: «рисуем» символ с искажениями, как это делает человек пальцем
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; const R = (a, b) => a + (b - a) * rnd();

const HIRA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ';
const KATA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポー';

function distort(raw, level) {
  let st = raw.map(s => { const r = []; for (let i = 0; i < s.length; i += 2) r.push({ x: s[i] / 10, y: s[i + 1] / 10 }); return r; });
  const rot = R(-0.14, 0.14) * level, sh = R(-0.2, 0.2) * level, sx = 1 + R(-0.2, 0.2) * level, sy = 1 + R(-0.2, 0.2) * level;
  st = st.map(s => {
    const ox = R(-5, 5) * level, oy = R(-5, 5) * level, sc = 1 + R(-0.2, 0.2) * level;   // каждый штрих чуть сдвинут и другого размера
    const cx = s.reduce((a, p) => a + p.x, 0) / s.length, cy = s.reduce((a, p) => a + p.y, 0) / s.length;
    const ph = R(0, 6), amp = R(0, 1.6) * level;
    let r = s.map((p, i) => ({ x: cx + (p.x - cx) * sc + ox + amp * Math.sin(i / 3 + ph), y: cy + (p.y - cy) * sc + oy + amp * Math.cos(i / 4 + ph) }));
    if (rnd() < 0.12 * level) r.reverse();                         // штрих в обратную сторону
    const trim = Math.floor(r.length * R(0, 0.12) * level); if (r.length - trim > 2) r = rnd() < .5 ? r.slice(trim) : r.slice(0, r.length - trim);
    return r;
  });
  if (st.length > 1 && rnd() < 0.25 * level) { const i = Math.floor(rnd() * (st.length - 1)); st.splice(i, 2, st[i].concat(st[i + 1])); }
  return st.map(s => s.map(p => { const x = p.x - 54, y = p.y - 54; return { x: (x * Math.cos(rot) - y * Math.sin(rot) + sh * y) * sx * 3, y: (x * Math.sin(rot) + y * Math.cos(rot)) * sy * 3 }; }));
}


module.exports={distort,HIRA,KATA,rnd};
