package kana.api

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.sun.net.httpserver.HttpServer
import jakarta.servlet.http.Cookie
import kana.api.tg.TgService
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.context.TestPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import java.net.InetSocketAddress
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicLong
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@SpringBootTest
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestPropertySource(properties = ["kana.cookie-secure=false", "kana.register-per-hour=1000", "kana.login-per-minute=1000", "kana.sync-per-minute=1000",
    "kana.tg.token=TEST", "kana.tg.poll=false"])
class TelegramFriendsTest(@Autowired val mvc: MockMvc, @Autowired val om: ObjectMapper, @Autowired val tg: TgService, @Autowired val jdbc: JdbcTemplate) {

    companion object {
        /** поддельный Bot API: запоминает отправленные ботом сообщения */
        val sent = CopyOnWriteArrayList<JsonNode>()
        private val om = ObjectMapper()
        val server: HttpServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            createContext("/") { ex ->
                val method = ex.requestURI.path.substringAfterLast('/')
                val body = om.readTree(ex.requestBody.readAllBytes().let { if (it.isEmpty()) "{}".toByteArray() else it })
                if (method == "sendMessage" || method == "editMessageText") sent.add(om.createObjectNode().put("method", method).set<JsonNode>("body", body))
                val result: Any = if (method == "getMe") mapOf("username" to "kana_test_bot") else true
                val bytes = om.writeValueAsBytes(mapOf("ok" to true, "result" to result))
                ex.responseHeaders.add("Content-Type", "application/json"); ex.sendResponseHeaders(200, bytes.size.toLong()); ex.responseBody.write(bytes); ex.close()
            }
            start()
        }
        @JvmStatic @DynamicPropertySource
        fun props(r: DynamicPropertyRegistry) { r.add("kana.tg.api-base") { "http://127.0.0.1:${server.address.port}" } }
    }
    @AfterAll fun stop() = server.stop(0)

    private val updateId = AtomicLong(1)
    private fun json(b: MockHttpServletRequestBuilder, body: Any, c: Cookie? = null) = b.contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body)).also { if (c != null) it.cookie(c) }
    private fun res(b: MockHttpServletRequestBuilder) = mvc.perform(b).andReturn().response
    private fun body(b: MockHttpServletRequestBuilder) = om.readTree(res(b).contentAsString)

    private fun from(id: Long, first: String = "Иван", last: String? = "Петров", username: String? = null) =
        mapOf("id" to id, "first_name" to first, "last_name" to last, "username" to username).filterValues { it != null }
    private fun update(msg: Map<String, Any?>) = tg.handle(om.valueToTree(mapOf("update_id" to updateId.incrementAndGet(), "message" to msg)))
    private fun startCmd(tgId: Long, nonce: String) = update(mapOf("message_id" to 1, "chat" to mapOf("id" to tgId, "type" to "private"), "from" to from(tgId), "text" to "/start $nonce"))
    private fun contact(tgId: Long, owner: Long, phone: String = "+7 900 123-45-67") =
        update(mapOf("message_id" to 2, "chat" to mapOf("id" to tgId, "type" to "private"), "from" to from(tgId), "contact" to mapOf("phone_number" to phone, "first_name" to "Иван", "user_id" to owner)))
    private fun callback(tgId: Long, data: String) = tg.handle(om.valueToTree(mapOf("update_id" to updateId.incrementAndGet(),
        "callback_query" to mapOf("id" to "q1", "from" to from(tgId), "data" to data, "message" to mapOf("message_id" to 5, "chat" to mapOf("id" to tgId, "type" to "private"))))))
    private fun lastTo(tgId: Long) = sent.last { it["body"]["chat_id"].asLong() == tgId }["body"]

    private fun startLogin(): Pair<String, String> {
        val r = body(post("/api/tg/login"))
        assertTrue(r["link"].asText().startsWith("https://t.me/kana_test_bot?start="))
        return r["nonce"].asText() to r["secret"].asText()
    }
    private fun status(n: Pair<String, String>) = res(json(post("/api/tg/status"), mapOf("nonce" to n.first, "secret" to n.second)))

    private fun register(name: String = "Тест"): Pair<Cookie, Long> {
        val u = "u_" + UUID.randomUUID().toString().take(8)
        val r = res(json(post("/api/auth/register"), mapOf("username" to u, "password" to "secret-pass", "displayName" to name)))
        assertEquals(201, r.status)
        return r.getCookie("kana_session")!! to jdbc.queryForObject("select id from users where username = ?", Long::class.java, u)!!
    }
    private fun linkDirect(id: Long) = jdbc.update("update users set tg_id = ?, phone = '+70000000000' where id = ?", 900_000_000L + id, id)
    private fun username(id: Long) = jdbc.queryForObject("select username from users where id = ?", String::class.java, id)!!

    @Test
    fun `вход через Telegram — новый пользователь делится номером`() {
        val tgId = 7_000_000_000L + (System.nanoTime() % 1_000_000)
        val n = startLogin()
        assertEquals("new", om.readTree(status(n).contentAsString)["status"].asText())
        startCmd(tgId, n.first)
        assertTrue(lastTo(tgId)["reply_markup"]["keyboard"][0][0]["request_contact"].asBoolean(), "бот просит поделиться номером")
        assertEquals("need_contact", om.readTree(status(n).contentAsString)["status"].asText())
        contact(tgId, owner = 42)   // чужой контакт
        assertTrue(lastTo(tgId)["text"].asText().contains("собственный номер"))
        contact(tgId, owner = tgId)
        val ok = status(n)
        val j = om.readTree(ok.contentAsString)
        assertEquals("ok", j["status"].asText())
        assertEquals("Иван Петров", j["displayName"].asText())
        val c = assertNotNull(ok.getCookie("kana_session"))
        val me = body(get("/api/auth/me").cookie(c))
        assertTrue(me["linked"].asBoolean()); assertFalse(me["hasPassword"].asBoolean())
        assertEquals("+79001234567", jdbc.queryForObject("select phone from users where tg_id = ?", String::class.java, tgId))
        assertEquals("used", om.readTree(status(n).contentAsString)["status"].asText(), "повторно сессию не выдаёт")
        assertEquals(409, res(post("/api/auth/unlink-telegram").cookie(c)).status, "без пароля Telegram отвязать нельзя")

        // второй вход тем же Telegram — без номера, с подтверждением кнопкой
        val n2 = startLogin()
        startCmd(tgId, n2.first)
        // ту же ссылку открыли ещё раз и просто /start без кода — бот повторяет вопрос, а не «ссылка устарела»
        startCmd(tgId, n2.first)
        assertTrue(lastTo(tgId)["text"].asText().startsWith("Войти в Кана-тетрадь"), lastTo(tgId)["text"].asText())
        update(mapOf("message_id" to 3, "chat" to mapOf("id" to tgId, "type" to "private"), "from" to from(tgId), "text" to "/start"))
        assertTrue(lastTo(tgId)["text"].asText().startsWith("Войти в Кана-тетрадь"), lastTo(tgId)["text"].asText())
        assertEquals("ok:${n2.first}", lastTo(tgId)["reply_markup"]["inline_keyboard"][0][0]["callback_data"].asText())
        callback(tgId, "ok:${n2.first}")
        val ok2 = status(n2)
        startCmd(tgId, n2.first)
        assertTrue(lastTo(tgId)["text"].asText().contains("Вход уже выполнен"), lastTo(tgId)["text"].asText())
        assertEquals("ok", om.readTree(ok2.contentAsString)["status"].asText())
        assertEquals(me["username"].asText(), body(get("/api/auth/me").cookie(ok2.getCookie("kana_session")!!))["username"].asText(), "тот же аккаунт")

        // «Это не я»
        val n3 = startLogin()
        startCmd(tgId, n3.first); callback(tgId, "no:${n3.first}")
        assertEquals("denied", om.readTree(status(n3).contentAsString)["status"].asText())
        assertNull(status(n3).getCookie("kana_session"))
        // чужой секрет
        assertEquals(404, status(n3.first to "wrong").status)
    }

    @Test
    fun `привязка Telegram к аккаунту с паролем`() {
        val (c, id) = register("Анна")
        val tgId = 6_000_000_000L + (System.nanoTime() % 1_000_000)
        assertFalse(body(get("/api/auth/me").cookie(c))["linked"].asBoolean())
        val r = body(post("/api/tg/link").cookie(c))
        val n = r["nonce"].asText() to r["secret"].asText()
        startCmd(tgId, n.first)
        contact(tgId, tgId)
        assertEquals("linked", om.readTree(status(n).contentAsString)["status"].asText())
        val me = body(get("/api/auth/me").cookie(c))
        assertTrue(me["linked"].asBoolean()); assertTrue(me["hasPassword"].asBoolean())
        // вход через тот же Telegram — в этот же аккаунт
        val l = startLogin(); startCmd(tgId, l.first); callback(tgId, "ok:${l.first}")
        assertEquals(username(id), om.readTree(status(l).contentAsString)["username"].asText())
        // второй аккаунт к тому же Telegram не привязать
        val (c2, _) = register()
        val r2 = body(post("/api/tg/link").cookie(c2))
        startCmd(tgId, r2["nonce"].asText())
        assertEquals("error", om.readTree(status(r2["nonce"].asText() to r2["secret"].asText()).contentAsString)["status"].asText())
        assertTrue(lastTo(tgId)["text"].asText().contains("другому аккаунту"))
        // отвязать можно — есть пароль
        assertFalse(body(post("/api/auth/unlink-telegram").cookie(c))["linked"].asBoolean())
    }

    @Test
    fun `друзья — поиск по логину, заявка, приглашение, прогресс`() {
        val (ca, a) = register("Аня"); val (cb, b) = register("Боря"); val (cc, c) = register("Вика"); val (cd, d) = register("Гоша")
        linkDirect(a); linkDirect(b); linkDirect(d)
        assertEquals(403, res(get("/api/friends").cookie(cc)).status, "без привязки телефона друзья недоступны")
        assertEquals(404, res(json(post("/api/friends/search"), mapOf("q" to username(c)), ca)).status, "без телефона в поиске не виден")
        assertEquals(404, res(json(post("/api/friends/search"), mapOf("q" to username(b).take(5)), ca)).status, "только точный логин")
        val found = body(json(post("/api/friends/search"), mapOf("q" to "@" + username(b).uppercase()), ca))
        assertEquals("Боря", found["user"]["name"].asText()); assertEquals("none", found["state"].asText())
        body(json(post("/api/friends/request"), mapOf("userId" to b), ca))
        assertEquals("requested", body(json(post("/api/friends/search"), mapOf("q" to username(b)), ca))["state"].asText())
        val lb = body(get("/api/friends").cookie(cb))
        assertEquals("Аня", lb["incoming"][0]["name"].asText())
        assertFalse(lb["incoming"][0].has("phone"), "телефон друзьям не показывается")
        body(json(post("/api/friends/accept"), mapOf("userId" to a), cb))
        // прогресс друга
        mvc.perform(json(post("/api/sync"), mapOf("cursor" to 0, "changes" to listOf(
            mapOf("c" to "lessons", "id" to "h1", "t" to 1, "data" to mapOf("done" to 1700000000000L, "quiz" to 100)),
            mapOf("c" to "lessons", "id" to "k1", "t" to 1, "data" to mapOf("intro" to 1)),
            mapOf("c" to "lessons", "id" to "r-food", "t" to 1, "data" to mapOf("quiz" to 90)),
            mapOf("c" to "answers", "id" to "x1", "t" to 1, "data" to mapOf("ts" to System.currentTimeMillis(), "k" to "あ", "r" to "ok")),
            mapOf("c" to "answers", "id" to "x2", "t" to 1, "data" to mapOf("ts" to System.currentTimeMillis(), "k" to "い", "r" to "bad")))), ca))
        val fr = body(get("/api/friends").cookie(cb))["friends"]
        assertEquals(1, fr.size()); assertEquals("Аня", fr[0]["name"].asText())
        assertEquals(1, fr[0]["stats"]["lessonsH"].asInt()); assertEquals(0, fr[0]["stats"]["lessonsK"].asInt())
        assertEquals(2, fr[0]["stats"]["weekAnswers"].asInt()); assertEquals(50, fr[0]["stats"]["weekAccuracy"].asInt())
        // приглашение ссылкой — одноразовое
        val token = body(post("/api/friends/invite").cookie(ca))["token"].asText()
        assertEquals("friend", body(get("/api/friends/invite/$token").cookie(cb))["state"].asText())
        assertEquals("Аня", body(get("/api/friends/invite/$token").cookie(cd))["from"]["name"].asText())
        assertEquals(400, res(post("/api/friends/invite/$token/accept").cookie(ca)).status, "своё приглашение принять нельзя")
        assertEquals("Аня", body(post("/api/friends/invite/$token/accept").cookie(cd))["added"]["name"].asText())
        assertEquals(404, res(get("/api/friends/invite/$token").cookie(cb)).status, "приглашение использовано")
        assertEquals(2, body(get("/api/friends").cookie(ca))["friends"].size())
        // встречная заявка — сразу дружба; удаление
        body(json(post("/api/friends/request"), mapOf("userId" to b), cd))
        body(json(post("/api/friends/request"), mapOf("userId" to d), cb))
        assertEquals(2, body(get("/api/friends").cookie(cb))["friends"].size())
        body(json(post("/api/friends/remove"), mapOf("userId" to d), cb))
        assertEquals(1, body(get("/api/friends").cookie(cb))["friends"].size())
    }
}
