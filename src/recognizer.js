/* Распознаватель рукописной каны без ИИ.
   Метод: сравнение облаков точек ($P point-cloud recognizer, Vatavu/Anthony/Wobbrock 2012),
   расширенный направлением штриха (каждая точка = x, y, dx·W, dy·W).
   Эталоны: штрихи KanjiVG + автоматически созданные варианты написания
   (слитные штрихи, наклон, особые формы) + собственный почерк пользователя. */
(function (root) {
  let N = 48;            // точек на символ
  let W = 0.2;          // вес направления штриха

  function pathLen(p) { let d = 0; for (let i = 1; i < p.length; i++) d += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y); return d; }

  // strokes: [[{x,y},...],...] -> N точек с id штриха, ресемплинг по общей длине
  function resample(strokes, n) {
    const ss = strokes.filter(s => s.length > 0).map(s => s.length === 1 ? [s[0], { x: s[0].x + 0.01, y: s[0].y + 0.01 }] : s);
    const total = ss.reduce((a, s) => a + pathLen(s), 0) || 1;
    const I = total / (n - 1);
    const out = [];
    let D = 0;
    ss.forEach((s, sid) => {
      let prev = s[0];
      out.push({ x: prev.x, y: prev.y, s: sid });
      D = 0;
      for (let i = 1; i < s.length; i++) {
        let cur = s[i];
        let d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
        while (D + d >= I && d > 0) {
          const t = (I - D) / d;
          const q = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y), s: sid };
          out.push(q); prev = q; d = Math.hypot(cur.x - prev.x, cur.y - prev.y); D = 0;
        }
        D += d; prev = cur;
      }
    });
    // подгоняем количество точек ровно к n
    while (out.length > n) {
      // удаляем точку из самого плотного места
      let bi = 1, bd = Infinity;
      for (let i = 1; i < out.length - 1; i++) { const d = Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y); if (d < bd) { bd = d; bi = i; } }
      out.splice(bi, 1);
    }
    while (out.length < n) out.push({ ...out[out.length - 1] });
    return out;
  }

  function normalize(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const size = Math.max(maxX - minX, maxY - minY) || 1;
    let cx = 0, cy = 0;
    const q = pts.map(p => ({ x: (p.x - minX) / size, y: (p.y - minY) / size, s: p.s }));
    for (const p of q) { cx += p.x; cy += p.y; }
    cx /= q.length; cy /= q.length;
    for (const p of q) { p.x -= cx; p.y -= cy; }
    // направление: касательная внутри штриха
    for (let i = 0; i < q.length; i++) {
      const a = (i > 0 && q[i - 1].s === q[i].s) ? q[i - 1] : q[i];
      const b = (i < q.length - 1 && q[i + 1].s === q[i].s) ? q[i + 1] : q[i];
      let dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy);
      if (l > 1e-9) { dx /= l; dy /= l; } else { dx = 0; dy = 0; }
      q[i].u = dx * W; q[i].v = dy * W;
    }
    return q;
  }

  function prepare(strokes) { return normalize(resample(strokes, N)); }

  function cloudDistance(a, b, start, minSoFar) {
    const n = a.length, matched = new Uint8Array(n);
    let sum = 0, i = start, weight = n;
    do {
      let idx = -1, min = Infinity;
      const p = a[i];
      for (let j = 0; j < n; j++) if (!matched[j]) {
        const q = b[j];
        const dx = p.x - q.x, dy = p.y - q.y, du = p.u - q.u, dv = p.v - q.v;
        const d = Math.sqrt(dx * dx + dy * dy + du * du + dv * dv);
        if (d < min) { min = d; idx = j; }
      }
      matched[idx] = 1; sum += weight * min;
      if (sum >= minSoFar) return sum;
      weight--; i = (i + 1) % n;
    } while (i !== start);
    return sum;
  }

  function greedy(a, b, best) {
    const n = a.length, step = Math.floor(Math.pow(n, 0.5));
    let min = best;
    for (let i = 0; i < n; i += step) {
      min = Math.min(min, cloudDistance(a, b, i, min), cloudDistance(b, a, i, min));
    }
    return min;
  }

  // ---- направленные карты признаков (directional element feature, классический признак OCR) ----
