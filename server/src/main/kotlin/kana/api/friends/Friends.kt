package kana.api.friends

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.servlet.http.HttpServletRequest
import kana.api.ApiException
import kana.api.auth.RateLimiter
import kana.api.auth.userId
import kana.api.push.Message
import kana.api.push.PushService
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.LocalDate
import java.time.ZoneId
import java.util.Base64

data class Person(val id: Long, val name: String, val username: String, val avatar: String? = null)
data class Stats(val streak: Int, val todayMin: Int, val todayCards: Int, val goalMin: Int, val goalCards: Int,
                 val lessonsH: Int, val lessonsK: Int, val weekAnswers: Int, val weekAccuracy: Int?, val xp: Int = 0)
data class Friend(val id: Long, val name: String, val username: String, val since: Long, val stats: Stats, val avatar: String? = null)
data class UserRef(val userId: Long = 0)
data class SearchRequest(val q: String = "")

/** Что видят друзья: только сводка — серия, сегодняшние минуты и карточки, пройденные уроки, ответы за неделю. */
@Service
class Progress(private val jdbc: JdbcTemplate, private val mapper: ObjectMapper) {
    private fun dayKey(d: LocalDate) = "${d.year}-${d.monthValue}-${d.dayOfMonth}"

    fun of(userId: Long, zone: ZoneId = ZoneId.of("Europe/Moscow")): Stats {
        val tz = jdbc.queryForList("select tz from push_prefs where user_id = ?", String::class.java, userId).firstOrNull()?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: zone
        val today = LocalDate.now(tz)
        val goal = jdbc.queryForList("select data::text from items where user_id = ? and collection = 'settings' and item_id = 'main' and not deleted", String::class.java, userId)
            .firstOrNull()?.let { mapper.readTree(it)["goal"] }
        val days = mutableMapOf<String, IntArray>()
        jdbc.queryForList("select data::text from items where user_id = ? and collection = 'activity' and not deleted", String::class.java, userId).forEach {
            val a = mapper.readTree(it); val d = a["d"]?.asText() ?: return@forEach
            days.getOrPut(d) { IntArray(2) }.let { t -> t[0] += a["s"]?.asInt() ?: 0; t[1] += a["c"]?.asInt() ?: 0 }
        }
        val active = { d: LocalDate -> days[dayKey(d)]?.let { it[0] >= 60 || it[1] > 0 } == true }
        var streak = 0; var d = if (active(today)) today else today.minusDays(1)
        while (active(d)) { streak++; d = d.minusDays(1) }
        val t = days[dayKey(today)] ?: IntArray(2)
        val lessons = jdbc.queryForList("select item_id from items where user_id = ? and collection = 'lessons' and not deleted and (data->>'done') is not null and data->>'done' not in ('false', '0')", String::class.java, userId)
        val since = System.currentTimeMillis() - 7 * 86_400_000L
        val week = jdbc.queryForList("select count(*) as n, count(*) filter (where data->>'r' = 'ok') as ok from items where user_id = ? and collection = 'answers' and not deleted and (data->>'ts')::bigint >= ?", userId, since).first()
        val n = (week["n"] as Number).toInt(); val ok = (week["ok"] as Number).toInt()
        // опыт, как в приложении: 10 за верный ответ, 100 за пройденный урок хираганы или катаканы
        val okAll = jdbc.queryForObject("select count(*) from items where user_id = ? and collection = 'answers' and not deleted and data->>'r' = 'ok'", Int::class.java, userId) ?: 0
        val lh = lessons.count { Regex("^h\\d+$").matches(it) }; val lk = lessons.count { Regex("^k\\d+$").matches(it) }
        return Stats(streak, t[0] / 60, t[1], goal?.get("min")?.asInt(30) ?: 30, goal?.get("cards")?.asInt(50) ?: 50,
            lh, lk, n, if (n > 0) Math.round(ok * 100.0 / n).toInt() else null, okAll * 10 + (lh + lk) * 100)
    }
}

fun avatarUrl(id: Long, ver: Int, has: Boolean): String? = if (has) "/api/avatar/$id?v=$ver" else null

@Service
class FriendsService(private val jdbc: JdbcTemplate, private val progress: Progress, private val push: PushService) {
    private val rnd = SecureRandom()
    private fun sha(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray())
    private fun pair(x: Long, y: Long) = if (x < y) x to y else y to x

    private val PERSON = "u.id, coalesce(u.display_name, u.username), u.username, u.avatar_ver, u.avatar is not null"
    private fun personOf(rs: java.sql.ResultSet) = Person(rs.getLong(1), rs.getString(2), rs.getString(3), avatarUrl(rs.getLong(1), rs.getInt(4), rs.getBoolean(5)))
    private fun person(id: Long): Person? = jdbc.query("select $PERSON from users u where u.id = ?", { rs, _ -> personOf(rs) }, id).firstOrNull()
    private fun exists(id: Long) = jdbc.queryForObject("select count(*) from users where id = ?", Long::class.java, id)!! > 0

