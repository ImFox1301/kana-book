package kana.api

import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.HttpMediaTypeNotSupportedException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice

class ApiException(val status: HttpStatus, message: String) : RuntimeException(message)

data class ApiError(val error: String)

@RestControllerAdvice
class ApiErrors {
    @ExceptionHandler(ApiException::class)
    fun api(e: ApiException) = ResponseEntity.status(e.status).body(ApiError(e.message ?: "Ошибка"))

    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun unreadable(e: HttpMessageNotReadableException) =
        ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiError("Некорректный запрос"))

    @ExceptionHandler(HttpMediaTypeNotSupportedException::class)
    fun mediaType(e: HttpMediaTypeNotSupportedException) =
        ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).body(ApiError("Ожидается JSON"))
}
