package com.aleisteralvear.newsie.network.http

import com.aleisteralvear.newsie.network.rss.SecureFeedParser
import com.aleisteralvear.newsie.network.security.UnsafeUrlException
import com.aleisteralvear.newsie.network.security.UrlSecurityGuard
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.InetAddress
import java.net.URI
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit

sealed interface FeedHttpResult {
    data class Success(
        val body: String,
        val finalUrl: String,
        val etag: String?,
        val lastModified: String?,
    ) : FeedHttpResult

    data object NotModified : FeedHttpResult

    data class Failure(val reason: String) : FeedHttpResult
}

/**
 * Custom OkHttp DNS implementation validating every resolved IP before socket connection,
 * preventing DNS rebinding and private-network SSRF leaks.
 */
class SsrfGuardingDns(
    private val delegate: Dns = Dns.SYSTEM,
    private val allowLocalNetworkExplicitly: Boolean = false,
) : Dns {
    override fun lookup(hostname: String): List<InetAddress> {
        val addresses = delegate.lookup(hostname)
        for (addr in addresses) {
            UrlSecurityGuard.assertAddressSafe(addr, allowLocalNetworkExplicitly)
        }
        return addresses
    }
}

class NewsHttpClient(
    baseClient: OkHttpClient? = null,
    private val allowCleartextHttp: Boolean = false,
    private val allowLocalNetworkForApprovedTests: Boolean = false,
) {
    private val client: OkHttpClient = (baseClient?.newBuilder() ?: OkHttpClient.Builder())
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .dns(SsrfGuardingDns(allowLocalNetworkExplicitly = allowLocalNetworkForApprovedTests))
        .build()

    suspend fun fetchFeed(
        rawUrl: String,
        etag: String? = null,
        lastModified: String? = null,
    ): FeedHttpResult = withContext(Dispatchers.IO) {
        var currentUrl = try {
            UrlSecurityGuard.validateFeedUrlSyntax(
                rawUrl,
                allowLocalNetworkExplicitly = allowLocalNetworkForApprovedTests,
                allowCleartextHttp = allowCleartextHttp,
            ).toString()
        } catch (ex: UnsafeUrlException) {
            return@withContext FeedHttpResult.Failure(ex.message ?: "Unsafe feed URL blocked.")
        }

        var redirectsFollowed = 0
        while (redirectsFollowed <= MAX_REDIRECTS) {
            val reqBuilder = Request.Builder()
                .url(currentUrl)
                .header("User-Agent", "Newsie-Android/1.0 (+local-rss-reader)")
                .header(
                    "Accept",
                    "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
                )
            if (redirectsFollowed == 0) {
                if (!etag.isNullOrBlank()) reqBuilder.header("If-None-Match", etag)
                if (!lastModified.isNullOrBlank()) reqBuilder.header("If-Modified-Since", lastModified)
            }

            val response = try {
                client.newCall(reqBuilder.build()).execute()
            } catch (ex: UnsafeUrlException) {
                return@withContext FeedHttpResult.Failure(ex.message ?: "Blocked unsafe network target.")
            } catch (ex: IOException) {
                return@withContext FeedHttpResult.Failure("Network error: ${ex.message ?: "timeout or unreachable host"}")
            } catch (ex: Exception) {
                return@withContext FeedHttpResult.Failure("Request failed: ${ex.message ?: "unknown error"}")
            }

            response.use { res ->
                when (res.code) {
                    304 -> return@withContext FeedHttpResult.NotModified
                    in 300..399 -> {
                        val location = res.header("Location")
                            ?: return@withContext FeedHttpResult.Failure("Redirect response missing Location header.")
                        val resolvedTarget = try {
                            URI(currentUrl).resolve(location).toString()
                        } catch (_: Exception) {
                            return@withContext FeedHttpResult.Failure("Malformed redirect URL.")
                        }
                        currentUrl = try {
                            UrlSecurityGuard.validateFeedUrlSyntax(
                                resolvedTarget,
                                allowLocalNetworkExplicitly = allowLocalNetworkForApprovedTests,
                                allowCleartextHttp = allowCleartextHttp,
                            ).toString()
                        } catch (ex: UnsafeUrlException) {
                            return@withContext FeedHttpResult.Failure(
                                "Blocked unsafe redirect target: ${ex.message}",
                            )
                        }
                        redirectsFollowed++
                    }
                    in 200..299 -> {
                        val body = res.body ?: return@withContext FeedHttpResult.Failure("Empty response body.")
                        val contentLength = body.contentLength()
                        if (contentLength > SecureFeedParser.MAX_FEED_BYTES) {
                            return@withContext FeedHttpResult.Failure("Feed exceeds 2 MB maximum size limit.")
                        }
                        val bytes = try {
                            readCappedBytes(body.byteStream(), SecureFeedParser.MAX_FEED_BYTES)
                        } catch (ex: FeedTooLargeException) {
                            return@withContext FeedHttpResult.Failure(ex.message ?: "Feed exceeded 2 MB limit.")
                        }
                        return@withContext FeedHttpResult.Success(
                            body = String(bytes, StandardCharsets.UTF_8),
                            finalUrl = currentUrl,
                            etag = res.header("ETag"),
                            lastModified = res.header("Last-Modified"),
                        )
                    }
                    else -> {
                        return@withContext FeedHttpResult.Failure("HTTP ${res.code} ${res.message}".trim())
                    }
                }
            }
        }
        FeedHttpResult.Failure("Exceeded maximum redirect limit ($MAX_REDIRECTS).")
    }

    private fun readCappedBytes(stream: java.io.InputStream, maxBytes: Int): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(8192)
        var total = 0
        while (true) {
            val read = stream.read(buf)
            if (read == -1) break
            total += read
            if (total > maxBytes) {
                throw FeedTooLargeException("Feed payload exceeded ${maxBytes / (1024 * 1024)} MB safety limit.")
            }
            out.write(buf, 0, read)
        }
        return out.toByteArray()
    }

    private class FeedTooLargeException(message: String) : IOException(message)

    companion object {
        const val MAX_REDIRECTS = 5
    }
}
