package kana.api.tg

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.servlet.http.HttpServletRequest
import kana.api.ApiException
import kana.api.auth.RateLimiter
import kana.api.auth.SessionService
import kana.api.auth.userId
import org.slf4j.LoggerFactory
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.context.event.EventListener
import org.springframework.dao.DuplicateKeyException
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Duration
import java.util.Base64

@ConfigurationProperties("kana.tg")
data class TgProps(
    /** токен бота от @BotFather; пусто — вход через Telegram выключен */
    val token: String = "",
    val apiBase: String = "https://api.telegram.org",
    /** опрашивать Telegram (long polling); в тестах обновления подаются напрямую */
    val poll: Boolean = true,
    /** сколько живёт ссылка входа */
    val ttlMinutes: Long = 15,
    /** попыток входа через Telegram с одного адреса за 10 минут (экран входа создаёт попытку заранее) */
    val loginLimit: Int = 40,
) { val enabled get() = token.isNotBlank() }

/** Bot API: вызовы методов. Опрос (long polling) — сервер сам забирает сообщения, входящий доступ не нужен. */
@Component
class TgApi(private val props: TgProps, private val mapper: ObjectMapper) {
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
    @Volatile private var name: String? = null

    fun call(method: String, body: Map<String, Any?>, timeoutSec: Long = 15): JsonNode {
        val req = HttpRequest.newBuilder(URI("${props.apiBase.trimEnd('/')}/bot${props.token}/$method"))
            .timeout(Duration.ofSeconds(timeoutSec)).header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body.filterValues { it != null }))).build()
        val res = http.send(req, HttpResponse.BodyHandlers.ofString())
        val json = mapper.readTree(res.body())
        if (!json.path("ok").asBoolean()) throw IllegalStateException("Telegram $method: ${json.path("description").asText(res.statusCode().toString())}")
        return json["result"]
    }

    /** имя бота для ссылки t.me/<имя> */
    fun botName(): String = name ?: call("getMe", emptyMap())["username"].asText().also { name = it }

    fun send(chat: Long, text: String, markup: Any? = null) = runCatching { call("sendMessage", mapOf("chat_id" to chat, "text" to text, "reply_markup" to markup)) }
}

data class StartResponse(val nonce: String, val secret: String, val link: String)
data class StatusRequest(val nonce: String = "", val secret: String = "")

