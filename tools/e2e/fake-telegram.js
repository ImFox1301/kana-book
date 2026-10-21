// Поддельный Telegram Bot API для сквозных проверок с настоящим kana-api:
//   java -Dkana.tg.token=test -Dkana.tg.api-base=http://127.0.0.1:8792 -jar kana-api.jar
// Тест «пишет боту» через POST /__tg/send (тело — объект update без update_id) и читает ответы бота через GET /__tg/sent.
const http = require('http');
const PORT = +process.env.TG_PORT || 8792;
const queue = [], sent = [];
let nextId = 1, waiting = [];

function reply(res, result) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, result })); }
function flush() {
  for (const w of waiting.splice(0)) { clearTimeout(w.t); w.done(); }
}

http.createServer((req, res) => {
  let data = ''; req.on('data', c => data += c);
  req.on('end', () => {
    const body = data ? JSON.parse(data) : {};
    if (req.url === '/__tg/send') { queue.push(Object.assign({ update_id: nextId++ }, body)); flush(); return reply(res, true); }
    if (req.url === '/__tg/sent') return reply(res, sent);
    const method = req.url.split('/').pop();
    if (method === 'getMe') return reply(res, { id: 1, is_bot: true, username: 'kana_test_bot' });
    if (method === 'getUpdates') {
      const take = () => queue.filter(u => u.update_id >= (body.offset || 0));
      if (take().length) return reply(res, take());
      const w = { done: () => reply(res, take()) };
      w.t = setTimeout(() => { waiting = waiting.filter(x => x !== w); w.done(); }, 1000);   // короткий long polling — тесты быстрее
      waiting.push(w);
      return;
    }
    if (method === 'sendMessage' || method === 'editMessageText') sent.push(Object.assign({ method }, body));
    reply(res, true);
  });
}).listen(PORT, '127.0.0.1', () => console.log('поддельный Telegram: http://127.0.0.1:' + PORT));
