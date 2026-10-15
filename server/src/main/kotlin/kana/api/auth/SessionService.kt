package kana.api.auth

import kana.api.KanaProps
import org.springframework.http.ResponseCookie
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Service
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Duration
import java.util.Base64

const val SESSION_COOKIE = "kana_session"

/** Сессии: случайный токен в httpOnly-cookie, в базе хранится только его SHA-256. */
@Service
class SessionService(private val jdbc: JdbcTemplate, private val props: KanaProps) {
    private val random = SecureRandom()

    fun create(userId: Long): String {
        val bytes = ByteArray(32).also(random::nextBytes)
        val token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        jdbc.update(
            "insert into sessions (token_hash, user_id, expires_at) values (?, ?, now() + make_interval(days => ?))",
            hash(token), userId, props.sessionDays.toInt(),
        )
        return token
    }

    /** id пользователя по токену; продлевает сессию не чаще раза в сутки. */
    fun resolve(token: String): Long? {
        val h = hash(token)
        val row = jdbc.query(
            "select user_id, last_seen_at < now() - interval '1 day' as stale from sessions where token_hash = ? and expires_at > now()",
            RowMapper { rs, _ -> rs.getLong("user_id") to rs.getBoolean("stale") }, h,
        ).firstOrNull() ?: return null
        if (row.second) {
            jdbc.update(
                "update sessions set last_seen_at = now(), expires_at = now() + make_interval(days => ?) where token_hash = ?",
                props.sessionDays.toInt(), h,
            )
        }
        return row.first
    }

    fun delete(token: String) { jdbc.update("delete from sessions where token_hash = ?", hash(token)) }

    fun deleteAllExcept(userId: Long, keepToken: String?) {
        if (keepToken == null) jdbc.update("delete from sessions where user_id = ?", userId)
        else jdbc.update("delete from sessions where user_id = ? and token_hash <> ?", userId, hash(keepToken))
    }

    fun cookie(token: String): ResponseCookie = ResponseCookie.from(SESSION_COOKIE, token)
        .httpOnly(true).secure(props.cookieSecure).sameSite("Strict").path("/api")
        .maxAge(Duration.ofDays(props.sessionDays)).build()

    fun clearCookie(): ResponseCookie = ResponseCookie.from(SESSION_COOKIE, "")
        .httpOnly(true).secure(props.cookieSecure).sameSite("Strict").path("/api").maxAge(0).build()

    private fun hash(token: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(token.toByteArray())
}
