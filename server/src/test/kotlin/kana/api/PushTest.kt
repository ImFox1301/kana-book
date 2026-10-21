package kana.api

import com.fasterxml.jackson.databind.ObjectMapper
import com.sun.net.httpserver.HttpServer
import jakarta.servlet.http.Cookie
import kana.api.push.PushService
import kana.api.push.WebPush
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.context.TestPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import java.net.InetSocketAddress
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@SpringBootTest
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestPropertySource(properties = ["kana.cookie-secure=false", "kana.register-per-hour=1000", "kana.login-per-minute=1000", "kana.sync-per-minute=1000",
    "kana.push.extra-hosts=127.0.0.1", "kana.push.allow-http=true", "kana.push.tick-ms=3600000", "kana.push.subject=https://kana.example"])
class PushTest(@Autowired val mvc: MockMvc, @Autowired val om: ObjectMapper, @Autowired val push: PushService, @Autowired val jdbc: org.springframework.jdbc.core.JdbcTemplate) {

    /** «push-сервис»: принимает сообщения как FCM; путь /gone/… отвечает 410 */
    data class Got(val path: String, val headers: Map<String, String>, val body: ByteArray)
    private val got = CopyOnWriteArrayList<Got>()
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { ex ->
            got += Got(ex.requestURI.path, ex.requestHeaders.mapValues { it.value.first() }.mapKeys { it.key.lowercase() }, ex.requestBody.readAllBytes())
            ex.sendResponseHeaders(if (ex.requestURI.path.startsWith("/gone")) 410 else 201, -1); ex.close()
        }
        start()
    }
    private val base = "http://127.0.0.1:${server.address.port}"
    @AfterAll fun stop() = server.stop(0)

    /** «браузер»: свои ключи подписки */
    private val ua = WebPush.newKeyPair()
    private val uaPub = WebPush.raw(ua.public as ECPublicKey)
    private val authSecret = ByteArray(16).also(SecureRandom()::nextBytes)

    private fun json(b: MockHttpServletRequestBuilder, body: Any, c: Cookie) = b.contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body)).cookie(c)
    private fun register(): Pair<Cookie, Long> {
        val name = "p_" + UUID.randomUUID().toString().take(8)
        val r = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(mapOf("username" to name, "password" to "secret-pass", "displayName" to "Тест")))).andReturn().response
        assertEquals(201, r.status)
        return r.getCookie("kana_session")!! to jdbc.queryForObject("select id from users where username = ?", Long::class.java, name)!!
    }
    private fun subscribe(c: Cookie, path: String, time: String = "19:00", tz: String = "Europe/Moscow") =
        mvc.perform(json(post("/api/push/subscribe"), mapOf("endpoint" to base + path, "keys" to mapOf("p256dh" to WebPush.b64(uaPub), "auth" to WebPush.b64(authSecret)), "time" to time, "tz" to tz, "remind" to true), c)).andReturn().response

    @Test
    fun `шифрование и подпись совместимы с браузером`() {
        val msg = "Привет, 日本語".toByteArray()
        val enc = WebPush.encrypt(msg, WebPush.b64(uaPub), WebPush.b64(authSecret))
        assertEquals(String(msg), String(WebPush.decrypt(enc, ua.private, uaPub, authSecret)))
        val kp = WebPush.newKeyPair(); val pub = WebPush.raw(kp.public as ECPublicKey)
        val header = WebPush.vapid("https://fcm.googleapis.com", "https://kana.example", kp.private, pub)
        val jwt = header.substringAfter("t=").substringBefore(",")
        assertTrue(WebPush.verifyJwt(jwt, pub))
        assertTrue(header.endsWith("k=" + WebPush.b64(pub)))
    }

    @Test
    fun `подписка, проверочное сообщение, удаление недействительной подписки`() {
        val (c, _) = register()
        val key = om.readTree(mvc.perform(get("/api/push/key")).andReturn().response.contentAsString)["key"].asText()
        assertEquals(65, WebPush.unb64(key).size)
        // чужие адреса не принимаются
        val bad = mvc.perform(json(post("/api/push/subscribe"), mapOf("endpoint" to "https://evil.example/x", "keys" to mapOf("p256dh" to WebPush.b64(uaPub), "auth" to WebPush.b64(authSecret))), c)).andReturn().response
        assertEquals(400, bad.status)
        assertEquals(200, subscribe(c, "/ok/" + UUID.randomUUID()).status)
        assertEquals(200, subscribe(c, "/gone/" + UUID.randomUUID()).status)
        got.clear()
        val r = om.readTree(mvc.perform(post("/api/push/test").cookie(c)).andReturn().response.contentAsString)
        assertEquals(1, r["sent"].asInt())
        val m = got.first { it.path.startsWith("/ok") }
        assertEquals("aes128gcm", m.headers["content-encoding"])
        assertNotNull(m.headers["ttl"])
        val jwt = m.headers["authorization"]!!.substringAfter("t=").substringBefore(",")
        assertTrue(WebPush.verifyJwt(jwt, WebPush.unb64(key)), "подпись VAPID проверяется открытым ключом сервера")
        assertTrue(String(WebPush.unb64(jwt.split('.')[1])).contains("\"aud\":\"$base\""))
        val payload = om.readTree(WebPush.decrypt(m.body, ua.private, uaPub, authSecret))
        assertTrue(payload["body"].asText().contains("Напоминания работают"))
        // подписка /gone ответила 410 — удалена
        assertEquals(1, om.readTree(mvc.perform(get("/api/push/prefs").cookie(c)).andReturn().response.contentAsString)["devices"].asInt())
        // без входа — нельзя
        assertEquals(401, mvc.perform(post("/api/push/test")).andReturn().response.status)
    }

    @Test
    fun `напоминание в выбранное время, один раз и только если цель не выполнена`() {
        val (c, userId) = register()
        val zone = ZoneId.of("Asia/Tokyo")
        assertEquals(200, subscribe(c, "/ok/" + UUID.randomUUID(), "20:30", "Asia/Tokyo").status)
        val day = ZonedDateTime.of(2026, 10, 21, 0, 0, 0, 0, zone)
        val mine = { got.filter { it.path.startsWith("/ok") } }
        got.clear()
        push.remind(day.withHour(20).withMinute(0).toInstant())
        assertTrue(mine().isEmpty(), "до 20:30 по Токио — рано")
        push.remind(day.withHour(20).withMinute(35).toInstant())
        assertEquals(1, mine().size)
        val text = om.readTree(WebPush.decrypt(mine()[0].body, ua.private, uaPub, authSecret))["body"].asText()
        assertTrue(text.contains("Сегодня ещё не было занятий"), text)
        push.remind(day.withHour(21).toInstant())
        assertEquals(1, mine().size, "второй раз за день не напоминает")

        // на следующий день цель выполнена — напоминания нет; текст для невыполненной — сколько осталось
        val next = day.plusDays(1)
        mvc.perform(json(post("/api/sync"), mapOf("cursor" to 0, "changes" to listOf(
            mapOf("c" to "settings", "id" to "main", "t" to 1, "data" to mapOf("goal" to mapOf("min" to 10, "cards" to 20))),
            mapOf("c" to "activity", "id" to "2026-10-22|a", "t" to 1, "data" to mapOf("d" to "2026-10-22", "s" to 400, "c" to 15)),
            mapOf("c" to "activity", "id" to "2026-10-22|b", "t" to 1, "data" to mapOf("d" to "2026-10-22", "s" to 300, "c" to 10)))), c))
        assertNull(push.reminderFor(userId, next.toLocalDate()), "11 минут и 25 карточек при цели 10 и 20 — выполнено")
        push.remind(next.withHour(20).withMinute(40).toInstant())
        assertEquals(1, mine().size, "цель выполнена — не напоминает")
    }

    @Test
    fun `выключенные напоминания не приходят`() {
        val (c, _) = register()
        assertEquals(200, subscribe(c, "/ok/" + UUID.randomUUID(), "08:00", "UTC").status)
        mvc.perform(json(post("/api/push/prefs"), mapOf("enabled" to false), c))
        got.clear()
        push.remind(ZonedDateTime.of(2026, 10, 21, 8, 5, 0, 0, ZoneId.of("UTC")).toInstant())
        assertFalse(got.any { it.path.startsWith("/ok") })
        assertEquals(400, mvc.perform(json(post("/api/push/prefs"), mapOf("tz" to "Mars/Base"), c)).andReturn().response.status)
    }
}
