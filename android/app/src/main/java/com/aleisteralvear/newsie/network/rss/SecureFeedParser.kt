package com.aleisteralvear.newsie.network.rss

import com.aleisteralvear.newsie.domain.models.Article
import com.aleisteralvear.newsie.domain.models.FeedFormat
import com.aleisteralvear.newsie.domain.models.NewsSource
import com.aleisteralvear.newsie.domain.usecases.ArticleNormalizer
import com.aleisteralvear.newsie.network.security.UrlSecurityGuard
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.StringReader
import java.time.Instant

class FeedParseException(message: String, cause: Throwable? = null) : Exception(message, cause)

data class ParsedFeedResult(
    val format: FeedFormat,
    val feedTitle: String,
    val feedDescription: String,
    val articles: List<Article>,
)

/**
 * Secure native XML RSS 2.0 and Atom 1.0 parser.
 * Rejects <!DOCTYPE and <!ENTITY declarations before parsing and disables DTD processing on XmlPullParser.
 */
object SecureFeedParser {
    const val MAX_FEED_BYTES = 2 * 1024 * 1024 // 2 MB cap
    private val dangerousXmlDeclRegex = Regex("<!\\s*(DOCTYPE|ENTITY)", RegexOption.IGNORE_CASE)
    private val imgSrcRegex = Regex("<img[^>]+src=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)

    fun assertXmlSafeAgainstXxe(xmlText: String) {
        if (dangerousXmlDeclRegex.containsMatchIn(xmlText)) {
            throw SecurityException("Rejected unsafe XML containing DOCTYPE or ENTITY declaration (XXE guard).")
        }
    }

    fun parse(
        xmlText: String,
        source: NewsSource,
        categoryName: String,
        maxItems: Int = 50,
    ): ParsedFeedResult {
        if (xmlText.toByteArray().size > MAX_FEED_BYTES) {
            throw FeedParseException("Feed payload exceeds 2 MB safety limit.")
        }
        assertXmlSafeAgainstXxe(xmlText)
        val trimmed = xmlText.trimStart('\uFEFF', ' ', '\n', '\r', '\t')
        if (trimmed.isEmpty() || !trimmed.startsWith("<")) {
            throw FeedParseException("Response is not a valid RSS or Atom XML document.")
        }

        val factory = XmlPullParserFactory.newInstance().apply {
            isNamespaceAware = true
            runCatching { setFeature(XmlPullParser.FEATURE_PROCESS_DOCDECL, false) }
            runCatching { setFeature(XmlPullParser.FEATURE_VALIDATION, false) }
        }
        val parser = factory.newPullParser()
        parser.setInput(StringReader(trimmed))

        var rootDetected: FeedFormat? = null
        var feedTitle = source.name
        var feedDescription = source.description
        val articles = mutableListOf<Article>()

        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT && articles.size < maxItems) {
            if (event == XmlPullParser.START_TAG) {
                val localName = parser.name?.substringAfter(":")?.lowercase() ?: ""
                when {
                    rootDetected == null && (localName == "rss" || localName == "rdf") -> {
                        rootDetected = FeedFormat.RSS
                    }
                    rootDetected == null && localName == "feed" -> {
                        rootDetected = FeedFormat.ATOM
                    }
                    rootDetected == null -> {
                        throw FeedParseException("Unsupported XML root <$localName>; expected RSS or Atom.")
                    }
                    rootDetected == FeedFormat.RSS && localName == "channel" -> {
                        val channelMeta = parseRssChannel(parser, source, categoryName, maxItems)
                        feedTitle = channelMeta.first.ifBlank { source.name }
                        feedDescription = channelMeta.second.ifBlank { source.description }
                        articles.addAll(channelMeta.third)
                        break
                    }
                    rootDetected == FeedFormat.RSS && localName == "item" -> {
                        parseRssItem(parser, source, categoryName)?.let { articles.add(it) }
                    }
                    rootDetected == FeedFormat.ATOM && localName == "title" -> {
                        feedTitle = ArticleNormalizer.stripHtmlToPlainText(readElementText(parser))
                            .ifBlank { source.name }
                    }
                    rootDetected == FeedFormat.ATOM && localName == "subtitle" -> {
                        feedDescription = ArticleNormalizer.stripHtmlToPlainText(readElementText(parser))
                            .ifBlank { source.description }
                    }
                    rootDetected == FeedFormat.ATOM && localName == "entry" -> {
                        parseAtomEntry(parser, source, categoryName)?.let { articles.add(it) }
                    }
                }
            }
            event = parser.next()
        }

        if (rootDetected == null) {
            throw FeedParseException("Could not find an RSS or Atom root element.")
        }

        return ParsedFeedResult(
            format = rootDetected,
            feedTitle = feedTitle,
            feedDescription = feedDescription,
            articles = articles,
        )
    }

