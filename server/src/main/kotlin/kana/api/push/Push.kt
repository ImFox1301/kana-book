package kana.api.push

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.servlet.http.HttpServletRequest
import kana.api.ApiException
import kana.api.auth.RateLimiter
import kana.api.auth.userId
import org.slf4j.LoggerFactory
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.scheduling.annotation.EnableScheduling
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.context.annotation.Configuration
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.PrivateKey
import java.security.interfaces.ECPublicKey
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

@ConfigurationProperties("kana.push")
data class PushProps(
    /** контакт для push-сервисов (VAPID sub): https-адрес сайта или mailto:. Пусто — адрес сайта, с которого подписались */
    val subject: String = "",
    /** как часто проверять, кому пора напомнить */
    val tickMs: Long = 300_000,
    /** после назначенного времени напоминание ещё отправляется столько минут (если сервер был выключен — не слать ночью) */
    val windowMinutes: Long = 180,
    /** дополнительные разрешённые хосты push-сервисов (для тестов) */
    val extraHosts: List<String> = emptyList(),
    val allowHttp: Boolean = false,
)

@Configuration
@EnableScheduling
class PushConfig

data class PushSub(val id: Long, val userId: Long, val endpoint: String, val p256dh: String, val auth: String)
data class Keys(val p256dh: String = "", val auth: String = "")
data class SubscribeRequest(val endpoint: String = "", val keys: Keys = Keys(), val time: String? = null, val tz: String? = null)
data class PrefsRequest(val time: String? = null, val tz: String? = null, val enabled: Boolean? = null)
data class EndpointRequest(val endpoint: String = "")
data class Message(val title: String, val body: String, val tag: String = "reminder", val url: String = "/")

/** Ключи VAPID: создаются при первом запуске и хранятся в базе — подписки браузеров привязаны к открытому ключу. */
@Component
class VapidKeys(jdbc: JdbcTemplate) {
    val private: PrivateKey
    val publicRaw: ByteArray

    init {
        val stored = jdbc.queryForList("select v from kv where k = 'vapid'", String::class.java).firstOrNull()
        if (stored != null) {
            val (priv, pub) = stored.split('.')
            private = WebPush.privateFromPkcs8(WebPush.unb64(priv)); publicRaw = WebPush.unb64(pub)
        } else {
            val kp = WebPush.newKeyPair()
            private = kp.private; publicRaw = WebPush.raw(kp.public as ECPublicKey)
            jdbc.update("insert into kv (k, v) values ('vapid', ?) on conflict (k) do nothing", WebPush.b64(WebPush.pkcs8(private)) + "." + WebPush.b64(publicRaw))
        }
    }
    val publicB64: String get() = WebPush.b64(publicRaw)
}

/** Доставка одного сообщения push-сервису. Возвращает HTTP-код ответа. */
interface PushTransport { fun send(sub: PushSub, body: ByteArray, authorization: String, ttl: Int): Int }

@Component
class HttpPushTransport : PushTransport {
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build()
    override fun send(sub: PushSub, body: ByteArray, authorization: String, ttl: Int): Int {
        val req = HttpRequest.newBuilder(URI(sub.endpoint)).timeout(Duration.ofSeconds(15))
            .header("TTL", ttl.toString()).header("Urgency", "normal").header("Topic", "reminder")
            .header("Content-Encoding", "aes128gcm").header("Content-Type", "application/octet-stream")
            .header("Authorization", authorization)
            .POST(HttpRequest.BodyPublishers.ofByteArray(body)).build()
        return http.send(req, HttpResponse.BodyHandlers.discarding()).statusCode()
    }
}

