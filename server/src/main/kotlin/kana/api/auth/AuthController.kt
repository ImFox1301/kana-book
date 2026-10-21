package kana.api.auth

import jakarta.servlet.http.HttpServletRequest
import kana.api.ApiException
import kana.api.KanaProps
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

data class Credentials(val username: String = "", val password: String = "", val displayName: String? = null)
data class NameChange(val displayName: String = "")
data class PasswordChange(val oldPassword: String = "", val newPassword: String = "")
data class PasswordConfirm(val password: String = "")
data class Me(val username: String, val displayName: String? = null, val linked: Boolean = false, val telegram: String? = null, val hasPassword: Boolean = true)
fun UserRow.me() = Me(username, displayName, tgId != null, tgUsername, !passwordHash.startsWith("!"))

@RestController
@RequestMapping("/api/auth")
class AuthController(
    private val users: UserRepository,
    private val sessions: SessionService,
    private val limiter: RateLimiter,
    private val props: KanaProps,
) {
    private val encoder = BCryptPasswordEncoder(10)
    // для выравнивания времени ответа, когда логина не существует
    private val dummyHash = encoder.encode("kana-dummy-password")

    @PostMapping("/register")
    fun register(@RequestBody body: Credentials, req: HttpServletRequest): ResponseEntity<Me> {
        if (!props.registrationOpen) throw ApiException(HttpStatus.FORBIDDEN, "Регистрация сейчас закрыта")
        val username = body.username.trim()
        validateUsername(username)
        validatePassword(body.password)
        val name = displayName(body.displayName)
        if (!limiter.tryAcquire("reg:${req.remoteAddr}", props.registerPerHour, 3_600_000))
            throw ApiException(HttpStatus.TOO_MANY_REQUESTS, "Слишком много регистраций с вашего адреса. Попробуйте через час")
        val id = users.create(username, encoder.encode(body.password), name)
            ?: throw ApiException(HttpStatus.CONFLICT, "Этот логин уже занят")
        return withSession(HttpStatus.CREATED, id, Me(username, name))
    }

    @PostMapping("/login")
    fun login(@RequestBody body: Credentials, req: HttpServletRequest): ResponseEntity<Me> {
        val username = body.username.trim()
        val userKey = "fail:${username.lowercase()}"
        if (!limiter.tryAcquire("login:${req.remoteAddr}", props.loginPerMinute, 60_000) ||
            limiter.count(userKey, 15 * 60_000) >= props.loginFailuresPerUser
        ) throw ApiException(HttpStatus.TOO_MANY_REQUESTS, "Слишком много попыток входа. Подождите несколько минут")
        val user = users.findByUsername(username)
        val ok = encoder.matches(body.password, user?.passwordHash ?: dummyHash) && user != null
        if (!ok || user == null) {
            limiter.tryAcquire(userKey, Int.MAX_VALUE, 15 * 60_000)
            throw ApiException(HttpStatus.UNAUTHORIZED, "Неверный логин или пароль")
        }
        limiter.reset(userKey)
        return withSession(HttpStatus.OK, user.id, user.me())
    }

    @PostMapping("/logout")
    fun logout(req: HttpServletRequest): ResponseEntity<Map<String, Boolean>> {
        req.sessionToken()?.let(sessions::delete)
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, sessions.clearCookie().toString()).body(mapOf("ok" to true))
    }

    @GetMapping("/me")
    fun me(req: HttpServletRequest): Me {
        val user = req.userId()?.let(users::findById) ?: throw ApiException(HttpStatus.UNAUTHORIZED, "Вы не вошли")
        return user.me()
    }

    @PostMapping("/unlink-telegram")
    fun unlinkTelegram(req: HttpServletRequest): Me {
        val user = req.userId()?.let(users::findById) ?: throw ApiException(HttpStatus.UNAUTHORIZED, "Вы не вошли")
        if (user.passwordHash.startsWith("!")) throw ApiException(HttpStatus.CONFLICT, "В этот аккаунт можно войти только через Telegram — отвязать его нельзя")
        users.unlinkTelegram(user.id)
        return users.findById(user.id)!!.me()
    }

    /** «Как к вам обращаться» — имя, которое видят друзья. */
    @PostMapping("/name")
    fun changeName(@RequestBody body: NameChange, req: HttpServletRequest): Me {
        val user = req.userId()?.let(users::findById) ?: throw ApiException(HttpStatus.UNAUTHORIZED, "Вы не вошли")
        val name = displayName(body.displayName)
        users.updateDisplayName(user.id, name)
        return users.findById(user.id)!!.me()
    }

    @PostMapping("/password")
    fun changePassword(@RequestBody body: PasswordChange, req: HttpServletRequest): Map<String, Boolean> {
        val user = req.userId()?.let(users::findById) ?: throw ApiException(HttpStatus.UNAUTHORIZED, "Вы не вошли")
        // у аккаунта из Telegram пароля ещё нет — его можно задать без старого
        if (!user.passwordHash.startsWith("!") && !encoder.matches(body.oldPassword, user.passwordHash)) throw ApiException(HttpStatus.FORBIDDEN, "Текущий пароль указан неверно")
        validatePassword(body.newPassword)
        users.updatePassword(user.id, encoder.encode(body.newPassword))
        sessions.deleteAllExcept(user.id, req.sessionToken())   // выйти на остальных устройствах
        return mapOf("ok" to true)
    }

    @PostMapping("/delete")
    fun deleteAccount(@RequestBody body: PasswordConfirm, req: HttpServletRequest): ResponseEntity<Map<String, Boolean>> {
        val user = req.userId()?.let(users::findById) ?: throw ApiException(HttpStatus.UNAUTHORIZED, "Вы не вошли")
        if (!user.passwordHash.startsWith("!") && !encoder.matches(body.password, user.passwordHash)) throw ApiException(HttpStatus.FORBIDDEN, "Пароль указан неверно")
        users.delete(user.id)   // сессии и данные удаляются каскадом
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, sessions.clearCookie().toString()).body(mapOf("ok" to true))
    }

    private fun withSession(status: HttpStatus, userId: Long, me: Me): ResponseEntity<Me> {
        val token = sessions.create(userId)
        return ResponseEntity.status(status).header(HttpHeaders.SET_COOKIE, sessions.cookie(token).toString()).body(me)
    }

    private fun displayName(raw: String?): String {
        val n = (raw ?: "").trim().replace(Regex("\\s+"), " ")
        if (n.isEmpty()) throw ApiException(HttpStatus.BAD_REQUEST, "Укажите, как к вам обращаться")
        if (n.codePointCount(0, n.length) > 40) throw ApiException(HttpStatus.BAD_REQUEST, "Имя слишком длинное: не больше 40 символов")
        if (n.any { Character.isISOControl(it) || it in "<>" }) throw ApiException(HttpStatus.BAD_REQUEST, "В имени есть недопустимые символы")
        return n
    }

    private fun validateUsername(u: String) {
        if (!USERNAME.matches(u))
            throw ApiException(HttpStatus.BAD_REQUEST, "Логин: от 3 до 32 символов — латинские буквы, цифры, точка, дефис или подчёркивание")
    }

    private fun validatePassword(p: String) {
        if (p.length < 8) throw ApiException(HttpStatus.BAD_REQUEST, "Пароль должен быть не короче 8 символов")
        if (p.length > 128) throw ApiException(HttpStatus.BAD_REQUEST, "Пароль слишком длинный: не больше 128 символов")
    }

    companion object {
        private val USERNAME = Regex("^[A-Za-z0-9._-]{3,32}$")
    }
}