    private fun parseRssChannel(
        parser: XmlPullParser,
        source: NewsSource,
        categoryName: String,
        maxItems: Int,
    ): Triple<String, String, List<Article>> {
        var channelTitle = ""
        var channelDesc = ""
        val items = mutableListOf<Article>()
        val startDepth = parser.depth
        var event = parser.next()
        while (!(event == XmlPullParser.END_TAG && parser.depth == startDepth) &&
            event != XmlPullParser.END_DOCUMENT
        ) {
            if (event == XmlPullParser.START_TAG) {
                val tag = parser.name?.substringAfter(":")?.lowercase() ?: ""
                when {
                    tag == "title" && channelTitle.isEmpty() -> {
                        channelTitle = ArticleNormalizer.stripHtmlToPlainText(readElementText(parser))
                    }
                    tag == "description" && channelDesc.isEmpty() -> {
                        channelDesc = ArticleNormalizer.stripHtmlToPlainText(readElementText(parser))
                    }
                    tag == "item" && items.size < maxItems -> {
                        parseRssItem(parser, source, categoryName)?.let { items.add(it) }
                    }
                    else -> skipSubtree(parser)
                }
            }
            event = parser.next()
        }
        return Triple(channelTitle, channelDesc, items)
    }

    private fun parseRssItem(
        parser: XmlPullParser,
        source: NewsSource,
        categoryName: String,
    ): Article? {
        var title = ""
        var link = ""
        var author: String? = null
        var rawDescription = ""
        var rawEncoded = ""
        var pubDateRaw: String? = null
        var imageUrl: String? = null
        val keywords = mutableListOf<String>()

        val itemDepth = parser.depth
        var event = parser.next()
        while (!(event == XmlPullParser.END_TAG && parser.depth == itemDepth) &&
            event != XmlPullParser.END_DOCUMENT
        ) {
            if (event == XmlPullParser.START_TAG) {
                val fullName = parser.name?.lowercase() ?: ""
                val localName = fullName.substringAfter(":")
                when {
                    localName == "title" -> title = ArticleNormalizer.stripHtmlToPlainText(readElementText(parser))
                    localName == "link" -> {
                        val href = parser.getAttributeValue(null, "href")
                        val txt = readElementText(parser)
                        link = (href ?: txt).trim()
                    }
                    localName == "author" || fullName == "dc:creator" -> {
                        val a = ArticleNormalizer.stripHtmlToPlainText(readElementText(parser))
                        if (a.isNotBlank()) author = a
                    }
                    fullName == "content:encoded" -> rawEncoded = readElementText(parser)
                    localName == "description" -> rawDescription = readElementText(parser)
                    localName == "pubdate" || fullName == "dc:date" -> {
                        pubDateRaw = readElementText(parser).trim()
                    }
                    localName == "category" -> {
                        val catText = ArticleNormalizer.stripHtmlToPlainText(readElementText(parser))
                        if (catText.isNotBlank() && keywords.size < 6) keywords.add(catText.lowercase())
                    }
                    localName == "enclosure" -> {
                        val type = parser.getAttributeValue(null, "type")?.lowercase() ?: ""
                        val url = parser.getAttributeValue(null, "url")?.trim()
                        if (imageUrl == null && url != null && (type.startsWith("image/") || url.contains(".jpg") || url.contains(".png") || url.contains(".webp"))) {
                            imageUrl = sanitizeImageUrl(url)
                        }
                        skipSubtree(parser)
                    }
                    fullName == "media:content" || fullName == "media:thumbnail" || localName == "thumbnail" -> {
                        val url = parser.getAttributeValue(null, "url")?.trim()
                        if (imageUrl == null && url != null) {
                            imageUrl = sanitizeImageUrl(url)
                        }
                        skipSubtree(parser)
                    }
                    else -> skipSubtree(parser)
                }
            }
            event = parser.next()
        }

        if (title.isBlank() || link.isBlank()) return null
        val safeUrl = try {
            UrlSecurityGuard.validateFeedUrlSyntax(link, allowCleartextHttp = true).toString()
        } catch (_: Exception) {
            return null
        }

        if (imageUrl == null) {
            val htmlBlob = rawEncoded.ifBlank { rawDescription }
            val match = imgSrcRegex.find(htmlBlob)
            if (match != null) {
                imageUrl = sanitizeImageUrl(match.groupValues[1])
            }
        }

        val cleanDesc = ArticleNormalizer.stripHtmlToPlainText(rawDescription).ifBlank {
            ArticleNormalizer.stripHtmlToPlainText(rawEncoded).take(260)
        }
        val cleanExcerpt = ArticleNormalizer.stripHtmlToPlainText(rawEncoded.ifBlank { rawDescription })
            .ifBlank { cleanDesc.ifBlank { title } }

        val epochMs = ArticleNormalizer.parseFlexibleTimestamp(pubDateRaw)
        val normalizedUrl = ArticleNormalizer.normalizeArticleUrl(safeUrl)
        val fingerprint = ArticleNormalizer.computeFingerprint(source.name, title, normalizedUrl)
        val readMinutes = ArticleNormalizer.estimateReadTimeMinutes("$title $cleanExcerpt")

        return Article(
            id = "art-$fingerprint",
            fingerprint = fingerprint,
            sourceId = source.id,
            publisher = source.name,
            author = author,
            categoryId = source.categoryId,
            categoryName = categoryName,
            title = title,
            description = cleanDesc.ifBlank { title },
            excerpt = cleanExcerpt,
            url = normalizedUrl,
            imageUrl = imageUrl,
            imageAlt = "$title — ${source.name}",
            publishedAtIso = Instant.ofEpochMilli(epochMs).toString(),
            publishedEpochMs = epochMs,
            publishedLabel = ArticleNormalizer.formatRelativeLabel(epochMs),
            readTimeMinutes = readMinutes,
            keywords = keywords.ifEmpty { listOf(source.categoryId) },
            isBookmarked = false,
            isSample = false,
        )
    }