@Service
class TgService(private val jdbc: JdbcTemplate, private val api: TgApi, private val props: TgProps, private val mapper: ObjectMapper) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val rnd = SecureRandom()
    private val b64 = Base64.getUrlEncoder().withoutPadding()
    private val unusable = "!telegram"   // у аккаунтов из Telegram нет пароля: BCrypt никогда не совпадёт
    private fun sha(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray())
    private fun token(n: Int) = b64.encodeToString(ByteArray(n).also(rnd::nextBytes))

    fun start(kind: String, userId: Long?): StartResponse {
        if (!props.enabled) throw ApiException(HttpStatus.SERVICE_UNAVAILABLE, "Вход через Telegram не настроен")
        jdbc.update("delete from tg_logins where created_at < now() - interval '1 day'")
        val nonce = token(18); val secret = token(24)
        jdbc.update("insert into tg_logins (nonce, secret_hash, kind, user_id) values (?, ?, ?, ?)", nonce, sha(secret), kind, userId)
        return StartResponse(nonce, secret, "https://t.me/${api.botName()}?start=$nonce")
    }

    data class Row(val nonce: String, val kind: String, val userId: Long?, val tgId: Long?, val status: String, val message: String?, val resultUserId: Long?, val fresh: Boolean)
    private fun row(where: String, vararg args: Any): Row? = jdbc.query(
        "select nonce, kind, user_id, tg_id, status, message, result_user_id, created_at > now() - make_interval(mins => ${props.ttlMinutes.toInt()}) as fresh from tg_logins where $where",
        { rs, _ -> Row(rs.getString(1), rs.getString(2), rs.getObject(3) as Long?, rs.getObject(4) as Long?, rs.getString(5), rs.getString(6), rs.getObject(7) as Long?, rs.getBoolean(8)) }, *args,
    ).firstOrNull()
    private fun set(nonce: String, status: String, message: String? = null, tgId: Long? = null, result: Long? = null) =
        jdbc.update("update tg_logins set status = ?, message = coalesce(?, message), tg_id = coalesce(?, tg_id), result_user_id = coalesce(?, result_user_id) where nonce = ?", status, message, tgId, result, nonce)

    /** Состояние попытки для браузера, который её начал. Для входа при успехе — id пользователя (сессию создаст контроллер). */
    fun status(nonce: String, secret: String): Row {
        val r = row("nonce = ? and secret_hash = ?", nonce, sha(secret)) ?: throw ApiException(HttpStatus.NOT_FOUND, "Попытка входа не найдена")
        if (!r.fresh && r.status !in setOf("approved", "done")) return r.copy(status = "expired")
        return r
    }
    fun markDone(nonce: String) = jdbc.update("update tg_logins set status = 'done' where nonce = ? and status = 'approved'", nonce)

    // ---------- сообщения боту ----------
    private val contactKeyboard = mapOf("keyboard" to listOf(listOf(mapOf("text" to "Поделиться номером", "request_contact" to true))), "resize_keyboard" to true, "one_time_keyboard" to true)
    private val noKeyboard = mapOf("remove_keyboard" to true)

    fun handle(u: JsonNode) {
        try {
            u["callback_query"]?.let { return onCallback(it) }
            val m = u["message"] ?: return
            val from = m["from"] ?: return
            val chat = m["chat"]["id"].asLong()
            if (m["chat"]["type"]?.asText() != "private") return
            m["contact"]?.let { return onContact(chat, from, it) }
            val text = m["text"]?.asText() ?: return
            if (text.startsWith("/start")) onStart(chat, from, text.removePrefix("/start").trim())
            else api.send(chat, "Это бот KANA. Чтобы войти, откройте приложение → «Профиль» → «Войти».")
        } catch (e: Exception) { log.warn("telegram update: {}", e.message) }
    }

    private fun userByTg(tgId: Long) = jdbc.queryForList("select id, coalesce(display_name, username) as name from users where tg_id = ?", tgId).firstOrNull()

    private fun confirmMarkup(nonce: String) = mapOf("inline_keyboard" to listOf(listOf(
        mapOf("text" to "Войти", "callback_data" to "ok:$nonce"), mapOf("text" to "Это не я", "callback_data" to "no:$nonce"))))

    /** Подсказка для незавершённой попытки: повторный /start не должен её «ломать». */
    private fun prompt(chat: Long, r: Row) {
        val linked = r.tgId?.let(::userByTg)
        when (r.status) {
            "confirm" -> api.send(chat, "Войти в KANA как «${linked?.get("name") ?: "вы"}»?\nЕсли вы не начинали вход сами, нажмите «Это не я».", confirmMarkup(r.nonce))
            "need_contact" -> api.send(chat, if (r.kind == "login")
                "Чтобы войти, поделитесь номером телефона — нажмите кнопку ниже. Номер нужен, чтобы привязать к нему аккаунт; другим пользователям он не показывается."
                else "Чтобы привязать номер телефона к аккаунту, нажмите кнопку ниже. Другим пользователям номер не показывается.", contactKeyboard)
        }
    }

    private fun onStart(chat: Long, from: JsonNode, nonce: String) {
        val tgId = from["id"].asLong()
        // /start без кода (или код потерялся): продолжить незавершённый вход этого пользователя, если он есть
        val r = if (nonce.isNotEmpty()) row("nonce = ?", nonce)
                else row("tg_id = ? and status in ('need_contact', 'confirm') order by created_at desc limit 1", tgId)?.takeIf { it.fresh }
        if (r == null) {
            api.send(chat, if (nonce.isEmpty()) "Здравствуйте! Это бот KANA. Чтобы войти, откройте приложение → «Профиль» → «Войти»."
                           else "Ссылка не найдена. Начните вход в приложении ещё раз.", noKeyboard)
            return
        }
        if (r.status != "new") {
            // ту же ссылку открыли ещё раз — продолжаем с того шага, где остановились
            when {
                r.tgId != null && r.tgId != tgId -> api.send(chat, "Эту ссылку уже открыли в другом Telegram. Начните вход в приложении ещё раз.", noKeyboard)
                r.status in setOf("approved", "done") -> api.send(chat, if (r.kind == "login") "Вход уже выполнен — вернитесь в приложение." else "Телефон уже привязан — вернитесь в приложение.", noKeyboard)
                r.status == "denied" -> api.send(chat, "Вход по этой ссылке отменён. Если это были вы — начните вход в приложении ещё раз.", noKeyboard)
                r.status == "error" -> api.send(chat, r.message ?: "Не получилось. Начните вход в приложении ещё раз.", noKeyboard)
                !r.fresh -> api.send(chat, "Ссылка устарела. Начните вход в приложении ещё раз.", noKeyboard)
                else -> prompt(chat, r)
            }
            return
        }
        if (!r.fresh) { api.send(chat, "Ссылка устарела. Начните вход в приложении ещё раз.", noKeyboard); return }
        val linked = userByTg(tgId)
        if (r.kind == "login") {
            if (linked != null) {
                set(r.nonce, "confirm", tgId = tgId)
                api.send(chat, "Войти в KANA как «${linked["name"]}»?\nЕсли вы не начинали вход сами, нажмите «Это не я».", confirmMarkup(r.nonce))
            } else {
                set(r.nonce, "need_contact", tgId = tgId)
                prompt(chat, r.copy(status = "need_contact", tgId = tgId))
            }
        } else {
            val owner = linked?.get("id") as Number?
            when {
                owner != null && owner.toLong() == r.userId -> { set(r.nonce, "approved", tgId = tgId, result = r.userId); api.send(chat, "Этот Telegram уже привязан к вашему аккаунту.", noKeyboard) }
                // аккаунт, созданный входом через Telegram (без пароля), объединим с этим — так не теряется прогресс
                owner != null && !hasPassword(owner.toLong()) -> { set(r.nonce, "need_contact", tgId = tgId); prompt(chat, r.copy(status = "need_contact", tgId = tgId)) }
                owner != null -> { set(r.nonce, "error", "Этот Telegram уже привязан к другому аккаунту", tgId); api.send(chat, "Этот Telegram уже привязан к другому аккаунту KANA.", noKeyboard) }
                else -> { set(r.nonce, "need_contact", tgId = tgId); prompt(chat, r.copy(status = "need_contact", tgId = tgId)) }
            }
        }
    }

    private fun onContact(chat: Long, from: JsonNode, c: JsonNode) {
        val tgId = from["id"].asLong()
        val r = row("tg_id = ? and status = 'need_contact' order by created_at desc limit 1", tgId)
        if (r == null || !r.fresh) { api.send(chat, "Ссылка устарела. Начните вход в приложении ещё раз.", noKeyboard); return }
        if (c["user_id"]?.asLong() != tgId) { api.send(chat, "Нужен ваш собственный номер — нажмите кнопку «Поделиться номером».", contactKeyboard); return }
        val phone = "+" + c["phone_number"].asText().filter(Char::isDigit)
        val tgName = from["username"]?.asText()
        if (r.kind == "login") {
            val existing = userByTg(tgId)
            val id = (existing?.get("id") as Number?)?.toLong() ?: createUser(tgId, tgName, phone, displayName(from))
            set(r.nonce, "approved", result = id)
            api.send(chat, if (existing == null) "Готово! Создан новый аккаунт — вернитесь в приложение.\nЕсли у вас уже есть аккаунт с логином и паролем, войдите в него и привяжите Telegram в разделе «Я»: аккаунты объединятся вместе с прогрессом."
                           else "Готово! Вернитесь в приложение — вход выполнен.", noKeyboard)
        } else {
            try {
                val other = (userByTg(tgId)?.get("id") as Number?)?.toLong()
                val merged = other != null && other != r.userId && !hasPassword(other)
                if (merged) mergeInto(other!!, r.userId!!)
                jdbc.update("update users set tg_id = ?, tg_username = ?, phone = ? where id = ?", tgId, tgName, phone, r.userId)
                set(r.nonce, "approved", result = r.userId)
                api.send(chat, if (merged) "Готово! Номер привязан, а аккаунт, созданный раньше через Telegram, объединён с этим — прогресс из обоих сохранён. Вернитесь в приложение."
                               else "Готово! Номер привязан к аккаунту. Вернитесь в приложение.", noKeyboard)
            } catch (e: DuplicateKeyException) {
                set(r.nonce, "error", "Этот Telegram уже привязан к другому аккаунту")
                api.send(chat, "Этот Telegram уже привязан к другому аккаунту KANA.", noKeyboard)
            }
        }
    }

    private fun onCallback(q: JsonNode) {
        val data = q["data"]?.asText() ?: return
        val tgId = q["from"]["id"].asLong()
        val nonce = data.substringAfter(':')
        val r = row("nonce = ? and tg_id = ?", nonce, tgId)
        val ok = data.startsWith("ok:")
        val text = when {
            r == null || r.status != "confirm" -> "Эта кнопка уже не действует."
            !r.fresh -> "Ссылка устарела. Начните вход в приложении ещё раз."
            ok -> { set(nonce, "approved", result = (userByTg(tgId)!!["id"] as Number).toLong()); "Вход подтверждён. Вернитесь в приложение." }
            else -> { set(nonce, "denied", "Вход отклонён в Telegram"); "Вход отменён. Если кто-то прислал вам эту ссылку — не переходите по таким ссылкам." }
        }
        runCatching { api.call("answerCallbackQuery", mapOf("callback_query_id" to q["id"].asText())) }
        q["message"]?.let { m -> runCatching { api.call("editMessageText", mapOf("chat_id" to m["chat"]["id"].asLong(), "message_id" to m["message_id"].asLong(), "text" to text)) } }
    }

    private fun hasPassword(id: Long) = jdbc.queryForObject("select password_hash not like '!%' from users where id = ?", Boolean::class.java, id) == true

    /**
     * Перенести всё из аккаунта from в аккаунт to и удалить from. Данные синхронизации объединяются
     * по тем же правилам, что и синхронизация: при совпадении остаётся более позднее изменение.
     */
    fun mergeInto(from: Long, to: Long) {
        jdbc.update(
            "insert into items (user_id, collection, item_id, data, deleted, updated_at) " +
            "select ?, collection, item_id, data, deleted, updated_at from items where user_id = ? " +
            "on conflict (user_id, collection, item_id) do update set data = excluded.data, deleted = excluded.deleted, " +
            "updated_at = excluded.updated_at, seq = nextval('items_seq') where excluded.updated_at > items.updated_at", to, from)
        // друзья, заявки, устройства для уведомлений
        jdbc.update(
            "insert into friends (a, b) select least(?, o), greatest(?, o) from (select case when a = ? then b else a end as o from friends where a = ? or b = ?) f " +
            "where o <> ? on conflict do nothing", to, to, from, from, from, to)
        jdbc.update("insert into friend_requests (from_id, to_id) select ?, to_id from friend_requests where from_id = ? and to_id <> ? on conflict do nothing", to, from, to)
        jdbc.update("insert into friend_requests (from_id, to_id) select from_id, ? from friend_requests where to_id = ? and from_id <> ? on conflict do nothing", to, from, to)
        jdbc.update("update push_subs set user_id = ? where user_id = ?", to, from)
        jdbc.update("update users set display_name = coalesce(display_name, (select display_name from users where id = ?)) where id = ?", from, to)
        jdbc.update("update users set tg_id = null where id = ?", from)
        jdbc.update("delete from users where id = ?", from)   // сессии и остатки — каскадом
        // все устройства этого аккаунта получат объединённые данные при следующей синхронизации
        jdbc.update("update items set seq = nextval('items_seq') where user_id = ?", to)
    }

    private fun displayName(from: JsonNode): String =
        listOfNotNull(from["first_name"]?.asText(), from["last_name"]?.asText()).joinToString(" ").trim().take(40).ifBlank { "Ученик" }

    private fun createUser(tgId: Long, tgName: String?, phone: String, name: String): Long {
        val base = tgName?.takeIf { Regex("^[A-Za-z0-9._-]{3,32}$").matches(it) }
        for (candidate in listOfNotNull(base, "tg$tgId", "tg${tgId}_${token(3).lowercase().filter(Char::isLetterOrDigit)}")) {
            try {
                return jdbc.queryForObject(
                    "insert into users (username, password_hash, display_name, tg_id, tg_username, phone) values (?, ?, ?, ?, ?, ?) returning id",
                    Long::class.java, candidate, unusable, name, tgId, tgName, phone)!!
            } catch (e: DuplicateKeyException) {
                userByTg(tgId)?.let { return (it["id"] as Number).toLong() }   // гонка: аккаунт уже создан
            }
        }
        throw IllegalStateException("не удалось подобрать логин")
    }

    // ---------- опрос Telegram ----------
    @Volatile private var running = false
    @EventListener(ApplicationReadyEvent::class)
    fun startPolling() {
        if (!props.enabled || !props.poll) return
        running = true
        Thread({
            var offset = jdbc.queryForList("select v from kv where k = 'tg_offset'", String::class.java).firstOrNull()?.toLongOrNull() ?: 0L
            runCatching { api.call("deleteWebhook", emptyMap()); log.info("Telegram-бот @{} подключён", api.botName()) }.onFailure { log.warn("Telegram: {}", it.message) }
            while (running) {
                try {
                    val updates = api.call("getUpdates", mapOf("offset" to offset, "timeout" to 25, "allowed_updates" to listOf("message", "callback_query")), 40)
                    for (u in updates) {
                        offset = u["update_id"].asLong() + 1
                        handle(u)
                        jdbc.update("insert into kv (k, v) values ('tg_offset', ?) on conflict (k) do update set v = excluded.v", offset.toString())
                    }
                } catch (e: Exception) { log.warn("Telegram getUpdates: {}", e.message); Thread.sleep(5000) }
            }
        }, "telegram-poll").apply { isDaemon = true }.start()
    }
}

