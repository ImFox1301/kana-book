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
    set(k, v) { try { localStorage.setItem('kana-tetrad:' + k, JSON.stringify(v)); } catch (e) { } },
  };

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

  // ---------- настройки ----------
  const def = { script: 'h', rows: { h: ['a', 'ka', 'sa'], k: ['a', 'ka', 'sa'] }, topics: null, wfilter: 'all', count: 20, mode: 'draw', sys: 'ru', len: 1 };
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
      opt(md, 'type', S.mode, 'Обратный перевод', 'вижу знак → пишу звучание', null, v => { S.mode = v; save(); renderSetup(); }));
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
  function startQuiz(items, count) {
    Q = { deck: buildDeck(items, count), i: 0, results: [], mode: S.mode, sys: S.sys, len: S.len };
    show('quiz'); renderCard();
  }
  $('#btn-start').onclick = () => {
    const items = selectedItems(); if (!items.length) return;
    if (S.count < items.length) S.count = items.length;
    startQuiz(items, S.count);
  };
  $('#btn-quit').onclick = () => { if (Q && Q.results.length) renderResult(); else { Q = null; show('setup'); } };

  function readingOf(it, sys) { return displayReading(it.kana, sys, it.w && it.w.read); }
  const otherSys = s => s === 'ru' ? 'lat' : 'ru';

  // поле для рисования
  function makePad(onchange) {
    const wrap = h('div', { class: 'pad' });
    const cv = h('canvas', { 'aria-label': 'Поле для рисования знака' });
    wrap.append(cv);
    const pad = { el: wrap, strokes: [], cur: null };
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
    if (Q.mode === 'draw') {
      const units = [...it.kana];
      const slotStrokes = units.map(() => []);
      let cur = 0;
      const prompt = h('div', { class: 'prompt' },
        h('span', { class: 'lab' }, isWord ? 'Напишите слово' : 'Нарисуйте знак'),
        isWord ? h('span', { class: 'meaning' }, it.w.mean) : null,
        h('span', { class: 'big' }, readingOf(it, Q.sys)),
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
  function actions(submit) {
    return h('div', { class: 'actions' },
      iconBtn('btn ghost', 'skip', 'Пропустить', () => finish({ it: Q.deck[Q.i], status: 'skip' }), 'Пропустить карточку и посмотреть ответ'),
      iconBtn('btn primary', 'next', 'Далее', submit, 'Проверить ответ'));
  }

  function finish(res) {
    Q.results[Q.i] = res;
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
    const reading = h('div', {}, h('div', { class: 'correct-reading' }, readingOf(it, Q.sys)), h('div', { class: 'small muted' }, readingOf(it, otherSys(Q.sys))));
    if (Q.mode === 'draw') {
      const units = [...it.kana];
      const cmp = h('div', { class: 'compare' });
      if (res.per) cmp.append(h('figure', {}, h('div', { class: 'glyphs' }, ...res.per.map(p => { const c = thumb(p.strokes); c.style.borderColor = p.ok ? 'var(--ok)' : 'var(--shu)'; return c; })), h('figcaption', {}, 'Ваш рисунок')));
      cmp.append(h('figure', {}, h('div', { class: 'glyphs' }, ...units.map(u => h('div', { class: 'glyph' }, u))), h('figcaption', {}, 'Правильно')));
      v.append(cmp);
      if (isWord) v.append(h('div', { class: 'meaning' }, it.w.mean));
      v.append(reading);
      if (status === 'bad' && res.per) {
        const wrong = res.per.filter(p => !p.ok);
        v.append(h('div', { class: 'note' }, wrong.map(p => `Знак ${p.target}: распознан как «${p.best}»`).join('. ') + '.'));
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
          res.status = 'ok'; res.taught = true; renderVerdict(res);
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
    el.append(h('div', { class: 'actions', style: 'justify-content:center' },
      missedItems.length ? iconBtn('btn primary', 'undo', `Повторить ошибки (${missedItems.length})`, () => startQuiz(missedItems, missedItems.length * 2)) : null,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { Q = null; show('setup'); } }, 'Новый квиз')));
    show('result');
  }

  // ---------- переключение экранов ----------
  let lastQuiz = 'setup';
  function show(name) {
    if (name !== 'dict') lastQuiz = name;
    $('#screen-setup').hidden = name !== 'setup';
    $('#screen-quiz').hidden = name !== 'quiz';
    $('#screen-result').hidden = name !== 'result';
    $('#screen-dict').hidden = name !== 'dict';
    document.querySelectorAll('nav.tabs button').forEach(x => x.setAttribute('aria-selected', String((x.dataset.tab === 'dict') === (name === 'dict'))));
    if (name === 'setup') renderSetup();
    if (name === 'dict') renderDict();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => show(b.dataset.tab === 'dict' ? 'dict' : lastQuiz));
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !$('#screen-quiz').hidden && document.activeElement && document.activeElement.tagName === 'BODY') {
      const b = $('#card .btn.primary'); if (b) b.click();
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
    if (!KANA_RE.test(kana)) { $('#add-ok').textContent = ''; $('#add-preview').textContent = 'Слово должно быть записано хираганой или катаканой.'; return; }
    userWords.push({ kana, mean, topic, read }); deleted.delete(kana + '|' + mean); saveWords();
    $('#add-ok').textContent = `Добавлено: ${kana}`; e.target.reset(); $('#add-preview').textContent = ''; renderDict();
  });
  $('#imp-file').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { $('#imp-text').value = r.result; }; r.readAsText(f); });
  $('#imp-go').onclick = () => {
    const lines = $('#imp-text').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let added = 0, skipped = 0; const have = new Set(allWords().map(wid));
    for (const line of lines) {
      const sep = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
      const [kana, mean, topic, read] = line.split(sep).map(s => (s || '').trim().replace(/^"|"$/g, ''));
      if (!kana || !mean || !KANA_RE.test(kana)) { skipped++; continue; }
      const w = { kana, mean, topic: topic || 'Импорт', read: read || undefined };
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

  window.__kana = { selectedItems, buildDeck, judgeChar, S, startQuiz, get Q() { return Q; }, finish, next };
  show('setup');
})();