@Service
class PushService(private val jdbc: JdbcTemplate, private val keys: VapidKeys, private val transport: PushTransport,
                  private val props: PushProps, private val mapper: ObjectMapper) {
    private val log = LoggerFactory.getLogger(javaClass)

    /** Только адреса настоящих push-сервисов браузеров: сервер не должен ходить по произвольным ссылкам. */
    private val hosts = listOf("fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com", "push.yandex.ru")

    fun validEndpoint(endpoint: String): Boolean {
        val u = runCatching { URI(endpoint) }.getOrNull() ?: return false
        val host = u.host?.lowercase() ?: return false
        if (u.scheme != "https" && !(props.allowHttp && u.scheme == "http")) return false
        return (hosts + props.extraHosts).any { host == it || host.endsWith(".$it") }
    }

    /** Адрес сайта для VAPID: из настройки или тот, через который пришла подписка (Caddy передаёт исходный Host). */
    fun rememberSite(host: String?) {
        if (props.subject.isNotBlank() || host.isNullOrBlank() || host == "localhost" || host.startsWith("127.") || !host.contains('.')) return
        jdbc.update("insert into kv (k, v) values ('site', ?) on conflict (k) do update set v = excluded.v", "https://" + host.lowercase())
    }
    private fun subject(): String = props.subject.ifBlank {
        jdbc.queryForList("select v from kv where k = 'site'", String::class.java).firstOrNull() ?: "mailto:kana-tetrad@users.noreply.github.com"
    }

    fun subscribe(userId: Long, r: SubscribeRequest) {
        if (!validEndpoint(r.endpoint) || r.endpoint.length > 1000) throw ApiException(HttpStatus.BAD_REQUEST, "Неизвестный сервис уведомлений")
        val ok = runCatching { WebPush.publicFromRaw(WebPush.unb64(r.keys.p256dh)); WebPush.unb64(r.keys.auth).size == 16 }.getOrDefault(false)
        if (!ok) throw ApiException(HttpStatus.BAD_REQUEST, "Некорректная подписка")
        if ((jdbc.queryForObject("select count(*) from push_subs where user_id = ?", Long::class.java, userId) ?: 0) >= 20)
            jdbc.update("delete from push_subs where id = (select min(id) from push_subs where user_id = ?)", userId)
        jdbc.update("""
            insert into push_subs (user_id, endpoint, p256dh, auth) values (?, ?, ?, ?)
            on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
        """.trimIndent(), userId, r.endpoint, r.keys.p256dh, r.keys.auth)
        setPrefs(userId, PrefsRequest(r.time, r.tz, true))
    }

    fun unsubscribe(userId: Long, endpoint: String) {
        jdbc.update("delete from push_subs where user_id = ? and endpoint = ?", userId, endpoint)
    }

    fun setPrefs(userId: Long, r: PrefsRequest) {
        val time = r.time?.let { runCatching { LocalTime.parse(it) }.getOrNull() ?: throw ApiException(HttpStatus.BAD_REQUEST, "Время в виде ЧЧ:ММ") }
        val tz = r.tz?.let { runCatching { ZoneId.of(it) }.getOrNull() ?: throw ApiException(HttpStatus.BAD_REQUEST, "Неизвестный часовой пояс") }
        jdbc.update("insert into push_prefs (user_id) values (?) on conflict do nothing", userId)
        if (time != null) jdbc.update("update push_prefs set remind_at = ?, last_sent = null where user_id = ?", "%02d:%02d".format(time.hour, time.minute), userId)
        if (tz != null) jdbc.update("update push_prefs set tz = ? where user_id = ?", tz.id, userId)
        if (r.enabled != null) jdbc.update("update push_prefs set enabled = ? where user_id = ?", r.enabled, userId)
    }

    fun prefs(userId: Long): Map<String, Any?> {
        val p = jdbc.queryForList("select enabled, remind_at, tz from push_prefs where user_id = ?", userId).firstOrNull()
        val n = jdbc.queryForObject("select count(*) from push_subs where user_id = ?", Long::class.java, userId)
        return mapOf("enabled" to (p?.get("enabled") ?: false), "time" to (p?.get("remind_at") ?: "19:00"), "tz" to p?.get("tz"), "devices" to n)
    }

    private fun subs(userId: Long) = jdbc.query("select id, user_id, endpoint, p256dh, auth from push_subs where user_id = ?",
        { rs, _ -> PushSub(rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getString(4), rs.getString(5)) }, userId)

    /** Отправить сообщение на все устройства пользователя. Возвращает, на сколько ушло. */
    fun sendTo(userId: Long, msg: Message): Int {
        val payload = mapper.writeValueAsBytes(msg)
        var sent = 0
        for (s in subs(userId)) {
            val code = runCatching {
                val u = URI(s.endpoint)
                val aud = "${u.scheme}://${u.host}" + (if (u.port > 0) ":${u.port}" else "")
                transport.send(s, WebPush.encrypt(payload, s.p256dh, s.auth), WebPush.vapid(aud, subject(), keys.private, keys.publicRaw), 12 * 3600)
            }.getOrElse { log.warn("push {}: {}", s.id, it.message); -1 }
            when {
                code in 200..299 -> sent++
                code == 404 || code == 410 -> jdbc.update("delete from push_subs where id = ?", s.id)   // подписка больше не действует
                else -> log.warn("push {}: ответ {}", s.id, code)
            }
        }
        return sent
    }

    /** Кому пора напомнить: наступило выбранное время, сегодня ещё не напоминали и цель дня не выполнена. */
    @Scheduled(fixedDelayString = "\${kana.push.tick-ms:300000}", initialDelay = 60_000)
    fun tick() = remind(Instant.now())

    fun remind(now: Instant): Int {
        var n = 0
        val rows = jdbc.queryForList("select p.user_id, p.remind_at, p.tz, p.last_sent from push_prefs p where p.enabled and exists (select 1 from push_subs s where s.user_id = p.user_id)")
        for (r in rows) {
            val userId = (r["user_id"] as Number).toLong()
            val zone = runCatching { ZoneId.of(r["tz"] as String) }.getOrDefault(ZoneId.of("UTC"))
            val local = now.atZone(zone)
            val today = local.toLocalDate()
            val at = LocalTime.parse(r["remind_at"] as String)
            val last = (r["last_sent"] as java.sql.Date?)?.toLocalDate()
            val minutesLate = Duration.between(local.toLocalDate().atTime(at).atZone(zone), local).toMinutes()
            if (last == today || minutesLate < 0 || minutesLate > props.windowMinutes) continue
            jdbc.update("update push_prefs set last_sent = ? where user_id = ?", java.sql.Date.valueOf(today), userId)
            val msg = reminderFor(userId, today) ?: continue
            if (sendTo(userId, msg) > 0) n++
        }
        return n
    }

    /** Текст напоминания по данным синхронизации; null — цель уже выполнена. */
    fun reminderFor(userId: Long, today: LocalDate): Message? {
        val goal = jdbc.queryForList("select data::text from items where user_id = ? and collection = 'settings' and item_id = 'main' and not deleted", String::class.java, userId)
            .firstOrNull()?.let { mapper.readTree(it)["goal"] }
        val gMin = goal?.get("min")?.asInt(30) ?: 30
        val gCards = goal?.get("cards")?.asInt(50) ?: 50
        // активность: «дата|устройство» → { d: "2026-10-21" (месяц и день без нуля, как в приложении), s: секунды, c: карточки }
        val days = mutableMapOf<String, IntArray>()
        jdbc.queryForList("select data::text from items where user_id = ? and collection = 'activity' and not deleted", String::class.java, userId).forEach {
            val a = mapper.readTree(it); val d = a["d"]?.asText() ?: return@forEach
            days.getOrPut(d) { IntArray(2) }.let { t -> t[0] += a["s"]?.asInt() ?: 0; t[1] += a["c"]?.asInt() ?: 0 }
        }
        val key = { d: LocalDate -> "${d.year}-${d.monthValue}-${d.dayOfMonth}" }
        val t = days[key(today)] ?: IntArray(2)
        val min = t[0] / 60; val cards = t[1]
        if (min >= gMin && cards >= gCards) return null
        var streak = 0; var d = today.minusDays(1)
        while (days[key(d)]?.let { it[0] >= 60 || it[1] > 0 } == true) { streak++; d = d.minusDays(1) }
        val left = buildList {
            if (min < gMin) add("${gMin - min} ${plural(gMin - min, "минута", "минуты", "минут")}")
            if (cards < gCards) add("${gCards - cards} ${plural(gCards - cards, "карточка", "карточки", "карточек")}")
        }.joinToString(" и ")
        val body = when {
            streak > 0 && min == 0 && cards == 0 -> "Серия — $streak ${plural(streak, "день", "дня", "дней")} подряд. Пара минут сегодня — и она продолжится."
            min == 0 && cards == 0 -> "Сегодня ещё не было занятий. Цель: $gMin мин и $gCards карточек."
            else -> "До цели дня осталось: $left."
        }
        return Message("Кана-тетрадь", body)
    }

    private fun plural(n: Int, one: String, few: String, many: String): String {
        val m = n % 10; val mm = n % 100
        return if (m == 1 && mm != 11) one else if (m in 2..4 && mm !in 12..14) few else many
    }
}

