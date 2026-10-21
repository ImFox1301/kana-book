// Локальный стенд для сквозных проверок: раздаёт dist/ и /api.
// API_URL=http://127.0.0.1:8080 — проксировать на настоящий kana-api; без него — встроенная заглушка с тем же протоколом.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../../dist');
const PORT = +process.env.PORT || 8790;
const API = process.env.API_URL;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };

// ---- заглушка API ----
const users = new Map(), sessions = new Map(), items = new Map(), pushSubs = new Map(), pushPrefs = new Map(); let seq = 0;
// Telegram и друзья (заглушка повторяет логику сервера в упрощённом виде)
const tgLogins = new Map(), tgSent = [], friendsSet = new Set(), friendReq = new Set(), invites = new Map();
const avatarOf = u => users.get(u).avatar ? '/api/avatar/' + encodeURIComponent(u) + '?v=' + users.get(u).avVer : null;
const meOf = u => { const x = users.get(u); return { username: x.name, displayName: x.displayName, linked: !!x.tgId, telegram: x.tgUser || null, hasPassword: !!x.pass, avatar: avatarOf(u) }; };
const fkey = (a, b) => [a, b].sort().join('|');
const personOf = u => ({ id: u, name: users.get(u).displayName || users.get(u).name, username: users.get(u).name, avatar: avatarOf(u) });
const zeroStats = { streak: 0, todayMin: 0, todayCards: 0, goalMin: 30, goalCards: 50, lessonsH: 0, lessonsK: 0, weekAnswers: 0, weekAccuracy: null };
function friendsOf(u) {
  const fr = [...friendsSet].filter(k => k.split('|').includes(u)).map(k => k.split('|').find(x => x !== u));
  return { friends: fr.map(f => Object.assign(personOf(f), { since: 0, stats: Object.assign({}, zeroStats, { weekAnswers: [...items.values()].filter(i => i.uid === f && i.c === 'answers').length }) })),
    incoming: [...friendReq].filter(k => k.endsWith('>' + u)).map(k => personOf(k.split('>')[0])),
    outgoing: [...friendReq].filter(k => k.startsWith(u + '>')).map(k => personOf(k.split('>')[1])), me: zeroStats };
}
const userByTg = id => [...users.keys()].find(u => users.get(u).tgId === id);
function tgReply(chat, text, markup) { tgSent.push({ chat_id: chat, text, reply_markup: markup }); }
function tgHandle(u) {
  if (u.callback_query) {
    const q = u.callback_query, nonce = q.data.slice(3), r = tgLogins.get(nonce);
    if (r && r.status === 'confirm' && r.tgId === q.from.id) { if (q.data.startsWith('ok:')) { r.status = 'approved'; r.result = userByTg(q.from.id); } else r.status = 'denied'; }
    return;
  }
  const m = u.message, from = m.from;
  if (m.contact) {
    const r = [...tgLogins.values()].reverse().find(x => x.tgId === from.id && x.status === 'need_contact');
    if (!r) return tgReply(from.id, 'Ссылка устарела');
    if (m.contact.user_id !== from.id) return tgReply(from.id, 'Нужен ваш собственный номер');
    if (r.kind === 'login') {
      let id = userByTg(from.id);
      if (!id) { id = (from.username || 'tg' + from.id).toLowerCase(); users.set(id, { name: from.username || id, pass: null, displayName: [from.first_name, from.last_name].filter(Boolean).join(' '), tgId: from.id, tgUser: from.username }); }
      r.status = 'approved'; r.result = id;
    } else { const x = users.get(r.user); x.tgId = from.id; x.tgUser = from.username; r.status = 'approved'; r.result = r.user; }
    return tgReply(from.id, 'Готово!');
  }
  const nonce = (m.text || '').replace('/start', '').trim(), r = tgLogins.get(nonce);
  if (!r) return tgReply(from.id, 'Ссылка не найдена');
  if (r.status !== 'new') {   // ту же ссылку открыли ещё раз — повторить вопрос
    if (r.tgId === from.id && r.status === 'confirm') return tgReply(from.id, 'Войти в Кана-тетрадь?', { inline_keyboard: [[{ text: 'Войти', callback_data: 'ok:' + nonce }]] });
    if (r.tgId === from.id && r.status === 'need_contact') return tgReply(from.id, 'Поделитесь номером', { keyboard: [[{ text: 'Поделиться номером', request_contact: true }]] });
    return tgReply(from.id, r.status === 'approved' || r.status === 'done' ? 'Вход уже выполнен' : 'Ссылка устарела');
  }
  r.tgId = from.id;
  const owner = userByTg(from.id);
  if (r.kind === 'login') { r.status = owner ? 'confirm' : 'need_contact'; tgReply(from.id, owner ? 'Войти в Кана-тетрадь?' : 'Поделитесь номером', owner ? { inline_keyboard: [[{ text: 'Войти', callback_data: 'ok:' + nonce }, { text: 'Это не я', callback_data: 'no:' + nonce }]] } : { keyboard: [[{ text: 'Поделиться номером', request_contact: true }]] }); }
  else if (owner && owner !== r.user) { r.status = 'error'; r.message = 'Этот Telegram уже привязан к другому аккаунту'; }
  else if (owner) { r.status = 'approved'; r.result = r.user; }
  else { r.status = 'need_contact'; tgReply(from.id, 'Поделитесь номером', { keyboard: [[{ text: 'Поделиться номером', request_contact: true }]] }); }
}
function tgStart(kind, user) {
  const nonce = crypto.randomBytes(12).toString('base64url'), secret = crypto.randomBytes(16).toString('base64url');
  tgLogins.set(nonce, { kind, user, secret, status: 'new' });
  return { nonce, secret, link: 'https://t.me/kana_test_bot?start=' + nonce };
}
const PUSH_KEY = Buffer.concat([Buffer.from([4]), crypto.randomBytes(64)]).toString('base64url');
const send = (res, status, body, cookie) => { res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, cookie ? { 'Set-Cookie': cookie } : {})); res.end(JSON.stringify(body)); };
function mock(req, res, body) {
  const cookie = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith('kana_session='));
  const uid = cookie ? sessions.get(cookie.split('=')[1]) : undefined;
  const p = req.url;
  const newSession = u => { const t = crypto.randomBytes(16).toString('hex'); sessions.set(t, u); return `kana_session=${t}; Path=/api; HttpOnly; SameSite=Strict`; };
  if (p === '/api/auth/register') {
    const u = body.username.toLowerCase();
    if (users.has(u)) return send(res, 409, { error: 'Этот логин уже занят' });
    if (body.password.length < 8) return send(res, 400, { error: 'Пароль должен быть не короче 8 символов' });
    if (!(body.displayName || '').trim()) return send(res, 400, { error: 'Укажите, как к вам обращаться' });
    users.set(u, { name: body.username, pass: body.password, displayName: body.displayName.trim() });
    return send(res, 201, meOf(u), newSession(u));
  }
  if (p === '/api/auth/login') {
    const u = users.get((body.username || '').toLowerCase());
    if (!u || !u.pass || u.pass !== body.password) return send(res, 401, { error: 'Неверный логин или пароль' });
    return send(res, 200, meOf(body.username.toLowerCase()), newSession(body.username.toLowerCase()));
  }
  if (p === '/api/auth/logout') { if (cookie) sessions.delete(cookie.split('=')[1]); return send(res, 200, { ok: true }, 'kana_session=; Path=/api; Max-Age=0'); }
  if (p === '/api/push/key') return send(res, 200, { key: PUSH_KEY });
  if (p === '/api/tg/config') return send(res, 200, { enabled: true });
  if (p === '/api/tg/login') return send(res, 200, tgStart('login', null));
  if (p === '/api/tg/status') {
    const r = tgLogins.get(body.nonce);
    if (!r || r.secret !== body.secret) return send(res, 404, { error: 'не найдено' });
    if (r.status === 'approved' && r.kind === 'login') { r.status = 'done'; return send(res, 200, Object.assign({ status: 'ok' }, meOf(r.result)), newSession(r.result)); }
    return send(res, 200, { status: r.status === 'approved' ? 'linked' : r.status === 'done' ? 'used' : r.status, message: r.message || null });
  }
  if (!uid) return send(res, 401, { error: 'Вы не вошли' });
  if (p.startsWith('/api/push/')) {
    const prefs = () => { const pr = pushPrefs.get(uid) || { enabled: false, time: '19:00', tz: null }; return Object.assign({}, pr, { devices: [...pushSubs.values()].filter(s => s.uid === uid).length }); };
    if (p === '/api/push/subscribe') {
      if (!/^https:\/\/fcm\.googleapis\.com\//.test(body.endpoint || '') || !body.keys || !body.keys.p256dh) return send(res, 400, { error: 'Некорректная подписка' });
      pushSubs.set(body.endpoint, { uid, endpoint: body.endpoint });
      const old = pushPrefs.get(uid);
      pushPrefs.set(uid, { enabled: body.remind != null ? body.remind : old ? old.enabled : false, time: body.time || (old && old.time) || '19:00', tz: body.tz });
      return send(res, 200, prefs());
    }
    if (p === '/api/push/unsubscribe') { pushSubs.delete(body.endpoint); return send(res, 200, prefs()); }
    if (p === '/api/push/prefs') { if (req.method === 'POST') pushPrefs.set(uid, Object.assign(prefs(), Object.fromEntries(Object.entries(body).filter(([, v]) => v != null)))); return send(res, 200, prefs()); }
    if (p === '/api/push/test') return send(res, 200, { sent: prefs().devices });
  }
  if (p === '/api/auth/me') return send(res, 200, meOf(uid));
  if (p === '/api/auth/name') { const n = (body.displayName || '').trim(); if (!n) return send(res, 400, { error: 'Укажите, как к вам обращаться' }); users.get(uid).displayName = n; return send(res, 200, meOf(uid)); }
  if (p === '/api/auth/avatar') { const x = users.get(uid); x.avatar = Buffer.from(String(body.data).split('base64,').pop(), 'base64'); x.avVer = (x.avVer || 0) + 1; return send(res, 200, meOf(uid)); }
  if (p === '/api/auth/avatar/delete') { const x = users.get(uid); x.avatar = null; x.avVer = (x.avVer || 0) + 1; return send(res, 200, meOf(uid)); }
  if (p.startsWith('/api/avatar/')) { const x = users.get(decodeURIComponent(p.split('/')[3].split('?')[0])); if (!x || !x.avatar) return send(res, 404, {}); res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(x.avatar); }
  if (p === '/api/auth/unlink-telegram') { const x = users.get(uid); if (!x.pass) return send(res, 409, { error: 'нельзя' }); x.tgId = null; x.tgUser = null; return send(res, 200, meOf(uid)); }
  if (p === '/api/tg/link') return send(res, 200, tgStart('link', uid));
  if (p.startsWith('/api/friends')) {
    if (p === '/api/friends') return send(res, 200, friendsOf(uid));
    if (p === '/api/friends/search') {
      const t = (body.q || '').trim().replace(/^@/, '').toLowerCase(), x = users.get(t);
      if (!x) return send(res, 404, { error: 'Никого не нашли' });
      const state = t === uid ? 'me' : friendsSet.has(fkey(uid, t)) ? 'friend' : friendReq.has(uid + '>' + t) ? 'requested' : friendReq.has(t + '>' + uid) ? 'incoming' : 'none';
      return send(res, 200, { user: personOf(t), state });
    }
    const other = body.userId;
    if (p === '/api/friends/request') { if (friendReq.has(other + '>' + uid)) { friendReq.delete(other + '>' + uid); friendsSet.add(fkey(uid, other)); } else friendReq.add(uid + '>' + other); return send(res, 200, friendsOf(uid)); }
    if (p === '/api/friends/accept') { friendReq.delete(other + '>' + uid); friendsSet.add(fkey(uid, other)); return send(res, 200, friendsOf(uid)); }
    if (p === '/api/friends/decline') { friendReq.delete(other + '>' + uid); return send(res, 200, friendsOf(uid)); }
    if (p === '/api/friends/cancel') { friendReq.delete(uid + '>' + other); return send(res, 200, friendsOf(uid)); }
    if (p === '/api/friends/remove') { friendsSet.delete(fkey(uid, other)); return send(res, 200, friendsOf(uid)); }
    if (p === '/api/friends/invite') { const t = crypto.randomBytes(12).toString('base64url'); invites.set(t, uid); return send(res, 200, { token: t }); }
    const m = p.match(/^\/api\/friends\/invite\/([^/]+)(\/accept)?$/);
    if (m) {
      const from = invites.get(decodeURIComponent(m[1]));
      if (!from) return send(res, 404, { error: 'Приглашение не найдено или устарело' });
      if (!m[2]) return send(res, 200, { from: personOf(from), state: from === uid ? 'me' : friendsSet.has(fkey(uid, from)) ? 'friend' : 'new' });
      if (from === uid) return send(res, 400, { error: 'Это ваше собственное приглашение' });
      invites.delete(decodeURIComponent(m[1])); friendsSet.add(fkey(uid, from));
      return send(res, 200, Object.assign(friendsOf(uid), { added: personOf(from) }));
    }
  }
  if (p === '/api/sync') {
    for (const ch of body.changes || []) {
      const k = uid + '\u0000' + ch.c + '\u0000' + ch.id, cur = items.get(k);
      if (!cur || cur.t < ch.t) items.set(k, { c: ch.c, id: ch.id, t: ch.t, del: !!ch.del || ch.data == null, data: ch.del ? null : ch.data, seq: ++seq, uid });
    }
    const all = [...items.values()].filter(i => i.uid === uid && i.seq > body.cursor).sort((a, b) => a.seq - b.seq);
    const page = all.slice(0, 1000);
    return send(res, 200, { cursor: page.length ? page[page.length - 1].seq : body.cursor, items: page.map(({ uid, seq, ...r }) => r), more: all.length > 1000 });
  }
  send(res, 404, { error: 'нет такого метода' });
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/tts') && !API) {   // заглушка озвучки: любой mp3
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000, immutable' });
    return fs.createReadStream(path.join(ROOT, 'audio/m/あ.mp3')).pipe(res);
  }
  // управление «ботом» из тестов — как у tools/e2e/fake-telegram.js
  if (req.url.startsWith('/__tg/') && !API) {
    let data = ''; req.on('data', c => data += c);
    req.on('end', () => {
      if (req.url === '/__tg/send') { tgHandle(JSON.parse(data)); return send(res, 200, { ok: true }); }
      if (req.url === '/__tg/sent') return send(res, 200, tgSent);
      send(res, 404, {});
    });
    return;
  }
  if (req.url.startsWith('/api/')) {
    if (API) {
      const u = new URL(req.url, API);
      const pr = http.request(u, { method: req.method, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      pr.on('error', () => send(res, 502, { error: 'API недоступно' }));
      req.pipe(pr);
      return;
    }
    let data = ''; req.on('data', c => data += c); req.on('end', () => mock(req, res, data ? JSON.parse(data) : {}));
    return;
  }
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) f = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`стенд: http://localhost:${PORT} (${API ? 'API ' + API : 'заглушка API'})`));
