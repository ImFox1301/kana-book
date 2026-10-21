package kana.api.push

import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Web Push без сторонних библиотек: шифрование содержимого (RFC 8291, aes128gcm по RFC 8188)
 * и подпись сервера VAPID (RFC 8292, ES256). Всё на стандартной криптографии JDK.
 */
object WebPush {
    private val rnd = SecureRandom()
    private val b64u = Base64.getUrlEncoder().withoutPadding()
    private val b64uDec = Base64.getUrlDecoder()

    fun b64(bytes: ByteArray): String = b64u.encodeToString(bytes)
    fun unb64(s: String): ByteArray = b64uDec.decode(s.trim().trimEnd('=').replace('+', '-').replace('/', '_'))

    val P256: ECParameterSpec by lazy {
        val g = KeyPairGenerator.getInstance("EC"); g.initialize(ECGenParameterSpec("secp256r1"))
        (g.generateKeyPair().public as ECPublicKey).params
    }

    fun newKeyPair(): KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1"), rnd) }.generateKeyPair()

    /** открытый ключ в виде 65 байт: 0x04 || X || Y */
    fun raw(pub: ECPublicKey): ByteArray {
        fun fixed(v: BigInteger): ByteArray { val b = v.toByteArray(); return ByteArray(32).also { val src = if (b.size > 32) b.copyOfRange(b.size - 32, b.size) else b; System.arraycopy(src, 0, it, 32 - src.size, src.size) } }
        return byteArrayOf(4) + fixed(pub.w.affineX) + fixed(pub.w.affineY)
    }

    fun publicFromRaw(raw: ByteArray): ECPublicKey {
        require(raw.size == 65 && raw[0] == 4.toByte()) { "ключ должен быть точкой P-256 в несжатом виде" }
        val x = BigInteger(1, raw.copyOfRange(1, 33)); val y = BigInteger(1, raw.copyOfRange(33, 65))
        return KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), P256)) as ECPublicKey
    }

    fun privateFromPkcs8(bytes: ByteArray): PrivateKey = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(bytes))

    private fun hmac(key: ByteArray, vararg data: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA256").run { init(SecretKeySpec(key, "HmacSHA256")); data.forEach { update(it) }; doFinal() }

    private fun ecdh(priv: PrivateKey, pub: ECPublicKey): ByteArray =
        KeyAgreement.getInstance("ECDH").run { init(priv); doPhase(pub, true); generateSecret() }

    /** Ключ и nonce для записи — общие для отправителя и получателя. */
    fun derive(authSecret: ByteArray, ecdhSecret: ByteArray, uaPublic: ByteArray, asPublic: ByteArray, salt: ByteArray): Pair<ByteArray, ByteArray> {
        val prkKey = hmac(authSecret, ecdhSecret)
        val ikm = hmac(prkKey, "WebPush: info\u0000".toByteArray(), uaPublic, asPublic, byteArrayOf(1))
        val prk = hmac(salt, ikm)
        val cek = hmac(prk, "Content-Encoding: aes128gcm\u0000".toByteArray(), byteArrayOf(1)).copyOf(16)
        val nonce = hmac(prk, "Content-Encoding: nonce\u0000".toByteArray(), byteArrayOf(1)).copyOf(12)
        return cek to nonce
    }

    /** Зашифровать содержимое для подписки (p256dh и auth — из PushSubscription браузера). */
    fun encrypt(plain: ByteArray, p256dh: String, auth: String, ephemeral: KeyPair = newKeyPair(), salt: ByteArray = ByteArray(16).also(rnd::nextBytes)): ByteArray {
        val uaPublic = unb64(p256dh)
        val asPublic = raw(ephemeral.public as ECPublicKey)
        val (cek, nonce) = derive(unb64(auth), ecdh(ephemeral.private, publicFromRaw(uaPublic)), uaPublic, asPublic, salt)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, SecretKeySpec(cek, "AES"), GCMParameterSpec(128, nonce)) }
        val body = cipher.doFinal(plain + byteArrayOf(2))            // 0x02 — последняя (единственная) запись
        return ByteBuffer.allocate(16 + 4 + 1 + asPublic.size + body.size)
            .put(salt).putInt(4096).put(asPublic.size.toByte()).put(asPublic).put(body).array()
    }

    /** Расшифровка на стороне получателя — для проверки в тестах. */
    fun decrypt(message: ByteArray, uaPrivate: PrivateKey, uaPublic: ByteArray, authSecret: ByteArray): ByteArray {
        val buf = ByteBuffer.wrap(message)
        val salt = ByteArray(16).also { buf.get(it) }; buf.int
        val asPublic = ByteArray(buf.get().toInt()).also { buf.get(it) }
        val body = ByteArray(buf.remaining()).also { buf.get(it) }
        val (cek, nonce) = derive(authSecret, ecdh(uaPrivate, publicFromRaw(asPublic)), uaPublic, asPublic, salt)
        val plain = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, SecretKeySpec(cek, "AES"), GCMParameterSpec(128, nonce)) }.doFinal(body)
        return plain.copyOf(plain.indexOfLast { it == 2.toByte() })
    }

    /** Заголовок Authorization по VAPID: JWT на 12 часов для адреса push-сервиса. */
    fun vapid(audience: String, subject: String, priv: PrivateKey, pubRaw: ByteArray, nowSec: Long = System.currentTimeMillis() / 1000): String {
        val head = b64("""{"typ":"JWT","alg":"ES256"}""".toByteArray())
        val claims = b64("""{"aud":"${audience}","exp":${nowSec + 12 * 3600},"sub":"${subject}"}""".toByteArray())
        val sig = Signature.getInstance("SHA256withECDSAinP1363Format").run { initSign(priv); update("$head.$claims".toByteArray()); sign() }
        return "vapid t=$head.$claims.${b64(sig)}, k=${b64(pubRaw)}"
    }

    fun verifyJwt(jwt: String, pubRaw: ByteArray): Boolean {
        val (h, c, s) = jwt.split('.')
        return Signature.getInstance("SHA256withECDSAinP1363Format").run { initVerify(publicFromRaw(pubRaw)); update("$h.$c".toByteArray()); verify(unb64(s)) }
    }

    fun pkcs8(priv: PrivateKey): ByteArray = (priv as ECPrivateKey).encoded
}