    /** Кому можно показывать фото: себе, друзьям и тем, с кем есть заявка. */
    fun canSeeAvatar(viewer: Long, owner: Long) = viewer == owner || areFriends(viewer, owner) ||
        jdbc.queryForObject("select count(*) from friend_requests where (from_id = ? and to_id = ?) or (from_id = ? and to_id = ?)", Long::class.java, viewer, owner, owner, viewer)!! > 0

    fun areFriends(x: Long, y: Long): Boolean { val (a, b) = pair(x, y); return jdbc.queryForObject("select count(*) from friends where a = ? and b = ?", Long::class.java, a, b)!! > 0 }

    fun list(me: Long): Map<String, Any> {
        val friends = jdbc.query("""
            select $PERSON, extract(epoch from f.created_at) * 1000
            from friends f join users u on u.id = case when f.a = ? then f.b else f.a end
            where f.a = ? or f.b = ? order by coalesce(u.display_name, u.username)
        """.trimIndent(), { rs, _ -> val p = personOf(rs); Friend(p.id, p.name, p.username, rs.getLong(6), progress.of(p.id), p.avatar) }, me, me, me)
        val incoming = jdbc.query("select $PERSON from friend_requests r join users u on u.id = r.from_id where r.to_id = ? order by r.created_at desc", { rs, _ -> personOf(rs) }, me)
        val outgoing = jdbc.query("select $PERSON from friend_requests r join users u on u.id = r.to_id where r.from_id = ? order by r.created_at desc", { rs, _ -> personOf(rs) }, me)
        return mapOf("friends" to friends, "incoming" to incoming, "outgoing" to outgoing, "me" to progress.of(me))
    }

    /** Поиск только по точному логину. Фото найденного не показываем — только имя и логин. */
    fun search(me: Long, q: String): Map<String, Any?> {
        val login = q.trim().removePrefix("@")
        val p = jdbc.query("select $PERSON from users u where lower(u.username) = lower(?)", { rs, _ -> personOf(rs).copy(avatar = null) }, login).firstOrNull()
            ?: throw ApiException(HttpStatus.NOT_FOUND, "Никого не нашли. Проверьте логин — нужен точный, например pavel_k")
        val state = when {
            p.id == me -> "me"
            areFriends(me, p.id) -> "friend"
            exists(me, p.id) -> "requested"
            exists(p.id, me) -> "incoming"
            else -> "none"
        }
        return mapOf("user" to p, "state" to state)
    }
    private fun exists(from: Long, to: Long) = jdbc.queryForObject("select count(*) from friend_requests where from_id = ? and to_id = ?", Long::class.java, from, to)!! > 0

    fun request(me: Long, to: Long) {
        if (me == to) throw ApiException(HttpStatus.BAD_REQUEST, "Это вы")
        if (!exists(to)) throw ApiException(HttpStatus.NOT_FOUND, "Пользователь не найден")
        if (areFriends(me, to)) return
        if (exists(to, me)) { accept(me, to); return }   // встречная заявка — сразу дружим
        if (jdbc.queryForObject("select count(*) from friend_requests where from_id = ?", Long::class.java, me)!! >= 50)
            throw ApiException(HttpStatus.TOO_MANY_REQUESTS, "Слишком много неотвеченных заявок")
        val added = jdbc.update("insert into friend_requests (from_id, to_id) values (?, ?) on conflict do nothing", me, to)
        if (added > 0) person(me)?.let { push.sendTo(to, Message("KANA", "${it.name} хочет добавить вас в друзья", "friends", "/#friends")) }
    }

    fun accept(me: Long, from: Long) {
        val removed = jdbc.update("delete from friend_requests where from_id = ? and to_id = ?", from, me)
        if (removed == 0 && !areFriends(me, from)) throw ApiException(HttpStatus.NOT_FOUND, "Заявка не найдена")
        befriend(me, from)
        person(me)?.let { push.sendTo(from, Message("KANA", "${it.name} теперь у вас в друзьях", "friends", "/#friends")) }
    }

    private fun befriend(x: Long, y: Long) {
        val (a, b) = pair(x, y)
        jdbc.update("insert into friends (a, b) values (?, ?) on conflict do nothing", a, b)
        jdbc.update("delete from friend_requests where (from_id = ? and to_id = ?) or (from_id = ? and to_id = ?)", x, y, y, x)
    }

