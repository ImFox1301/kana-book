(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const k in attrs) {
      const v = attrs[k];
      if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  };
  const ICON = {
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l8 7-8 7zM17 5v14"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    slot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  };
  const iconBtn = (cls, icon, label, onclick, title) => { const b = h('button', { class: cls, type: 'button', onclick, title: title || label }); b.innerHTML = ICON[icon]; b.append(label); return b; };

  // ---------- хранилище в браузере ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('kana-tetrad:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) {
      try { localStorage.setItem('kana-tetrad:' + k, JSON.stringify(v)); } catch (e) { }
      if (SYNCED.has(k) && !applying && window.KanaSync) window.KanaSync.touch();
    },
  };
  // то, что синхронизируется с аккаунтом
  const SYNCED = new Set(['words', 'deleted', 'samples', 'settings', 'answers', 'lessons', 'activity']);
  let applying = false;

  // ---------- распознаватель ----------
  const rec = new KanaRec.Recognizer(KVG);
  let samples = store.get('samples', {});
  const unpack = (s) => s.map(st => { const r = []; for (let i = 0; i < st.length; i += 2) r.push({ x: st[i], y: st[i + 1] }); return r; });
  const pack = (strokes) => strokes.map(s => s.flatMap(p => [Math.round(p.x * 1000), Math.round(p.y * 1000)]));
  function loadSamples() { rec.clearUser(); for (const ch in samples) for (const s of samples[ch]) rec.addUserSample(ch, unpack(s)); }
  loadSamples();

  const HBASE = [], KBASE = [];
  for (const r of ROWS) if (r.g !== 'yoon') for (const k of r.h.split(' ')) { HBASE.push(k); KBASE.push(toKata(k)); }
  KBASE.push('ー', 'ヴ');
  const isKata = c => /[゠-ヿ]/.test(c);
  const candFor = c => isKata(c) ? KBASE : HBASE;

  function judgeChar(strokes, target, len) {
    const s = strokes.map(st => st.map(p => ({ x: p.x * 100, y: p.y * 100 })));
    const ranked = rec.rank(s, candFor(target));
    return KanaRec.judge(ranked, target, len);
  }

  // ---------- слова ----------
  let userWords = store.get('words', []);
  let deleted = new Set(store.get('deleted', []));
  const wid = w => w.kana + '|' + w.mean;
  function allWords() {
    const b = BUILTIN_WORDS.map(([kana, mean, topic, read]) => ({ kana, mean, topic, read, builtin: true }));
    return b.concat(userWords).filter(w => !deleted.has(wid(w)));
  }
  const topicsOf = ws => [...new Set(ws.map(w => w.topic || 'Без темы'))];
  const wordScript = w => /[゠-ヿ]/.test(w.kana) ? 'k' : 'h';

  // ---------- история ответов ----------
  const MAX_ANSWERS = 20000;
  let answers = store.get('answers', []);

  // ---------- настройки ----------
  const def = { script: 'h', rows: { h: ['a', 'ka', 'sa'], k: ['a', 'ka', 'sa'] }, topics: null, wfilter: 'all', count: 20, mode: 'draw', sys: 'ru', len: 1, abcScript: 'h', abcMode: 'listen', abcSel: { h: [], k: [] }, reps: 5, ghost: true, voice: 'm', goal: { min: 30, cards: 50 }, onboarded: false, vibrate: true, simScript: 'h', simSel: { h: null, k: null }, simCount: 20 };
  const S = Object.assign({}, def, store.get('settings', {}));
  const save = () => store.set('settings', S);

  function selectedItems() {
    if (S.script === 'w') {
      const ws = allWords();
      const tps = S.topics || topicsOf(ws);
      return ws.filter(w => tps.includes(w.topic || 'Без темы') && (S.wfilter === 'all' || wordScript(w) === S.wfilter))
        .map(w => ({ kind: 'word', kana: w.kana, w }));
    }
    const out = [];
    for (const r of ROWS) if (S.rows[S.script].includes(r.id)) for (const k of r.h.split(' ')) out.push({ kind: 'kana', kana: S.script === 'k' ? toKata(k) : k, row: r });
    return out;
  }

  // ---------- экран настройки ----------
  function opt(sel, value, cur, title, desc, k, onpick) {
    return h('button', { class: 'opt', type: 'button', 'aria-pressed': String(value === cur), onclick: () => onpick(value) },
      k ? h('span', { class: 'k' }, k) : null, h('span', { class: 't' }, title), desc ? h('span', { class: 'd' }, desc) : null);
  }
  function renderSetup() {
    const sc = $('#sel-script'); sc.replaceChildren(
      opt(sc, 'h', S.script, 'Хирагана', 'родные слова и грамматика', 'あ', v => { S.script = v; save(); renderSetup(); }),
      opt(sc, 'k', S.script, 'Катакана', 'заимствования и имена', 'ア', v => { S.script = v; save(); renderSetup(); }),
      opt(sc, 'w', S.script, 'Слова', 'из хираганы и катаканы', 'ことば', v => { S.script = v; save(); renderSetup(); }));

    const rows = $('#sel-rows'); rows.replaceChildren();
    if (S.script === 'w') {
      $('#rows-title').textContent = 'Темы';
      const ws = allWords(); const tps = topicsOf(ws);
      if (!S.topics) S.topics = tps.slice();
      S.topics = S.topics.filter(t => tps.includes(t));
      const filt = h('div', { class: 'seg' },
        ...[['all', 'Все слова'], ['h', 'Только хирагана'], ['k', 'Только катакана']].map(([v, t]) =>
          h('button', { class: 'preset', type: 'button', 'aria-pressed': String(S.wfilter === v), style: S.wfilter === v ? 'border-color:var(--indigo);color:var(--indigo)' : '', onclick: () => { S.wfilter = v; save(); renderSetup(); } }, t)));
      const chips = h('div', { class: 'chips' }, ...tps.map(t => {
        const n = ws.filter(w => (w.topic || 'Без темы') === t && (S.wfilter === 'all' || wordScript(w) === S.wfilter)).length;
        return h('button', { class: 'chip word', type: 'button', 'aria-pressed': String(S.topics.includes(t)), onclick: () => { S.topics = S.topics.includes(t) ? S.topics.filter(x => x !== t) : S.topics.concat(t); save(); renderSetup(); } },
          h('span', { class: 'k' }, t), h('span', { class: 'n' }, n + ' сл.'));
      }));
      rows.append(h('div', {}, h('div', { class: 'ghead' }, h('span', { class: 'label' }, 'Темы словаря'),
        h('span', {}, h('button', { class: 'link', type: 'button', onclick: () => { S.topics = tps.slice(); save(); renderSetup(); } }, 'все'),
          h('button', { class: 'link', type: 'button', onclick: () => { S.topics = []; save(); renderSetup(); } }, 'снять'))), chips),
        h('div', {}, h('div', { class: 'ghead' }, h('span', { class: 'label' }, 'Азбука слов')), filt));
    } else {
      $('#rows-title').textContent = 'Ряды';
      const sel = S.rows[S.script];
      for (const g of GROUPS) {
        const rs = ROWS.filter(r => r.g === g.id);
        const allOn = rs.every(r => sel.includes(r.id));
        rows.append(h('div', {},
          h('div', { class: 'ghead' }, h('span', { class: 'label' }, g.name),
            h('button', { class: 'link', type: 'button', onclick: () => { S.rows[S.script] = allOn ? sel.filter(x => !rs.some(r => r.id === x)) : [...new Set(sel.concat(rs.map(r => r.id)))]; save(); renderSetup(); } }, allOn ? 'снять все' : 'выбрать все')),
          h('div', { class: 'chips' }, ...rs.map(r => h('button', {
            class: 'chip', type: 'button', 'aria-pressed': String(sel.includes(r.id)),
            onclick: () => { S.rows[S.script] = sel.includes(r.id) ? sel.filter(x => x !== r.id) : sel.concat(r.id); save(); renderSetup(); }
          }, h('span', { class: 'k' }, (S.script === 'k' ? toKata(r.h) : r.h).replace(/ /g, '')), h('span', { class: 'n' }, 'ряд ' + r.name))))));
      }
    }

    const n = selectedItems().length;
    const cnt = $('#cnt');
    cnt.min = Math.max(1, n);
    if (n && S.count < n) S.count = n;
    cnt.value = S.count;
    $('#cnt-presets').replaceChildren(...(n ? [[n, 'по разу'], [n * 2, '×2'], [n * 3, '×3']] : []).map(([v, t]) =>
      h('button', { class: 'preset', type: 'button', onclick: () => { S.count = v; save(); renderSetup(); } }, `${t} · ${v}`)));
    const unit = S.script === 'w' ? 'слов' : 'знаков';
    $('#cnt-hint').textContent = n ? `Выбрано ${unit}: ${n}. Каждый появится хотя бы один раз, остальные карточки — случайные повторы.` : `Ничего не выбрано — отметьте ${S.script === 'w' ? 'хотя бы одну тему' : 'хотя бы один ряд'}.`;

    const md = $('#sel-mode'); md.replaceChildren(
      opt(md, 'draw', S.mode, 'Перевод', 'вижу звучание → рисую знак пальцем', null, v => { S.mode = v; save(); renderSetup(); }),
      opt(md, 'type', S.mode, 'Обратный перевод', 'вижу знак → пишу звучание', null, v => { S.mode = v; save(); renderSetup(); }),
      opt(md, 'listen', S.mode, 'На слух', 'слышу звучание → выбираю знак', null, v => { S.mode = v; save(); renderSetup(); }));
    const sy = $('#sel-sys'); sy.replaceChildren(
      opt(sy, 'ru', S.sys, 'Кириллица', 'система Поливанова: си, ти, цу', null, v => { S.sys = v; save(); renderSetup(); }),
      opt(sy, 'lat', S.sys, 'Латиница', 'система Хэпбёрна: shi, chi, tsu', null, v => { S.sys = v; save(); renderSetup(); }));
    const ln = $('#sel-len'); ln.replaceChildren(
      opt(ln, 0, S.len, 'Строго', 'похожие знаки не засчитываются', null, v => { S.len = v; save(); renderSetup(); }),
      opt(ln, 1, S.len, 'Обычно', 'засчитывает разные почерки', null, v => { S.len = v; save(); renderSetup(); }),
      opt(ln, 2, S.len, 'Мягко', 'для первых попыток', null, v => { S.len = v; save(); renderSetup(); }));
    $('#lenient-wrap').hidden = S.mode !== 'draw';
    $('#btn-start').disabled = n === 0;
  }
  $('#cnt').addEventListener('change', e => { const n = selectedItems().length; S.count = Math.min(500, Math.max(n || 1, parseInt(e.target.value) || n)); save(); renderSetup(); });
  $('#cnt-minus').onclick = () => { S.count = Math.max(selectedItems().length || 1, S.count - 1); save(); renderSetup(); };
  $('#cnt-plus').onclick = () => { S.count = Math.min(500, S.count + 1); save(); renderSetup(); };

  // ---------- колода ----------
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function buildDeck(items, count) {
    const deck = items.slice();
    while (deck.length < count) deck.push(items[Math.floor(Math.random() * items.length)]);
    shuffle(deck);
    // не ставим одну и ту же карточку подряд
    for (let i = 1; i < deck.length; i++) if (deck[i].kana === deck[i - 1].kana) {
      const j = deck.findIndex((x, k) => k > i && x.kana !== deck[i].kana && (k + 1 >= deck.length || deck[k + 1].kana !== deck[i].kana) && deck[k - 1].kana !== deck[i].kana);
      if (j > 0) [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  // ---------- квиз ----------
  let Q = null;
  function startQuiz(items, count, opts = {}) {
    if (!opts.keepFlow && FLOW && FLOW.step !== 'quiz') FLOW = null;
    Q = { deck: buildDeck(items, count), i: 0, results: [], mode: opts.mode || S.mode, sys: S.sys, len: S.len, pool: items, review: !!opts.review, back: opts.back || 'setup', again: opts.again || null, track: opts.track || null };
    show('quiz'); renderCard();
  }
  $('#btn-start').onclick = () => {
    const items = selectedItems(); if (!items.length) return;
    if (S.count < items.length) S.count = items.length;
    startQuiz(items, S.count);
  };
  $('#btn-quit').onclick = () => { if (Q && Q.results.length) renderResult(); else if (FLOW) backToLesson(); else { const b = Q ? Q.back : 'setup'; Q = null; show(b); } };

  function readingOf(it, sys) { return displayReading(it.kana, sys, it.w && it.w.read); }
  const otherSys = s => s === 'ru' ? 'lat' : 'ru';

  // поле для рисования
  function makePad(onchange) {
    const wrap = h('div', { class: 'pad' });
    const cv = h('canvas', { 'aria-label': 'Поле для рисования знака' });
    wrap.append(cv);
    const pad = { el: wrap, strokes: [], cur: null, ghost: null };
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    pad.redraw = () => {
      const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const W = Math.max(10, Math.round(r.width * dpr));
      if (cv.width !== W) { cv.width = W; cv.height = W; }
      const g = cv.getContext('2d'); g.clearRect(0, 0, W, W);
      g.fillStyle = css('--paper'); g.fillRect(0, 0, W, W);
      g.strokeStyle = css('--guide'); g.lineWidth = Math.max(1, dpr);
      g.strokeRect(W * 0.04, W * 0.04, W * 0.92, W * 0.92);
      g.setLineDash([6 * dpr, 6 * dpr]);
      g.beginPath(); g.moveTo(W / 2, W * 0.04); g.lineTo(W / 2, W * 0.96); g.moveTo(W * 0.04, W / 2); g.lineTo(W * 0.96, W / 2); g.stroke();
      g.setLineDash([]);
      if (pad.ghost && KVG[pad.ghost]) {   // полупрозрачный образец, чтобы обвести
        g.globalAlpha = 0.16;
        drawStrokes(g, kvgStrokes(pad.ghost), W, css('--ink'), 0.07);
        g.globalAlpha = 1;
      }
      drawStrokes(g, pad.strokes, W, css('--stroke'), 0.034);
    };
    const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
    cv.addEventListener('pointerdown', e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); pad.cur = [pt(e)]; pad.strokes.push(pad.cur); pad.redraw(); });
    cv.addEventListener('pointermove', e => {
      if (!pad.cur) return; e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) pad.cur.push(pt(ev));
      pad.redraw();
    });
    const end = () => { if (pad.cur) { pad.cur = null; onchange && onchange(); } };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    pad.set = s => { pad.strokes = s; pad.redraw(); };
    pad.undo = () => { pad.strokes.pop(); pad.redraw(); onchange && onchange(); };
    pad.clear = () => { pad.strokes.length = 0; pad.redraw(); onchange && onchange(); };
    new ResizeObserver(() => pad.redraw()).observe(cv);
    return pad;
  }
  const kvgStrokes = ch => KVG[ch].map(s => { const r = []; for (let i = 0; i < s.length; i += 2) r.push({ x: s[i] / 1090, y: s[i + 1] / 1090 }); return r; });
  function drawStrokes(g, strokes, W, color, width) {
    g.strokeStyle = color; g.fillStyle = color; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = W * width;
    for (const s of strokes) {
      if (s.length === 1) { g.beginPath(); g.arc(s[0].x * W, s[0].y * W, W * width / 2, 0, 7); g.fill(); continue; }
      g.beginPath(); g.moveTo(s[0].x * W, s[0].y * W); for (const p of s) g.lineTo(p.x * W, p.y * W); g.stroke();
    }
  }
  function thumb(strokes, cls) {
    const cv = h('canvas', { class: cls || 'box' });
    requestAnimationFrame(() => {
      const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, W = Math.max(10, Math.round(r.width * dpr));
      cv.width = W; cv.height = W;
      const g = cv.getContext('2d');
      drawStrokes(g, strokes, W, getComputedStyle(document.documentElement).getPropertyValue('--stroke').trim(), 0.045);
    });
    return cv;
  }

  // порядок штрихов по KanjiVG
  function strokeOrder(ch) {
    const cv = h('canvas', { class: 'box', 'aria-label': 'Порядок штрихов ' + ch });
    let timer = null;
    const play = () => {
      cancelAnimationFrame(timer);
      const data = KVG[ch]; if (!data) return;
      const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, W = Math.max(10, Math.round(r.width * dpr));
      cv.width = W; cv.height = W;
      const g = cv.getContext('2d');
      const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const strokes = data.map(s => { const r = []; for (let i = 0; i < s.length; i += 2) r.push({ x: s[i] / 1090, y: s[i + 1] / 1090 }); return r; });
      const total = strokes.reduce((a, s) => a + s.length, 0);
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let shown = reduce ? total : 0;
      const frame = () => {
        g.clearRect(0, 0, W, W);
        drawStrokes(g, strokes, W, css('--guide'), 0.05);
        let left = shown; const part = [];
        strokes.forEach(s => { if (left <= 0) return; part.push(s.slice(0, Math.max(1, left))); left -= s.length; });
        drawStrokes(g, part, W, css('--stroke'), 0.05);
        g.font = `600 ${W * 0.1}px Onest, sans-serif`; g.fillStyle = css('--shu');
        part.forEach((s, i) => g.fillText(String(i + 1), Math.min(W * 0.92, Math.max(2, s[0].x * W - W * 0.09)), Math.max(W * 0.1, s[0].y * W)));
        if (shown < total) { shown += 1.2; timer = requestAnimationFrame(frame); }
      };
      frame();
    };
    cv.addEventListener('click', play);
    requestAnimationFrame(play);
    return cv;
  }

  function renderCard() {
    const it = Q.deck[Q.i];
    $('#ctr').textContent = `${Q.i + 1} / ${Q.deck.length}`;
    $('#prog').style.width = (Q.i / Q.deck.length * 100) + '%';
    const card = $('#card'); card.replaceChildren();
    const msg = h('div', { class: 'msg', role: 'status' });
    const isWord = it.kind === 'word';
    const mode = it.mode || Q.mode;
    if (mode === 'listen' || mode === 'sim' || mode === 'mean') return renderChoice(card, it, mode, msg);
    if (mode === 'build') return renderBuild(card, it, msg);
    if (mode === 'draw') {
      const units = [...it.kana];
      const slotStrokes = units.map(() => []);
      let cur = 0;
      const prompt = h('div', { class: 'prompt' },
        h('span', { class: 'lab' }, isWord ? 'Напишите слово' : 'Нарисуйте знак'),
        isWord ? h('span', { class: 'meaning' }, it.w.mean) : null,
        h('span', { class: 'big' }, readingOf(it, Q.sys)),
        sayButton(it, 'Прослушать'),
        !isWord && HINTS[toHira(it.kana)] ? h('span', { class: 'tag' }, HINTS[toHira(it.kana)]) : null,
        isWord ? h('span', { class: 'tag' }, wordScript(it.w) === 'k' ? 'катакана' : 'хирагана') : null,
        !isWord && units.length > 1 ? h('span', { class: 'tag' }, 'два знака: второй — маленький') : null);
      card.append(prompt);
      let slotsEl = null;
      const pad = makePad(() => { slotStrokes[cur] = pad.strokes; updateSlots(); msg.textContent = ''; });
      function updateSlots() {
        if (!slotsEl) return;
        slotsEl.replaceChildren(...units.map((u, i) => {
          const b = h('button', { class: 'slot', type: 'button', 'aria-current': String(i === cur), 'aria-label': `Знак ${i + 1}` + (isSmall(u) ? ' (маленький)' : ''), onclick: () => { cur = i; pad.set(slotStrokes[i]); updateSlots(); } });
          if (slotStrokes[i].length) b.append(thumb(slotStrokes[i], '')); else b.append(h('span', { class: 'muted small' }, String(i + 1)));
          if (isSmall(u) || u === 'ー') b.append(h('span', { class: 'sm' }, isSmall(u) ? 'мал.' : 'ー'));
          return b;
        }));
      }
      if (units.length > 1) { slotsEl = h('div', { class: 'slots' }); card.append(slotsEl); }
      card.append(pad.el);
      const tools = h('div', { class: 'padtools' },
        iconBtn('iconbtn', 'undo', 'Отменить штрих', () => pad.undo()),
        iconBtn('iconbtn', 'clear', 'Стереть', () => pad.clear()));
      if (units.length > 1) tools.append(iconBtn('iconbtn', 'slot', 'Следующий знак', () => { if (cur < units.length - 1) { cur++; pad.set(slotStrokes[cur]); updateSlots(); } }));
      card.append(tools, msg);
      pad.set(slotStrokes[0]); updateSlots();
      const submit = () => {
        const filled = slotStrokes.filter(s => s.length).length;
        if (!filled) { msg.textContent = 'Сначала нарисуйте знак или нажмите «Пропустить».'; return; }
        if (filled < units.length) { msg.textContent = 'Нарисуйте все знаки слова — ячейки сверху показывают, какие пустые.'; return; }
        const per = units.map((u, i) => ({ u, target: bigOf(u), strokes: slotStrokes[i].map(s => s.slice()), ...judgeChar(slotStrokes[i], bigOf(u), Q.len) }));
        finish({ it, status: per.every(p => p.ok) ? 'ok' : 'bad', per });
      };
      card.append(actions(submit));
    } else {
      const input = h('input', { class: 'answer', id: 'answer', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: Q.sys === 'ru' ? 'кириллицей' : 'латиницей', 'aria-label': 'Звучание' });
      card.append(h('div', { class: 'prompt' },
        h('span', { class: 'lab' }, 'Как это читается?'),
        h('span', { class: 'kana' + (isWord ? ' word' : '') }, it.kana)), input, msg);
      const submit = () => {
        const v = input.value.trim();
        if (!v) { msg.textContent = 'Впишите звучание или нажмите «Пропустить».'; return; }
        finish({ it, status: checkReading(v, it.kana, Q.sys, it.w && it.w.read) ? 'ok' : 'bad', answer: v });
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); } });
      card.append(actions(submit));
      setTimeout(() => input.focus(), 30);
    }
  }
  // ---------- карточки с выбором: квиз на слух и похожие знаки ----------
  const soundKey = k => displayReading(k, 'lat').replace(/^wo$/, 'o');      // を звучит как お, ぢ — как じ
  let ALL_KANA = null;
  const allKana = () => ALL_KANA || (ALL_KANA = ROWS.flatMap(r => r.h.split(' ')).flatMap(k => [k, toKata(k)]));
  const similarOf = k => SIMILAR.filter(g => g.k.includes(k));
  function simNote(a, b) {
    if (!a || !b) return null;
    const g = SIMILAR.find(g => g.k.includes(a) && g.k.includes(b)); if (g) return g.t;
    for (const l of LESSONS) for (const [x, y, t] of l.similar || []) if ((x === a && y === b) || (x === b && y === a)) return t;
    return null;
  }
  const groupNote = it => { const g = SIMILAR.find(g => it.group && g.k.length === it.group.length && g.k.every(k => it.group.includes(k))); return g ? g.t : it.group && it.group.length === 2 ? simNote(it.group[0], it.group[1]) : null; };
  function pickDistinct(target, cands, n) {
    const out = [], seen = new Set([soundKey(target)]);
    for (const c of cands) { if (out.length >= n) break; if (c === target || out.includes(c)) continue; const sk = soundKey(c); if (seen.has(sk)) continue; seen.add(sk); out.push(c); }
    return out;
  }
  function listenOptions(it) {
    if (it.kind === 'word') {
      const sc = wordScript(it.w), L = [...it.kana].length;
      const pool = [...new Set(Q.pool.filter(x => x.kind === 'word').map(x => x.kana).concat(allWords().filter(w => wordScript(w) === sc).map(w => w.kana)))];
      const near = shuffle(pool.filter(k => Math.abs([...k].length - L) <= 1));
      return shuffle([it.kana, ...pickDistinct(it.kana, near.concat(shuffle(pool.slice())), 3)]);
    }
    const k = it.kana, kata = isKata(k[0]), multi = k.length > 1;
    const same = c => (c.length > 1) === multi && isKata(c[0]) === kata;
    const sim = shuffle(similarOf(k).flatMap(g => g.k).filter(c => c !== k)).slice(0, 2);
    const pool = shuffle(Q.pool.filter(x => x.kind !== 'word').map(x => x.kana).filter(same));
    const all = shuffle(allKana().filter(same));
    const sk = soundKey(k), near = all.filter(c => { const o = soundKey(c); return o.slice(-1) === sk.slice(-1) || o[0] === sk[0]; });
    return shuffle([k, ...pickDistinct(k, sim.concat(pool, near, all), 3)]);
  }
  // ---------- конструктор предложений ----------
  const partRead = (t, i) => PARTICLE_READ[t] ? PARTICLE_READ[t][i] : displayReading(t, i ? 'ru' : 'lat');
  function sentItem(lv, [ru, parts, kanji, alts, note]) {
    const p = parts.split('|');
    const lat = p.map(t => partRead(t, 0)).join(' '), rus = p.map(t => partRead(t, 1)).join(' ');
    return { kind: 'sent', word: true, kana: p.join(''), parts: p, alts: (alts || '').split('/').filter(Boolean).map(a => a.split('|')), note: note || null, extra: lv.extra, level: lv.id,
      w: { kana: p.join(''), mean: ru, kanji, read: lat + '|' + rus } };
  }
  const levelItems = lv => lv.items.map(x => sentItem(lv, x));
  const sentIndex = () => { const m = new Map(); for (const lv of BUILDER) for (const it of levelItems(lv)) m.set(it.kana, it); return m; };
  function renderBuild(card, it, msg) {
    const extra = shuffle(it.extra.filter(t => !it.parts.includes(t))).slice(0, 2);
    const bank = shuffle(it.parts.concat(extra).map((t, i) => ({ t, i })));
    const sel = [];
    const tray = h('div', { class: 'btray', 'aria-label': 'Собранная фраза' }), pool = h('div', { class: 'bbank', 'aria-label': 'Блоки' });
    const draw = () => {
      tray.replaceChildren(...(sel.length ? sel.map((b, j) => h('button', { type: 'button', class: 'btok', 'data-t': b.t, title: 'Убрать', onclick: () => { sel.splice(j, 1); draw(); } }, b.t)) : [h('span', { class: 'muted small' }, 'Нажимайте на блоки по порядку')]));
      pool.replaceChildren(...bank.map(b => h('button', { type: 'button', class: 'btok', 'data-t': b.t, disabled: sel.includes(b), onclick: () => { sel.push(b); msg.textContent = ''; draw(); } }, b.t)));
    };
    draw();
    card.append(h('div', { class: 'prompt' }, h('span', { class: 'lab' }, 'Соберите по-японски'), h('span', { class: 'ru-sent' }, it.w.mean)),
      tray, pool, h('div', { class: 'padtools' }, iconBtn('iconbtn', 'undo', 'Убрать последний', () => { sel.pop(); draw(); }), iconBtn('iconbtn', 'clear', 'Сначала', () => { sel.length = 0; draw(); })), msg);
    const submit = () => {
      if (!sel.length) { msg.textContent = 'Соберите фразу из блоков или нажмите «Пропустить».'; return; }
      const got = sel.map(b => b.t), key = got.join('|');
      const ok = [it.parts].concat(it.alts).some(a => a.join('|') === key);
      finish({ it, status: ok ? 'ok' : 'bad', built: got });
    };
    card.append(actions(submit));
  }
  function startBuilder(lv) {
    const items = lv ? levelItems(lv) : shuffle(BUILDER.flatMap(levelItems)).slice(0, 10);
    FLOW = null;
    startQuiz(items, items.length, { mode: 'build', back: 'builder', track: lv ? { id: 'b-' + lv.id, title: lv.title } : null, again: () => startBuilder(lv) });
  }
  function renderBuilder() {
    const el = $('#screen-builder'); el.replaceChildren();
    el.append(h('div', { class: 'backbar' }, h('button', { class: 'link back', type: 'button', onclick: () => show('practice') }, '← Практика')),
      h('h1', { class: 'h1' }, 'Конструктор предложений'),
      h('p', { class: 'small muted' }, 'Русская фраза — соберите её по-японски из блоков. Среди блоков есть лишние частицы. После ответа — чтение, озвучка и пояснение. Уровни идут от простого к сложному, у каждого — одна новая конструкция.'));
    const list = h('div', { class: 'lessons' });
    BUILDER.forEach((lv, i) => {
      const best = (lessonsDone['b-' + lv.id] || {}).quiz, done = best >= PASS * 100;
      const more = h('div', { class: 'blevel-intro', hidden: true }, h('p', {}, lv.intro), iconBtn('btn primary', 'next', `Начать · ${lv.items.length} фраз`, () => startBuilder(lv)));
      list.append(h('div', { class: 'blevel' },
        h('button', { type: 'button', class: 'lrow' + (done ? ' done' : ''), 'aria-expanded': 'false', onclick: e => { const b = e.currentTarget; more.hidden = !more.hidden; b.setAttribute('aria-expanded', String(!more.hidden)); } },
          h('span', { class: 'n' }, done ? '✓' : String(i + 1)),
          h('span', {}, h('div', { class: 't' }, lv.title), h('div', { class: 'k' }, lv.pattern)),
          best ? h('span', { class: 'badge ' + (done ? 'ok' : 'soon') }, best + '%') : h('span', { class: 'badge soon' }, lv.items.length + ' фраз')),
        more));
    });
    el.append(list, h('div', { class: 'actions', style: 'justify-content:flex-start' }, iconBtn('btn ghost', 'next', 'Все уровни вперемешку · 10', () => startBuilder(null))));
  }

  // ---------- чтение в поездке ----------
  const readingItem = (t, [sign, kana, mean, read]) => ({ kind: 'word', kana, w: { kana, mean, read, sign, kanji: hasKanji(sign) ? sign : undefined, topic: t.title, rtopic: t.id } });
  const readingItems = t => t.items.map(x => readingItem(t, x));
  const meaningOf = k => { const w = wordIndex().get(k); return w ? w.mean : k; };
  function meanOptions(it) {
    const t = READING.find(t => t.id === it.w.rtopic);
    const same = t ? shuffle(readingItems(t)) : [];
    const pool = shuffle(Q.pool.filter(x => x.kind === 'word' && x.w));
    const all = shuffle(READING.flatMap(readingItems));
    const out = [it.kana], seen = new Set([it.w.mean]);
    for (const x of same.concat(pool, all)) { if (out.length >= 4) break; if (seen.has(x.w.mean) || out.includes(x.kana)) continue; seen.add(x.w.mean); out.push(x.kana); }
    return shuffle(out);
  }
  function signplate(text) { return h('div', { class: 'signplate' + ([...text].length > 6 ? ' long' : ''), lang: 'ja' }, text); }
  let RT = null;                                         // открытая тема чтения
  function readingList() {
    const box = h('div', { class: 'lessons' });
    for (const t of READING) {
      const best = (lessonsDone['r-' + t.id] || {}).quiz;
      box.append(h('button', { type: 'button', class: 'lrow' + (best >= PASS * 100 ? ' done' : ''), onclick: () => { RT = t; show('reading'); } },
        h('span', { class: 'n', lang: 'ja' }, best >= PASS * 100 ? '✓' : t.icon),
        h('span', {}, h('div', { class: 't' }, t.title), h('div', { class: 'k' }, t.items.slice(0, 5).map(x => x[0]).join('・'))),
        best ? h('span', { class: 'badge ' + (best >= PASS * 100 ? 'ok' : 'soon') }, best + '%') : h('span', { class: 'badge soon' }, t.items.length + ' надп.')));
    }
    return box;
  }
  function startReading(t, mode) {
    const items = t ? readingItems(t) : shuffle(READING.flatMap(readingItems)).slice(0, 20);
    const list = mode === 'type' ? items.filter(x => !hasKanji(x.w.sign)) : items;
    FLOW = null;
    startQuiz(list, list.length, { mode, back: 'reading', track: t ? { id: 'r-' + t.id, title: t.title } : null, again: () => startReading(t, mode) });
  }
  function renderReading() {
    const el = $('#screen-reading'); el.replaceChildren();
    if (!RT) {
      el.append(h('div', { class: 'backbar' }, h('button', { class: 'link back', type: 'button', onclick: () => show('practice') }, '← Практика')),
        h('h1', { class: 'h1' }, 'Чтение в поездке'),
        h('p', { class: 'small muted' }, 'Вывески, указатели и меню по темам. Надписи каной тренируются и на чтение, надписи иероглифами достаточно узнавать в лицо — чтение показывается после ответа. Шрифт — как на настоящих табличках, а не рукописный.'),
        readingList(),
        h('div', { class: 'actions', style: 'justify-content:flex-start' }, iconBtn('btn ghost', 'next', 'Все темы вперемешку', () => startReading(null, 'mean'))));
      return;
    }
    const t = RT, items = readingItems(t), kanaOnly = items.filter(x => !hasKanji(x.w.sign));
    el.append(h('div', { class: 'backbar' }, h('button', { class: 'link back', type: 'button', onclick: () => { RT = null; renderReading(); } }, '← Все темы')),
      h('div', { class: 'hello' }, h('h1', { class: 'h1' }, t.title), (lessonsDone['r-' + t.id] || {}).quiz ? h('span', { class: 'badge ' + (lessonsDone['r-' + t.id].quiz >= PASS * 100 ? 'ok' : 'soon') }, `Лучший результат · ${lessonsDone['r-' + t.id].quiz}%`) : null),
      h('p', { class: 'lintro-text' }, t.intro),
      h('div', { class: 'actions', style: 'justify-content:flex-start' },
        iconBtn('btn primary', 'next', `Что означает? · ${items.length}`, () => startReading(t, 'mean'), 'Квиз: выбрать значение надписи'),
        kanaOnly.length ? iconBtn('btn ghost', 'next', `Прочитать · ${kanaOnly.length}`, () => startReading(t, 'type'), 'Квиз: написать чтение надписей каной') : null));
    const list = h('div', { class: 'sheet rlist' });
    for (const it of items) {
      const rd = h('span', { class: 'rd hid', title: 'Нажмите, чтобы показать чтение', onclick: () => rd.classList.remove('hid') }, (hasKanji(it.w.sign) ? it.kana + ' · ' : '') + displayReading(it.kana, S.sys, it.w.read));
      list.append(h('div', { class: 'ritem' }, signplate(it.w.sign), h('div', {}, h('div', { class: 'm' }, it.w.mean), rd), sayButton(it) || h('span')));
    }
    el.append(list);
  }

  function renderChoice(card, it, mode, msg) {
    const isWord = it.kind === 'word';
    const dir = mode === 'listen' || mode === 'mean' ? mode : (Math.random() < 0.5 ? 'k2r' : 'r2k');
    const keys = mode === 'listen' ? listenOptions(it) : mode === 'mean' ? meanOptions(it) : shuffle((it.group || [it.kana]).slice());
    const prompt = h('div', { class: 'prompt' });
    if (mode === 'mean') {
      prompt.append(h('span', { class: 'lab' }, 'Что означает надпись?'), signplate(it.w.sign || it.kana));
    } else if (mode === 'listen') {
      const say = h('button', { class: 'iconbtn say big', type: 'button', 'aria-label': 'Прослушать ещё раз', onclick: () => play() }, svgIcon('sound'), 'Ещё раз');
      const play = () => isWord ? playWord(it.kana, say, it.w.kanji) : playKana(it.kana, say);
      prompt.append(h('span', { class: 'lab' }, isWord ? 'Какое слово прозвучало?' : 'Какой знак прозвучал?'), say,
        h('span', { class: 'tag' }, isWord ? (wordScript(it.w) === 'k' ? 'слово катаканой' : 'слово хираганой') : isKata(it.kana[0]) ? 'катакана' : 'хирагана'));
      setTimeout(play, 150);
    } else if (dir === 'k2r') {
      prompt.append(h('span', { class: 'lab' }, 'Как читается этот знак?'), h('span', { class: 'kana' }, it.kana));
    } else {
      prompt.append(h('span', { class: 'lab' }, 'Найдите знак'), h('span', { class: 'big' }, readingOf(it, Q.sys)), sayButton(it, 'Прослушать'));
    }
    const asText = dir === 'k2r' || dir === 'mean';
    const label = k => dir === 'mean' ? meaningOf(k) : dir === 'k2r' ? displayReading(k, Q.sys) : k;
    const box = h('div', { class: 'choices' + (asText ? '' : ' kana') + (isWord ? ' word' : '') + (dir === 'mean' ? ' mean' : '') + (keys.length === 4 ? ' four' : '') });
    keys.forEach((k, i) => box.append(h('button', { type: 'button', class: 'choice', 'data-k': k, 'aria-label': label(k),
      onclick: () => finish({ it, status: k === it.kana ? 'ok' : 'bad', chosen: k, dir }) },
      h('span', { class: 'n', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'v' }, label(k)))));
    card.append(prompt, box, msg, h('div', { class: 'actions' },
      iconBtn('btn ghost', 'skip', 'Пропустить', () => finish({ it, status: 'skip', dir }), 'Пропустить карточку и посмотреть ответ')));
  }
  function actions(submit) {
    return h('div', { class: 'actions' },
      iconBtn('btn ghost', 'skip', 'Пропустить', () => finish({ it: Q.deck[Q.i], status: 'skip' }), 'Пропустить карточку и посмотреть ответ'),
      iconBtn('btn primary', 'next', 'Далее', submit, 'Проверить ответ'));
  }

  function finish(res) {
    Q.results[Q.i] = res;
    const mode = res.mode = res.mode || res.it.mode || Q.mode;
    const a = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), ts: Date.now(), k: res.it.kana, w: res.it.kind === 'word' || res.it.kind === 'sent' ? 1 : 0, m: mode, r: res.status };
    // с чем перепутан знак: выбранный вариант или то, как распознан рисунок
    const x = res.chosen || (res.per && res.per.length === 1 && !res.per[0].ok ? res.per[0].best : null);
    if (res.status === 'bad' && x && x !== res.it.kana) a.x = x;
    res.answerId = a.id;
    answers.push(a);
    if (answers.length > MAX_ANSWERS) answers.splice(0, answers.length - MAX_ANSWERS);
    store.set('answers', answers);
    countCard(); buzz(res.status === 'ok');
    renderVerdict(res);
  }
  function renderVerdict(res) {
    const { it, status } = res;
    const isWord = it.kind === 'word';
    const card = $('#card'); card.replaceChildren();
    const v = h('div', { class: 'verdict' });
    const markTxt = status === 'ok' ? '○' : status === 'bad' ? '✕' : '—';
    v.append(h('div', { class: 'mark ' + status, 'aria-hidden': 'true' }, markTxt),
      h('div', { class: 'vtitle' }, status === 'ok' ? (res.taught ? 'Засчитано' : 'Верно') : status === 'bad' ? 'Неверно' : 'Пропущено'));
    const mode = res.mode || Q.mode;
    const reading = h('div', { class: 'vreading' }, h('div', { class: 'correct-reading' }, readingOf(it, Q.sys)), h('div', { class: 'small muted' }, readingOf(it, otherSys(Q.sys))), sayButton(it, 'Прослушать'));
    if (mode === 'build') {
      if (res.built && res.built.length) {
        const good = it.parts;
        v.append(h('div', { class: 'bline mine' }, ...res.built.map((t, i) => h('span', { class: 'btok' + (status === 'ok' ? ' ok' : t === good[i] ? '' : ' bad') }, t))), h('div', { class: 'small muted' }, 'Ваш вариант'));
      }
      v.append(h('div', { class: 'bline' }, ...it.parts.map(t => h('span', { class: 'btok' + (status === 'ok' ? ' ok' : '') }, t))), reading,
        h('div', { class: 'meaning' }, it.w.mean));
      if (it.alts.length) v.append(h('div', { class: 'small muted' }, 'Тоже верно: ' + it.alts.map(a => a.join('')).join('; ')));
      if (it.note) v.append(h('div', { class: 'note' }, it.note));
    } else if (mode === 'listen' || mode === 'sim' || mode === 'mean') {
      v.append(it.w && it.w.sign && it.w.sign !== it.kana ? signplate(it.w.sign) : h('div', { class: 'kana' + (isWord ? ' word' : ''), style: 'font-family:var(--kana);font-size:' + (isWord ? '44px' : '64px') + ';line-height:1.1' }, it.kana));
      if (it.w && it.w.sign && it.w.sign !== it.kana) v.append(h('div', { class: 'kana-in', style: 'font-size:26px' }, it.kana));
      v.append(reading);
      if (isWord) v.append(h('div', { class: 'meaning' }, it.w.mean));
      if (status === 'bad' && res.chosen && mode === 'mean') v.append(h('div', { class: 'your' }, 'Вы выбрали: ', h('s', {}, meaningOf(res.chosen))));
      else if (status === 'bad' && res.chosen) {
        const cw = isWord ? wordIndex().get(res.chosen) : null;
        v.append(h('div', { class: 'your' }, 'Вы выбрали: ', h('s', { class: 'kana-in' }, res.chosen), ' — ' + displayReading(res.chosen, Q.sys, cw && cw.read) + (cw ? ' · ' + cw.mean : '')));
      }
      if (mode === 'sim' && it.group) v.append(h('div', { class: 'simrow' }, ...it.group.map(k => h('div', { class: k === it.kana ? 'on' : '' }, h('span', { class: 'k' }, k), h('span', { class: 'r' }, displayReading(k, Q.sys))))));
      const note = !isWord && (status === 'bad' && res.chosen ? simNote(it.kana, res.chosen) : mode === 'sim' ? groupNote(it) : null);
      if (note) v.append(h('div', { class: 'note' }, 'Как различать: ' + note));
    } else if (mode === 'draw') {
      const units = [...it.kana];
      const cmp = h('div', { class: 'compare' });
      if (res.per) cmp.append(h('figure', {}, h('div', { class: 'glyphs' }, ...res.per.map(p => { const c = thumb(p.strokes); c.style.borderColor = p.ok ? 'var(--ok)' : 'var(--shu)'; return c; })), h('figcaption', {}, 'Ваш рисунок')));
      cmp.append(h('figure', {}, h('div', { class: 'glyphs' }, ...units.map(u => h('div', { class: 'glyph' }, u))), h('figcaption', {}, 'Правильно')));
      v.append(cmp);
      if (isWord) v.append(h('div', { class: 'meaning' }, it.w.mean));
      v.append(reading);
      if (status === 'bad' && res.per) {
        const wrong = res.per.filter(p => !p.ok);
        v.append(h('div', { class: 'note' }, wrong.map(p => `Знак ${p.target}: распознан как «${p.best}»` + (simNote(p.target, p.best) ? ` — ${simNote(p.target, p.best)}` : '')).join('. ') + '.'));
      }
      // порядок штрихов для неверных или пропущенных знаков
      if (status !== 'ok') {
        const targets = [...new Set((res.per ? res.per.filter(p => !p.ok).map(p => p.target) : units.map(bigOf)))].slice(0, 4);
        v.append(h('figure', { style: 'margin:0;display:grid;gap:6px;justify-items:center' },
          h('div', { class: 'glyphs' }, ...targets.map(t => strokeOrder(t))),
          h('figcaption', { class: 'small muted' }, 'Порядок штрихов — нажмите на ячейку, чтобы повторить')));
      }
      if (status === 'bad' && res.per) {
        v.append(iconBtn('btn ghost', 'undo', 'Мой знак верный — засчитать', () => {
          for (const p of res.per) if (!p.ok) {
            (samples[p.target] = samples[p.target] || []).push(pack(p.strokes));
            if (samples[p.target].length > 12) samples[p.target].shift();
            rec.addUserSample(p.target, p.strokes.map(s => s.map(q => ({ x: q.x * 100, y: q.y * 100 }))));
            p.ok = true;
          }
          store.set('samples', samples);
          res.status = 'ok'; res.taught = true;
          const a = answers.find(x => x.id === res.answerId); if (a) { a.r = 'ok'; delete a.x; store.set('answers', answers); }
          renderVerdict(res);
        }, 'Сохранить этот рисунок как образец вашего почерка и засчитать ответ'));
      }
      if (res.taught) v.append(h('div', { class: 'note' }, 'Рисунок сохранён как образец вашего почерка: такой вариант теперь будет приниматься.'));
    } else {
      v.append(h('div', { class: 'kana' + (isWord ? ' word' : ''), style: 'font-family:var(--kana);font-size:' + (isWord ? '44px' : '64px') + ';line-height:1.1' }, it.kana), reading);
      if (isWord) v.append(h('div', { class: 'meaning' }, it.w.mean));
      if (res.answer && status === 'bad') v.append(h('div', { class: 'your' }, 'Ваш ответ: ', h('s', {}, res.answer)));
    }
    const last = Q.i === Q.deck.length - 1;
    const cont = iconBtn('btn primary', 'next', last ? 'Показать итоги' : 'Следующая карточка', next);
    v.append(cont);
    card.append(v);
    setTimeout(() => cont.focus(), 30);
  }
  function next() {
    if (Q.i >= Q.deck.length - 1) { renderResult(); return; }
    Q.i++; renderCard();
  }

  function renderResult() {
    const rs = Q.results.filter(Boolean);
    const ok = rs.filter(r => r.status === 'ok').length, bad = rs.filter(r => r.status === 'bad').length, skip = rs.filter(r => r.status === 'skip').length;
    const missed = []; const seen = new Set();
    for (const r of rs) if (r.status !== 'ok' && !seen.has(r.it.kana)) { seen.add(r.it.kana); missed.push(r.it); }
    const el = $('#screen-result'); el.replaceChildren();
    el.append(h('div', { class: 'prompt' }, h('span', { class: 'lab' }, 'Итоги квиза'), h('span', { class: 'big' }, `${ok} из ${rs.length}`),
      rs.length < Q.deck.length ? h('span', { class: 'small muted' }, `Квиз завершён досрочно: пройдено ${rs.length} из ${Q.deck.length} карточек`) : null));
    el.append(h('div', { class: 'score', style: 'width:100%' },
      h('div', { class: 'ok' }, h('div', { class: 'v' }, ok), h('div', { class: 'l' }, 'правильных')),
      h('div', { class: 'bad' }, h('div', { class: 'v' }, bad + skip), h('div', { class: 'l' }, 'неправильных' + (skip ? `, из них пропущено ${skip}` : '')))));
    if (missed.length) {
      el.append(h('div', { class: 'small muted' }, 'Над чем поработать'),
        h('div', { class: 'mistakes' }, ...missed.map(it => h('div', {}, h('span', { class: 'k' }, it.kana), h('span', { class: 'r' }, readingOf(it, Q.sys) + (it.w ? ' · ' + it.w.mean : ''))))));
    }
    const missedItems = missed;
    if (FLOW && FLOW.step === 'quiz') {
      const l = FLOW.lesson, pct = Math.round(ok / Math.max(1, Q.deck.length) * 100), passed = pct >= PASS * 100;
      markStep(l, 'quiz', pct);
      const next = LESSONS[LESSONS.indexOf(l) + 1];
      el.prepend(h('div', { class: 'result-banner ' + (passed ? 'ok' : 'bad') }, passed ? `${lessonLabel(l)} пройден: ${pct}%` : `${pct}% — для прохождения нужно ${PASS * 100}%. Повторите знакомство и попробуйте ещё раз.`));
      el.append(h('div', { class: 'actions', style: 'justify-content:center' },
        passed && next ? iconBtn('btn primary', 'next', `Следующий урок: ${next.title}`, () => { FLOW = null; Q = null; openLesson(next); }) : null,
        iconBtn(passed ? 'btn ghost' : 'btn primary', 'undo', 'Пройти проверку ещё раз', () => startLessonQuiz(l)),
        h('button', { class: 'btn ghost', type: 'button', onclick: backToLesson }, 'К уроку')));
      return show('result');
    }
    if (Q.review) {
      const left = srsDue().length;
      el.prepend(h('div', { class: 'result-banner ' + (left ? 'bad' : 'ok') }, left ? `Повторение: ещё ${left} ${plural(left, 'знак', 'знака', 'знаков')} на сегодня` : 'Повторение на сегодня выполнено'));
      el.append(h('div', { class: 'actions', style: 'justify-content:center' },
        left ? iconBtn('btn primary', 'next', `Продолжить повторение (${left})`, startReview) : null,
        h('button', { class: left ? 'btn ghost' : 'btn primary', type: 'button', onclick: () => { Q = null; show('home'); } }, 'На главную')));
      return show('result');
    }
    const back = Q.back, again = Q.again;
    if (Q.track && rs.length === Q.deck.length) {
      const pct = Math.round(ok / Q.deck.length * 100), id = Q.track.id;
      lessonsDone[id] = { quiz: Math.max(pct, (lessonsDone[id] || {}).quiz || 0) }; saveLessons();
      el.prepend(h('div', { class: 'result-banner ' + (pct >= PASS * 100 ? 'ok' : 'bad') }, `${Q.track.title}: ${pct}%`));
    }
    el.append(h('div', { class: 'actions', style: 'justify-content:center' },
      missedItems.length ? iconBtn('btn primary', 'undo', `Повторить ошибки (${missedItems.length})`, () => startQuiz(missedItems, missedItems.length * 2, { mode: Q.mode, back })) : null,
      again ? iconBtn('btn ghost', 'next', 'Ещё раз', again) : null,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { Q = null; show(back); } }, back === 'setup' ? 'Новый квиз' : back === 'similar' ? 'К выбору групп' : back === 'builder' ? 'К уровням' : 'Готово')));
    show('result');
  }

  // ---------- азбука: таблицы, озвучка, прописи ----------
  const audioCache = {};
  function playKana(kana, cell) {
    const key = toHira(kana);
    if (!window.KANA_PWA) return;   // озвучка есть только в собранной версии
    const voice = S.voice === 'f' ? 'f' : 'm';
    let a = audioCache[voice + key];
    if (!a) { a = audioCache[voice + key] = new Audio('audio/' + voice + '/' + encodeURIComponent(key) + '.mp3'); a.preload = 'auto'; }
    try { a.currentTime = 0; } catch (e) { }
    const p = a.play(); if (p && p.catch) p.catch(() => { });
    if (cell) { cell.classList.remove('playing'); void cell.offsetWidth; cell.classList.add('playing'); }
    return a;
  }
  // слова: стартовый словарь — записанная озвучка; свои слова — VOICEVOX на сервере (/api/tts),
  // без сети или сервера — японский голос устройства, если он есть
  const WORD_AUDIO = new Set(window.WORD_AUDIO || []);
  const KANJI_RE = /^[\u3041-\u3096\u30a1-\u30fa\u30fc\u3005\u4e00-\u9fff]{1,30}$/;
  function ttsUrl(kana, kanji, voice) {
    return '/api/tts?v=' + (voice || (S.voice === 'f' ? 'f' : 'm')) + '&t=' + encodeURIComponent(kana) + (kanji && KANJI_RE.test(kanji) ? '&k=' + encodeURIComponent(kanji) : '');
  }
  function prefetchWord(kana, kanji) { if (window.KANA_PWA && !WORD_AUDIO.has(kana)) fetch(ttsUrl(kana, kanji)).catch(() => { }); }
  function speakDevice(kana) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(kana);
      u.lang = 'ja-JP'; u.rate = 0.85;
      const v = speechSynthesis.getVoices().find(v => /^ja/i.test(v.lang)); if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) { }
  }
  const hasJaVoice = () => { try { return speechSynthesis.getVoices().some(v => /^ja/i.test(v.lang)); } catch (e) { return false; } };
  try { speechSynthesis.onvoiceschanged = () => { if (current === 'dict') renderDict(); }; } catch (e) { }
  function canSay(kana) { return WORD_AUDIO.has(kana) || !!window.KANA_PWA || ('speechSynthesis' in window && hasJaVoice()); }
  function playWord(kana, btn, kanji) {
    const voice = S.voice === 'f' ? 'f' : 'm';
    const builtin = WORD_AUDIO.has(kana);
    if (!builtin && !window.KANA_PWA) { speakDevice(kana); }
    else {
      const key = 'w' + voice + kana + '|' + (kanji || '');
      let a = audioCache[key];
      if (!a) {
        a = audioCache[key] = new Audio(builtin ? 'audio/words/' + voice + '/' + encodeURIComponent(kana) + '.mp3' : ttsUrl(kana, kanji, voice));
        if (!builtin) a.addEventListener('error', () => { delete audioCache[key]; speakDevice(kana); });
      }
      try { a.currentTime = 0; } catch (e) { }
      const p = a.play(); if (p && p.catch) p.catch(() => { if (!builtin) { delete audioCache[key]; speakDevice(kana); } });
    }
    if (btn) { btn.classList.remove('playing'); void btn.offsetWidth; btn.classList.add('playing'); }
  }
  function sayButton(it, label) {
    const isWord = it.kind === 'word' || it.word;
    const kana = it.kana, kanji = it.kanji || (it.w && it.w.kanji);
    if (isWord && !canSay(kana)) return null;
    const b = h('button', { class: 'iconbtn say', type: 'button', title: 'Прослушать', 'aria-label': 'Прослушать ' + kana,
      onclick: () => isWord ? playWord(kana, b, kanji) : playKana(kana, b) }, svgIcon('sound'), label || null);
    return b;
  }
  let rowTimer = null;
  function playRow(list, cells) {
    clearTimeout(rowTimer);
    let i = 0;
    const step = () => { if (i >= list.length) return; playKana(list[i], cells[i]); i++; rowTimer = setTimeout(step, 750); };
    step();
  }

  // раскладка как в таблице годзюон: 5 столбцов по гласным
  function gojuonRows(group) {
    const out = [];
    for (const r of ROWS.filter(r => r.g === group)) {
      const c = r.h.split(' ');
      if (r.id === 'ya') out.push({ r, cells: [c[0], '', c[1], '', c[2]] });
      else if (r.id === 'wa') { out.push({ r, cells: [c[0], '', '', '', c[1]] }); out.push({ r: { id: 'n', name: 'н', l: 'n' }, cells: [c[2], '', '', '', ''], single: true }); }
      else out.push({ r, cells: c });
    }
    return out;
  }
  const VOWELS = { ru: ['а', 'и', 'у', 'э', 'о'], lat: ['a', 'i', 'u', 'e', 'o'] };

  function renderAbc() {
    const sc = S.abcScript === 'k' ? 'k' : 'h';
    const conv = k => sc === 'k' ? toKata(k) : k;
    const sel = new Set(S.abcSel[sc] || []);
    const selecting = S.abcMode === 'select';
    const el = $('#abc'); el.replaceChildren();
    const setSel = () => { S.abcSel[sc] = [...sel]; save(); renderAbc(); };

    el.append(h('div', { class: 'abc-top' },
      h('div', { class: 'segm', role: 'group', 'aria-label': 'Азбука' },
        ...[['h', 'Хирагана'], ['k', 'Катакана']].map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(sc === v), onclick: () => { S.abcScript = v; save(); renderAbc(); } }, t))),
      h('div', { class: 'segm', role: 'group', 'aria-label': 'Нажатие на знак' },
        h('button', { type: 'button', 'aria-pressed': String(!selecting), onclick: () => { S.abcMode = 'listen'; save(); renderAbc(); } }, svgIcon('sound'), 'Слушать'),
        h('button', { type: 'button', 'aria-pressed': String(selecting), onclick: () => { S.abcMode = 'select'; save(); renderAbc(); } }, svgIcon('check'), 'Выбрать для прописей')),
      h('div', { class: 'segm', role: 'group', 'aria-label': 'Голос' },
        ...[['m', 'Мужской голос'], ['f', 'Женский голос']].map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String((S.voice === 'f' ? 'f' : 'm') === v), onclick: () => { S.voice = v; save(); renderAbc(); playKana(conv('あ')); } }, t)))));
    el.append(h('p', { class: 'small muted abc-credit' }, 'Озвучка: VOICEVOX:青山龍星 (мужской голос), VOICEVOX:波音リツ (женский голос)'));
    el.append(h('p', { class: 'small muted abc-hint' }, selecting
      ? 'Отметьте знаки или целый ряд — нажмите на подпись ряда слева. Затем выберите число повторений внизу.'
      : 'Нажмите на знак, чтобы услышать его. Подпись ряда слева проигрывает весь ряд.'));

    for (const [group, title] of [['basic', 'Основные'], ['dakuten', 'С дакутэном и хандакутэном'], ['yoon', 'Сочетания (ёон)']]) {
      const yoon = group === 'yoon';
      const cols = yoon ? 3 : 5;
      const grid = h('div', { class: 'abc-grid' + (yoon ? ' yoon' : '') });
      grid.append(h('div', { class: 'abc-head' }));
      if (!yoon) VOWELS[S.sys].forEach(v => grid.append(h('div', { class: 'abc-head' }, v)));
      else ['а / я', 'у / ю', 'о / ё'].forEach((v, i) => grid.append(h('div', { class: 'abc-head' }, S.sys === 'lat' ? ['ya', 'yu', 'yo'][i] : v)));
      const rows = yoon ? ROWS.filter(r => r.g === 'yoon').map(r => ({ r, cells: r.h.split(' ') })) : gojuonRows(group);
      for (const { r, cells } of rows) {
        const kanas = cells.filter(Boolean).map(conv);
        const cellEls = [];
        const rowSelectable = selecting && !yoon;
        const allOn = kanas.every(k => sel.has(k));
        const label = h('button', {
          type: 'button', class: 'abc-row' + (rowSelectable && allOn ? ' on' : ''), disabled: selecting && yoon,
          title: selecting ? (allOn ? 'Снять ряд' : 'Выбрать весь ряд') : 'Прослушать ряд',
          onclick: () => {
            if (!selecting) return playRow(kanas, cellEls);
            if (allOn) kanas.forEach(k => sel.delete(k)); else kanas.forEach(k => sel.add(k));
            setSel();
          },
        }, S.sys === 'lat' ? (r.l ? r.l.split(' ')[0] : r.id) : r.name.replace(' + н', ''));
        grid.append(label);
        for (let i = 0; i < cols; i++) {
          const base = cells[i];
          if (!base) { grid.append(h('div', { class: 'abc-cell empty', 'aria-hidden': 'true' })); continue; }
          const k = conv(base);
          const reading = displayReading(k, S.sys);
          const on = sel.has(k);
          const cell = h('button', {
            type: 'button', class: 'abc-cell' + (selecting && on ? ' on' : ''), disabled: selecting && yoon,
            'aria-pressed': selecting ? String(on) : null,
            'aria-label': selecting ? `${k}, ${reading}${on ? ', выбран' : ''}` : `Прослушать ${k}, ${reading}`,
            onclick: () => {
              if (!selecting) return playKana(k, cell);
              if (on) sel.delete(k); else sel.add(k);
              setSel();
            },
          }, h('span', { class: 'k' }, k), h('span', { class: 'r' }, reading), selecting && on ? h('span', { class: 'tick', 'aria-hidden': 'true' }, '✓') : null);
          cellEls.push(cell);
          grid.append(cell);
        }
      }
      el.append(h('h4', { class: 'sh' }, title), grid);
      if (yoon && selecting) el.append(h('p', { class: 'small muted' }, 'Сочетания пишутся двумя знаками: отработайте основной знак и я, ю, ё — маленькие пишутся так же, только мельче.'));
    }

    // панель запуска прописей
    const n = sel.size;
    const bar = $('#abc-bar'); bar.replaceChildren();
    bar.hidden = n === 0;
    if (n) {
      const reps = Math.max(5, S.reps | 0);
      const cnt = h('input', { id: 'reps', type: 'number', inputmode: 'numeric', min: '5', max: '50', value: String(reps), 'aria-label': 'Повторений на каждый знак' });
      cnt.addEventListener('change', () => { S.reps = Math.min(50, Math.max(5, parseInt(cnt.value) || 5)); save(); renderAbc(); });
      bar.append(h('div', { class: 'abc-bar-in' },
        h('div', { class: 'abc-sel' }, h('b', {}, `Выбрано: ${n}`), h('span', { class: 'k' }, [...sel].slice(0, 12).join(' ') + (n > 12 ? ' …' : '')),
          h('button', { class: 'link', type: 'button', onclick: () => { sel.clear(); setSel(); } }, 'снять')),
        h('div', { class: 'abc-opts' },
          h('label', { class: 'small muted', for: 'reps' }, 'Повторений'),
          h('div', { class: 'stepper sm' },
            h('button', { type: 'button', 'aria-label': 'Меньше', onclick: () => { S.reps = Math.max(5, reps - 1); save(); renderAbc(); } }, '−'), cnt,
            h('button', { type: 'button', 'aria-label': 'Больше', onclick: () => { S.reps = Math.min(50, reps + 1); save(); renderAbc(); } }, '+')),
          ghostToggle(() => renderAbc())),
        iconBtn('btn primary', 'next', `Начать прописи · ${n * reps}`, () => startWriting([...sel].sort((a, b) => order(a) - order(b)), reps))));
    }
  }
  const ORDER = (() => { const m = {}; let i = 0; for (const r of ROWS) for (const k of r.h.split(' ')) { m[k] = i; m[toKata(k)] = i; i++; } return m; })();
  const order = k => ORDER[k] ?? 999;
  function ghostToggle(after) {
    const box = h('input', { type: 'checkbox', id: 'ghost-' + Math.random().toString(36).slice(2, 7) });
    box.checked = !!S.ghost;
    box.addEventListener('change', () => { S.ghost = box.checked; save(); after && after(); });
    return h('label', { class: 'check', for: box.id }, box, 'Подложка для обводки');
  }
  function svgIcon(name) {
    const sp = h('span', { class: 'ic', 'aria-hidden': 'true' });
    sp.innerHTML = {
      sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
      check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    }[name];
    return sp;
  }

  // ---------- прописи ----------
  let WR = null;
  function startWriting(kanas, reps, opts = {}) {
    if (opts.ghostFirst == null && FLOW && FLOW.step !== 'write') FLOW = null;
    WR = { kanas, reps, i: 0, done: 0, stats: kanas.map(k => ({ k, ok: 0, bad: 0, firstBad: 0, skipped: false })), seq: 0, ghostFirst: opts.ghostFirst };
    show('write'); renderWrite(true);
  }
  function renderWrite(newKana) {
    const el = $('#write'); el.replaceChildren();
    if (WR.i >= WR.kanas.length) return renderWriteResult();
    const k = WR.kanas[WR.i], st = WR.stats[WR.i];
    const total = WR.kanas.length * WR.reps;
    $('#w-ctr').textContent = `${Math.min(WR.done + 1, total)} / ${total}`;
    $('#w-prog').style.width = (WR.done / total * 100) + '%';

    const dots = h('div', { class: 'dots', 'aria-label': `Написано ${st.ok} из ${WR.reps}` },
      ...Array.from({ length: WR.reps }, (_, j) => h('i', { class: j < st.ok ? 'on' : '' })));
    const head = h('div', { class: 'w-head' },
      h('div', { class: 'w-model' }, strokeOrder(k), h('span', { class: 'small muted' }, 'нажмите — порядок штрихов')),
      h('div', { class: 'w-info' },
        h('div', { class: 'w-kana' }, k),
        h('div', { class: 'w-read' }, displayReading(k, S.sys), h('span', { class: 'muted' }, ' · ' + displayReading(k, otherSys(S.sys)))),
        h('button', { class: 'iconbtn', type: 'button', onclick: () => playKana(k) }, svgIcon('sound'), 'Произношение'),
        h('div', { class: 'small muted' }, `Знак ${WR.i + 1} из ${WR.kanas.length} · написано ${st.ok} из ${WR.reps}`),
        dots));
    const msg = h('div', { class: 'msg w-msg', role: 'status' });
    const pad = makePad(() => { msg.textContent = ''; msg.className = 'msg w-msg'; pad.el.classList.remove('ok', 'bad'); });
    const lessonGhost = WR.ghostFirst != null;
    pad.ghost = (lessonGhost ? st.ok < WR.ghostFirst : S.ghost) ? bigOf(k) : null;
    const check = iconBtn('btn primary', 'next', 'Проверить', () => submit(), 'Проверить написанный знак');
    const skipBtn = iconBtn('btn ghost', 'skip', 'Пропустить', () => { st.skipped = true; WR.done += WR.reps - st.ok; WR.i++; renderWrite(true); }, 'Перейти к следующему знаку');
    const tools = h('div', { class: 'padtools' },
      iconBtn('iconbtn', 'undo', 'Отменить штрих', () => pad.undo()),
      iconBtn('iconbtn', 'clear', 'Стереть', () => pad.clear()),
      lessonGhost ? h('span', { class: 'small muted' }, st.ok < WR.ghostFirst ? `По подложке: ещё ${WR.ghostFirst - st.ok}` : 'Теперь по памяти, без подложки') : ghostToggle(() => { pad.ghost = S.ghost ? bigOf(k) : null; pad.redraw(); }));
    const actions = h('div', { class: 'actions' }, skipBtn, check);
    el.append(head, pad.el, tools, msg, actions);
    if (newKana) setTimeout(() => playKana(k), 250);

    let busy = false;
    function submit() {
      if (busy) return;
      if (!pad.strokes.length) { msg.textContent = 'Сначала напишите знак в поле.'; return; }
      const strokes = pad.strokes.map(s => s.slice());
      const res = judgeChar(strokes, bigOf(k), S.len);
      const ghostUsed = !!pad.ghost;
      countCard(); buzz(res.ok);
      // в историю ответов — только попытки без подложки: обводка не показывает, помнит ли рука знак
      let rec_ = null;
      if (!ghostUsed) {
        rec_ = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), ts: Date.now(), k, w: 0, m: 'write', r: res.ok ? 'ok' : 'bad' };
        answers.push(rec_); if (answers.length > MAX_ANSWERS) answers.splice(0, answers.length - MAX_ANSWERS);
        store.set('answers', answers);
      }
      if (res.ok) return accept(false);
      st.bad++; if (st.ok === 0 && st.bad === 1) st.firstBad = 1;
      pad.el.classList.add('bad');
      msg.className = 'msg w-msg bad';
      msg.replaceChildren(h('b', {}, '✕ Не похоже'), ` — распознано как «${res.best}». Попробуйте ещё раз.`);
      actions.replaceChildren(
        iconBtn('btn ghost', 'undo', 'Мой знак верный', () => {
          (samples[bigOf(k)] = samples[bigOf(k)] || []).push(pack(strokes));
          if (samples[bigOf(k)].length > 12) samples[bigOf(k)].shift();
          store.set('samples', samples);
          rec.addUserSample(bigOf(k), strokes.map(s => s.map(q => ({ x: q.x * 100, y: q.y * 100 }))));
          st.bad--; if (rec_) { rec_.r = 'ok'; store.set('answers', answers); }
          accept(true);
        }, 'Сохранить рисунок как образец вашего почерка и засчитать'),
        iconBtn('btn primary', 'clear', 'Ещё раз', () => { pad.clear(); actions.replaceChildren(skipBtn, check); }));
    }
    function accept(taught) {
      busy = true;
      st.ok++; WR.done++;
      pad.el.classList.remove('bad'); pad.el.classList.add('ok');
      msg.className = 'msg w-msg ok';
      msg.replaceChildren(h('b', {}, '○ Верно'), taught ? ' — образец почерка сохранён' : '');
      dots.children[st.ok - 1] && dots.children[st.ok - 1].classList.add('on');
      setTimeout(() => {
        if (st.ok >= WR.reps) { WR.i++; renderWrite(true); }
        else renderWrite(false);
      }, taught ? 900 : 550);
    }
    WR.submit = submit;
  }
  function renderWriteResult() {
    $('#w-prog').style.width = '100%';
    const el = $('#write'); el.replaceChildren();
    const totalOk = WR.stats.reduce((a, s) => a + s.ok, 0), totalBad = WR.stats.reduce((a, s) => a + s.bad, 0);
    const hard = WR.stats.filter(s => s.bad > 0 || s.skipped);
    el.append(h('div', { class: 'prompt' }, h('span', { class: 'lab' }, 'Прописи завершены'),
      h('span', { class: 'big' }, `${totalOk} верных`),
      h('span', { class: 'small muted' }, totalBad ? `и ${totalBad} неудачных попыток` : 'без единой ошибки')));
    el.append(h('div', { class: 'w-table' }, ...WR.stats.map(s => h('div', { class: 'w-row' + (s.bad || s.skipped ? ' hard' : '') },
      h('span', { class: 'k' }, s.k),
      h('span', { class: 'r' }, displayReading(s.k, S.sys)),
      h('span', {}, s.skipped ? `пропущен, написано ${s.ok}` : `${s.ok} верно`),
      h('span', { class: s.bad ? 'bad' : 'muted' }, s.bad ? `${s.bad} ошиб.` : '—')))));
    if (FLOW && FLOW.step === 'write') {
      const l = FLOW.lesson; markStep(l, 'write');
      el.append(h('div', { class: 'actions', style: 'justify-content:center' },
        iconBtn('btn primary', 'next', 'Дальше: проверка', () => startLessonQuiz(l)),
        hard.length ? iconBtn('btn ghost', 'undo', `Повторить трудные (${hard.length})`, () => startWriting(hard.map(s => s.k), WR.reps, { ghostFirst: WR.ghostFirst })) : null,
        h('button', { class: 'btn ghost', type: 'button', onclick: backToLesson }, 'К уроку')));
      return;
    }
    el.append(h('div', { class: 'actions', style: 'justify-content:center' },
      hard.length ? iconBtn('btn primary', 'undo', `Повторить трудные (${hard.length})`, () => startWriting(hard.map(s => s.k), WR.reps)) : null,
      iconBtn('btn ghost', 'undo', 'Ещё раз все', () => startWriting(WR.kanas, WR.reps)),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { WR = null; show('abc'); } }, 'К азбуке')));
  }
  $('#btn-wquit').onclick = () => { if (WR && WR.done > 0 && WR.i < WR.kanas.length) { WR.i = WR.kanas.length; renderWrite(); } else if (FLOW) backToLesson(); else { WR = null; show('abc'); } };
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && current === 'write' && WR && WR.submit && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); WR.submit(); }
  });

  // ---------- переключение экранов ----------
  let current = 'home';
  const SCREENS = ['onboard', 'home', 'lessons', 'lesson', 'lintro', 'practice', 'setup', 'quiz', 'result', 'abc', 'write', 'dict', 'me', 'similar', 'reading', 'builder'];
  const TAB_OF = { onboard: null, home: 'home', lessons: 'lessons', lesson: 'lessons', lintro: 'lessons', practice: 'practice', setup: 'practice', quiz: 'practice', result: 'practice', abc: 'practice', write: 'practice', dict: 'dict', me: 'me', similar: 'practice', reading: 'practice', builder: 'practice' };
  const tabOf = name => (FLOW && ['quiz', 'result', 'write'].includes(name)) ? 'lessons' : TAB_OF[name];
  const lastOf = { home: 'home', lessons: 'lessons', practice: 'practice', dict: 'dict', me: 'me' };
  function show(name) {
    const tab = tabOf(name);
    if (tab && !FLOW) lastOf[tab] = (name === 'quiz' || name === 'result' || name === 'write') ? lastOf[tab] : name;
    current = name;
    for (const n of SCREENS) $('#screen-' + n).hidden = name !== n;
    document.querySelectorAll('.backbar[data-for]').forEach(b => { b.hidden = b.dataset.for !== name; });
    $('#bnav').hidden = name === 'onboard';
    document.querySelectorAll('#bnav button').forEach(x => { if (x.dataset.tab === tab) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
    ({ setup: renderSetup, dict: renderDict, me: renderMe, abc: renderAbc, home: renderHome, lessons: renderLessons, lesson: renderLesson, practice: renderPractice, onboard: renderOnboard, similar: renderSimilar, reading: renderReading, builder: renderBuilder })[name]?.();
    renderStreak();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('#bnav button').forEach(b => b.onclick = () => {
    const tab = b.dataset.tab;
    // повторное нажатие на текущий раздел — на его главный экран
    const target = tabOf(current) === tab ? tab : (lastOf[tab] || tab);
    if (FLOW && tab !== 'lessons') { FLOW = null; Q = null; WR = null; IN = null; }
    show(target === 'lessons' && curLesson && tabOf(current) !== 'lessons' && lastOf.lessons === 'lesson' ? 'lesson' : target);
  });
  document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => show(b.dataset.back));
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !$('#screen-quiz').hidden && document.activeElement && document.activeElement.tagName === 'BODY') {
      const b = $('#card .btn.primary'); if (b) b.click();
    }
    // карточки с выбором: цифры 1–4
    if (/^[1-9]$/.test(e.key) && !$('#screen-quiz').hidden && !(document.activeElement && document.activeElement.tagName === 'INPUT')) {
      const c = document.querySelectorAll('#card .choices .choice')[+e.key - 1]; if (c) { e.preventDefault(); c.click(); }
    }
  });

  // ---------- словарь ----------
  function saveWords() { store.set('words', userWords); store.set('deleted', [...deleted]); }
  function renderDict() {
    const q = ($('#dict-q').value || '').trim().toLowerCase();
    const ws = allWords();
    $('#topics').replaceChildren(...topicsOf(ws).map(t => h('option', { value: t })));
    const list = $('#wlist'); list.replaceChildren();
    const filt = ws.filter(w => !q || w.kana.includes(q) || w.mean.toLowerCase().includes(q) || displayReading(w.kana, 'ru', w.read).includes(q) || displayReading(w.kana, 'lat', w.read).includes(q));
    $('#dict-count').textContent = `${filt.length} из ${ws.length} слов`;
    for (const t of topicsOf(filt)) {
      list.append(h('div', {}, h('h4', {}, t), ...filt.filter(w => (w.topic || 'Без темы') === t).map(w => h('div', { class: 'wrow' },
        h('span', { class: 'k' }, w.kana),
        h('span', { class: 'rd' }, displayReading(w.kana, 'ru', w.read) + ' · ' + displayReading(w.kana, 'lat', w.read)),
        h('span', { class: 'm' }, w.mean),
        sayButton({ kana: w.kana, kanji: w.kanji, word: true }) || h('span', { class: 'say-none', title: 'Для своих слов нужен японский голос в системе устройства' }),
        h('button', { class: 'del', type: 'button', title: 'Удалить слово', 'aria-label': 'Удалить ' + w.kana, onclick: () => {
          if (w.builtin) deleted.add(wid(w)); else userWords = userWords.filter(x => wid(x) !== wid(w));
          saveWords(); renderDict();
        } }, '×')))));
    }
    if (!filt.length) list.append(h('div', { class: 'muted' }, 'Ничего не найдено.'));
    const n = Object.values(samples).reduce((a, s) => a + s.length, 0);
    $('#samples-info').textContent = `Образцов почерка: ${n}`;
  }
  $('#dict-q').addEventListener('input', renderDict);
  const KANA_RE = /^[ぁ-ゖァ-ーー]+$/;
  $('#add-kana').addEventListener('input', () => {
    const k = $('#add-kana').value.trim();
    $('#add-preview').textContent = k && KANA_RE.test(k) ? `Чтение: ${displayReading(k, 'ru', $('#add-read').value.trim() || null)} · ${displayReading(k, 'lat', $('#add-read').value.trim() || null)}` : (k ? 'Пишите только хираганой или катаканой' : '');
  });
  $('#add-form').addEventListener('submit', e => {
    e.preventDefault();
    const kana = $('#add-kana').value.trim(), mean = $('#add-mean').value.trim(), topic = $('#add-topic').value.trim() || 'Мои слова', read = $('#add-read').value.trim() || undefined;
    const kanji = $('#add-kanji').value.trim() || undefined;
    if (!KANA_RE.test(kana)) { $('#add-ok').textContent = ''; $('#add-preview').textContent = 'Слово должно быть записано хираганой или катаканой.'; return; }
    if (kanji && !KANJI_RE.test(kanji)) { $('#add-ok').textContent = ''; $('#add-preview').textContent = 'Запись иероглифами: только иероглифы и кана, до 30 знаков.'; return; }
    userWords.push({ kana, mean, topic, read, kanji }); deleted.delete(kana + '|' + mean); saveWords();
    prefetchWord(kana, kanji);
    $('#add-ok').textContent = `Добавлено: ${kana}`; e.target.reset(); $('#add-preview').textContent = ''; renderDict();
  });
  $('#imp-file').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { $('#imp-text').value = r.result; }; r.readAsText(f); });
  $('#imp-go').onclick = () => {
    const lines = $('#imp-text').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let added = 0, skipped = 0; const have = new Set(allWords().map(wid));
    for (const line of lines) {
      const sep = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
      const [kana, mean, topic, read, kanji] = line.split(sep).map(s => (s || '').trim().replace(/^"|"$/g, ''));
      if (!kana || !mean || !KANA_RE.test(kana)) { skipped++; continue; }
      const w = { kana, mean, topic: topic || 'Импорт', read: read || undefined, kanji: kanji && KANJI_RE.test(kanji) ? kanji : undefined };
      if (have.has(wid(w))) { skipped++; continue; }
      have.add(wid(w)); userWords.push(w); added++;
    }
    saveWords(); renderDict();
    $('#imp-res').innerHTML = ''; $('#imp-res').append(h('span', { class: added ? 'okmsg' : 'muted' }, `Добавлено слов: ${added}` + (skipped ? `. Пропущено строк: ${skipped} (дубли или не кана)` : '')));
  };
  $('#bk-copy').onclick = () => {
    const txt = JSON.stringify({ v: 1, words: userWords, deleted: [...deleted], samples });
    $('#bk-text').value = txt;
    const done = ok => { $('#bk-res').textContent = ok ? 'Копия в буфере обмена.' : 'Скопируйте текст из поля вручную.'; if (!ok) $('#bk-text').select(); };
    try { navigator.clipboard.writeText(txt).then(() => done(true), () => done(false)); } catch (e) { done(false); }
  };
  $('#bk-restore').onclick = () => {
    try {
      const d = JSON.parse($('#bk-text').value);
      if (Array.isArray(d.words)) userWords = d.words;
      if (Array.isArray(d.deleted)) deleted = new Set(d.deleted);
      if (d.samples && typeof d.samples === 'object') { samples = d.samples; store.set('samples', samples); loadSamples(); }
      saveWords(); renderDict(); $('#bk-res').textContent = 'Копия восстановлена.';
    } catch (e) { $('#bk-res').textContent = 'В поле не резервная копия: вставьте текст, полученный кнопкой «Скопировать копию».'; }
  };
  let armClear = false, armReset = false;
  $('#samples-clear').onclick = e => {
    if (!armClear) { armClear = true; e.target.textContent = 'Точно удалить образцы?'; return; }
    samples = {}; store.set('samples', samples); loadSamples(); armClear = false; e.target.textContent = 'Удалить образцы почерка'; renderDict();
  };
  $('#dict-reset').onclick = e => {
    if (!armReset) { armReset = true; e.target.textContent = 'Точно вернуть? Свои слова удалятся'; return; }
    userWords = []; deleted = new Set(); saveWords(); armReset = false; e.target.textContent = 'Вернуть стартовый словарь'; renderDict();
  };

  // ---------- прогресс ----------
  function kanaStats() {
    const m = {};
    for (const a of answers) {
      if (a.w) continue;
      for (const ch of [a.k]) { const s = m[ch] = m[ch] || []; s.push(a.r === 'ok' ? 1 : 0); }
    }
    for (const ch in m) m[ch] = m[ch].slice(-8);   // последние 8 попыток
    return m;
  }
  const dayKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  function renderProgress() {
    if (window.KanaSync) window.KanaSync.renderAccount($('#account-box'));
    const el = $('#stats'); el.replaceChildren();
    const total = answers.length, ok = answers.filter(a => a.r === 'ok').length;
    const weekAgo = Date.now() - 7 * 864e5, week = answers.filter(a => a.ts >= weekAgo), weekOk = week.filter(a => a.r === 'ok').length;
    const days = new Set(answers.map(a => dayKey(a.ts)));
    let streak = 0; const d = new Date();
    if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
    while (days.has(dayKey(d.getTime()))) { streak++; d.setDate(d.getDate() - 1); }
    const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
    el.append(h('div', { class: 'statrow' },
      h('div', {}, h('div', { class: 'v' }, String(total)), h('div', { class: 'l' }, 'ответов всего')),
      h('div', {}, h('div', { class: 'v' }, pct(ok, total)), h('div', { class: 'l' }, 'верных за всё время')),
      h('div', {}, h('div', { class: 'v' }, pct(weekOk, week.length)), h('div', { class: 'l' }, `верных за 7 дней (${week.length})`)),
      h('div', {}, h('div', { class: 'v' }, String(streak)), h('div', { class: 'l' }, 'дней подряд'))));
    const fc = srsForecast();
    if (fc.total) el.append(h('p', { class: 'small muted' }, `В интервальном повторении: ${fc.total}. Держатся неделю и дольше: ${fc.learned}. На сегодня: ${fc.due}, на завтра: ${fc.tomorrow}.`));
    if (!total) { el.append(h('p', { class: 'muted' }, 'Пройдите первый квиз — здесь появится, какие знаки уже держатся, а какие путаются.')); return; }

    const st = kanaStats();
    const weak = [];
    const grids = h('div', { class: 'kgrids' });
    for (const [script, name] of [['h', 'Хирагана'], ['k', 'Катакана']]) {
      const grid = h('div', { class: 'kgrid' });
      let seen = 0;
      for (const r of ROWS) {
        if (r.g === 'yoon') continue;
        // сетка 5 столбцов по гласным а-и-у-э-о; в рядах я и ва — пропуски, как в таблице годзюон
        const chars = r.h.split(' ');
        const cells = r.id === 'ya' ? [chars[0], '', chars[1], '', chars[2]] : r.id === 'wa' ? [chars[0], '', '', '', chars[1], chars[2], '', '', '', ''] : chars;
        // показываем только ряды, где уже были ответы
        if (!chars.some(c => st[script === 'k' ? toKata(c) : c])) continue;
        for (const base of cells) {
          if (!base) { grid.append(h('div', { class: 'kc gap', 'aria-hidden': 'true' })); continue; }
          const ch = script === 'k' ? toKata(base) : base;
          const s = st[ch];
          let cls = 'none', title = 'ещё не было';
          if (s) {
            seen++;
            const acc = s.reduce((x, y) => x + y, 0) / s.length;
            cls = acc >= 0.85 ? 'good' : acc >= 0.6 ? 'mid' : 'weak';
            title = `${Math.round(acc * 100)}% из последних ${s.length}`;
            if (acc < 0.85 && s.length >= 2) weak.push({ ch, acc, row: r });
          }
          grid.append(h('div', { class: 'kc ' + cls, title: ch + ': ' + title }, h('span', {}, ch), h('small', {}, s ? `${s.reduce((x, y) => x + y, 0)}/${s.length}` : '')));
        }
      }
      if (seen) grids.append(h('div', {}, h('h4', { class: 'sh' }, name), grid));
    }
    if (grids.children.length) el.append(grids);
    el.append(h('div', { class: 'legend small muted' },
      h('span', { class: 'kc good' }, ''), 'держится', h('span', { class: 'kc mid' }, ''), 'неуверенно', h('span', { class: 'kc weak' }, ''), 'путается',
      h('span', { class: 'kc none' }, ''), 'не было · по последним 8 попыткам; показаны ряды, которые вы уже тренировали'));
    if (weak.length) {
      weak.sort((a, b) => a.acc - b.acc);
      const items = weak.slice(0, 15).map(x => ({ kind: 'kana', kana: x.ch, row: x.row }));
      el.append(h('div', { class: 'weaklist' }, h('div', {}, h('b', {}, 'Слабые знаки: '), items.map(i => i.kana).join(' ')),
        iconBtn('btn primary', 'undo', 'Потренировать их', () => startQuiz(items, items.length * 2))));
    }
  }

  // ---------- активность: минуты и карточки за день ----------
  let device = store.get('device', null);
  if (!device) { device = Math.random().toString(36).slice(2, 10); try { localStorage.setItem('kana-tetrad:device', JSON.stringify(device)); } catch (e) { } }
  let activity = store.get('activity', {});           // «дата|устройство» → { d, s (секунды), c (карточки) }
  const todayKey = () => dayKey(Date.now());
  function actRec() {
    const id = todayKey() + '|' + device;
    return activity[id] = activity[id] || { d: todayKey(), s: 0, c: 0 };
  }
  function countCard() { actRec().c++; store.set('activity', activity); }
  function dayTotals(day) {
    let s = 0, c = 0;
    for (const id in activity) { const a = activity[id]; if (a.d === day) { s += a.s || 0; c += a.c || 0; } }
    return { min: Math.floor(s / 60), cards: c };
  }
  const LEARNING = new Set(['quiz', 'write', 'lintro', 'lesson', 'abc', 'result']);
  let lastInteract = 0;
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { lastInteract = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (document.visibilityState !== 'visible' || !LEARNING.has(current) || Date.now() - lastInteract > 60000) return;
    const r = actRec(); r.s += 10;
    if (r.s % 60 === 0) store.set('activity', activity); else try { localStorage.setItem('kana-tetrad:activity', JSON.stringify(activity)); } catch (e) { }
    if (current === 'home') renderHome();
  }, 10000);
  function goalMet(day) {
    const t = dayTotals(day), g = S.goal || def.goal;
    return t.min >= g.min && t.cards >= g.cards;
  }
  function activeDays() {
    const days = new Set(answers.map(a => dayKey(a.ts)));
    for (const id in activity) { const a = activity[id]; if ((a.s || 0) >= 60 || (a.c || 0) > 0) days.add(a.d); }
    return days;
  }
  function streakDays() {
    const days = activeDays();
    let n = 0; const d = new Date();
    if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
    while (days.has(dayKey(d.getTime()))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function renderStreak() {
    const n = streakDays(), el = $('#streak');
    el.hidden = n < 1;
    el.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3.5 5 5.5 5 10.5A5 5 0 0 1 7 13c0-2 1-3.5 2-4.5 0 2 1 3 2 3.5C11 9 10 6 12 2z"/></svg>';
    el.append(String(n));
    el.title = `${n} ${plural(n, 'день', 'дня', 'дней')} подряд с занятиями`;
  }
  const plural = (n, a, b, c) => { const m = n % 10, mm = n % 100; return m === 1 && mm !== 11 ? a : m >= 2 && m <= 4 && (mm < 12 || mm > 14) ? b : c; };
  // Отклик: верно — один импульс, ошибка — два.
  // Android и др.: Vibration API. iPhone: Safari его не поддерживает, но с iOS 18 переключатель
  // <input type="checkbox" switch> даёт системный тактильный щелчок — нажимаем невидимый переключатель.
  const iosHaptics = (() => {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS || navigator.vibrate) return null;
    const probe = document.createElement('input');
    if (!('switch' in probe)) return null;                // iOS старше 18
    let label = null;
    return () => {
      if (!label) {
        label = document.createElement('label');
        label.setAttribute('aria-hidden', 'true');
        label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
        const inp = document.createElement('input');
        inp.type = 'checkbox'; inp.setAttribute('switch', ''); inp.tabIndex = -1;
        label.append(inp); document.body.append(label);
      }
      label.click();
    };
  })();
  const canBuzz = () => !!navigator.vibrate || !!iosHaptics;
  function buzz(ok) {
    if (!S.vibrate) return;
    try {
      if (navigator.vibrate) { navigator.vibrate(ok ? 30 : [30, 90, 30]); return; }
      if (iosHaptics) { iosHaptics(); if (!ok) setTimeout(iosHaptics, 140); }
    } catch (e) { }
  }

  // ---------- уроки: прогресс ----------
  let lessonsDone = store.get('lessons', {});         // id → { intro, write, quiz (лучший %), done }
  const saveLessons = () => store.set('lessons', lessonsDone);
  const PASS = 0.8;
  const lessonState = l => lessonsDone[l.id] || {};
  const isDone = l => !!lessonState(l).done;
  function recommended() { return LESSONS.find(l => !isDone(l)) || null; }
  const lessonNo = l => LESSONS.filter(x => x.script === l.script).indexOf(l) + 1;   // номер внутри азбуки
  const scriptName = l => l.script === 'k' ? 'катакана' : 'хирагана';
  const lessonLabel = l => (l.script === 'k' ? 'Катакана, урок ' : 'Урок ') + lessonNo(l);
  const lessonPreview = l => { const k = lessonKana(l); return k.length ? k.slice(0, 12).join(' ') + (k.length > 12 ? ' …' : '') : (l.extra || []).concat(l.id === 'h18' ? ['は', 'へ', 'を'] : []).join(' '); };
  let FLOW = null;                                      // { lesson, step } — квиз или прописи запущены из урока
  let curLesson = null;

  function lessonQuizItems(l) {
    if (!lessonKana(l).length) return l.words.map(([kana, mean, kanji, read]) => ({ kind: 'word', kana, w: { kana, mean, kanji, read, topic: 'Урок' } }));
    const own = lessonKana(l).map(k => ({ kind: 'kana', kana: k }));
    const prev = LESSONS.slice(0, LESSONS.indexOf(l)).filter(x => x.script === l.script).flatMap(x => lessonKana(x)).filter(k => k.length === 1);
    const review = shuffle(prev.slice()).slice(0, Math.min(5, prev.length)).map(k => ({ kind: 'kana', kana: k }));
    return { own, review };
  }
  function startLessonQuiz(l) {
    FLOW = { lesson: l, step: 'quiz' };
    const it = lessonQuizItems(l);
    if (Array.isArray(it)) return startQuiz(it, it.length, { mode: 'type' });
    const own = it.own.length > 8 ? it.own : it.own.concat(it.own);   // небольшие уроки — каждый знак дважды
    startQuiz(own.concat(it.review), own.length + it.review.length, { mode: 'type' });
  }
  function startLessonWrite(l) {
    FLOW = { lesson: l, step: 'write' };
    startWriting(lessonWritable(l), 5, { ghostFirst: 3 });
  }
  function markStep(l, step, val) {
    const st = lessonsDone[l.id] = Object.assign({}, lessonsDone[l.id]);
    if (step === 'quiz') { st.quiz = Math.max(st.quiz || 0, val); if (val >= PASS * 100 && !st.done) st.done = Date.now(); }
    else st[step] = st[step] || Date.now();
    saveLessons();
  }
  function backToLesson() { const l = FLOW && FLOW.lesson; FLOW = null; Q = null; WR = null; if (l) openLesson(l); else show('lessons'); }

  // ---------- интервальное повторение ----------
  // Состояние считается из истории ответов (она синхронизируется), отдельно ничего не хранится.
  // Верный ответ в день повторения или позже — следующая «коробка»: 1, 2, 4, 7, 14, 30, 60, 120 дней.
  // Ошибка — знак возвращается в повторение сегодня, выученный (от 7 дней) откатывается на 1 день.
  const DAY = 864e5, IVL = [0, 1, 2, 4, 7, 14, 30, 60, 120], REVIEW_MAX = 20;
  const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  function srsState() {
    const m = new Map();
    const get = (k, w) => { const key = (w ? 'w:' : '') + k; let st = m.get(key); if (!st) m.set(key, st = { key, k, w: !!w, box: 0, due: 0, n: 0 }); return st; };
    for (const a of answers) {
      const st = get(a.k, a.w); st.n++;
      if (a.r === 'ok') { if (a.ts >= st.due) { st.box = Math.min(st.box + 1, IVL.length - 1); st.due = startOfDay(a.ts) + IVL[st.box] * DAY; } }
      else { st.box = st.box >= 4 ? 1 : 0; st.due = a.ts; }
    }
    // знаки начатых уроков и слова пройденных попадают в повторение, даже если ответов ещё не было
    for (const l of LESSONS) {
      const ls = lessonsDone[l.id]; if (!ls) continue;
      if (ls.intro || ls.done) for (const k of lessonKana(l)) get(k, false);
      if (ls.done) for (const [kana] of l.words) get(kana, true);
    }
    return m;
  }
  function srsDue(now = Date.now()) {
    return [...srsState().values()].filter(s => s.due <= now).sort((a, b) => a.box - b.box || a.due - b.due);
  }
  function srsForecast() {
    const st = [...srsState().values()], now = Date.now(), tomorrow = startOfDay(now) + DAY;
    return { total: st.length, due: st.filter(s => s.due <= now).length, tomorrow: st.filter(s => s.due > now && s.due < tomorrow + DAY).length, learned: st.filter(s => s.box >= 4).length };
  }
  function wordIndex() {
    const m = new Map();
    for (const l of LESSONS) for (const [kana, mean, kanji, read] of l.words) m.set(kana, { kana, mean, kanji, read, topic: 'Урок' });
    for (const w of allWords()) m.set(w.kana, w);
    // надпись из «Чтения в поездке» важнее: у неё есть вид таблички (駅, 出口), повторение показывает именно её
    for (const t of READING) for (const it of readingItems(t)) m.set(it.kana, it.w);
    return m;
  }
  const hasAudio = () => !!window.KANA_PWA;
  function reviewItems() {
    const due = srsDue(), words = wordIndex(), sents = sentIndex(), out = [];
    for (const s of due) {
      if (out.length >= REVIEW_MAX) break;
      let it;
      if (s.w && sents.has(s.k)) { it = Object.assign({}, sents.get(s.k), { mode: 'build' }); out.push(it); continue; }
      if (s.w) { const w = words.get(s.k); if (!w) continue; it = { kind: 'word', kana: s.k, w }; }
      else it = { kind: 'kana', kana: s.k };
      const canDraw = !s.w && [...s.k].every(c => KVG[bigOf(c)]);
      const canListen = s.w ? canSay(s.k) : hasAudio();
      // чем лучше знак выучен, тем сложнее задание: прочитать → узнать на слух → написать по памяти
      it.mode = s.w && it.w.kanji && it.w.sign ? 'mean' : s.box >= 4 && canDraw ? 'draw' : s.box >= 2 && canListen && Math.random() < 0.5 ? 'listen' : 'type';
      out.push(it);
    }
    return out;
  }
  function startReview() {
    const items = reviewItems();
    if (!items.length) return show('home');
    FLOW = null;
    startQuiz(items, items.length, { review: true, back: 'home', mode: 'type' });
  }

  // ---------- похожие знаки ----------
  function confusions(script) {
    const c = {};
    for (const a of answers.slice(-3000)) {
      if (a.w || !a.x || a.r === 'ok' || a.x.length !== a.k.length) continue;
      if (script && isKata(a.k[0]) !== (script === 'k')) continue;
      const key = [a.k, a.x].sort().join('|'); c[key] = (c[key] || 0) + 1;
    }
    return Object.entries(c).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => ({ pair: k.split('|'), n }));
  }
  function simGroups(sc) { return SIMILAR.filter(g => g.s === sc); }
  function simItems(groups) {
    const out = [];
    for (const g of groups) for (const k of g.k) out.push({ kind: 'kana', kana: k, mode: 'sim', group: g.k });
    return out;
  }
  function startSim(groups, count) {
    const items = simItems(groups); if (!items.length) return;
    FLOW = null;
    startQuiz(items, Math.max(items.length, count), { mode: 'sim', back: 'similar', again: () => startSim(groups, count) });
  }
  function renderSimilar() {
    const el = $('#screen-similar'); el.replaceChildren();
    const sc = S.simScript === 'k' ? 'k' : 'h';
    const groups = simGroups(sc);
    const sel = S.simSel && S.simSel[sc] ? S.simSel[sc].filter(id => groups.some(g => g.id === id)) : groups.map(g => g.id);
    const setSel = v => { S.simSel = Object.assign({ h: null, k: null }, S.simSel, { [sc]: v }); save(); renderSimilar(); };
    el.append(h('h1', { class: 'h1' }, 'Похожие знаки'),
      h('p', { class: 'small muted' }, 'Карточки с выбором из похожих знаков: то по знаку найти чтение, то по чтению — знак. После ответа — подсказка, как их различать.'),
      segm('Азбука', [['h', 'Хирагана'], ['k', 'Катакана']], sc, v => { S.simScript = v; save(); renderSimilar(); }));
    const conf = confusions(sc);
    if (conf.length) {
      el.append(h('div', { class: 'sheet simconf' }, h('div', { class: 'lbl' }, 'Чаще всего путаете'),
        h('div', { class: 'chips' }, ...conf.map(c => h('span', { class: 'chip', style: 'cursor:default' }, h('span', { class: 'k' }, c.pair.join(' · ')), h('span', { class: 'n' }, `${c.n} ${plural(c.n, 'раз', 'раза', 'раз')}`)))),
        iconBtn('btn primary', 'undo', 'Потренировать эти пары', () => startSim(conf.map(c => ({ k: c.pair })), conf.length * 6))));
    }
    const allOn = sel.length === groups.length;
    el.append(h('div', { class: 'sheet' },
      h('div', { class: 'ghead' }, h('span', { class: 'label' }, 'Группы'),
        h('button', { class: 'link', type: 'button', onclick: () => setSel(allOn ? [] : groups.map(g => g.id)) }, allOn ? 'снять все' : 'выбрать все')),
      h('div', { class: 'simgroups' }, ...groups.map(g => h('button', { type: 'button', class: 'simg', 'aria-pressed': String(sel.includes(g.id)),
        onclick: () => setSel(sel.includes(g.id) ? sel.filter(x => x !== g.id) : sel.concat(g.id)) },
        h('span', { class: 'k' }, g.k.join(' ')), h('span', { class: 'd' }, g.t))))));
    const chosen = groups.filter(g => sel.includes(g.id)), n = simItems(chosen).length;
    const count = Math.max(n, S.simCount || 20);
    el.append(h('div', { class: 'sheet simstart' },
      h('div', { class: 'set' }, h('div', { class: 'lbl' }, 'Карточек'), segm('Карточек', [10, 20, 30, 50].map(v => [v, String(v)]), S.simCount || 20, v => { S.simCount = v; save(); renderSimilar(); }),
        h('div', { class: 'd' }, n ? `Знаков в выбранных группах: ${n}. Каждый появится хотя бы раз${count > (S.simCount || 20) ? `, поэтому карточек будет ${count}` : ''}.` : 'Отметьте хотя бы одну группу.')),
      h('div', { class: 'start' }, (() => { const b = iconBtn('btn primary', 'next', 'Начать', () => startSim(chosen, count)); b.id = 'btn-sim-start'; b.disabled = !n; return b; })())));
  }

  // ---------- экран «Уроки» ----------
  function renderLessons() {
    const el = $('#screen-lessons'); el.replaceChildren();
    const rec = recommended();
    el.append(h('h1', { class: 'h1' }, 'Уроки'),
      h('p', { class: 'small muted' }, 'Сначала хирагана, затем катакана. Все уроки открыты; рекомендуем идти по порядку.'));
    for (const [sc, name] of [['h', 'Хирагана'], ['k', 'Катакана']]) {
    const ls = LESSONS.filter(l => l.script === sc);
    el.append(h('h2', { class: 'h2' }, `${name} · пройдено ${ls.filter(isDone).length} из ${ls.length}`));
    const list = h('div', { class: 'lessons' });
    for (const l of ls) {
      const st = lessonState(l), done = !!st.done, isRec = rec === l;
      const kana = lessonPreview(l);
      list.append(h('button', { type: 'button', class: 'lrow' + (done ? ' done' : '') + (isRec ? ' rec' : ''), onclick: () => openLesson(l) },
        h('span', { class: 'n' }, done ? '✓' : String(lessonNo(l))),
        h('span', {}, h('div', { class: 't' }, l.title), h('div', { class: 'k' }, kana)),
        done ? h('span', { class: 'badge ok' }, `${st.quiz}%`) : isRec ? h('span', { class: 'badge rec' }, 'Следующий') : st.intro || st.write || st.quiz ? h('span', { class: 'badge soon' }, 'начат') : null));
    }
    el.append(list);
    }
    el.append(h('h2', { class: 'h2' }, 'Чтение в поездке'),
      h('p', { class: 'small muted' }, 'Вывески, указатели и меню по темам — когда знаки уже знакомы.'),
      readingList());
  }

  // ---------- экран урока ----------
  function openLesson(l) { curLesson = l; show('lesson'); }
  function renderLesson() {
    const l = curLesson; if (!l) return show('lessons');
    const st = lessonState(l);
    const el = $('#screen-lesson'); el.replaceChildren();
    const kanas = lessonKana(l);
    el.append(h('div', { class: 'backbar' }, h('button', { class: 'link back', type: 'button', onclick: () => show('lessons') }, '← Уроки')));
    const head = h('div', { class: 'lhead' },
      h('div', { class: 'small muted' }, `Урок ${lessonNo(l)} · ${scriptName(l)}`),
      h('div', { class: 'hello' }, h('h1', { class: 'h1' }, l.title), st.done ? h('span', { class: 'badge ok' }, `Пройден · ${st.quiz}%`) : recommended() === l ? h('span', { class: 'badge rec' }, 'Рекомендуемый') : null));
    if (kanas.length) {
      const row = h('div', { class: 'lkana' });
      kanas.forEach(k => { const b = h('button', { type: 'button', class: k.length > 1 ? 'w2' : '', title: 'Прослушать', 'aria-label': 'Прослушать ' + k, onclick: () => playKana(k, b) }, k); row.append(b); });
      head.append(row);
    }
    head.append(h('p', { class: 'lintro-text' }, l.intro));
    el.append(h('div', { class: 'sheet' }, head));

    const writable = lessonWritable(l);
    const steps = [
      { key: 'intro', t: 'Знакомство', d: kanas.length ? `${kanas.length} ${plural(kanas.length, kanas.some(k => k.length > 1) ? 'сочетание' : 'знак', kanas.some(k => k.length > 1) ? 'сочетания' : 'знака', kanas.some(k => k.length > 1) ? 'сочетаний' : 'знаков')}: произношение, ${writable.length ? 'порядок штрихов, ' : ''}как запомнить` : (l.points || []).map(p => p[0]).join(', '), go: () => startIntro(l) },
      writable.length ? { key: 'write', t: 'Прописи', d: 'Каждый знак 5 раз: 3 по подложке, 2 по памяти', go: () => startLessonWrite(l) } : null,
      { key: 'quiz', t: 'Проверка', d: `Квиз на чтение${kanas.length ? (lessonNo(l) > 1 ? ' с повторением прошлых уроков' : '') : ' слов'}. Нужно ${PASS * 100}% верных`, go: () => startLessonQuiz(l) },
    ].filter(Boolean);
    const sl = h('div', { class: 'steps' });
    steps.forEach((s, i) => {
      const done = s.key === 'quiz' ? (st.quiz || 0) >= PASS * 100 : !!st[s.key];
      sl.append(h('div', { class: 'stepc' + (done ? ' done' : '') },
        h('span', { class: 'n' }, done ? '✓' : String(i + 1)),
        h('div', {}, h('div', { class: 't' }, s.t + (s.key === 'quiz' && st.quiz ? ` · лучший результат ${st.quiz}%` : '')), h('div', { class: 'd' }, s.d)),
        h('button', { class: 'btn ' + (done ? 'ghost' : 'primary'), type: 'button', onclick: s.go }, done ? 'Ещё раз' : 'Начать')));
    });
    el.append(h('h2', { class: 'h2' }, 'Шаги урока'), sl);

    el.append(h('h2', { class: 'h2' }, 'Слова урока'));
    const words = h('div', { class: 'lwords' });
    for (const [kana, mean, kanji, read] of l.words) {
      const rd = h('span', { class: 'rd hid', title: 'Нажмите, чтобы показать чтение', onclick: () => rd.classList.remove('hid') }, displayReading(kana, S.sys, read));
      words.append(h('div', { class: 'lword' },
        h('div', {}, h('div', { class: 'k' }, kana), rd),
        sayButton({ kana, kanji, word: true }) || h('span'),
        h('div', { class: 'm' }, mean)));
      prefetchWord(kana, kanji);
    }
    el.append(h('div', { class: 'sheet' }, h('p', { class: 'small muted', style: 'margin:0 0 6px' }, 'Попробуйте прочитать сами, потом нажмите на размытое чтение или прослушайте.'), words));

    if (l.similar && l.similar.length) {
      el.append(h('h2', { class: 'h2' }, 'Не перепутать'),
        h('div', { class: 'sheet lsim' }, ...l.similar.map(([a, b, t]) => h('div', {}, h('span', { class: 'k' }, a + ' · ' + b), t))));
    }
    el.append(h('h2', { class: 'h2' }, 'Распечатать'),
      h('div', { class: 'pdfrow' },
        iconBtn('btn ghost', 'next', 'Конспект в PDF', () => makePdf('notes', l), 'Скачать конспект урока'),
        writable.length ? iconBtn('btn ghost', 'next', 'Прописи в PDF', () => makePdf('sheet', l), 'Скачать прописи урока') : null,
        h('span', { class: 'small muted', id: 'pdf-msg' })));
  }

  // ---------- знакомство со знаками ----------
  let IN = null;
  function startIntro(l) { IN = { l, i: 0 }; FLOW = { lesson: l, step: 'intro' }; show('lintro'); renderIntro(); }
  function introCards(l) {
    const points = (l.points || []).map(([t, p]) => ({ point: true, t, p }));
    return points.concat(lessonKana(l).map(k => ({ k, note: l.notes[k] || l.notes[toHira(k)] || null }))).concat(l.similar.length ? [{ similar: true }] : []);
  }
  function renderIntro() {
    const l = IN.l, cards = introCards(l), c = cards[IN.i];
    $('#i-ctr').textContent = `${IN.i + 1} / ${cards.length}`;
    $('#i-prog').style.width = ((IN.i + 1) / cards.length * 100) + '%';
    const el = $('#lintro'); el.replaceChildren();
    const box = h('div', { class: 'icard' });
    if (c.point) {
      box.append(h('div', { class: 'vtitle' }, c.t), h('div', { class: 'ibox' }, h('p', {}, c.p)));
    } else if (c.similar) {
      box.append(h('div', { class: 'vtitle' }, 'Не перепутать'),
        ...l.similar.map(([a, b, t]) => h('div', { class: 'ibox' }, h('div', { style: 'font-family:var(--kana);font-size:40px;line-height:1.2' }, a + '　' + b), h('p', {}, t))));
    } else {
      const k = c.k;
      const pair = h('div', { class: 'pair' });
      if (KVG[k]) pair.append(h('div', { class: 'so' }, strokeOrder(k)));
      pair.append(h('div', { class: 'glyph-big' }, k));
      const play = h('button', { class: 'iconbtn say', type: 'button', onclick: () => playKana(k, play) }, svgIcon('sound'), 'Произношение');
      box.append(pair,
        h('div', { class: 'rd' }, displayReading(k, S.sys), h('span', {}, ' · ' + displayReading(k, otherSys(S.sys)))),
        play,
        KVG[k] ? h('div', { class: 'small muted' }, 'Нажмите на клетку слева, чтобы повторить порядок штрихов') : null);
      if (c.note) {
        box.append(h('div', { class: 'ibox' }, h('span', { class: 'lab' }, 'Как запомнить'), h('p', {}, c.note[0])));
        box.append(h('div', { class: 'ibox' }, h('span', { class: 'lab' }, 'Произношение'), h('p', {}, c.note[1])));
      }
      setTimeout(() => playKana(k), 300);
    }
    const last = IN.i >= cards.length - 1;
    box.append(h('div', { class: 'actions' },
      IN.i > 0 ? iconBtn('btn ghost', 'undo', 'Назад', () => { IN.i--; renderIntro(); }) : h('span'),
      iconBtn('btn primary', 'next', last ? 'Готово' : 'Дальше', () => {
        if (!last) { IN.i++; renderIntro(); return; }
        markStep(l, 'intro'); IN = null; FLOW = null; openLesson(l);
      })));
    el.append(box);
  }
  $('#btn-iquit').onclick = () => { IN = null; FLOW = null; openLesson(curLesson); };

  // ---------- Сегодня ----------
  function greet() { const hr = new Date().getHours(); return hr < 5 ? 'Доброй ночи' : hr < 12 ? 'Доброе утро' : hr < 18 ? 'Добрый день' : 'Добрый вечер'; }
  function weakKana() {
    const st = kanaStats(), out = [];
    for (const ch in st) { const s = st[ch]; if (s.length >= 2) { const acc = s.reduce((x, y) => x + y, 0) / s.length; if (acc < 0.85) out.push({ ch, acc }); } }
    return out.sort((a, b) => a.acc - b.acc).slice(0, 15);
  }
  const CTA_ICONS = {
    lesson: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="13" height="14" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v12"/><path d="M7 14l2 2 4-4"/></svg>',
    listen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
    reading: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="11" rx="2"/><path d="M12 15v6M8 21h8M7 9h10"/></svg>',
    builder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="6" rx="1.5"/><rect x="14" y="4" width="7" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/></svg>',
    similar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1"/><path d="M4 15c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1"/></svg>',
    weak: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4"/></svg>',
    quiz: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 9h6M9 13h6M9 17h3"/></svg>',
    abc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 3.5l4 4L9 19l-5 1 1-5z"/></svg>',
  };
  function cta(icon, title, desc, kana, onclick, cls) {
    const ico = h('span', { class: 'ico' }); ico.innerHTML = CTA_ICONS[icon];
    return h('button', { type: 'button', class: 'cta ' + (cls || ''), onclick }, ico,
      h('span', {}, h('div', { class: 't' }, title), kana ? h('div', { class: 'k' }, kana) : null, desc ? h('div', { class: 'd' }, desc) : null),
      h('span', { class: 'go', 'aria-hidden': 'true' }, '›'));
  }
  function renderHome() {
    const el = $('#screen-home'); el.replaceChildren();
    const g = S.goal || def.goal, t = dayTotals(todayKey());
    const pm = Math.min(1, t.min / g.min), pc = Math.min(1, t.cards / g.cards);
    const met = pm >= 1 && pc >= 1;
    const box = h('div', { class: 'home' });
    box.append(h('div', { class: 'hello' }, h('h1', { class: 'h1' }, greet()),
      h('button', { class: 'link', type: 'button', onclick: () => show('me') }, 'Изменить цель')));
    box.append(h('div', { class: 'sheet goal' },
      h('div', { class: 'goal-row' }, h('div', { class: 'top' }, h('span', {}, 'Занятия'), h('b', {}, `${t.min} из ${g.min} мин`)), h('div', { class: 'bar' + (pm >= 1 ? ' done' : '') }, h('i', { style: `width:${pm * 100}%` }))),
      h('div', { class: 'goal-row' }, h('div', { class: 'top' }, h('span', {}, 'Карточки и прописи'), h('b', {}, `${t.cards} из ${g.cards}`)), h('div', { class: 'bar' + (pc >= 1 ? ' done' : '') }, h('i', { style: `width:${pc * 100}%` }))),
      met ? h('div', { class: 'goal-done' }, '○ Цель на сегодня выполнена') : null));
    const fc = srsForecast();
    if (fc.due) box.append(cta('review', `Повторение · ${fc.due} ${plural(fc.due, 'знак', 'знака', 'знаков')}`, `Пора повторить, пока не забылось${fc.due > REVIEW_MAX ? ` — по ${REVIEW_MAX} за подход` : ''}`, srsDue().slice(0, 10).map(s => s.k).join(' '), startReview, 'main review'));
    const rec = recommended();
    if (rec) {
      const st = lessonState(rec), started = st.intro || st.write || st.quiz;
      const kanas = lessonKana(rec);
      box.append(cta('lesson', `${started ? 'Продолжить' : 'Начать'}: ${lessonLabel(rec).replace(/^Урок/, 'урок')}`, rec.title, kanas.length ? kanas.slice(0, 8).join(' ') : null, () => openLesson(rec), 'main'));
    } else {
      box.append(cta('lesson', 'Все уроки пройдены', 'Хирагана и катакана выучены — дальше чтение вывесок и меню', null, () => show('reading'), 'main'));
    }
    if (!fc.due && fc.total) box.append(h('div', { class: 'sheet srsdone small' }, h('b', {}, '○ Повторение на сегодня выполнено'), h('span', { class: 'muted' }, fc.tomorrow ? ` · завтра ${fc.tomorrow} ${plural(fc.tomorrow, 'знак', 'знака', 'знаков')}` : '')));
    const weak = weakKana();
    if (weak.length) box.append(cta('weak', 'Слабые знаки', `${weak.length} ${plural(weak.length, 'знак', 'знака', 'знаков')} — короткий квиз на чтение`, weak.map(w => w.ch).slice(0, 10).join(' '),
      () => { const items = weak.map(w => ({ kind: 'kana', kana: w.ch })); startQuiz(items, items.length * 2, { mode: 'type' }); }, 'alt'));
    box.append(h('div', { class: 'quick' },
      cta('quiz', 'Квиз', 'Свободная тренировка', null, () => show('setup'), 'alt'),
      cta('abc', 'Азбука и прописи', 'Озвучка и письмо', null, () => show('abc'), 'alt'),
      cta('listen', 'Квиз на слух', 'Узнать знак по звучанию', null, () => openListenSetup(), 'alt'),
      cta('similar', 'Похожие знаки', 'シ・ツ, ぬ・め и другие', null, () => show('similar'), 'alt')));
    // неделя
    const days = activeDays(), wk = h('div', { class: 'week', 'aria-label': 'Последние 7 дней' });
    const names = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); const k = dayKey(d.getTime());
      wk.append(h('div', { class: (goalMet(k) ? 'goal' : days.has(k) ? 'on' : '') + (i === 0 ? ' today' : ''), title: goalMet(k) ? 'цель выполнена' : days.has(k) ? 'были занятия' : 'без занятий' }, names[d.getDay()], h('i')));
    }
    box.append(h('div', { class: 'sheet' }, h('div', { class: 'small muted', style: 'margin-bottom:6px' }, `Неделя · ${streakDays()} ${plural(streakDays(), 'день', 'дня', 'дней')} подряд`), wk,
      h('div', { class: 'legend small muted', style: 'margin-top:8px' }, h('span', { class: 'kc good' }, ''), 'были занятия', h('span', { class: 'kc', style: 'background:var(--ok);border-color:var(--ok)' }, ''), 'цель выполнена')));
    el.append(box);
  }

  // ---------- Практика ----------
  function renderPractice() {
    const el = $('#screen-practice'); el.replaceChildren();
    const weak = weakKana();
    el.append(h('h1', { class: 'h1' }, 'Практика'), h('p', { class: 'small muted' }, 'Свободные тренировки — в любом порядке и сколько угодно.'),
      h('div', { class: 'practice' },
        cta('quiz', 'Квиз', 'Хирагана, катакана или слова: нарисовать знак по звучанию или прочитать', null, () => show('setup')),
        srsForecast().due ? cta('review', 'Повторение', `${srsForecast().due} на сегодня — интервальное повторение пройденного`, null, startReview, 'main') : null,
        cta('abc', 'Азбука и прописи', 'Таблицы с озвучкой, прописи выбранных знаков с подложкой', null, () => show('abc')),
        cta('listen', 'Квиз на слух', 'Звучит знак или слово — выберите, как он пишется', null, () => openListenSetup()),
        cta('similar', 'Похожие знаки', 'シ・ツ・ソ・ン, ぬ・め, ね・れ・わ: выбор из похожих и подсказки, как различать', null, () => show('similar')),
        cta('builder', 'Конструктор предложений', 'Русская фраза → собрать японскую из блоков: «где туалет?», «счёт, пожалуйста»', null, () => show('builder')),
        cta('reading', 'Чтение в поездке', 'Вывески, указатели и меню: еда, транспорт, магазины, отель, улица', null, () => { RT = null; show('reading'); }),
        weak.length ? cta('weak', 'Слабые знаки', 'Квиз по знакам, на которых вы чаще ошибаетесь', weak.map(w => w.ch).slice(0, 10).join(' '), () => { const items = weak.map(w => ({ kind: 'kana', kana: w.ch })); startQuiz(items, items.length * 2, { mode: 'type' }); }) : null));
  }

  function openListenSetup() { S.mode = 'listen'; save(); show('setup'); }

  // ---------- Я: настройки ----------
  function toggle(id, on, onchange, disabled) {
    const inp = h('input', { type: 'checkbox', id, role: 'switch', disabled: !!disabled });
    inp.checked = !!on; inp.addEventListener('change', () => onchange(inp.checked));
    return h('span', { class: 'tgl' }, inp, h('span'));
  }
  function segm(label, options, cur, onpick) {
    return h('div', { class: 'segm', role: 'group', 'aria-label': label },
      ...options.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(cur === v), onclick: () => onpick(v) }, t)));
  }
  const GOAL_MIN = [10, 20, 30, 45, 60], GOAL_CARDS = [20, 50, 100, 150];

  // ---------- напоминания (Web Push) ----------
  // Подписка — на это устройство, время и часовой пояс — в аккаунте. Сервер присылает напоминание
  // в выбранное время, только если цель дня ещё не выполнена (по синхронизированной активности).
  const isIOSDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const PS = { on: false, time: store.get('remind-time', '19:00'), busy: false, msg: '', checked: false };
  const api = (path, body) => window.KanaSync && window.KanaSync.api ? window.KanaSync.api(path, body) : Promise.resolve({ status: 0, data: {} });
  async function pushSub() {
    try { const reg = await navigator.serviceWorker.getRegistration(); return reg ? await reg.pushManager.getSubscription() : null; } catch (e) { return null; }
  }
  async function pushRefresh() {
    if (!pushSupported() || !window.KanaSync || !window.KanaSync.account) { PS.on = false; PS.checked = true; return; }
    const sub = await pushSub();
    PS.on = !!sub && Notification.permission === 'granted';
    if (PS.on) { const r = await api('/push/prefs'); if (r.status === 200 && r.data.time) { PS.time = r.data.time; store.set('remind-time', PS.time); } }
    PS.checked = true;
  }
  const b64ToU8 = s => { const b = atob((s + '==='.slice((s.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return null; } };
  async function pushEnable() {
    PS.busy = true; PS.msg = ''; renderSettings();
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Уведомления запрещены для этого сайта — разрешите их в настройках браузера' : 'Разрешение на уведомления не получено');
      const key = await api('/push/key');
      if (key.status !== 200 || !key.data.key) throw new Error('Сервер напоминаний недоступен');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key.data.key) });
      const j = sub.toJSON();
      const r = await api('/push/subscribe', { endpoint: j.endpoint, keys: j.keys, time: PS.time, tz: tz() });
      if (r.status !== 200) throw new Error(r.data.error || 'Не получилось включить напоминания');
      PS.on = true; PS.msg = `Включено: напомним в ${PS.time}, если цель дня ещё не выполнена.`;
    } catch (e) { PS.on = false; PS.msg = e.message || 'Не получилось включить напоминания'; }
    PS.busy = false; renderSettings();
  }
  async function pushDisable(silent) {
    const sub = await pushSub();
    if (sub) { await api('/push/unsubscribe', { endpoint: sub.endpoint }); try { await sub.unsubscribe(); } catch (e) { } }
    PS.on = false; if (!silent) { PS.msg = 'Напоминания на этом устройстве выключены.'; renderSettings(); }
  }
  async function pushTime(v) {
    PS.time = v; store.set('remind-time', v);
    if (PS.on) { const r = await api('/push/prefs', { time: v, tz: tz() }); PS.msg = r.status === 200 ? `Напомним в ${v}.` : (r.data.error || 'Не получилось сохранить время'); renderSettings(); }
  }
  async function pushTest() {
    PS.msg = 'Отправляю…'; renderSettings();
    const r = await api('/push/test', {});
    PS.msg = r.status === 200 ? (r.data.sent ? 'Отправлено — уведомление должно появиться через несколько секунд.' : 'Не дошло: подписка устарела. Выключите и снова включите напоминания.') : (r.data.error || 'Не получилось отправить');
    renderSettings();
  }
  window.KanaPush = { forget: () => pushDisable(true), refresh: () => pushRefresh().then(() => { if (current === 'me') renderSettings(); }) };
  function remindRow() {
    const logged = !!(window.KanaSync && window.KanaSync.account);
    const why = !logged ? 'Войдите в аккаунт: напоминание приходит, только если цель дня ещё не выполнена, а для этого серверу нужен ваш прогресс.'
      : !pushSupported() ? (isIOSDevice && !standalone() ? 'На iPhone и iPad напоминания работают в установленном приложении (iOS 16.4 и новее): Safari → «Поделиться» → «На экран Домой».' : 'Этот браузер не поддерживает уведомления.')
        : isIOSDevice && !standalone() ? 'На iPhone и iPad напоминания работают в установленном приложении: Safari → «Поделиться» → «На экран Домой».'
          : 'Раз в день в выбранное время, если цель дня ещё не выполнена.';
    const can = logged && pushSupported() && !(isIOSDevice && !standalone());
    if (!logged) { PS.checked = false; PS.on = false; }
    if (can && !PS.checked) pushRefresh().then(() => { if (current === 'me') renderSettings(); });
    const row = h('div', { class: 'set switch' }, h('div', {}, h('div', { class: 'lbl' }, 'Напоминания о занятиях'), h('div', { class: 'd' }, why)),
      toggle('set-notify', PS.on, v => v ? pushEnable() : pushDisable(), !can || PS.busy));
    const out = [row];
    if (can && PS.on) {
      const t = h('input', { type: 'time', id: 'remind-time', value: PS.time, step: 900, 'aria-label': 'Время напоминания' });
      t.addEventListener('change', () => { if (/^\d\d:\d\d$/.test(t.value)) pushTime(t.value); });
      out.push(h('div', { class: 'set remind' }, h('label', { class: 'lbl', for: 'remind-time' }, 'Время напоминания'), h('div', { class: 'remind-row' }, t,
        h('button', { class: 'btn ghost', type: 'button', id: 'btn-push-test', onclick: pushTest }, 'Проверить'))));
    }
    if (PS.msg) out.push(h('div', { class: 'small muted', id: 'push-msg', role: 'status' }, PS.msg));
    return out;
  }
  function renderSettings() {
    const el = $('#settings'); el.replaceChildren();
    const g = S.goal || def.goal;
    const setGoal = (k, v) => { S.goal = Object.assign({}, g, { [k]: v }); save(); renderSettings(); renderStreak(); };
    el.append(
      h('div', { class: 'set' }, h('div', { class: 'lbl' }, 'Цель: минут в день'), segm('Минут в день', GOAL_MIN.map(v => [v, String(v)]), g.min, v => setGoal('min', v)),
        h('div', { class: 'd' }, 'Считается время в уроках, квизах и прописях.')),
      h('div', { class: 'set' }, h('div', { class: 'lbl' }, 'Цель: карточек и прописей в день'), segm('Карточек в день', GOAL_CARDS.map(v => [v, String(v)]), g.cards, v => setGoal('cards', v)),
        h('div', { class: 'd' }, 'Каждый ответ в квизе и каждая попытка в прописях. Цель выполнена, когда набраны и минуты, и карточки.' + (window.KanaSync && window.KanaSync.account ? ' Цель сохраняется в аккаунте.' : ''))),
      h('div', { class: 'set' }, h('div', { class: 'lbl' }, 'Транскрипция'), segm('Транскрипция', [['ru', 'Кириллица'], ['lat', 'Латиница']], S.sys, v => { S.sys = v; save(); renderSettings(); })),
      h('div', { class: 'set' }, h('div', { class: 'lbl' }, 'Голос озвучки'), segm('Голос', [['m', 'Мужской'], ['f', 'Женский']], S.voice === 'f' ? 'f' : 'm', v => { S.voice = v; save(); renderSettings(); playKana('あ'); }),
        h('div', { class: 'd' }, 'VOICEVOX:青山龍星 (мужской), VOICEVOX:波音リツ (женский)')),
      h('div', { class: 'set' }, h('div', { class: 'lbl' }, 'Проверка рисунка'), segm('Строгость', [[0, 'Строго'], [1, 'Обычно'], [2, 'Мягко']], S.len, v => { S.len = v; save(); renderSettings(); })),
      h('div', { class: 'set switch' }, h('div', {}, h('div', { class: 'lbl' }, 'Вибрация'), h('div', { class: 'd' }, 'Тактильный отклик')),
        toggle('set-vibrate', S.vibrate && canBuzz(), v => { S.vibrate = v; save(); buzz(true); }, !canBuzz())),
      ...remindRow());
  }
  function renderMe() {
    if (window.KanaSync) window.KanaSync.renderAccount($('#account-box'));
    renderSettings();
    renderProgress();
  }

  // ---------- первый запуск ----------
  function renderOnboard() {
    const el = $('#screen-onboard'); el.replaceChildren();
    const g = Object.assign({}, def.goal, S.goal);
    const draw = () => {
      el.replaceChildren(h('div', { class: 'onboard' },
        h('div', { class: 'hero', 'aria-hidden': 'true' }, 'かな'),
        h('h1', { class: 'h1' }, 'Добро пожаловать в Кана-тетрадь'),
        h('p', {}, 'Здесь можно выучить хирагану и катакану по урокам, тренироваться в квизах и прописях и учить первые слова. Сначала — небольшая настройка, её всегда можно поменять в разделе «Я».'),
        h('div', { class: 'sheet' },
          h('div', { class: 'set' }, h('div', { class: 'lbl' }, 'Сколько минут в день вы готовы заниматься?'), segm('Минут в день', GOAL_MIN.map(v => [v, v + ' мин']), g.min, v => { g.min = v; draw(); })),
          h('div', { class: 'set' }, h('div', { class: 'lbl' }, 'Сколько карточек и прописей в день?'), segm('Карточек в день', GOAL_CARDS.map(v => [v, String(v)]), g.cards, v => { g.cards = v; draw(); }),
            h('div', { class: 'd' }, 'Для начала хватит 50: это примерно один урок и короткий квиз.')),
          h('div', { class: 'set' }, h('div', { class: 'lbl' }, 'Как показывать чтение?'), segm('Транскрипция', [['ru', 'Кириллицей: си, ти, цу'], ['lat', 'Латиницей: shi, chi, tsu']], S.sys, v => { S.sys = v; draw(); }))),
        h('div', { class: 'start' }, iconBtn('btn primary', 'next', 'Начать', () => { S.goal = g; S.onboarded = true; save(); show('home'); })),
        h('p', { class: 'small' }, 'Уже занимались на другом устройстве? ', h('button', { class: 'link', type: 'button', onclick: () => { S.goal = g; S.onboarded = true; save(); show('me'); } }, 'Войдите в аккаунт'), ' — цель и прогресс подтянутся.')));
    };
    draw();
  }

  // ---------- PDF урока ----------
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('не загрузился ' + src)); document.head.append(s); }); }
  async function makePdf(kind, l) {
    const msg = $('#pdf-msg'); if (msg) msg.textContent = 'Готовлю PDF…';
    try {
      if (!window.PDFLib) await loadScript('vendor/pdf-lib.min.js');
      if (!window.fontkit) await loadScript('vendor/fontkit.umd.min.js');
      const ctx = { no: lessonNo(l), scriptName: scriptName(l), kana: kind === 'sheet' ? lessonWritable(l) : lessonKana(l), read: (k, sys, ov) => displayReading(k, sys, ov), sys: S.sys };
      const bytes = await window.KanaPdf[kind === 'sheet' ? 'sheet' : 'notes'](l, ctx);
      const name = `${lessonLabel(l)} — ${kind === 'sheet' ? 'прописи' : 'конспект'}.pdf`;
      deliverFile(bytes, name, 'application/pdf');
      if (msg) msg.textContent = 'Готово: ' + name;
      window.__lastPdf = { name, size: bytes.length };
    } catch (e) { if (msg) msg.textContent = 'Не получилось собрать PDF: ' + e.message; }
  }
  function deliverFile(bytes, name, type) {
    const file = new File([bytes], name, { type });
    const mobile = /iPhone|iPad|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: name }).catch(() => { }); return; }
    const url = URL.createObjectURL(file), a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---------- связь с синхронизацией ----------
  const hash36 = str => { let x = 0x811c9dc5; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return x.toString(36); };
  const sampleId = (ch, s) => ch + ':' + hash36(JSON.stringify(s));
  window.KanaApp = {
    items() {
      const out = [];
      for (const w of userWords) out.push({ c: 'words', id: wid(w), data: { kana: w.kana, mean: w.mean, topic: w.topic, read: w.read, kanji: w.kanji } });
      for (const id of deleted) out.push({ c: 'hidden', id, data: {} });
      for (const ch in samples) for (const s of samples[ch]) out.push({ c: 'samples', id: sampleId(ch, s), data: { ch, s } });
      out.push({ c: 'settings', id: 'main', data: Object.assign({}, S) });
      for (const a of answers) { const { id, ...rest } = a; out.push({ c: 'answers', id, data: rest }); }
      for (const id in lessonsDone) out.push({ c: 'lessons', id, data: lessonsDone[id] });
      for (const id in activity) out.push({ c: 'activity', id, data: activity[id] });
      return out;
    },
    apply(c, id, data) {
      if (c === 'words') { userWords = userWords.filter(w => wid(w) !== id); if (data) userWords.push({ kana: data.kana, mean: data.mean, topic: data.topic, read: data.read, kanji: data.kanji }); }
      else if (c === 'hidden') { if (data) deleted.add(id); else deleted.delete(id); }
      else if (c === 'samples') {
        const ch = data ? data.ch : id.split(':')[0];
        const list = (samples[ch] || []).filter(s => sampleId(ch, s) !== id);
        if (data) list.push(data.s);
        if (list.length) samples[ch] = list; else delete samples[ch];
      }
      else if (c === 'settings' && data) { for (const k in S) delete S[k]; Object.assign(S, def, data); }
      else if (c === 'answers') { answers = answers.filter(a => a.id !== id); if (data) answers.push({ id, ...data }); }
      else if (c === 'lessons') { if (data) lessonsDone[id] = data; else delete lessonsDone[id]; }
      else if (c === 'activity') {
        // своё устройство считает само: чужая копия не должна откатить сегодняшние секунды
        if (!data) delete activity[id];
        else if (id.endsWith('|' + device) && activity[id]) activity[id] = { d: data.d, s: Math.max(data.s || 0, activity[id].s || 0), c: Math.max(data.c || 0, activity[id].c || 0) };
        else activity[id] = data;
      }
    },
    commit() {
      applying = true;
      answers.sort((a, b) => a.ts - b.ts);
      store.set('words', userWords); store.set('deleted', [...deleted]); store.set('samples', samples); store.set('settings', S); store.set('answers', answers);
      store.set('lessons', lessonsDone); store.set('activity', activity);
      applying = false;
      loadSamples();
      ({ setup: renderSetup, dict: renderDict, me: renderMe, abc: renderAbc, home: renderHome, lessons: renderLessons, lesson: renderLesson, practice: renderPractice, similar: renderSimilar, reading: renderReading, builder: renderBuilder })[current]?.();
      renderStreak();
    },
    resetLocal() {
      userWords = []; deleted = new Set(); samples = {}; answers = []; lessonsDone = {}; activity = {};
      for (const k in S) delete S[k]; Object.assign(S, JSON.parse(JSON.stringify(def)));
      this.commit();
    },
    rerender() { if (current === 'me') renderMe(); },
  };

  window.__kana = { selectedItems, buildDeck, judgeChar, S, startQuiz, get Q() { return Q; }, finish, next, show, openLesson, get lessonsDone() { return lessonsDone; }, dayTotals, todayKey, buzz, srsState, srsDue, srsForecast, startReview, startSim, confusions, startReading, startBuilder };
  show(S.onboarded ? 'home' : 'onboard');
})();
