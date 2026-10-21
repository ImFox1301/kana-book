package kana.api.friends

import jakarta.servlet.http.HttpServletRequest
import kana.api.ApiException
import kana.api.auth.UserRepository
import kana.api.auth.userId
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController
import java.time.Duration

/** Фото профиля видят только сам пользователь и его друзья (и те, с кем есть заявка в друзья). */
@RestController
class AvatarController(private val users: UserRepository, private val friends: FriendsService) {
    @GetMapping("/api/avatar/{id}")
    fun avatar(@PathVariable id: Long, req: HttpServletRequest): ResponseEntity<ByteArray> {
        val me = req.userId() ?: throw ApiException(HttpStatus.UNAUTHORIZED, "Вы не вошли")
        if (!friends.canSeeAvatar(me, id)) throw ApiException(HttpStatus.NOT_FOUND, "Нет фото")
        val (bytes, type) = users.avatar(id) ?: throw ApiException(HttpStatus.NOT_FOUND, "Нет фото")
        // адрес содержит версию (?v=), поэтому кэшировать можно надолго
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(type))
            .cacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePrivate())
            .header("X-Content-Type-Options", "nosniff").body(bytes)
    }
}
