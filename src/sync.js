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
  let account = ls.get('account', null);   // { username }
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
  async function auth(kind, username, password) {
    ui.busy = true; ui.error = ''; rerender();
    const r = await api('/auth/' + kind, { username, password });
    ui.busy = false;
    if (r.status !== 200 && r.status !== 201) { ui.error = r.data.error || 'Не получилось, попробуйте ещё раз'; rerender(); return; }
    if (!r.data.username) { ui.error = 'Сервер аккаунтов пока недоступен. Занимайтесь без входа — данные сохраняются на устройстве.'; rerender(); return; }
    account = { username: r.data.username }; cursor = 0; snap = {}; lastSync = 0; saveState();
    ui.error = ''; ui.mode = 'login'; rerender();
    syncNow();
  }
  async function logout() {
    await syncNow();
    if (window.KanaPush) await window.KanaPush.forget();   // напоминания этого устройства привязаны к аккаунту
    await api('/auth/logout', {});
    account = null; cursor = 0; snap = {}; lastSync = 0; status = ''; saveState();
    window.KanaApp.resetLocal();
    ui.confirm = null; rerender();
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
  function rerender() { if (box && !box.closest('[hidden]')) renderAccount(box); }
  function renderAccount(el) {
    box = el;
    if (!enabled) { el.hidden = true; return; }
    el.hidden = false; el.replaceChildren();
    const add = (...xs) => el.append(...xs.filter(x => x != null && x !== false));
    if (!account) {
      const isReg = ui.mode === 'register';
      const user = h('input', { id: 'acc-user', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Логин', 'aria-label': 'Логин' });
      const pass = h('input', { id: 'acc-pass', type: 'password', autocomplete: isReg ? 'new-password' : 'current-password', placeholder: isReg ? 'Пароль, от 8 символов' : 'Пароль', 'aria-label': 'Пароль' });
      const form = h('form', { class: 'row', onsubmit: e => { e.preventDefault(); auth(isReg ? 'register' : 'login', user.value.trim(), pass.value); } },
        user, pass, h('button', { class: 'btn primary', type: 'submit', disabled: ui.busy }, isReg ? 'Создать аккаунт' : 'Войти'));
      add(
        h('div', {}, h('b', {}, 'Сохранять прогресс между устройствами'),
          h('div', { class: 'st' }, 'Без аккаунта всё хранится только на этом устройстве. Войдите, и слова, образцы почерка, настройки и история ответов будут на всех ваших устройствах. Уже накопленное здесь перенесётся в аккаунт.')),
        form,
        ui.error ? h('div', { class: 'err', role: 'alert' }, ui.error) : null,
        status ? h('div', { class: 'st' }, status) : null,
        h('div', { class: 'row' }, h('button', { class: 'link', type: 'button', onclick: () => { ui.mode = isReg ? 'login' : 'register'; ui.error = ''; rerender(); } },
          isReg ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Создать')));
      return;
    }
    el.append(h('div', { class: 'row', style: 'justify-content:space-between' },
      h('div', {}, h('span', { class: 'who' }, account.username),
        h('div', { class: 'st' }, status || ('Синхронизировано: ' + fmtTime(lastSync)))),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', type: 'button', disabled: running, onclick: () => syncNow() }, 'Синхронизировать'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { ui.confirm = 'logout'; ui.error = ''; rerender(); } }, 'Выйти'))));
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

  // ---------- когда синхронизироваться ----------
  if (enabled) {
    window.addEventListener('online', () => touch());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') touch(); });
    setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 120000);
    if (account) setTimeout(syncNow, 800);
  }

  return { touch, syncNow, renderAccount, api, get account() { return account; } };
})();
