package kana.api.sync

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.servlet.http.HttpServletRequest
import kana.api.ApiException
import kana.api.KanaProps
import kana.api.auth.RateLimiter
import kana.api.auth.userId
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

/** Изменение одного элемента: c — коллекция, t — время изменения на устройстве (мс), del — удалён. */
data class Change(val c: String = "", val id: String = "", val t: Long = 0, val del: Boolean = false, val data: JsonNode? = null)

data class SyncRequest(val cursor: Long = 0, val changes: List<Change> = emptyList())

data class SyncResponse(val cursor: Long, val items: List<Change>, val more: Boolean)

@RestController
class SyncController(private val sync: SyncService, private val limiter: RateLimiter, private val props: KanaProps) {

    /**
     * Отправить свои изменения и получить всё, что изменилось на сервере после cursor.
     * Конфликт: остаётся версия с большим t. Свои же изменения тоже возвращаются — клиент применяет их идемпотентно.
     */
    @PostMapping("/api/sync", consumes = [MediaType.APPLICATION_JSON_VALUE])
    fun sync(@RequestBody body: SyncRequest, req: HttpServletRequest): SyncResponse {
        val userId = req.userId() ?: throw ApiException(HttpStatus.UNAUTHORIZED, "Вы не вошли")
        if (!limiter.tryAcquire("sync:$userId", props.syncPerMinute, 60_000))
            throw ApiException(HttpStatus.TOO_MANY_REQUESTS, "Слишком частая синхронизация")
        return sync.sync(userId, body)
    }
}

@Service
class SyncService(private val jdbc: JdbcTemplate, private val mapper: ObjectMapper, private val props: KanaProps) {

    @Transactional
    fun sync(userId: Long, body: SyncRequest): SyncResponse {
        if (body.changes.size > MAX_CHANGES) throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "Слишком много изменений за раз")
        // синхронизации одного пользователя идут по очереди — порядок seq не перемешивается
        jdbc.queryForList("select pg_advisory_xact_lock(?)", userId)

        if (body.changes.isNotEmpty()) {
            val count = jdbc.queryForObject("select count(*) from items where user_id = ?", Long::class.java, userId) ?: 0L
            if (count + body.changes.size > props.maxItemsPerUser)
                throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "Достигнут предел хранилища аккаунта")
            val rows = body.changes.map { ch ->
                if (ch.c !in COLLECTIONS) throw ApiException(HttpStatus.BAD_REQUEST, "Неизвестная коллекция: ${ch.c}")
                if (ch.id.isEmpty() || ch.id.length > MAX_ID) throw ApiException(HttpStatus.BAD_REQUEST, "Некорректный id")
                if (ch.t <= 0) throw ApiException(HttpStatus.BAD_REQUEST, "Некорректное время изменения")
                val json = if (ch.del || ch.data == null || ch.data.isNull) null else mapper.writeValueAsString(ch.data)
                if (json != null && json.length > MAX_DATA) throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "Слишком большой элемент: ${ch.c}/${ch.id}")
                arrayOf<Any?>(userId, ch.c, ch.id, json, ch.del || json == null, ch.t)
            }
            jdbc.batchUpdate(
                """
                insert into items (user_id, collection, item_id, data, deleted, updated_at)
                values (?, ?, ?, ?::jsonb, ?, ?)
                on conflict (user_id, collection, item_id) do update
                   set data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at, seq = nextval('items_seq')
                 where items.updated_at < excluded.updated_at
                """.trimIndent(),
                rows,
            )
        }

        val rows: List<Pair<Long, Change>> = jdbc.query(
            "select collection, item_id, data::text as data, deleted, updated_at, seq from items where user_id = ? and seq > ? order by seq limit ?",
            RowMapper { rs, _ ->
                rs.getLong("seq") to Change(
                    c = rs.getString("collection"),
                    id = rs.getString("item_id"),
                    t = rs.getLong("updated_at"),
                    del = rs.getBoolean("deleted"),
                    data = rs.getString("data")?.let(mapper::readTree),
                )
            },
            userId, body.cursor, PAGE + 1,
        )
        val page = rows.take(PAGE)
        return SyncResponse(
            cursor = page.lastOrNull()?.first ?: body.cursor,
            items = page.map { it.second },
            more = rows.size > PAGE,
        )
    }

    companion object {
        val COLLECTIONS = setOf("words", "hidden", "samples", "settings", "answers", "lessons", "activity", "favs")
        const val MAX_CHANGES = 2000
        const val MAX_ID = 300
        const val MAX_DATA = 64 * 1024
        const val PAGE = 1000
    }
}
