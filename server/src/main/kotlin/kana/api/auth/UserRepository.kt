package kana.api.auth

import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Repository

data class UserRow(val id: Long, val username: String, val passwordHash: String)

@Repository
class UserRepository(private val jdbc: JdbcTemplate) {
    private val mapper = RowMapper { rs, _ -> UserRow(rs.getLong("id"), rs.getString("username"), rs.getString("password_hash")) }

    /** null — логин уже занят (без учёта регистра). */
    fun create(username: String, passwordHash: String): Long? = try {
        jdbc.queryForObject(
            "insert into users (username, password_hash) values (?, ?) returning id",
            Long::class.java, username, passwordHash,
        )
    } catch (e: DuplicateKeyException) {
        null
    }

    fun findByUsername(username: String): UserRow? =
        jdbc.query("select id, username, password_hash from users where lower(username) = lower(?)", mapper, username).firstOrNull()

    fun findById(id: Long): UserRow? =
        jdbc.query("select id, username, password_hash from users where id = ?", mapper, id).firstOrNull()

    fun updatePassword(id: Long, passwordHash: String) {
        jdbc.update("update users set password_hash = ? where id = ?", passwordHash, id)
    }

    fun delete(id: Long) { jdbc.update("delete from users where id = ?", id) }
}
