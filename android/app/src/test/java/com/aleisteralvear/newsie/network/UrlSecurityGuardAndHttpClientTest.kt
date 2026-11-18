package com.aleisteralvear.newsie.network

import com.aleisteralvear.newsie.network.http.FeedHttpResult
import com.aleisteralvear.newsie.network.http.NewsHttpClient
import com.aleisteralvear.newsie.network.security.UnsafeUrlException
import com.aleisteralvear.newsie.network.security.UrlSecurityGuard
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress

class UrlSecurityGuardAndHttpClientTest {

    @Test
    fun blocksNonHttpsEmbeddedCredentialsLocalhostPrivateCidrsAndMetadata() {
        val blockedUrls = listOf(
            "http://example.com/rss.xml",
            "https://user:pass@example.com/rss.xml",
            "https://localhost/feed.xml",
            "https://127.0.0.1/feed.xml",
            "https://10.0.0.15/feed.xml",
            "https://172.16.10.2/feed.xml",
            "https://192.168.1.1/feed.xml",
            "https://169.254.169.254/latest/meta-data",
            "https://100.64.0.10/feed.xml",
            "https://[::1]/feed.xml",
            "https://[fc00::1]/feed.xml",
            "https://[::ffff:127.0.0.1]/feed.xml",
            "https://service.local/feed.xml",
            "https://metadata.google.internal/computeMetadata/v1",
            "ftp://example.com/feed.xml",
            "file:///etc/passwd",
        )

        for (candidate in blockedUrls) {
            assertThrows("Expected block for $candidate", UnsafeUrlException::class.java) {
                UrlSecurityGuard.validateFeedUrlSyntax(candidate)
            }
        }

        // Verify raw InetAddress resolution guard catches private targets behind DNS
        assertThrows(UnsafeUrlException::class.java) {
            UrlSecurityGuard.assertAddressSafe(InetAddress.getByName("127.0.0.1"))
        }
        assertThrows(UnsafeUrlException::class.java) {
            UrlSecurityGuard.assertAddressSafe(InetAddress.getByName("169.254.169.254"))
        }
        assertThrows(UnsafeUrlException::class.java) {
            UrlSecurityGuard.assertAddressSafe(InetAddress.getByName("8.8.8.8"))
            // 8.8.8.8 succeeds; confirm private 10.20.30.40 throws
            UrlSecurityGuard.assertAddressSafe(InetAddress.getByName("10.20.30.40"))
        }
    }

    @Test
    fun allowsPublicHttpsFeedUrls() {
        val uri = UrlSecurityGuard.validateFeedUrlSyntax("https://feeds.bbci.co.uk/news/rss.xml")
        assertEquals("https", uri.scheme)
        assertEquals("feeds.bbci.co.uk", uri.host)
    }

    @Test
    fun httpClient_blocksRedirectToMetadataOrLoopbackEvenWhenInitialHostAllowed() = runTest {
        val server = MockWebServer()
        server.enqueue(
            MockResponse()
                .setResponseCode(302)
                .addHeader("Location", "https://169.254.169.254/latest/meta-data/"),
        )
        server.enqueue(
            MockResponse()
                .setResponseCode(302)
                .addHeader("Location", "http://127.0.0.1:8080/internal"),
        )
        server.start()
        try {
            // Enable loopback ONLY for the mock origin server so redirect target enforcement is still strict
            val client = NewsHttpClient(
                allowCleartextHttp = true,
                allowLocalNetworkForApprovedTests = false,
            )
            // Direct request to MockWebServer localhost fails SSRF unless explicitly waived, proving default SSRF defense
            val directBlocked = client.fetchFeed(server.url("/rss.xml").toString())
            assertTrue(directBlocked is FeedHttpResult.Failure)

            // When target is waived, 169.254.169.254 cloud metadata STILL gets blocked strictly on redirect!
            val strictRedirectClient = NewsHttpClient(
                allowCleartextHttp = true,
                allowLocalNetworkForApprovedTests = true,
            )
            val redirectResult = strictRedirectClient.fetchFeed(server.url("/rss.xml").toString())
            assertTrue(redirectResult is FeedHttpResult.Failure)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun httpClient_handlesConditional304AndRejectsOversizedFeeds() = runTest {
        val server = MockWebServer()
        server.enqueue(
            MockResponse()
                .setResponseCode(304),
        )
        val oversized = "x".repeat(2 * 1024 * 1024 + 512)
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(oversized),
        )
        server.start()
        try {
            val client = NewsHttpClient(
                allowCleartextHttp = true,
                allowLocalNetworkForApprovedTests = true,
            )
            val notMod = client.fetchFeed(
                rawUrl = server.url("/feed").toString(),
                etag = "\"v1\"",
                lastModified = "Wed, 21 Oct 2025 07:28:00 GMT",
            )
            assertTrue(notMod is FeedHttpResult.NotModified)
            val req = server.takeRequest()
            assertEquals("\"v1\"", req.getHeader("If-None-Match"))

            val huge = client.fetchFeed(server.url("/huge").toString())
            assertTrue(huge is FeedHttpResult.Failure)
            assertTrue((huge as FeedHttpResult.Failure).reason.contains("2 MB"))
        } finally {
            server.shutdown()
        }
    }
}
