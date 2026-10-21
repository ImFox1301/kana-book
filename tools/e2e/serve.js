// Локальный стенд для сквозных проверок: раздаёт dist/ и /api.
// API_URL=http://127.0.0.1:8080 — проксировать на настоящий kana-api; без него — встроенная заглушка с тем же протоколом.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../../dist');
const PORT = +process.env.PORT || 8790;
const API = process.env.API_URL;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };

// ---- заглушка API ----
const users = new Map(), sessions = new Map(), items = new Map(), pushSubs = new Map(), pushPrefs = new Map(); let seq = 0;
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
    return send(res, 201, { username: body.username, displayName: body.displayName.trim() }, newSession(u));
  }
  if (p === '/api/auth/login') {
    const u = users.get((body.username || '').toLowerCase());
    if (!u || u.pass !== body.password) return send(res, 401, { error: 'Неверный логин или пароль' });
    return send(res, 200, { username: u.name, displayName: u.displayName }, newSession(body.username.toLowerCase()));
  }
  if (p === '/api/auth/logout') { if (cookie) sessions.delete(cookie.split('=')[1]); return send(res, 200, { ok: true }, 'kana_session=; Path=/api; Max-Age=0'); }
  if (p === '/api/push/key') return send(res, 200, { key: PUSH_KEY });
  if (!uid) return send(res, 401, { error: 'Вы не вошли' });
  if (p.startsWith('/api/push/')) {
    const prefs = () => { const pr = pushPrefs.get(uid) || { enabled: false, time: '19:00', tz: null }; return Object.assign({}, pr, { devices: [...pushSubs.values()].filter(s => s.uid === uid).length }); };
    if (p === '/api/push/subscribe') {
      if (!/^https:\/\/fcm\.googleapis\.com\//.test(body.endpoint || '') || !body.keys || !body.keys.p256dh) return send(res, 400, { error: 'Некорректная подписка' });
      pushSubs.set(body.endpoint, { uid, endpoint: body.endpoint });
      pushPrefs.set(uid, { enabled: true, time: body.time || '19:00', tz: body.tz });
      return send(res, 200, prefs());
    }
    if (p === '/api/push/unsubscribe') { pushSubs.delete(body.endpoint); return send(res, 200, prefs()); }
    if (p === '/api/push/prefs') { if (req.method === 'POST') pushPrefs.set(uid, Object.assign(prefs(), Object.fromEntries(Object.entries(body).filter(([, v]) => v != null)))); return send(res, 200, prefs()); }
    if (p === '/api/push/test') return send(res, 200, { sent: prefs().devices });
  }
  if (p === '/api/auth/me') return send(res, 200, { username: users.get(uid).name, displayName: users.get(uid).displayName });
  if (p === '/api/auth/name') { const n = (body.displayName || '').trim(); if (!n) return send(res, 400, { error: 'Укажите, как к вам обращаться' }); users.get(uid).displayName = n; return send(res, 200, { username: users.get(uid).name, displayName: n }); }
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