@RestController
@RequestMapping("/api/tg")
class TgController(private val tg: TgService, private val props: TgProps, private val sessions: SessionService,
                   private val limiter: RateLimiter, private val jdbc: JdbcTemplate) {

    @GetMapping("/config")
    fun config() = mapOf("enabled" to props.enabled)

    @PostMapping("/login")
    fun login(req: HttpServletRequest): StartResponse {
        if (!limiter.tryAcquire("tg:${req.remoteAddr}", props.loginLimit, 600_000)) throw ApiException(HttpStatus.TOO_MANY_REQUESTS, "Слишком много попыток. Подождите несколько минут")
        return tg.start("login", null)
    }

    @PostMapping("/link")
    fun link(req: HttpServletRequest): StartResponse {
        val u = req.userId() ?: throw ApiException(HttpStatus.UNAUTHORIZED, "Вы не вошли")
        if (!limiter.tryAcquire("tg-link:$u", 20, 600_000)) throw ApiException(HttpStatus.TOO_MANY_REQUESTS, "Слишком много попыток. Подождите несколько минут")
        return tg.start("link", u)
    }

    /** Приложение спрашивает раз в пару секунд. Вход подтверждён — здесь же ставится cookie сессии. */
    @PostMapping("/status")
    fun status(@RequestBody body: StatusRequest): ResponseEntity<Map<String, Any?>> {
        val r = tg.status(body.nonce, body.secret)
        if (r.status == "approved" && r.kind == "login" && r.resultUserId != null) {
            tg.markDone(r.nonce)
            val u = jdbc.queryForMap("select username, display_name from users where id = ?", r.resultUserId)
            return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, sessions.cookie(sessions.create(r.resultUserId)).toString())
                .body(mapOf("status" to "ok", "username" to u["username"], "displayName" to u["display_name"]))
        }
        val status = when (r.status) { "approved", "done" -> if (r.kind == "link") "linked" else "used"; else -> r.status }
        return ResponseEntity.ok(mapOf("status" to status, "message" to r.message))
    }
}
