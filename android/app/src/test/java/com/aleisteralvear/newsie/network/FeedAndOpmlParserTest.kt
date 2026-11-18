package com.aleisteralvear.newsie.network

import com.aleisteralvear.newsie.domain.models.DefaultSeedData
import com.aleisteralvear.newsie.domain.models.FeedFormat
import com.aleisteralvear.newsie.domain.models.NewsSource
import com.aleisteralvear.newsie.domain.usecases.ArticleNormalizer
import com.aleisteralvear.newsie.network.rss.FeedParseException
import com.aleisteralvear.newsie.network.rss.OpmlManager
import com.aleisteralvear.newsie.network.rss.SecureFeedParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import android.app.Application
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class)
class FeedAndOpmlParserTest {

    private val sampleSource = NewsSource(
        id = "src-test",
        name = "Tech Dispatch",
        url = "https://example.org/rss.xml",
        format = FeedFormat.RSS,
        categoryId = "tech",
        enabled = true,
    )

    @Test
    fun parsesRss20AndStripsHtmlAndComputesStableDeduplicationFingerprint() {
        val rssXml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
              <channel>
                <title>Tech Dispatch Weekly</title>
                <description>Systems &amp; security journalism</description>
                <item>
                  <title>Post-Quantum &lt;b&gt;Lattice&lt;/b&gt; Benchmarks</title>
                  <link>https://example.org/articles/pq-benchmarks?utm_source=rss&amp;fbclid=999</link>
                  <description>&lt;p&gt;Independent cryptographic throughput measurements.&lt;/p&gt;</description>
                  <pubDate>Tue, 18 Feb 2025 14:30:00 GMT</pubDate>
                  <media:thumbnail url="https://cdn.example.org/cover.jpg" />
                </item>
              </channel>
            </rss>
        """.trimIndent()

        val parsed = SecureFeedParser.parse(rssXml, sampleSource, "Technology")
        assertEquals(FeedFormat.RSS, parsed.format)
        assertEquals("Tech Dispatch Weekly", parsed.feedTitle)
        assertEquals(1, parsed.articles.size)
        val art = parsed.articles.first()
        assertEquals("Post-Quantum Lattice Benchmarks", art.title)
        assertEquals("https://example.org/articles/pq-benchmarks", art.url)
        assertEquals("https://cdn.example.org/cover.jpg", art.imageUrl)
        assertTrue(!art.description.contains("<p>"))

        val fp1 = ArticleNormalizer.computeFingerprint(
            "Tech Dispatch",
            "Post-Quantum Lattice Benchmarks",
            "https://example.org/articles/pq-benchmarks?utm_campaign=weekly",
        )
        assertEquals(fp1, art.fingerprint)
    }

    @Test
    fun parsesAtom10FeedsCleanly() {
        val atomXml = """
            <?xml version="1.0" encoding="utf-8"?>
            <feed xmlns="http://www.w3.org/2005/Atom">
              <title>Research Atom</title>
              <subtitle>Climate &amp; Science Briefs</subtitle>
              <entry>
                <title>Ocean Heat Sensor Network</title>
                <link rel="alternate" href="https://science.example.org/ocean-heat" />
                <author><name>Dr. Elena Vance</name></author>
                <updated>2025-03-01T09:15:00Z</updated>
                <summary>New autonomous floats report deep-current temperature gradients.</summary>
              </entry>
            </feed>
        """.trimIndent()

        val parsed = SecureFeedParser.parse(atomXml, sampleSource, "Science")
        assertEquals(FeedFormat.ATOM, parsed.format)
        assertEquals("Research Atom", parsed.feedTitle)
        assertEquals(1, parsed.articles.size)
        assertEquals("Dr. Elena Vance", parsed.articles.first().author)
    }

    @Test
    fun rejectsXxeDoctypeEntityAndMalformedXmlAcrossFeedAndOpmlParsers() {
        val xxeRss = """
            <?xml version="1.0"?>
            <!DOCTYPE lolz [
              <!ENTITY lol "lol">
              <!ENTITY lol2 "&lol;&lol;&lol;">
            ]>
            <rss version="2.0"><channel><title>&lol2;</title></channel></rss>
        """.trimIndent()

        assertThrows(SecurityException::class.java) {
            SecureFeedParser.parse(xxeRss, sampleSource, "Tech")
        }

        val xxeOpml = """
            <?xml version="1.0"?>
            <!DOCTYPE opml SYSTEM "https://attacker.example/dtd">
            <opml version="2.0"><body><outline xmlUrl="https://example.org/rss.xml" /></body></opml>
        """.trimIndent()

        assertThrows(SecurityException::class.java) {
            OpmlManager.parseOpmlImport(xxeOpml, DefaultSeedData.defaultCategories, emptySet())
        }

        assertThrows(FeedParseException::class.java) {
            SecureFeedParser.parse("not xml at all", sampleSource, "Tech")
        }
    }

    @Test
    fun opmlExportAndImport_preservesSafeFeedsAndSkipsUnsafeOrDuplicateUrls() {
        val exportXml = OpmlManager.exportToOpml(listOf(sampleSource), DefaultSeedData.defaultCategories)
        assertTrue(exportXml.contains("xmlUrl=\"https://example.org/rss.xml\""))

        val incomingOpml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <opml version="2.0">
              <body>
                <outline text="Technology" title="Technology">
                  <outline text="Duplicate" type="rss" xmlUrl="https://example.org/rss.xml" />
                  <outline text="Fresh Feed" type="atom" xmlUrl="https://news.ycombinator.com/rss" />
                  <outline text="SSRF Exploit" type="rss" xmlUrl="https://169.254.169.254/feed.xml" />
                </outline>
              </body>
            </opml>
        """.trimIndent()

        val result = OpmlManager.parseOpmlImport(
            opmlXml = incomingOpml,
            categories = DefaultSeedData.defaultCategories,
            existingUrls = setOf("https://example.org/rss.xml"),
        )
        assertEquals(1, result.importedSources.size)
        assertEquals("https://news.ycombinator.com/rss", result.importedSources.first().url)
        assertEquals("technology", result.importedSources.first().categoryId)
        assertEquals(2, result.skippedEntries.size)
    }
}