    private fun parseAtomEntry(
        parser: XmlPullParser,
        source: NewsSource,
        categoryName: String,
    ): Article? {
        var title = ""
        var link = ""
        var author: String? = null
        var rawSummary = ""
        var rawContent = ""
        var updatedRaw: String? = null
        var imageUrl: String? = null
        val keywords = mutableListOf<String>()

        val entryDepth = parser.depth
        var event = parser.next()
        while (!(event == XmlPullParser.END_TAG && parser.depth == entryDepth) &&
            event != XmlPullParser.END_DOCUMENT
        ) {
            if (event == XmlPullParser.START_TAG) {
                val fullName = parser.name?.lowercase() ?: ""
                val localName = fullName.substringAfter(":")
                when {
                    localName == "title" -> title = ArticleNormalizer.stripHtmlToPlainText(readElementText(parser))
                    localName == "link" -> {
                        val rel = parser.getAttributeValue(null, "rel")?.lowercase() ?: "alternate"
                        val href = parser.getAttributeValue(null, "href")?.trim()
                        val type = parser.getAttributeValue(null, "type")?.lowercase() ?: ""
                        if (rel == "enclosure" && type.startsWith("image/") && href != null && imageUrl == null) {
                            imageUrl = sanitizeImageUrl(href)
                        } else if ((rel == "alternate" || link.isEmpty()) && !href.isNullOrBlank()) {
                            link = href
                        }
                        skipSubtree(parser)
                    }
                    localName == "author" -> {
                        author = readAuthorNameFromAtom(parser) ?: author
                    }
                    localName == "summary" -> rawSummary = readElementText(parser)
                    localName == "content" -> rawContent = readElementText(parser)
                    localName == "published" -> {
                        val t = readElementText(parser).trim()
                        if (t.isNotBlank()) updatedRaw = t
                    }
                    localName == "updated" -> {
                        val t = readElementText(parser).trim()
                        if (updatedRaw == null && t.isNotBlank()) updatedRaw = t
                    }
                    localName == "category" -> {
                        val term = parser.getAttributeValue(null, "label")
                            ?: parser.getAttributeValue(null, "term")
                            ?: readElementText(parser)
                        val cleanTerm = ArticleNormalizer.stripHtmlToPlainText(term)
                        if (cleanTerm.isNotBlank() && keywords.size < 6) {
                            keywords.add(cleanTerm.lowercase())
                        } else {
                            skipSubtree(parser)
                        }
                    }
                    fullName == "media:content" || fullName == "media:thumbnail" -> {
                        val url = parser.getAttributeValue(null, "url")?.trim()
                        if (imageUrl == null && url != null) imageUrl = sanitizeImageUrl(url)
                        skipSubtree(parser)
                    }
                    else -> skipSubtree(parser)
                }
            }
            event = parser.next()
        }

        if (title.isBlank() || link.isBlank()) return null
        val safeUrl = try {
            UrlSecurityGuard.validateFeedUrlSyntax(link, allowCleartextHttp = true).toString()
        } catch (_: Exception) {
            return null
        }

        if (imageUrl == null) {
            val htmlBlob = rawContent.ifBlank { rawSummary }
            val match = imgSrcRegex.find(htmlBlob)
            if (match != null) {
                imageUrl = sanitizeImageUrl(match.groupValues[1])
            }
        }

        val cleanDesc = ArticleNormalizer.stripHtmlToPlainText(rawSummary).ifBlank {
            ArticleNormalizer.stripHtmlToPlainText(rawContent).take(260)
        }
        val cleanExcerpt = ArticleNormalizer.stripHtmlToPlainText(rawContent.ifBlank { rawSummary })
            .ifBlank { cleanDesc.ifBlank { title } }

        val epochMs = ArticleNormalizer.parseFlexibleTimestamp(updatedRaw)
        val normalizedUrl = ArticleNormalizer.normalizeArticleUrl(safeUrl)
        val fingerprint = ArticleNormalizer.computeFingerprint(source.name, title, normalizedUrl)
        val readMinutes = ArticleNormalizer.estimateReadTimeMinutes("$title $cleanExcerpt")

        return Article(
            id = "art-$fingerprint",
            fingerprint = fingerprint,
            sourceId = source.id,
            publisher = source.name,
            author = author,
            categoryId = source.categoryId,
            categoryName = categoryName,
            title = title,
            description = cleanDesc.ifBlank { title },
            excerpt = cleanExcerpt,
            url = normalizedUrl,
            imageUrl = imageUrl,
            imageAlt = "$title — ${source.name}",
            publishedAtIso = Instant.ofEpochMilli(epochMs).toString(),
            publishedEpochMs = epochMs,
            publishedLabel = ArticleNormalizer.formatRelativeLabel(epochMs),
            readTimeMinutes = readMinutes,
            keywords = keywords.ifEmpty { listOf(source.categoryId) },
            isBookmarked = false,
            isSample = false,
        )
    }

