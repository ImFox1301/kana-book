// Аккаунт и синхронизация. Без входа всё работает на устройстве; вход нужен, чтобы прогресс был на всех устройствах.
// Схема: приложение остаётся главным хранилищем, сервер — общая копия. Отправляем изменения с момента
// прошлой синхронизации, получаем всё новое с сервера; при конфликте побеждает более позднее изменение.
window.KanaSync = (function () {
  const $ = s => document.querySelector(s);
  const enabled = !!window.KANA_PWA;   // в превью без сервера — только локально
  const K = 'kana-tetrad:';
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(K + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(K + k); else localStorage.setItem(K + k, JSON.stringify(v)); } catch (e) { } },
  };
  let account = ls.get('account', null);   // { username, displayName }
  let cursor = ls.get('sync-cursor', 0);
  let snap = ls.get('sync-snap', {});        // что уже есть на сервере: ключ -> хеш данных
  let lastSync = ls.get('sync-last', 0);
  let status = '';                            // текст для пользователя
  let running = false, again = false, timer = null;
  let ui = { mode: 'login', error: '', busy: false, confirm: null };

  // ---------- утилиты ----------
  const canon = v => {   // JSON с отсортированными ключами: сервер (jsonb) возвращает ключи в своём порядке
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v);
  };
  const hash = str => { let x = 0x811c9dc5, y = 0x01000193; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; y = Math.imul(y ^ str.charCodeAt(i), 2246822519) >>> 0; } return x.toString(36) + y.toString(36); };
  const keyOf = (c, id) => c + '\u0001' + id;
  const clean = d => JSON.parse(JSON.stringify(d));   // без undefined — как его увидит сервер
  function localMap() {
    const m = new Map();
    for (const it of window.KanaApp.items()) { const data = clean(it.data); m.set(keyOf(it.c, it.id), { c: it.c, id: it.id, data, h: hash(canon(data)) }); }
    return m;
  }
  async function api(path, body) {
    let r;
    try {
      r = await fetch('/api' + path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) { return { status: 0, data: { error: 'Нет связи с сервером' } }; }
    let data = null; try { data = await r.json(); } catch (e) { }
    return { status: r.status, data: data || {} };
  }
  const fmtTime = ts => ts ? new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ещё не было';
  function saveState() { ls.set('account', account); ls.set('sync-cursor', cursor); ls.set('sync-snap', snap); ls.set('sync-last', lastSync); }

  // ---------- синхронизация ----------
  async function syncNow() {
    if (!enabled || !account) return;
    if (running) { again = true; return; }
    running = true; again = false; status = 'Синхронизация…'; rerender();
    try {
      const first = cursor === 0 && Object.keys(snap).length === 0;
      const now = Date.now();
      const local = localMap();
      const sent = new Map();   // ключ -> хеш, который отправили (null — удаление)
      const changes = [];
      for (const [k, it] of local) if (snap[k] !== it.h) {
        // при первом входе локальные данные «старше» аккаунта: добавятся, но не перезапишут то, что уже есть на сервере
        changes.push({ c: it.c, id: it.id, t: first ? 1 : (it.c === 'answers' ? (it.data.ts || now) : now), data: it.data });
        sent.set(k, it.h);
      }
      for (const k in snap) if (!local.has(k)) {
        const [c, id] = k.split('\u0001');
        changes.push({ c, id, t: now, del: true }); sent.set(k, null);
      }
      let more = true;
      while (changes.length || more) {
        const batch = changes.splice(0, 1000);
        const r = await api('/sync', { cursor, changes: batch });
        if (r.status === 401) { status = 'Сессия истекла — войдите снова. Данные на устройстве сохранены.'; account = null; saveState(); return; }
        if (r.status !== 200 || !Array.isArray(r.data.items)) { status = (r.data.error || 'Сервер недоступен') + '. Повторю позже.'; return; }
        const cur = localMap();
        for (const it of r.data.items) {
          const k = keyOf(it.c, it.id);
          const expected = sent.has(k) ? sent.get(k) : (snap[k] ?? null);
          const actual = cur.has(k) ? cur.get(k).h : null;
          if (expected !== actual) continue;   // изменили на устройстве во время синхронизации — отправим в следующий раз
          if (it.del) { window.KanaApp.apply(it.c, it.id, null); delete snap[k]; }
          else { window.KanaApp.apply(it.c, it.id, it.data); snap[k] = hash(canon(clean(it.data))); }
        }
        cursor = r.data.cursor; more = r.data.more;
        window.KanaApp.commit();
        saveState();
      }
      lastSync = Date.now(); status = ''; saveState();
    } finally {
      running = false; rerender();
      if (again) setTimeout(syncNow, 500);
    }
  }
  function touch() {
    if (!enabled || !account) return;
    clearTimeout(timer); timer = setTimeout(syncNow, 2500);
  }

  // ---------- вход, регистрация, выход ----------
  async function auth(kind, username, password, displayName) {
    ui.busy = true; ui.error = ''; rerender();
    const r = await api('/auth/' + kind, kind === 'register' ? { username, password, displayName } : { username, password });
    ui.busy = false;
    // к аккаунту привязан Telegram — вход по паролю подтверждается в боте
    if (r.status === 202 && r.data.confirm === 'telegram') {
      stopTg();
      tg = { kind: 'login', nonce: r.data.nonce, secret: r.data.secret, link: r.data.link, state: 'confirm', at: Date.now(),
        msg: 'Подтвердите вход: бот KANA прислал сообщение в Telegram — нажмите в нём «Войти». Если сообщения нет, откройте бота кнопкой ниже.' };
      tgSave(); tg.timer = setInterval(tgPoll, 2000); rerender(); return;
    }
    if (r.status !== 200 && r.status !== 201) { ui.error = r.data.error || 'Не получилось, попробуйте ещё раз'; rerender(); return; }
    if (!r.data.username) { ui.error = 'Сервер аккаунтов пока недоступен. Занимайтесь без входа — данные сохраняются на устройстве.'; rerender(); return; }
    signedIn(r.data);
  }
  const fromMe = d => ({ username: d.username, displayName: d.displayName || null, linked: !!d.linked, telegram: d.telegram || null, hasPassword: d.hasPassword !== false, avatar: d.avatar || null });
  async function signedIn(data) {
    account = fromMe(data); cursor = 0; snap = {}; lastSync = 0; saveState();
    ui.error = ''; ui.editName = false; stopTg();
    if (window.KanaApp && window.KanaApp.beforeLogin) window.KanaApp.beforeLogin();
    await syncNow();              // сначала забрать аккаунт (цель, прогресс), потом решать, что показать
    await refreshMe();
    if (window.KanaApp && window.KanaApp.afterLogin) window.KanaApp.afterLogin(); else rerender();
  }

  // ---------- Telegram: вход и привязка телефона ----------
  // Приложение создаёт попытку, пользователь открывает бота по ссылке, бот просит номер (или подтверждение),
  // приложение раз в 2 секунды узнаёт результат.
  let tgEnabled = ls.get('tg-enabled', null), tgChecked = false, tg = null;   // tg: { kind, nonce, secret, link, state, msg, timer }
  // начатый вход переживает перезагрузку страницы (iPhone часто перезапускает приложение, пока вы в Telegram)
  const ss = { get() { try { return JSON.parse(sessionStorage.getItem('kana-tetrad:tg') || 'null'); } catch (e) { return null; } },
               set(v) { try { if (v) sessionStorage.setItem('kana-tetrad:tg', JSON.stringify(v)); else sessionStorage.removeItem('kana-tetrad:tg'); } catch (e) { } } };
  const TG_FRESH = 7 * 60000, TG_TTL = 14 * 60000;
  function tgSave() { ss.set(tg && tg.nonce && tg.state !== 'ready' ? { kind: tg.kind, nonce: tg.nonce, secret: tg.secret, link: tg.link, state: tg.state, at: tg.at } : null); }
  // включён ли вход через Telegram: запоминаем, чтобы кнопка была видна сразу, без ожидания ответа сервера
  async function tgConfig() {
    if (tgChecked) return tgEnabled;
    tgChecked = true;
    const r = await api('/tg/config');
    if (r.status === 200) { tgEnabled = !!r.data.enabled; ls.set('tg-enabled', tgEnabled); }
    return tgEnabled;
  }
  let tgPending = null;   // запрос ссылки уже идёт — не создаём вторую попытку (иначе ссылка на экране и ожидаемая разойдутся)
  function tgPrepare(kind) {
    if (tg && tg.kind === kind && tg.link && Date.now() - tg.at < TG_FRESH) return Promise.resolve();
    if (tgPending && tgPending.kind === kind) return tgPending.p;
    const p = tgPrepareNow(kind).finally(() => { if (tgPending && tgPending.p === p) tgPending = null; });
    tgPending = { kind, p };
    return p;
  }
  async function tgPrepareNow(kind) {
    stopTg();
    const r = await api(kind === 'login' ? '/tg/login' : '/tg/link', {});
    if (r.status !== 200) { tg = { kind, state: 'error', msg: r.data.error || 'Telegram сейчас недоступен' }; rerender(); return; }
    tg = { kind, nonce: r.data.nonce, secret: r.data.secret, link: r.data.link, state: 'ready', at: Date.now() };
    rerender();
  }
  let tgWin = null;
  const closeTgWin = () => { if (!tgWin) return; const w = tgWin; tgWin = null; setTimeout(() => { try { w.close(); } catch (e) { } }, 300); };
  // вернулись из Telegram — убрать оставшуюся вкладку (about:blank или t.me)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') closeTgWin(); });
  window.addEventListener('focus', closeTgWin);
  function stopTg() { if (tg && tg.timer) clearInterval(tg.timer); tg = null; ss.set(null); }
  function tgOpened() {
    if (!tg || !tg.nonce) return;
    if (tg.state === 'ready') tg.state = 'waiting';
    tgSave(); rerender();
    if (tg.timer) return;
    tg.timer = setInterval(tgPoll, 2000);
  }
  const TG_TEXT = {
    waiting: 'Ждём ответа из Telegram… Нажмите «Старт» в боте.',
    need_contact: 'В боте нажмите «Поделиться номером».',
    confirm: 'Подтвердите вход в боте кнопкой «Войти».',
    denied: 'Вход отклонён в Telegram.',
    expired: 'Ссылка устарела — откройте Telegram ещё раз.',
    used: 'Эта ссылка уже использована.',
  };
  async function tgPoll() {
    if (!tg || !tg.nonce) return;
    const cur = tg;
    const r = await api('/tg/status', { nonce: cur.nonce, secret: cur.secret });
    if (tg !== cur) return;
    if (r.status !== 200) { if (r.status === 404) { stopTg(); rerender(); } return; }
    const st = r.data.status;
    if (st === 'ok') { clearInterval(cur.timer); tg = null; ss.set(null); signedIn(r.data); return; }
    if (st === 'linked') { clearInterval(cur.timer); tg = null; ss.set(null); await refreshMe(); rerender(); note('Telegram привязан — теперь можно входить в один шаг'); if (window.KanaApp) window.KanaApp.rerender(); return; }
    if (st === 'new') return;
    cur.state = st; cur.msg = r.data.message || null;
    if (['denied', 'expired', 'used', 'error'].includes(st)) { clearInterval(cur.timer); cur.timer = null; cur.link = null; ss.set(null); }
    else tgSave();
    rerender();
  }
  const TG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.9 4.6 18.7 19.7c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9-8.2c.4-.4-.1-.6-.6-.2L6.3 13.3l-4.8-1.5c-1-.3-1.1-1 .2-1.5L20.5 3.1c.9-.3 1.6.2 1.4 1.5z"/></svg>';
  // Кнопка показывается сразу. Ссылку на бота готовим заранее; если её ещё нет — открываем окно и подставляем ссылку, когда придёт.
  function tgBlock(kind, compact) {
    if (tgEnabled === false) return null;
    const ready = tg && tg.kind === kind && tg.link && !(tg.state === 'ready' && Date.now() - tg.at > TG_FRESH);
    if (!ready && !(tg && tg.kind === kind && tg.state && tg.state !== 'ready' && !tg.link)) { if (tg && tg.kind === kind && tg.state === 'ready') stopTg(); if (!tg || tg.kind !== kind) tgPrepare(kind); }
    const label = kind === 'login' ? 'Войти через Telegram' : 'Привязать телефон через Telegram';
    const btn = h('a', { class: compact ? 'tground' : 'btn tg', id: kind === 'login' ? 'btn-tg-login' : 'btn-tg-link', href: ready ? tg.link : '#', target: '_blank', rel: 'noopener', 'aria-label': label,
      onclick: async e => {
        e.preventDefault();
        // окно открываем сразу (иначе браузер заблокирует его как всплывающее) и запоминаем:
        // Telegram откроется своим приложением, а пустую вкладку закроем, когда человек вернётся
        const w = window.open(ready ? tg.link : 'about:blank', '_blank');
        tgWin = w;
        if (!ready) {
          if (!tg || tg.kind !== kind || !tg.link) { stopTg(); await tgPrepare(kind); }
          if (!(tg && tg.link)) { if (w) w.close(); tgWin = null; return; }
          if (w) w.location.href = tg.link; else location.href = tg.link;
        } else if (!w) location.href = tg.link;
        tgOpened();
      } });
    btn.innerHTML = TG_ICON; if (compact) btn.title = label; else btn.append(h('span', {}, label));
    const done = tg && tg.kind === kind && ['denied', 'expired', 'used', 'error'].includes(tg.state);
    return h('div', { class: 'tgbox' + (compact ? ' compact' : '') }, btn,
      done ? h('button', { class: 'link', type: 'button', onclick: () => { stopTg(); tgPrepare(kind); } }, 'Попробовать ещё раз') : null,
      tg && tg.kind === kind && tg.state && tg.state !== 'ready' ? h('div', { class: 'st', role: 'status', id: 'tg-status' }, tg.msg || TG_TEXT[tg.state] || '') : null);
  }
  // возвращают текст ошибки или null — их вызывают диалоги подтверждения
  async function unlinkTg() {
    const r = await api('/auth/unlink-telegram', {});
    if (r.status !== 200) return r.data.error || 'Не получилось отвязать';
    account = Object.assign(account, fromMe(r.data)); saveState(); rerender(); if (window.KanaApp) window.KanaApp.rerender();
    note('Telegram отвязан'); return null;
  }
  const note = msg => { if (window.KanaUI) window.KanaUI.toast(msg); };
  // фото: уменьшаем на устройстве до 256×256 (обрезка по центру), JPEG ~20–40 КБ
  async function uploadAvatar(file) {
    ui.error = ''; ui.notice = 'Загружаю фото…'; rerender();
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Не удалось открыть картинку')); i.src = URL.createObjectURL(file); });
      const side = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas');
      c.width = c.height = 256;
      c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(img.src);
      const r = await api('/auth/avatar', { data: c.toDataURL('image/jpeg', 0.85) });
      if (r.status !== 200) throw new Error(r.data.error || 'Не получилось загрузить фото');
      account = Object.assign(account, fromMe(r.data)); saveState(); ui.notice = ''; note('Фото обновлено');
    } catch (e) { ui.notice = ''; ui.error = e.message; }
    rerender();
  }
  async function deleteAvatar() {
    const r = await api('/auth/avatar/delete', {});
    if (r.status !== 200) return r.data.error || 'Не получилось убрать фото';
    account = Object.assign(account, fromMe(r.data)); saveState(); rerender(); note('Фото убрано'); return null;
  }
  async function setName(name) {
    ui.busy = true; ui.error = ''; rerender();
    const r = await api('/auth/name', { displayName: name });
    ui.busy = false;
    if (r.status !== 200) { ui.error = r.data.error || 'Не получилось сохранить имя'; rerender(); return; }
    account.displayName = r.data.displayName; saveState(); ui.editName = false; rerender();
  }
  async function refreshMe() {   // имя могли поменять на другом устройстве
    const r = await api('/auth/me');
    if (r.status === 200 && account && r.data.username) {
      const was = account.linked;
      account = Object.assign(account, fromMe(r.data)); saveState(); rerender();
      if (was !== account.linked && window.KanaApp) window.KanaApp.rerender();
    }
  }
  async function logout() {
    await syncNow();
    if (window.KanaPush) await window.KanaPush.forget();   // напоминания этого устройства привязаны к аккаунту
    await api('/auth/logout', {});
    account = null; cursor = 0; snap = {}; lastSync = 0; status = ''; saveState();
    ui.error = ''; ui.notice = ''; stopTg();
    window.KanaApp.resetLocal();   // перерисует «Я» уже без аккаунта
  }
  async function deleteAccount(password) {
    const r = await api('/auth/delete', { password });
    if (r.status !== 200) return r.data.error || 'Не получилось удалить аккаунт';
    if (window.KanaPush) await window.KanaPush.forget().catch(() => { });
    account = null; cursor = 0; snap = {}; lastSync = 0; saveState(); stopTg();
    window.KanaApp.resetLocal(); window.KanaApp.open('me'); note('Аккаунт удалён');
    return null;
  }

  // ---------- интерфейс ----------
  let box = null;
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs) { const v = attrs[k]; if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v); }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }
  let rerender = function () { if (box && !box.closest('[hidden]')) renderAccount(box); };
  function renderAccount(el) {
    box = el;
    if (!enabled) { el.hidden = true; return; }
    el.hidden = false; el.replaceChildren();
    const add = (...xs) => el.append(...xs.filter(x => x != null && x !== false));
    const open = name => { ui.error = ''; window.KanaApp.open(name); };
    if (!account) {
      // без аккаунта — сразу форма входа, как на первом экране
      const form = h('div', { id: 'me-login' });
      add(h('div', { class: 'sheet account-guest' }, h('p', { class: 'st center' }, 'Войдите, чтобы прогресс был на всех ваших устройствах.'),
        status ? h('div', { class: 'st' }, status) : null, form));
      renderAuthPage(form, 'login', { embedded: true, regId: 'btn-to-register' });
      return;
    }
    const UI = window.KanaUI;
    const icon = n => UI ? UI.I(n) : h('span');
    const nameForm = () => {
      const inp = h('input', { id: 'acc-name-edit', maxlength: 40, autocomplete: 'nickname', value: account.displayName || '', placeholder: 'Например, Павел', 'aria-label': 'Как к вам обращаться' });
      setTimeout(() => { inp.focus(); inp.select(); }, 30);
      inp.addEventListener('keydown', e => { if (e.key === 'Escape' && account.displayName) { ui.editName = false; rerender(); } });
      return h('form', { class: 'name-edit', onsubmit: e => { e.preventDefault(); setName(inp.value); } }, inp,
        h('button', { class: 'icbtn boxed ok', type: 'submit', disabled: ui.busy, 'aria-label': 'Сохранить имя', title: 'Сохранить' }, icon('check')),
        account.displayName ? h('button', { class: 'icbtn boxed', type: 'button', 'aria-label': 'Отмена', title: 'Отмена', onclick: () => { ui.editName = false; ui.error = ''; rerender(); } }, icon('close')) : null);
    };
    if (!account.displayName) {
      el.append(h('div', { class: 'ask-name' }, h('b', {}, 'Как к вам обращаться?'), h('div', { class: 'st' }, 'Это имя увидят друзья.'), nameForm()));
    }
    const fileIn = h('input', { type: 'file', accept: 'image/*', id: 'avatar-file', hidden: true, onchange: () => { if (fileIn.files[0]) uploadAvatar(fileIn.files[0]); fileIn.value = ''; } });
    const ava = (window.KanaAvatar ? window.KanaAvatar(account.displayName || account.username, account.avatar, 'big') : h('span'));
    // фото: меню — загрузить или убрать (с подтверждением)
    const avaBtn = h('button', { type: 'button', class: 'ava-btn', id: 'btn-avatar', 'aria-haspopup': 'menu', 'aria-label': 'Фото профиля', title: 'Фото профиля',
      onclick: () => UI.menu(avaBtn, [
        { icon: 'upload', label: account.avatar ? 'Сменить фото' : 'Загрузить фото', id: 'menu-avatar-up', onclick: () => fileIn.click() },
        account.avatar ? { icon: 'trash', label: 'Убрать фото', danger: true, id: 'menu-avatar-del', onclick: () => UI.dialog({ title: 'Убрать фото?', text: 'Вместо фото будет картинка KANA. Новое фото можно загрузить в любой момент.', confirm: 'Убрать', danger: true, onConfirm: deleteAvatar }) } : null]) }, ava);
    const editing = ui.editName && account.displayName;
    el.append(h('div', { class: 'profile' },
      h('div', { class: 'ava-edit' }, avaBtn, fileIn),
      h('div', {}, editing ? nameForm() : h('div', { class: 'who-row' }, h('div', { class: 'who' }, account.displayName || account.username),
          account.displayName ? h('button', { class: 'icbtn', type: 'button', id: 'btn-edit-name', 'aria-label': 'Изменить имя', title: 'Изменить имя', onclick: () => { ui.editName = true; rerender(); } }, icon('pen')) : null),
        account.displayName ? h('div', { class: 'login' }, '@' + account.username) : null,
        window.KanaLevel ? window.KanaLevel() : null)));
    const card = h('div', { class: 'sheet acc-card' }, h('div', { class: 'h3' }, 'Аккаунт'),
      h('div', { class: 'sync-row' }, h('span', { class: 'st' }, status || ('Синхронизировано: ' + fmtTime(lastSync))),
        h('button', { class: 'btn ghost sm', type: 'button', disabled: running, onclick: () => syncNow() }, running ? 'Синхронизация…' : 'Синхронизировать')));
    el.append(card);
    if (ui.notice) card.append(h('div', { class: 'st', role: 'status' }, ui.notice));
    if (account.linked) {
      const t = h('div', { class: 'tg-ok' }, h('span', { class: 'tg-ic' }), h('div', {}, h('b', {}, 'Телефон привязан через Telegram'),
        h('div', { class: 'st' }, (account.telegram ? '@' + account.telegram + ' · ' : '') + 'вход в один шаг, без пароля')), h('span', { class: 'tg-check' }, icon('check')));
      t.querySelector('.tg-ic').innerHTML = TG_ICON;
      card.append(t);
    } else if (tgEnabled !== false) {
      card.append(h('div', { class: 'tglink' }, tgBlock('link'),
        h('div', { class: 'st' }, 'Сможете входить в один шаг, без пароля. Номер другим пользователям не показывается.')));
    }
    if (!tgChecked) tgConfig().then(() => rerender());
    if (ui.error) card.append(h('div', { class: 'err', role: 'alert' }, ui.error));
    // выход — отдельно, в самом низу профиля, с подтверждением
    el.append(h('div', { class: 'logout-box' }, h('button', { class: 'btn logout wide', type: 'button', id: 'btn-logout', onclick: () => UI.dialog({
      title: 'Выйти из аккаунта?', text: 'Прогресс сохранён в аккаунте. С этого устройства он будет удалён, пока вы снова не войдёте.', confirm: 'Выйти', danger: true,
      onConfirm: async () => { await logout(); return null; } }) }, 'Выйти из аккаунта')));
  }

  // ---------- отдельные экраны входа и регистрации ----------
  // Форма рисуется один раз при открытии экрана; дальше меняются только ошибка, кнопка и блок Telegram —
  // иначе нажатие могло попасть в момент перерисовки и потеряться.
  let page = null, pageKind = 'login', parts = null;
  function renderAuthPage(el, kind, opts = {}) {
    if (page && page !== el) page.replaceChildren();   // одна форма на странице: иначе поля с одинаковыми id
    page = el; pageKind = kind; el.replaceChildren(); parts = null;
    const isReg = kind === 'register';
    const BACK = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H4 M10 6l-6 6 6 6"/></svg>';
    const backBtn = h('button', { class: 'icbtn back', type: 'button', 'aria-label': 'Назад', onclick: () => { ui.error = ''; window.KanaApp.back ? window.KanaApp.back() : window.KanaApp.open('me'); } }); backBtn.innerHTML = BACK;
    const back = h('div', { class: 'phead' }, backBtn, h('h1', { class: 'h1' }, isReg ? 'Регистрация' : 'Вход'));
    if (account) { el.append(opts.embedded ? '' : back, h('p', {}, 'Вы уже вошли как ', h('b', {}, account.displayName || account.username), '.')); return; }
    ui.error = '';
    const field = (id, label, attrs, hint) => h('label', { class: 'fld', for: id }, h('span', { class: 'lbl' }, label), h('input', Object.assign({ id }, attrs)), hint ? h('span', { class: 'st' }, hint) : null);
    const name = isReg ? field('acc-name', 'Имя', { maxlength: 40, autocomplete: 'nickname', placeholder: 'Как к вам обращаться', required: true }, 'Это имя увидят друзья. Его можно поменять потом.') : null;
    const user = field('acc-user', 'Логин', { autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true, placeholder: isReg ? 'латиницей, от 3 символов' : '' }, isReg ? 'Для входа. Латинские буквы, цифры, точка, дефис, подчёркивание.' : null);
    const pass = field('acc-pass', 'Пароль', { type: 'password', autocomplete: isReg ? 'new-password' : 'current-password', required: true, minlength: isReg ? 8 : null, placeholder: isReg ? 'от 8 символов' : '' });
    const val = id => el.querySelector('#' + id).value;
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    const submit = h('button', { class: 'btn primary', type: 'submit' }, isReg ? 'Создать аккаунт' : 'Войти');
    const form = h('form', { class: 'authform', onsubmit: e => { e.preventDefault(); auth(kind, val('acc-user').trim(), val('acc-pass'), isReg ? val('acc-name').trim() : undefined); } },
      name, user, pass, err, submit);
    // Telegram — круглая кнопка под основной
    const tgHolder = h('div', { class: 'tgunder', hidden: true }, h('div', { class: 'orline' }, isReg ? 'или через Telegram — без логина и пароля' : 'или через Telegram'), h('div', { class: 'tgslot' }));
    const orLine = null;
    const sw = h('button', { class: 'link', type: 'button', id: opts.embedded ? (opts.regId || 'btn-welcome-register') : null, onclick: () => { ui.error = ''; window.KanaApp.open(isReg ? 'login' : 'register'); } }, isReg ? 'Войти' : 'Создать');
    el.append(opts.embedded ? '' : back, form, tgHolder,
      h('p', { class: 'switch-auth' }, isReg ? 'Уже есть аккаунт? ' : 'Нет аккаунта? ', sw),
      opts.embedded ? '' : h('p', { class: 'small muted' }, isReg ? 'Аккаунт хранит прогресс, слова и настройки на всех ваших устройствах и нужен для напоминаний. Уже накопленное на этом устройстве перенесётся в аккаунт.' : 'Войдите, чтобы прогресс был на всех ваших устройствах.'));
    parts = { err, submit, tgHolder, orLine, isReg };
    updateAuthPage();
    tgConfig().then(updateAuthPage);
  }
  function updateAuthPage() {
    if (!parts || !page || !page.isConnected || page.closest('[hidden]')) return;
    parts.err.hidden = !ui.error; parts.err.textContent = ui.error || '';
    parts.submit.disabled = !!ui.busy;
    parts.submit.textContent = ui.busy ? 'Подождите…' : parts.isReg ? 'Создать аккаунт' : 'Войти';
    parts.tgHolder.hidden = tgEnabled === false;
    if (tgEnabled !== false) parts.tgHolder.querySelector('.tgslot').replaceChildren(tgBlock('login', true) || '');
  }
  const prevRerender = rerender;
  rerender = function () {
    if (page && page.isConnected && !page.closest('[hidden]') && parts) { updateAuthPage(); return; }
    prevRerender();
  };

  // ---------- когда синхронизироваться ----------
  if (enabled) {
    // продолжить начатый вход через Telegram после перезагрузки
    const saved = ss.get();
    if (saved && Date.now() - saved.at < TG_TTL && (saved.kind === 'link') === !!account) { tg = Object.assign(saved, { timer: setInterval(tgPoll, 2000) }); tgEnabled = true; ui.linking = saved.kind === 'link';
      setTimeout(() => { if (tg && window.KanaApp) window.KanaApp.open(tg.kind === 'login' ? 'login' : 'me'); tgPoll(); }, 0); }
    else ss.set(null);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && tg && tg.timer) tgPoll(); });
    window.addEventListener('online', () => touch());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') touch(); });
    setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 120000);
    if (account) setTimeout(() => { syncNow(); refreshMe(); }, 800);
  }

  return { touch, syncNow, renderAccount, renderAuthPage, api, refreshMe, unlinkTg, deleteAccount, get account() { return account; } };
})();