const G=16;
function defFeat(strokes){
  let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;
  for(const s of strokes)for(const p of s){a=Math.min(a,p.x);c=Math.max(c,p.x);b=Math.min(b,p.y);d=Math.max(d,p.y)}
  const size=Math.max(c-a,d-b)||1, ox=(size-(c-a))/2, oy=(size-(d-b))/2;
  const F=new Float32Array(4*G*G);
  const put=(x,y,o,w)=>{ // билинейно + размытие делаем потом
    const gx=x*(G-1),gy=y*(G-1),ix=Math.floor(gx),iy=Math.floor(gy),fx=gx-ix,fy=gy-iy;
    for(const [dx,dy,ww] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){const X=ix+dx,Y=iy+dy;if(X<G&&Y<G)F[o*G*G+Y*G+X]+=w*ww}
  };
  for(const s of strokes){
    if(s.length===1){const x=(s[0].x-a+ox)/size,y=(s[0].y-b+oy)/size;for(let o=0;o<4;o++)put(x,y,o,0.3);continue}
    for(let i=1;i<s.length;i++){
      const x0=(s[i-1].x-a+ox)/size,y0=(s[i-1].y-b+oy)/size,x1=(s[i].x-a+ox)/size,y1=(s[i].y-b+oy)/size;
      const dx=x1-x0,dy=y1-y0,L=Math.hypot(dx,dy);if(L<1e-6)continue;
      const ang=Math.atan2(dy,dx); // ориентация без знака: 4 плоскости
      const steps=Math.max(1,Math.ceil(L*G*2));
      for(let k=0;k<steps;k++){const t=(k+.5)/steps,x=x0+dx*t,y=y0+dy*t;
        for(let o=0;o<4;o++){const w=Math.max(0,Math.cos(2*(ang-o*Math.PI/4)));if(w>0)put(x,y,o,w*L/steps*G)}}
    }
  }
  // размытие 3x3 дважды
  for(let pass=0;pass<2;pass++){const T=new Float32Array(F.length);
    for(let o=0;o<4;o++)for(let y=0;y<G;y++)for(let x=0;x<G;x++){let s=0,n=0;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const X=x+i,Y=y+j;if(X>=0&&Y>=0&&X<G&&Y<G){const w=(i==0?2:1)*(j==0?2:1);s+=F[o*G*G+Y*G+X]*w;n+=w}}T[o*G*G+y*G+x]=s/n}
    F.set(T)}
  let nn=0;for(const v of F)nn+=v*v;nn=Math.sqrt(nn)||1;for(let i=0;i<F.length;i++)F[i]/=nn;return F;
}
function defDist(A,B){let s=0;for(let i=0;i<A.length;i++)s+=A[i]*B[i];return 1-s}


  // ---- варианты написания ----
  const P = (s) => { const r = []; for (let i = 0; i < s.length; i += 2) r.push({ x: s[i] / 10, y: s[i + 1] / 10 }); return r; };
  function shear(strokes, k) { return strokes.map(s => s.map(p => ({ x: p.x - k * (p.y - 54), y: p.y }))); }
  function join(strokes, i) {
    const r = strokes.slice(0, i).concat([strokes[i].concat(strokes[i + 1])], strokes.slice(i + 2));
    return r;
  }
  function splitAt(strokes, si, frac, gap) {
    const s = strokes[si], k = Math.round(s.length * frac);
    return strokes.slice(0, si).concat([s.slice(0, k), s.slice(k + gap)], strokes.slice(si + 1));
  }
  // особые формы, которые встречаются в рукописи и учебниках
  const SPECIAL = {
    'そ': [s => splitAt(s, 0, 0.24, 2), s => splitAt(s, 0, 0.22, 4)],   // そ в два штриха
    'ぞ': [s => splitAt(s, 0, 0.24, 2)],
    'ゆ': [s => join(s, 0)],
  };

  function variants(ch, raw) {
    const base = raw.map(P);
    const out = [{ strokes: base, kind: 'standard' }];
    if (base.length > 1) for (let i = 0; i < base.length - 1; i++) out.push({ strokes: join(base, i), kind: 'joined' });
    if (base.length > 2 && base.length <= 4) out.push({ strokes: [base.flat()], kind: 'cursive' });
    out.push({ strokes: shear(base, 0.18), kind: 'slant' });
    out.push({ strokes: shear(base, -0.12), kind: 'slant' });
    (SPECIAL[ch] || []).forEach(f => out.push({ strokes: f(base), kind: 'special' }));
    return out;
  }

  class Recognizer {
    constructor(kvg) {
      this.kvg = kvg;
      this.templates = {};   // ch -> [{p: облако точек, f: карта направлений}]
      this.user = {};        // ch -> [...] собственный почерк
      for (const ch in kvg) this.templates[ch] = variants(ch, kvg[ch]).map(v => ({ p: prepare(v.strokes), f: defFeat(v.strokes) }));
    }
    addUserSample(ch, strokes) { (this.user[ch] = this.user[ch] || []).push({ p: prepare(strokes), f: defFeat(strokes) }); }
    clearUser() { this.user = {}; }
    // возвращает отсортированный список {ch, d}; d = расстояние облаков + расстояние карт направлений
    rank(strokes, candidates, topK = 14) {
      const f = defFeat(strokes);
      const pre = candidates.map(ch => {
        const ts = (this.templates[ch] || []).concat(this.user[ch] || []);
        let dd = Infinity; for (const t of ts) dd = Math.min(dd, defDist(f, t.f));
        return { ch, dd, ts };
      }).sort((a, b) => a.dd - b.dd);
      const g = prepare(strokes), norm = N * (N + 1) / 2;
      const res = pre.slice(0, topK).map(c => {
        let best = Infinity; for (const t of c.ts) best = Math.min(best, greedy(g, t.p, best));
        return { ch: c.ch, d: best / norm + c.dd };
      });
      for (const c of pre.slice(topK)) res.push({ ch: c.ch, d: Infinity });
      res.sort((a, b) => a.d - b.d);
      return res;
    }
  }

  // группы символов, которые различаются деталью: внутри группы цель должна быть строго лучшей
  const STRICT = ['かが', 'きぎ', 'くぐ', 'けげ', 'こご', 'さざ', 'しじ', 'すず', 'せぜ', 'そぞ', 'ただ', 'ちぢ', 'つづ', 'てで', 'とど',
    'はばぱ', 'ひびぴ', 'ふぶぷ', 'へべぺ', 'ほぼぽ', 'カガ', 'キギ', 'クグ', 'ケゲ', 'コゴ', 'サザ', 'シジ', 'スズ', 'セゼ', 'ソゾ',
    'タダ', 'チヂ', 'ツヅ', 'テデ', 'トド', 'ハバパ', 'ヒビピ', 'フブプ', 'ヘベペ', 'ホボポ', 'ウヴ',
    'ソン', 'シツ', 'ぬめ', 'るろ', 'ねれわ', 'はほ', 'あお', 'さち', 'いり', 'クタ', 'ワウ', 'コユ', 'チテ', 'ノメ', 'ヌス', 'シン', 'ソツ',
    'うら', 'ラヲ', 'セヤ', 'マム'];
  const strictOf = {};
  for (const g of STRICT) for (const c of g) strictOf[c] = (strictOf[c] || '') + g;

  /* решение: принять, если цель близка к лучшему совпадению (форма «похожа»),
     но ни один символ из её «строгой» группы не подошёл лучше */
  function judge(ranked, target, leniency) {
    const margin = [0.05, 0.15, 0.30][leniency ?? 1];
    const cap = [0.35, 0.45, 0.60][leniency ?? 1];
    const best = ranked[0];
    const t = ranked.find(r => r.ch === target);
    if (!t) return { ok: false, best: best.ch, dist: Infinity };
    const group = strictOf[target] || '';
    const rival = ranked.find(r => r.ch !== target && group.includes(r.ch) && r.d < t.d);
    const ok = !rival && t.d <= cap && t.d <= best.d * (1 + margin) + 0.01;
    return { ok, best: best.ch, dist: t.d, bestDist: best.d };
  }

  root.KanaRec = { Recognizer, judge, prepare, setParams(n, w) { N = n; W = w; } };
})(typeof window !== 'undefined' ? window : globalThis);
