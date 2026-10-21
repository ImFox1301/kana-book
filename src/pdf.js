// PDF урока прямо в браузере (работает и без сети): конспект и прописи.
// Знаки рисуются векторно по штрихам KanjiVG, тексты — шрифтами Onest (кириллица, латиница) и Klee One (кана).
window.KanaPdf = (function () {
  const A4 = [595.28, 841.89], M = 40;
  let fontBytes = null;
  async function fonts(doc) {
    if (!fontBytes) fontBytes = await Promise.all(['pdf/onest-400.ttf', 'pdf/onest-700.ttf', 'pdf/klee-semibold.ttf'].map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.arrayBuffer(); })));
    doc.registerFontkit(window.fontkit);
    // без subset: подмножество от pdf-lib теряет часть глифов каны; шрифты и так урезаны заранее
    const [reg, bold, kana] = await Promise.all(fontBytes.map(b => doc.embedFont(b, { subset: false })));
    return { reg, bold, kana };
  }
  const isKana = c => /[　-ヿ＀-￯]/.test(c);

  // ---- текст со сменой шрифта: кана — Klee, остальное — Onest ----
  function runs(text, F, bold) {
    const out = []; let cur = null;
    for (const ch of text) {
      const f = isKana(ch) ? F.kana : (bold ? F.bold : F.reg);
      if (cur && cur.f === f) cur.t += ch; else out.push(cur = { f, t: ch });
    }
    return out;
  }
  const width = (text, F, size, bold) => runs(text, F, bold).reduce((w, r) => w + r.f.widthOfTextAtSize(r.t, size), 0);
  function wrap(text, F, size, maxW, bold) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      // переносим по пробелам; длинные японские фразы без пробелов — по знакам
      const tokens = para.split(/(\s+)/).filter(t => t.length);
      let line = '';
      for (const tok of tokens) {
        const tryLine = line + tok;
        if (width(tryLine.trimEnd(), F, size, bold) <= maxW || !line) {
          if (!line && width(tok, F, size, bold) > maxW) { for (const ch of tok) { if (width(line + ch, F, size, bold) > maxW) { lines.push(line); line = ch; } else line += ch; } }
          else line = tryLine;
        } else { lines.push(line.trimEnd()); line = tok.trimStart(); }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }
  function drawLine(page, text, x, y, F, size, color, bold) {
    for (const r of runs(text, F, bold)) { page.drawText(r.t, { x, y, size, font: r.f, color }); x += r.f.widthOfTextAtSize(r.t, size); }
  }

  // ---- знак по штрихам KanjiVG ----
  function strokesPath(ch, upto) {
    const S = KVG[ch]; if (!S) return [];
    return S.slice(0, upto ?? S.length).map(s => { let d = ''; for (let i = 0; i < s.length; i += 2) d += (i ? 'L' : 'M') + (s[i] / 10).toFixed(1) + ' ' + (s[i + 1] / 10).toFixed(1); return d; });
  }
  function drawKana(page, P, ch, x, y, size, opts = {}) {
    // x, y — левый верхний угол клетки (координаты PDF)
    const scale = size / 109, color = opts.color || P.rgb(0.11, 0.13, 0.15);
    const paths = strokesPath(ch, opts.upto);
    paths.forEach((d, i) => {
      const last = opts.highlightLast && i === paths.length - 1;
      page.drawSvgPath(d, { x, y, scale, borderColor: last ? P.rgb(0.76, 0.23, 0.16) : color, borderWidth: (opts.weight || 5.2), borderLineCap: P.LineCapStyle.Round, borderOpacity: opts.opacity ?? 1 });
    });
    if (opts.numbers) {
      const S = KVG[ch] || [];
      S.forEach((s, i) => {
        const sx = x + (s[0] / 10) * scale, sy = y - (s[1] / 10) * scale;
        page.drawText(String(i + 1), { x: Math.max(x + 1, sx - size * 0.11), y: Math.min(y - size * 0.09, sy + size * 0.02), size: size * 0.11, font: opts.F.bold, color: P.rgb(0.76, 0.23, 0.16) });
      });
    }
  }
  function cell(page, P, x, y, s, opts = {}) {
    const line = P.rgb(0.72, 0.76, 0.80);
    page.drawRectangle({ x, y: y - s, width: s, height: s, borderColor: opts.strong ? P.rgb(0.45, 0.5, 0.56) : line, borderWidth: opts.strong ? 1 : 0.7 });
    const dash = { dashArray: [2, 2.5], color: P.rgb(0.82, 0.85, 0.88), thickness: 0.5 };
    page.drawLine({ start: { x: x + s / 2, y: y - 2 }, end: { x: x + s / 2, y: y - s + 2 }, ...dash });
    page.drawLine({ start: { x: x + 2, y: y - s / 2 }, end: { x: x + s - 2, y: y - s / 2 }, ...dash });
  }

  // ---- страницы ----
  function pager(doc, F, P, title) {
    const st = { page: null, y: 0, n: 0 };
    st.add = () => {
      st.page = doc.addPage(A4); st.n++; st.y = A4[1] - M;
      drawLine(st.page, title, M, A4[1] - 24, F, 8.5, P.rgb(0.42, 0.46, 0.5));
      drawLine(st.page, 'Кана-тетрадь · штрихи: KanjiVG (CC BY-SA 3.0)', M, 22, F, 7.5, P.rgb(0.55, 0.58, 0.62));
      drawLine(st.page, String(st.n), A4[0] - M - 10, 22, F, 8, P.rgb(0.42, 0.46, 0.5));
    };
    st.need = h => { if (!st.page || st.y - h < M) st.add(); };
    st.text = (text, size, opts = {}) => {
      const lines = wrap(text, F, size, opts.w || (A4[0] - 2 * M), opts.bold);
      for (const ln of lines) { st.need(size * 1.45); drawLine(st.page, ln, opts.x || M, st.y - size, F, size, opts.color || P.rgb(0.11, 0.13, 0.15), opts.bold); st.y -= size * 1.45; }
    };
    return st;
  }

  async function notes(l, ctx) {
    const P = window.PDFLib, doc = await P.PDFDocument.create(), F = await fonts(doc);
    const ink = P.rgb(0.11, 0.13, 0.15), muted = P.rgb(0.34, 0.37, 0.4), accent = P.rgb(0.18, 0.31, 0.53);
    doc.setTitle(`${l.title} — конспект`); doc.setAuthor('Кана-тетрадь');
    const pg = pager(doc, F, P, `Урок ${ctx.no} · ${ctx.scriptName || 'хирагана'} · конспект`);
    pg.add();
    pg.text(l.title, 22, { bold: true }); pg.y -= 4;
    pg.text(l.intro, 10.5, { color: muted }); pg.y -= 10;
    const W = A4[0] - 2 * M;
    for (const k of ctx.kana) {
      const note = l.notes[k];
      const textX = M + 92, textW = W - 92;
      const lines = note ? wrap('Как запомнить: ' + note[0], F, 9.5, textW).length + wrap('Произношение: ' + note[1], F, 9.5, textW).length : 0;
      const stepsH = KVG[k] ? 36 : 0;
      const blockH = Math.max(86, 26 + lines * 13.8 + stepsH + 8);
      pg.need(blockH + 10);
      const top = pg.y;
      // крупный образец с номерами штрихов
      if (KVG[k]) { cell(pg.page, P, M, top, 80, { strong: true }); drawKana(pg.page, P, k, M + 4, top - 4, 72, { numbers: true, F, weight: 5.5 }); }
      else if ([...k].every(c => KVG[c])) {
        // сочетание (きゃ, ティ): знаки рядом в двух клетках, маленький — в нижней половине своей клетки
        [...k].forEach((c, i) => { cell(pg.page, P, M + i * 40, top - 20, 40, { strong: true }); drawKana(pg.page, P, c, M + i * 40 + 2, top - 22, 36, { weight: 5 }); });
      } else drawLine(pg.page, k, M + 6, top - 62, F, k.length > 1 ? 36 : 54, ink);
      drawLine(pg.page, k, textX, top - 20, F, 20, ink);
      drawLine(pg.page, `${ctx.read(k, 'ru')} · ${ctx.read(k, 'lat')}`, textX + (k.length > 1 ? 50 : 30), top - 18, F, 13, accent, true);
      let y = top - 34;
      if (note) {
        for (const [lab, txt] of [['Как запомнить: ', note[0]], ['Произношение: ', note[1]]]) {
          const ls = wrap(lab + txt, F, 9.5, textW);
          ls.forEach((ln, i) => {
            if (i === 0) { drawLine(pg.page, lab, textX, y, F, 9.5, ink, true); drawLine(pg.page, ln.slice(lab.length), textX + width(lab, F, 9.5, true), y, F, 9.5, ink); }
            else drawLine(pg.page, ln, textX, y, F, 9.5, ink);
            y -= 13.8;
          });
        }
      }
      // порядок штрихов по шагам
      if (KVG[k]) {
        const n = KVG[k].length; y -= 2;
        for (let i = 1; i <= n; i++) {
          const x = textX + (i - 1) * 32;
          cell(pg.page, P, x, y, 28);
          drawKana(pg.page, P, k, x + 1, y - 1, 26, { upto: i, highlightLast: true, weight: 6.5 });
        }
        y -= 32;
      }
      pg.y = Math.min(y, top - 86) - 12;
      pg.page.drawLine({ start: { x: M, y: pg.y + 6 }, end: { x: M + W, y: pg.y + 6 }, color: P.rgb(0.85, 0.87, 0.84), thickness: 0.6 });
    }
    if (l.points) {
      pg.y -= 4; pg.text('Главное в уроке', 13, { bold: true }); pg.y -= 2;
      for (const [t, p] of l.points) { pg.text(t, 10.5, { bold: true }); pg.text(p, 10, { color: muted }); pg.y -= 4; }
    }
    if (l.similar && l.similar.length) {
      pg.y -= 6; pg.need(40); pg.text('Не перепутать', 13, { bold: true }); pg.y -= 2;
      for (const [a, b, t] of l.similar) pg.text(`${a} · ${b} — ${t}`, 10);
    }
    if (l.words.length) {
      pg.y -= 8; pg.need(60); pg.text('Слова урока', 13, { bold: true }); pg.y -= 4;
      for (const [kana, mean, kanji, read] of l.words) {
        pg.need(22);
        drawLine(pg.page, kana, M, pg.y - 14, F, 14, ink);
        drawLine(pg.page, ctx.read(kana, ctx.sys, read), M + 170, pg.y - 13, F, 10, accent);
        const ml = wrap(mean, F, 10, W - 330);
        ml.forEach((ln, i) => drawLine(pg.page, ln, M + 330, pg.y - 13 - i * 12, F, 10, ink));
        pg.y -= Math.max(22, 10 + ml.length * 12);
      }
    }
    return doc.save();
  }

  async function sheet(l, ctx) {
    const P = window.PDFLib, doc = await P.PDFDocument.create(), F = await fonts(doc);
    const ink = P.rgb(0.11, 0.13, 0.15), accent = P.rgb(0.18, 0.31, 0.53);
    doc.setTitle(`${l.title} — прописи`); doc.setAuthor('Кана-тетрадь');
    const pg = pager(doc, F, P, `Урок ${ctx.no} · ${ctx.scriptName || 'хирагана'} · прописи`);
    pg.add();
    pg.text(`Прописи: ${l.title}`, 18, { bold: true });
    pg.text('В первой клетке — образец с порядком штрихов. Обведите бледные знаки, затем пишите сами в пустых клетках.', 9.5, { color: P.rgb(0.34, 0.37, 0.4) });
    pg.y -= 8;
    const W = A4[0] - 2 * M, cols = 10, s = W / cols;
    const rows = ctx.rows || 2;
    for (const k of ctx.kana) {
      const need = 18 + rows * s + 10;
      pg.need(need);
      drawLine(pg.page, k, M, pg.y - 12, F, 12, ink);
      drawLine(pg.page, `${ctx.read(k, 'ru')} · ${ctx.read(k, 'lat')}`, M + 18, pg.y - 11, F, 9.5, accent, true);
      pg.y -= 18;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = M + c * s, y = pg.y;
          cell(pg.page, P, x, y, s, { strong: r === 0 && c === 0 });
          const pad = s * 0.07, inner = s - 2 * pad;
          if (r === 0 && c === 0) drawKana(pg.page, P, k, x + pad, y - pad, inner, { numbers: true, F, weight: 5.2 });
          else if (r === 0 && c <= 4) drawKana(pg.page, P, k, x + pad, y - pad, inner, { color: P.rgb(0.45, 0.5, 0.56), opacity: [0, 0.42, 0.32, 0.24, 0.17][c], weight: 5.2 });
          else if (r === 1 && c <= 1) drawKana(pg.page, P, k, x + pad, y - pad, inner, { color: P.rgb(0.45, 0.5, 0.56), opacity: 0.15, weight: 5.2 });
        }
        pg.y -= s;
      }
      pg.y -= 12;
    }
    return doc.save();
  }

  return { notes, sheet };
})();
