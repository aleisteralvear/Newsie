package com.aleisteralvear.newsie.network.rss

import com.aleisteralvear.newsie.domain.models.Category
import com.aleisteralvear.newsie.domain.models.FeedFormat
import com.aleisteralvear.newsie.domain.models.NewsSource
import com.aleisteralvear.newsie.network.security.UrlSecurityGuard
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.StringReader
import java.util.UUID

data class OpmlImportResult(
    val importedSources: List<NewsSource>,
    val skippedEntries: List<String>,
)

object OpmlManager {
    fun exportToOpml(sources: List<NewsSource>, categories: List<Category>): String {
        val categoryMap = categories.associate { it.id to it.name }
        val grouped = sources.groupBy { categoryMap[it.categoryId] ?: "General" }

        return buildString {
            appendLine("""<?xml version="1.0" encoding="UTF-8"?>""")
            appendLine("""<opml version="2.0">""")
            appendLine("""  <head>""")
            appendLine("""    <title>Newsie Subscriptions</title>""")
            appendLine("""  </head>""")
            appendLine("""  <body>""")
            for ((catName, groupSources) in grouped) {
                val escapedCat = escapeXml(catName)
                appendLine("""    <outline text="$escapedCat" title="$escapedCat">""")
                for (src in groupSources) {
                    val escapedName = escapeXml(src.name)
                    val escapedUrl = escapeXml(src.url)
                    val typeAttr = if (src.format == FeedFormat.ATOM) "atom" else "rss"
                    appendLine(
                        """      <outline text="$escapedName" title="$escapedName" type="$typeAttr" xmlUrl="$escapedUrl" />""",
                    )
                }
                appendLine("""    </outline>""")
            }
            appendLine("""  </body>""")
            append("""</opml>""")
        }
    }

    fun parseOpmlImport(
        opmlXml: String,
        categories: List<Category>,
        existingUrls: Set<String>,
    ): OpmlImportResult {
        SecureFeedParser.assertXmlSafeAgainstXxe(opmlXml)
        val trimmed = opmlXml.trimStart('\uFEFF', ' ', '\n', '\r', '\t')
        if (!trimmed.startsWith("<")) {
            throw FeedParseException("OPML import is not valid XML.")
        }

        val factory = XmlPullParserFactory.newInstance().apply {
            isNamespaceAware = false
            runCatching { setFeature(XmlPullParser.FEATURE_PROCESS_DOCDECL, false) }
        }
        val parser = factory.newPullParser()
        parser.setInput(StringReader(trimmed))

        val categoryByName = categories.associateBy { it.name.lowercase() }
        val imported = mutableListOf<NewsSource>()
        val skipped = mutableListOf<String>()
        val seenUrls = existingUrls.map { it.lowercase() }.toMutableSet()
        val folderStack = ArrayDeque<String>()

        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            if (event == XmlPullParser.START_TAG) {
                if (parser.name.equals("outline", ignoreCase = true)) {
                    val xmlUrl = parser.getAttributeValue(null, "xmlUrl")?.trim()
                    val title = parser.getAttributeValue(null, "title")
                        ?: parser.getAttributeValue(null, "text")
                        ?: "Imported Feed"
                    val type = parser.getAttributeValue(null, "type")?.lowercase() ?: "rss"

                    if (xmlUrl.isNullOrBlank()) {
                        folderStack.addLast(title)
                    } else {
                        folderStack.addLast("") // sentinel for leaf outline
                        try {
                            val validUri = UrlSecurityGuard.validateFeedUrlSyntax(xmlUrl)
                            val canon = validUri.toString()
                            if (seenUrls.add(canon.lowercase())) {
                                val folder = folderStack.lastOrNull { it.isNotBlank() }?.lowercase()
                                val catId = (folder?.let { categoryByName[it]?.id }) ?: "news"
                                imported.add(
                                    NewsSource(
                                        id = "src-${UUID.randomUUID().toString().take(8)}",
                                        name = title.take(80),
                                        url = canon,
                                        format = if (type == "atom") FeedFormat.ATOM else FeedFormat.RSS,
                                        categoryId = catId,
                                        enabled = true,
                                        description = "Imported via OPML",
                                        lastUpdatedLabel = "Pending sync",
                                        isSample = false,
                                    ),
                                )
                            } else {
                                skipped.add("$title (duplicate)")
                            }
                        } catch (ex: Exception) {
                            skipped.add("$title (${ex.message ?: "unsafe URL"})")
                        }
                    }
                }
            } else if (event == XmlPullParser.END_TAG) {
                if (parser.name.equals("outline", ignoreCase = true) && folderStack.isNotEmpty()) {
                    folderStack.removeLast()
                }
            }
            event = parser.next()
        }

        return OpmlImportResult(importedSources = imported, skippedEntries = skipped)
    }

    private fun escapeXml(input: String): String = input
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&apos;")
}
