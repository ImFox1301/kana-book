package kana.api

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.ConfigurationPropertiesScan
import org.springframework.boot.runApplication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@SpringBootApplication
@ConfigurationPropertiesScan
class KanaApiApplication

fun main(args: Array<String>) {
    runApplication<KanaApiApplication>(*args)
}

@ConfigurationProperties("kana")
data class KanaProps(
    val cookieSecure: Boolean = true,
    val sessionDays: Long = 180,
    val registrationOpen: Boolean = true,
    /** регистраций с одного IP в час */
    val registerPerHour: Int = 10,
    /** попыток входа с одного IP в минуту */
    val loginPerMinute: Int = 20,
    /** неудачных попыток входа в один логин за 15 минут */
    val loginFailuresPerUser: Int = 10,
    /** синхронизаций одного пользователя в минуту */
    val syncPerMinute: Int = 60,
    /** максимум записей у одного пользователя */
    val maxItemsPerUser: Int = 200_000,
)

@RestController
class HealthController {
    @GetMapping("/api/health")
    fun health() = mapOf("status" to "ok")
}
