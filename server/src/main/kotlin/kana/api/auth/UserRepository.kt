package kana.api.auth

import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Repository

data class UserRow(val id: Long, val username: String, val passwordHash: String, val displayName: String? = null, val tgId: Long? = null, val tgUsername: String? = null, val avatarVer: Int = 0, val hasAvatar: Boolean = false)

@Repository
class UserRepository(private val jdbc: JdbcTemplate) {
    private val mapper = RowMapper { rs, _ -> UserRow(rs.getLong("id"), rs.getString("username"), rs.getString("password_hash"), rs.getString("display_name"), rs.getObject("tg_id") as Long?, rs.getString("tg_username"), rs.getInt("avatar_ver"), rs.getBoolean("has_avatar")) }

    /** null — логин уже занят (без учёта регистра). */
    fun create(username: String, passwordHash: String, displayName: String?): Long? = try {
        jdbc.queryForObject(
            "insert into users (username, password_hash, display_name) values (?, ?, ?) returning id",
            Long::class.java, username, passwordHash, displayName,
        )
    } catch (e: DuplicateKeyException) {
        null
    }

    fun findByUsername(username: String): UserRow? =
        jdbc.query("select id, username, password_hash, display_name, tg_id, tg_username, avatar_ver, avatar is not null as has_avatar from users where lower(username) = lower(?)", mapper, username).firstOrNull()

    fun findById(id: Long): UserRow? =
        jdbc.query("select id, username, password_hash, display_name, tg_id, tg_username, avatar_ver, avatar is not null as has_avatar from users where id = ?", mapper, id).firstOrNull()

    fun updatePassword(id: Long, passwordHash: String) {
        jdbc.update("update users set password_hash = ? where id = ?", passwordHash, id)
    }

    fun updateDisplayName(id: Long, name: String) { jdbc.update("update users set display_name = ? where id = ?", name, id) }

    /** отвязать Telegram и телефон (только у аккаунтов с паролем — иначе в них не войти) */
    fun unlinkTelegram(id: Long) { jdbc.update("update users set tg_id = null, tg_username = null, phone = null where id = ?", id) }

    fun setAvatar(id: Long, bytes: ByteArray?, type: String?) {
        jdbc.update("update users set avatar = ?, avatar_type = ?, avatar_ver = avatar_ver + 1 where id = ?", bytes, type, id)
    }
    fun avatar(id: Long): Pair<ByteArray, String>? = jdbc.query("select avatar, avatar_type from users where id = ? and avatar is not null",
        { rs, _ -> rs.getBytes(1) to rs.getString(2) }, id).firstOrNull()

    fun delete(id: Long) { jdbc.update("delete from users where id = ?", id) }
}