    fun decline(me: Long, from: Long) { jdbc.update("delete from friend_requests where from_id = ? and to_id = ?", from, me) }
    fun cancel(me: Long, to: Long) { jdbc.update("delete from friend_requests where from_id = ? and to_id = ?", me, to) }
    fun remove(me: Long, other: Long) { val (a, b) = pair(me, other); jdbc.update("delete from friends where a = ? and b = ?", a, b) }

    // ---------- ссылки-приглашения ----------
    fun invite(me: Long): String {
        jdbc.update("delete from friend_invites where expires_at < now()")
        if (jdbc.queryForObject("select count(*) from friend_invites where user_id = ?", Long::class.java, me)!! >= 30)
            jdbc.update("delete from friend_invites where token_hash = (select token_hash from friend_invites where user_id = ? order by created_at limit 1)", me)
        val token = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(18).also(rnd::nextBytes))
        jdbc.update("insert into friend_invites (token_hash, user_id, expires_at) values (?, ?, now() + interval '7 days')", sha(token), me)
        return token
    }
    private fun inviter(token: String): Long? =
        jdbc.queryForList("select user_id from friend_invites where token_hash = ? and expires_at > now()", Long::class.java, sha(token)).firstOrNull()

    fun inviteInfo(me: Long, token: String): Map<String, Any?> {
        val from = inviter(token) ?: throw ApiException(HttpStatus.NOT_FOUND, "Приглашение не найдено или устарело — попросите прислать новое")
        val p = person(from)!!
        return mapOf("from" to p, "state" to when { from == me -> "me"; areFriends(me, from) -> "friend"; else -> "new" })
    }

    fun acceptInvite(me: Long, token: String): Person {
        val from = inviter(token) ?: throw ApiException(HttpStatus.NOT_FOUND, "Приглашение не найдено или устарело — попросите прислать новое")
        if (from == me) throw ApiException(HttpStatus.BAD_REQUEST, "Это ваше собственное приглашение — отправьте его другу")
        jdbc.update("delete from friend_invites where token_hash = ?", sha(token))   // одноразовое
        befriend(me, from)
        person(me)?.let { push.sendTo(from, Message("KANA", "${it.name} принял(а) приглашение — теперь вы друзья", "friends", "/#friends")) }
        return person(from)!!
    }
}

@RestController
@RequestMapping("/api/friends")
class FriendsController(private val friends: FriendsService, private val limiter: RateLimiter) {
    private fun me(req: HttpServletRequest): Long = req.userId() ?: throw ApiException(HttpStatus.UNAUTHORIZED, "Вы не вошли")
    private fun limit(key: String, n: Int, ms: Long) { if (!limiter.tryAcquire(key, n, ms)) throw ApiException(HttpStatus.TOO_MANY_REQUESTS, "Слишком часто — попробуйте чуть позже") }

    @GetMapping
    fun list(req: HttpServletRequest) = friends.list(me(req))

    @PostMapping("/search")
    fun search(@RequestBody body: SearchRequest, req: HttpServletRequest): Map<String, Any?> { val u = me(req); limit("fsearch:$u", 30, 60_000); return friends.search(u, body.q) }

    @PostMapping("/request")
    fun request(@RequestBody body: UserRef, req: HttpServletRequest): Map<String, Any> { val u = me(req); limit("freq:$u", 30, 3_600_000); friends.request(u, body.userId); return friends.list(u) }

    @PostMapping("/accept")
    fun accept(@RequestBody body: UserRef, req: HttpServletRequest): Map<String, Any> { val u = me(req); friends.accept(u, body.userId); return friends.list(u) }

    @PostMapping("/decline")
    fun decline(@RequestBody body: UserRef, req: HttpServletRequest): Map<String, Any> { val u = me(req); friends.decline(u, body.userId); return friends.list(u) }

    @PostMapping("/cancel")
    fun cancel(@RequestBody body: UserRef, req: HttpServletRequest): Map<String, Any> { val u = me(req); friends.cancel(u, body.userId); return friends.list(u) }

    @PostMapping("/remove")
    fun remove(@RequestBody body: UserRef, req: HttpServletRequest): Map<String, Any> { val u = me(req); friends.remove(u, body.userId); return friends.list(u) }

    @PostMapping("/invite")
    fun invite(req: HttpServletRequest): Map<String, String> { val u = me(req); limit("finv:$u", 30, 3_600_000); return mapOf("token" to friends.invite(u)) }

    @GetMapping("/invite/{token}")
    fun inviteInfo(@PathVariable token: String, req: HttpServletRequest) = friends.inviteInfo(me(req), token)

    @PostMapping("/invite/{token}/accept")
    fun acceptInvite(@PathVariable token: String, req: HttpServletRequest): Map<String, Any> { val u = me(req); val p = friends.acceptInvite(u, token); return friends.list(u) + mapOf("added" to p) }
}
