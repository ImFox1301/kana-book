package kana.api.auth

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.net.URI

const val USER_ID_ATTR = "kana.userId"
const val TOKEN_ATTR = "kana.token"

fun HttpServletRequest.userId(): Long? = getAttribute(USER_ID_ATTR) as Long?
fun HttpServletRequest.sessionToken(): String? = getAttribute(TOKEN_ATTR) as String?

/**
 * 1) Запросы, меняющие данные, принимаются только со своего сайта (проверка Origin) — защита от CSRF
 *    вместе с SameSite=Strict у cookie.
 * 2) По cookie сессии определяет пользователя.
 */
@Component
class AuthFilter(private val sessions: SessionService) : OncePerRequestFilter() {

    override fun shouldNotFilter(request: HttpServletRequest) = !request.requestURI.startsWith("/api/")

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        if (request.method !in SAFE_METHODS) {
            val origin = request.getHeader("Origin")
            if (origin != null && !sameHost(origin, request.serverName)) {
                response.status = HttpServletResponse.SC_FORBIDDEN
                response.contentType = "application/json;charset=UTF-8"
                response.writer.write("""{"error":"Запрос с чужого сайта отклонён"}""")
                return
            }
        }
        val token = request.cookies?.firstOrNull { it.name == SESSION_COOKIE }?.value
        if (!token.isNullOrBlank()) {
            sessions.resolve(token)?.let {
                request.setAttribute(USER_ID_ATTR, it)
                request.setAttribute(TOKEN_ATTR, token)
            }
        }
        chain.doFilter(request, response)
    }

    private fun sameHost(origin: String, host: String): Boolean =
        runCatching { URI(origin).host.equals(host, ignoreCase = true) }.getOrDefault(false)

    companion object {
        private val SAFE_METHODS = setOf("GET", "HEAD", "OPTIONS")
    }
}