@RestController
@RequestMapping("/api/push")
class PushController(private val push: PushService, private val keys: VapidKeys, private val limiter: RateLimiter) {
    private fun user(req: HttpServletRequest) = req.userId() ?: throw ApiException(HttpStatus.UNAUTHORIZED, "Вы не вошли")

    @GetMapping("/key")
    fun key() = mapOf("key" to keys.publicB64)

    @GetMapping("/prefs")
    fun prefs(req: HttpServletRequest) = push.prefs(user(req))

    @PostMapping("/subscribe")
    fun subscribe(@RequestBody body: SubscribeRequest, req: HttpServletRequest): Map<String, Any?> {
        val u = user(req)
        if (!limiter.tryAcquire("push-sub:$u", 20, 60_000)) throw ApiException(HttpStatus.TOO_MANY_REQUESTS, "Слишком часто")
        push.rememberSite(req.serverName); push.subscribe(u, body); return push.prefs(u)
    }

    @PostMapping("/unsubscribe")
    fun unsubscribe(@RequestBody body: EndpointRequest, req: HttpServletRequest): Map<String, Any?> {
        val u = user(req); push.unsubscribe(u, body.endpoint); return push.prefs(u)
    }

    @PostMapping("/prefs")
    fun setPrefs(@RequestBody body: PrefsRequest, req: HttpServletRequest): Map<String, Any?> {
        val u = user(req); push.setPrefs(u, body); return push.prefs(u)
    }

    @PostMapping("/test")
    fun test(req: HttpServletRequest): Map<String, Int> {
        val u = user(req)
        if (!limiter.tryAcquire("push-test:$u", 5, 60_000)) throw ApiException(HttpStatus.TOO_MANY_REQUESTS, "Слишком часто — попробуйте через минуту")
        return mapOf("sent" to push.sendTo(u, Message("Кана-тетрадь", "Напоминания работают. Так будет выглядеть напоминание о занятиях.", "test")))
    }
}
