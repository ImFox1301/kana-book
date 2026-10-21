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
    if (r.status !== 200 && r.status !== 201) { ui.error = r.data.error || 'Не получилось, попробуйте ещё раз'; rerender(); return; }
    if (!r.data.username) { ui.error = 'Сервер аккаунтов пока недоступен. Занимайтесь без входа — данные сохраняются на устройстве.'; rerender(); return; }
    signedIn(r.data);
  }
  const fromMe = d => ({ username: d.username, displayName: d.displayName || null, linked: !!d.linked, telegram: d.telegram || null, hasPassword: d.hasPassword !== false });
  async function signedIn(data) {
    account = fromMe(data); cursor = 0; snap = {}; lastSync = 0; saveState();
    ui.error = ''; ui.editName = false; stopTg();
    await syncNow();              // сначала забрать аккаунт (цель, прогресс), потом решать, что показать
    await refreshMe();
    if (window.KanaApp && window.KanaApp.afterLogin) window.KanaApp.afterLogin(); else rerender();
  }

  // ---------- Telegram: вход и привязка телефона ----------
  // Приложение создаёт попытку, пользователь открывает бота по ссылке, бот просит номер (или подтверждение),
  // приложение раз в 2 секунды узнаёт результат.
  let tgEnabled = null, tg = null;   // tg: { kind, nonce, secret, link, state, msg, timer }
  async function tgConfig() { if (tgEnabled === null) { const r = await api('/tg/config'); tgEnabled = r.status === 200 && !!r.data.enabled; } return tgEnabled; }
  async function tgPrepare(kind) {
    if (tg && tg.kind === kind && tg.link && Date.now() - tg.at < 8 * 60000) return;
    stopTg();
    const r = await api(kind === 'login' ? '/tg/login' : '/tg/link', {});
    if (r.status !== 200) { tg = { kind, state: 'error', msg: r.data.error || 'Telegram сейчас недоступен' }; rerender(); return; }
    tg = { kind, nonce: r.data.nonce, secret: r.data.secret, link: r.data.link, state: 'ready', at: Date.now() };
    rerender();
  }
  function stopTg() { if (tg && tg.timer) clearInterval(tg.timer); tg = null; }
  function tgOpened() {
    if (!tg || !tg.nonce) return;
    tg.state = 'waiting'; rerender();
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
    if (st === 'ok') { clearInterval(cur.timer); tg = null; signedIn(r.data); return; }
    if (st === 'linked') { clearInterval(cur.timer); tg = null; await refreshMe(); ui.notice = 'Телефон привязан. Теперь доступны друзья.'; rerender(); if (window.KanaApp) window.KanaApp.rerender(); return; }
    if (st === 'new') return;
    cur.state = st; cur.msg = r.data.message || null;
    if (['denied', 'expired', 'used', 'error'].includes(st)) { clearInterval(cur.timer); cur.timer = null; cur.link = null; }
    rerender();
  }
  function tgBlock(kind) {
    if (!tgEnabled) return null;
    if (!tg || tg.kind !== kind) { tgPrepare(kind); return h('div', { class: 'tgbox' }, h('span', { class: 'st' }, 'Готовлю вход через Telegram…')); }
    const done = ['denied', 'expired', 'used', 'error'].includes(tg.state);
    const btn = tg.link ? h('a', { class: 'btn tg', id: kind === 'login' ? 'btn-tg-login' : 'btn-tg-link', href: tg.link, target: '_blank', rel: 'noopener', onclick: tgOpened },
      kind === 'login' ? 'Войти через Telegram' : 'Привязать телефон через Telegram') : null;
    return h('div', { class: 'tgbox' }, btn,
      done ? h('button', { class: 'link', type: 'button', onclick: () => { stopTg(); tgPrepare(kind); } }, 'Попробовать ещё раз') : null,
      tg.state !== 'ready' ? h('div', { class: 'st', role: 'status', id: 'tg-status' }, tg.msg || TG_TEXT[tg.state] || '') : null);
  }
  async function unlinkTg() {
    const r = await api('/auth/unlink-telegram', {});
    if (r.status !== 200) { ui.error = r.data.error || 'Не получилось отвязать'; rerender(); return; }
    account = Object.assign(account, fromMe(r.data)); saveState(); rerender(); if (window.KanaApp) window.KanaApp.rerender();
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
    ui.confirm = null; ui.error = ''; ui.linking = false; ui.notice = ''; stopTg();
    window.KanaApp.resetLocal();   // перерисует «Я» уже без аккаунта
  }
  async function deleteAccount(password) {
    ui.busy = true; ui.error = ''; rerender();
    const r = await api('/auth/delete', { password });
    ui.busy = false;
    if (r.status !== 200) { ui.error = r.data.error || 'Не получилось удалить аккаунт'; rerender(); return; }
    account = null; cursor = 0; snap = {}; lastSync = 0; saveState();
    window.KanaApp.resetLocal();
    ui.confirm = null; rerender();
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
      add(
        h('div', {}, h('b', {}, 'Сохранять прогресс между устройствами'),
          h('div', { class: 'st' }, 'Без аккаунта всё хранится только на этом устройстве. Войдите, и слова, образцы почерка, настройки и история ответов будут на всех ваших устройствах. Уже накопленное здесь перенесётся в аккаунт.')),
        status ? h('div', { class: 'st' }, status) : null,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', id: 'btn-to-login', onclick: () => open('login') }, 'Войти'),
          h('button', { class: 'btn ghost', type: 'button', id: 'btn-to-register', onclick: () => open('register') }, 'Создать аккаунт')));
      return;
    }
    const nameForm = () => {
      const inp = h('input', { id: 'acc-name-edit', maxlength: 40, autocomplete: 'nickname', value: account.displayName || '', placeholder: 'Например, Павел', 'aria-label': 'Как к вам обращаться' });
      setTimeout(() => inp.focus(), 30);
      return h('form', { class: 'row', onsubmit: e => { e.preventDefault(); setName(inp.value); } }, inp,
        h('button', { class: 'btn primary', type: 'submit', disabled: ui.busy }, 'Сохранить'),
        account.displayName ? h('button', { class: 'link', type: 'button', onclick: () => { ui.editName = false; ui.error = ''; rerender(); } }, 'Отмена') : null);
    };
    if (!account.displayName) {
      el.append(h('div', { class: 'ask-name' }, h('b', {}, 'Как к вам обращаться?'), h('div', { class: 'st' }, 'Это имя увидят друзья.'), nameForm()));
    }
    el.append(h('div', { class: 'row', style: 'justify-content:space-between' },
      h('div', {}, h('span', { class: 'who' }, account.displayName || account.username),
        account.displayName ? h('span', { class: 'st login' }, ' @' + account.username) : null,
        account.displayName && !ui.editName ? h('button', { class: 'link', type: 'button', id: 'btn-edit-name', onclick: () => { ui.editName = true; rerender(); } }, 'изменить имя') : null,
        h('div', { class: 'st' }, status || ('Синхронизировано: ' + fmtTime(lastSync)))),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', type: 'button', disabled: running, onclick: () => syncNow() }, 'Синхронизировать'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { ui.confirm = 'logout'; ui.error = ''; rerender(); } }, 'Выйти'))));
    if (ui.editName && account.displayName) el.append(nameForm());
    if (ui.notice) el.append(h('div', { class: 'okmsg', role: 'status' }, ui.notice));
    if (account.linked) {
      el.append(h('div', { class: 'row tgline' }, h('span', { class: 'st' }, 'Телефон привязан через Telegram' + (account.telegram ? ' (@' + account.telegram + ')' : '')),
        account.hasPassword ? h('button', { class: 'link', type: 'button', onclick: unlinkTg }, 'отвязать') : null));
    } else if (tgEnabled) {
      el.append(h('div', { class: 'tglink' }, h('div', { class: 'st' }, 'Привяжите номер телефона через Telegram — откроются друзья и вход в один шаг.'),
        ui.linking ? tgBlock('link') : h('button', { class: 'btn ghost', type: 'button', id: 'btn-link-start', onclick: () => { ui.linking = true; rerender(); } }, 'Привязать телефон')));
    } else tgConfig().then(v => { if (v) rerender(); });
    if (ui.confirm === 'logout') {
      el.append(h('div', { class: 'row' }, h('span', { class: 'st' }, 'Прогресс сохранён в аккаунте. С этого устройства он будет удалён, пока вы снова не войдёте.'),
        h('button', { class: 'btn primary', type: 'button', onclick: logout }, 'Выйти'),
        h('button', { class: 'link', type: 'button', onclick: () => { ui.confirm = null; rerender(); } }, 'Отмена')));
    } else if (ui.confirm === 'delete') {
      const pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Пароль для подтверждения', 'aria-label': 'Пароль' });
      el.append(h('form', { class: 'row', onsubmit: e => { e.preventDefault(); deleteAccount(pass.value); } },
        h('span', { class: 'st' }, 'Аккаунт и всё, что в нём сохранено, будут удалены без возможности восстановления.'), pass,
        h('button', { class: 'btn primary', type: 'submit', disabled: ui.busy }, 'Удалить навсегда'),
        h('button', { class: 'link', type: 'button', onclick: () => { ui.confirm = null; ui.error = ''; rerender(); } }, 'Отмена')));
    } else {
      el.append(h('div', { class: 'row' }, h('button', { class: 'link', type: 'button', onclick: () => { ui.confirm = 'delete'; rerender(); } }, 'Удалить аккаунт')));
    }
    if (ui.error) el.append(h('div', { class: 'err', role: 'alert' }, ui.error));
  }

  // ---------- отдельные экраны входа и регистрации ----------
  // Форма рисуется один раз при открытии экрана; дальше меняются только ошибка, кнопка и блок Telegram —
  // иначе нажатие могло попасть в момент перерисовки и потеряться.
  let page = null, pageKind = 'login', parts = null;
  function renderAuthPage(el, kind) {
    page = el; pageKind = kind; el.replaceChildren(); parts = null;
    const isReg = kind === 'register';
    const back = h('div', { class: 'backbar' }, h('button', { class: 'link back', type: 'button', onclick: () => { ui.error = ''; window.KanaApp.open('me'); } }, '← Назад'));
    if (account) { el.append(back, h('p', {}, 'Вы уже вошли как ', h('b', {}, account.displayName || account.username), '.')); return; }
    ui.error = '';
    const field = (id, label, attrs, hint) => h('label', { class: 'fld', for: id }, h('span', { class: 'lbl' }, label), h('input', Object.assign({ id }, attrs)), hint ? h('span', { class: 'st' }, hint) : null);
    const name = isReg ? field('acc-name', 'Как к вам обращаться', { maxlength: 40, autocomplete: 'nickname', placeholder: 'Например, Павел', required: true }, 'Это имя увидят друзья. Его можно поменять потом.') : null;
    const user = field('acc-user', 'Логин', { autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true, placeholder: isReg ? 'латиницей, от 3 символов' : '' }, isReg ? 'Для входа. Латинские буквы, цифры, точка, дефис, подчёркивание.' : null);
    const pass = field('acc-pass', 'Пароль', { type: 'password', autocomplete: isReg ? 'new-password' : 'current-password', required: true, minlength: isReg ? 8 : null, placeholder: isReg ? 'от 8 символов' : '' });
    const val = id => el.querySelector('#' + id).value;
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    const submit = h('button', { class: 'btn primary', type: 'submit' }, isReg ? 'Создать аккаунт' : 'Войти');
    const form = h('form', { class: 'authform', onsubmit: e => { e.preventDefault(); auth(kind, val('acc-user').trim(), val('acc-pass'), isReg ? val('acc-name').trim() : undefined); } },
      name, user, pass, err, submit);
    const tgHolder = h('div', { class: 'sheet tgsheet', hidden: true }, h('b', {}, isReg ? 'Быстрее — через Telegram' : 'Через Telegram'),
      h('div', { class: 'st' }, isReg ? 'Без логина и пароля: бот попросит поделиться номером телефона, имя возьмём из Telegram.' : 'Если аккаунт создан через Telegram или к нему привязан телефон.'),
      h('div', { class: 'tgslot' }));
    const orLine = h('div', { class: 'small muted', style: 'text-align:center', hidden: true }, isReg ? 'или с логином и паролем' : 'или по логину и паролю');
    el.append(back, h('h1', { class: 'h1' }, isReg ? 'Регистрация' : 'Вход'),
      h('p', { class: 'small muted' }, isReg ? 'Аккаунт хранит прогресс, слова и настройки на всех ваших устройствах и нужен для напоминаний. Уже накопленное на этом устройстве перенесётся в аккаунт.' : 'Войдите, чтобы прогресс был на всех ваших устройствах.'),
      tgHolder, orLine,
      h('div', { class: 'sheet' }, form),
      h('p', { class: 'small' }, isReg ? 'Уже есть аккаунт? ' : 'Нет аккаунта? ',
        h('button', { class: 'link', type: 'button', onclick: () => { ui.error = ''; window.KanaApp.open(isReg ? 'login' : 'register'); } }, isReg ? 'Войти' : 'Создать')));
    parts = { err, submit, tgHolder, orLine, isReg };
    updateAuthPage();
    if (tgEnabled === null) tgConfig().then(updateAuthPage);
  }
  function updateAuthPage() {
    if (!parts || !page || page.hidden) return;
    parts.err.hidden = !ui.error; parts.err.textContent = ui.error || '';
    parts.submit.disabled = !!ui.busy;
    parts.submit.textContent = ui.busy ? 'Подождите…' : parts.isReg ? 'Создать аккаунт' : 'Войти';
    parts.tgHolder.hidden = parts.orLine.hidden = !tgEnabled;
    if (tgEnabled) parts.tgHolder.querySelector('.tgslot').replaceChildren(tgBlock('login') || '');
  }
  const prevRerender = rerender;
  rerender = function () {
    if (page && !page.hidden && parts) { updateAuthPage(); return; }
    prevRerender();
  };

  // ---------- когда синхронизироваться ----------
  if (enabled) {
    window.addEventListener('online', () => touch());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') touch(); });
    setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 120000);
    if (account) setTimeout(() => { syncNow(); refreshMe(); }, 800);
  }

  return { touch, syncNow, renderAccount, renderAuthPage, api, refreshMe, get account() { return account; } };
})();