    private fun readAuthorNameFromAtom(parser: XmlPullParser): String? {
        val depth = parser.depth
        var name: String? = null
        var directText = StringBuilder()
        var event = parser.next()
        while (!(event == XmlPullParser.END_TAG && parser.depth == depth) &&
            event != XmlPullParser.END_DOCUMENT
        ) {
            if (event == XmlPullParser.START_TAG) {
                val local = parser.name?.substringAfter(":")?.lowercase() ?: ""
                if (local == "name") {
                    name = ArticleNormalizer.stripHtmlToPlainText(readElementText(parser))
                } else {
                    skipSubtree(parser)
                }
            } else if (event == XmlPullParser.TEXT) {
                directText.append(parser.text)
            }
            event = parser.next()
        }
        return name?.takeIf { it.isNotBlank() } ?: directText.toString().trim().takeIf { it.isNotBlank() }
    }

    private fun readElementText(parser: XmlPullParser): String {
        val targetDepth = parser.depth
        val sb = StringBuilder()
        var event = parser.next()
        while (!(event == XmlPullParser.END_TAG && parser.depth == targetDepth) &&
            event != XmlPullParser.END_DOCUMENT
        ) {
            when (event) {
                XmlPullParser.TEXT, XmlPullParser.CDSECT -> sb.append(parser.text)
                XmlPullParser.START_TAG -> {
                    sb.append(readElementText(parser)).append(" ")
                }
            }
            event = parser.next()
        }
        return sb.toString()
    }

    private fun skipSubtree(parser: XmlPullParser) {
        val depth = parser.depth
        var event = parser.next()
        while (!(event == XmlPullParser.END_TAG && parser.depth == depth) &&
            event != XmlPullParser.END_DOCUMENT
        ) {
            event = parser.next()
        }
    }

    private fun sanitizeImageUrl(raw: String): String? = try {
        UrlSecurityGuard.validateFeedUrlSyntax(raw, allowCleartextHttp = false).toString()
    } catch (_: Exception) {
        null
    }
}
