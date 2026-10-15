package kana.api.auth

import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap

/** Простое ограничение частоты: фиксированное окно на ключ, в памяти процесса. */
@Component
class RateLimiter {
    private class Window(var start: Long, var count: Int)

    private val windows = ConcurrentHashMap<String, Window>()
    @Volatile private var lastCleanup = System.currentTimeMillis()

    /** true — действие разрешено и засчитано. */
    fun tryAcquire(key: String, limit: Int, windowMs: Long): Boolean {
        val now = System.currentTimeMillis()
        cleanup(now)
        var allowed = false
        windows.compute(key) { _, w ->
            val cur = if (w == null || now - w.start >= windowMs) Window(now, 0) else w
            if (cur.count < limit) { cur.count++; allowed = true }
            cur
        }
        return allowed
    }

    /** Сколько событий уже засчитано в текущем окне (без увеличения). */
    fun count(key: String, windowMs: Long): Int {
        val w = windows[key] ?: return 0
        return if (System.currentTimeMillis() - w.start >= windowMs) 0 else w.count
    }

    fun reset(key: String) { windows.remove(key) }

    private fun cleanup(now: Long) {
        if (now - lastCleanup < 10 * 60_000) return
        lastCleanup = now
        windows.entries.removeIf { now - it.value.start > 60 * 60_000 }
    }
}
