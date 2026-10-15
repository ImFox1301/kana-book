package kana.api

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.servlet.http.Cookie
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.context.TestPropertySource
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = ["kana.cookie-secure=false", "kana.register-per-hour=1000", "kana.login-per-minute=1000", "kana.sync-per-minute=1000"])
class ApiTest(@Autowired val mvc: MockMvc, @Autowired val om: ObjectMapper) {

    private fun uname() = "u_" + UUID.randomUUID().toString().take(8)

    private fun json(b: MockHttpServletRequestBuilder, body: Any, cookie: Cookie? = null) =
        b.contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body)).also { if (cookie != null) it.cookie(cookie) }

    private data class Res(val status: Int, val body: JsonNode?, val cookie: Cookie?)

    private fun call(b: MockHttpServletRequestBuilder): Res {
        val r = mvc.perform(b).andReturn().response
        val text = r.contentAsString
        return Res(r.status, if (text.isBlank()) null else om.readTree(text), r.getCookie("kana_session"))
    }

    private fun register(u: String, p: String = "secret-pass"): Cookie {
        val r = call(json(post("/api/auth/register"), mapOf("username" to u, "password" to p)))
        assertEquals(201, r.status, r.body.toString())
        return assertNotNull(r.cookie)
    }

    private fun sync(cookie: Cookie, cursor: Long, vararg changes: Map<String, Any?>) =
        call(json(post("/api/sync"), mapOf("cursor" to cursor, "changes" to changes.toList()), cookie))

    @Test
    fun `регистрация, вход, выход`() {
        val u = uname()
        val c = register(u)
        assertTrue(c.isHttpOnly)
        assertEquals(u, call(get("/api/auth/me").cookie(c)).body!!["username"].asText())

        assertEquals(409, call(json(post("/api/auth/register"), mapOf("username" to u.uppercase(), "password" to "another-pass"))).status)
        assertEquals(400, call(json(post("/api/auth/register"), mapOf("username" to "a", "password" to "secret-pass"))).status)
        assertEquals(400, call(json(post("/api/auth/register"), mapOf("username" to uname(), "password" to "short"))).status)

        assertEquals(401, call(json(post("/api/auth/login"), mapOf("username" to u, "password" to "wrong-pass"))).status)
        val login = call(json(post("/api/auth/login"), mapOf("username" to u.uppercase(), "password" to "secret-pass")))
        assertEquals(200, login.status)
        val c2 = assertNotNull(login.cookie)

        assertEquals(200, call(post("/api/auth/logout").cookie(c2)).status)
        assertEquals(401, call(get("/api/auth/me").cookie(c2)).status)
        assertEquals(200, call(get("/api/auth/me").cookie(c)).status)   // другая сессия жива
    }

    @Test
    fun `синхронизация между устройствами`() {
        val c = register(uname())
        val word = mapOf("kana" to "ねこ", "mean" to "кошка", "topic" to "Животные")

        val r1 = sync(c, 0, mapOf("c" to "words", "id" to "ねこ|кошка", "t" to 1000, "data" to word))
        assertEquals(200, r1.status, r1.body.toString())
        assertEquals(1, r1.body!!["items"].size())
        val cursor = r1.body["cursor"].asLong()

        // второе устройство получает всё с нуля
        val all = sync(c, 0).body!!
        assertEquals("ねこ", all["items"][0]["data"]["kana"].asText())

        // старое изменение не перезаписывает новое
        sync(c, cursor, mapOf("c" to "words", "id" to "ねこ|кошка", "t" to 500, "data" to mapOf("kana" to "ねこ", "mean" to "старое")))
        assertEquals("кошка", sync(c, 0).body!!["items"][0]["data"]["mean"].asText())

        // удаление новее — приходит как удалённое
        val r3 = sync(c, cursor, mapOf("c" to "words", "id" to "ねこ|кошка", "t" to 2000, "del" to true))
        val item = r3.body!!["items"].first { it["id"].asText() == "ねこ|кошка" }
        assertTrue(item["del"].asBoolean())
        assertTrue(r3.body["cursor"].asLong() > cursor)

        // без изменений и с актуальным курсором — пусто
        assertEquals(0, sync(c, r3.body["cursor"].asLong()).body!!["items"].size())

        // чужой пользователь ничего не видит
        assertEquals(0, sync(register(uname()), 0).body!!["items"].size())
    }

    @Test
    fun `защита`() {
        assertEquals(401, call(json(post("/api/sync"), mapOf("cursor" to 0))).status)
        val c = register(uname())
        assertEquals(400, sync(c, 0, mapOf("c" to "evil", "id" to "x", "t" to 1)).status)
        // запрос с чужого сайта
        val cross = json(post("/api/sync"), mapOf("cursor" to 0), c).header("Origin", "https://evil.example")
        assertEquals(403, call(cross).status)
        val same = json(post("/api/sync"), mapOf("cursor" to 0), c).header("Origin", "http://localhost")
        assertEquals(200, call(same).status)
    }

    @Test
    fun `удаление аккаунта`() {
        val u = uname()
        val c = register(u)
        sync(c, 0, mapOf("c" to "settings", "id" to "main", "t" to 1, "data" to mapOf("sys" to "ru")))
        assertEquals(403, call(json(post("/api/auth/delete"), mapOf("password" to "wrong-pass"), c)).status)
        assertEquals(200, call(json(post("/api/auth/delete"), mapOf("password" to "secret-pass"), c)).status)
        assertEquals(401, call(json(post("/api/auth/login"), mapOf("username" to u, "password" to "secret-pass"))).status)
    }
}
