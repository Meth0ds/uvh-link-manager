package example.uvh

import okhttp3.Authenticator
import okhttp3.CookieJar
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URI
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Requires OkHttp 4/5. Run resolve() on an IO worker, never the Android UI thread. */
class UvhAppLinks(
    private val host: String,
    private val profileId: UUID,
    private val allowedPrefixes: List<String>,
    resolverOrigin: URI = URI("https://uvh.es"),
    private val userAgent: String = "UVH-AppLinks/1 (Android; Mobile)"
) {
    init {
        require(resolverOrigin.scheme == "https" && resolverOrigin.host != null && resolverOrigin.userInfo == null && resolverOrigin.rawQuery == null && resolverOrigin.rawFragment == null && resolverOrigin.path.orEmpty() in listOf("", "/"))
    }
    private val resolverUrl = resolverOrigin.resolve("/api/v1/app-links/resolve").toASCIIString()
    sealed interface Result {
        data class Content(val route: String, val webUrl: URI) : Result
        data class Web(val url: URI) : Result
        data object PasswordRequired : Result
        data object Unavailable : Result
    }
    // Retain in memory for this opening's network retries and password prompt.
    // Do not persist or log a password, grant, request body or complete URL.
    class Opening internal constructor(
        internal val url: URI,
        internal val attemptId: UUID = UUID.randomUUID(),
        internal var grant: String?,
        internal var challenge: String? = null
    )
    private val client = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
        .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
        .followRedirects(false).followSslRedirects(false).cache(null)
        .callTimeout(12, TimeUnit.SECONDS).build()

    fun opening(incoming: URI): Opening? {
        if (incoming.scheme != "https" || incoming.host?.lowercase() != host.lowercase() ||
            incoming.userInfo != null || incoming.port != -1 ||
            !Regex("^/a/[A-Za-z0-9_-]{1,64}$").matches(incoming.rawPath ?: "")) return null
        val query = incoming.rawQuery.orEmpty().split('&').filter { it.isNotEmpty() }
        if (query.any { it.substringBefore('=') !in listOf("qr", "handoff") }) return null
        val grant = incoming.rawFragment?.split('&')?.firstOrNull { it.startsWith("grant=") }
            ?.substringAfter('=')?.let { java.net.URLDecoder.decode(it, "UTF-8") }
        if ((grant?.length ?: 0) > 4096) return null
        val clean = URI(incoming.toASCIIString().substringBefore('#'))
        return Opening(clean, grant = grant)
    }
    /** Same Opening for a retry. A fresh user opening always needs fresh resolution. */
    fun resolve(opening: Opening, password: String? = null): Result {
        repeat(2) {
            val payload = JSONObject().put("launchUrl", opening.url.toASCIIString())
                .put("profileId", profileId.toString()).put("attemptId", opening.attemptId.toString())
            opening.challenge?.let { payload.put("challenge", it) }
            opening.grant?.let { payload.put("grant", it) }
            password?.let { payload.put("password", it) }
            val request = Request.Builder().url(resolverUrl)
                .header("Accept", "application/json")
                .header("User-Agent", userAgent)
                .header("Accept-Language", java.util.Locale.getDefault().toLanguageTag())
                .post(payload.toString().toRequestBody("application/json".toMediaType())).build()
            client.newCall(request).execute().use { response ->
                if (response.body?.contentType()?.subtype != "json") return Result.Unavailable
                val stream = response.body!!.byteStream()
                val buffer = ByteArray(16_385)
                var length = 0
                while (length < buffer.size) {
                    val count = stream.read(buffer, length, buffer.size - length)
                    if (count < 0) break
                    length += count
                }
                if (length > 16_384) return Result.Unavailable
                val reply = JSONObject(String(buffer, 0, length, Charsets.UTF_8))
                when {
                    response.code == 202 && reply.optString("kind") == "challenge_required" -> {
                        opening.challenge = reply.getString("challenge")
                    }
                    response.code == 401 && reply.optString("kind") == "password_required" -> return Result.PasswordRequired
                    response.code == 200 -> {
                        val web = runCatching { URI(reply.getString("webUrl")) }.getOrNull() ?: return Result.Unavailable
                        if (web.scheme !in listOf("http", "https") || web.host == null || web.userInfo != null) return Result.Unavailable
                        val grant = reply.opt("grant") as? String ?: return Result.Unavailable
                        if (grant.isEmpty() || grant.length > 4096) return Result.Unavailable
                        opening.grant = grant
                        if (reply.optString("kind") == "web") return Result.Web(web)
                        val route = reply.optString("route")
                        if (reply.optString("kind") != "content" || reply.optString("profileId") != profileId.toString() ||
                            !Regex("^/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]*$").matches(route) ||
                            allowedPrefixes.none { route.startsWith(it) || route == it.removeSuffix("/") }) return Result.Unavailable
                        return Result.Content(route, web)
                    }
                    else -> return Result.Unavailable
                }
            }
        }
        return Result.Unavailable
    }
}
