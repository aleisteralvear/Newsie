import { XMLParser } from 'fast-xml-parser';
import {
  estimateReadTimeMinutes,
  normalizeArticleUrl,
  normalizePublishedDate,
  stripHtmlToText,
} from '../engine/normalizer';

export type FeedFormat = 'RSS' | 'Atom';
type XmlNode = Record<string, unknown>;

export interface ParsedFeedArticle {
  guid?: string;
  title: string;
  url: string;
  normalizedUrl: string;
  description: string;
  excerpt: string;
  author?: string;
  publishedAtIso: string;
  imageUrl?: string;
  readTimeMinutes: number;
  keywords: string[];
}

export interface ParsedFeedResult {
  format: FeedFormat;
  title: string;
  description: string;
  siteUrl?: string;
  articles: ParsedFeedArticle[];
}

export class FeedParseError extends Error {
  constructor(
    public readonly code:
      | 'XXE_REJECTED'
      | 'INVALID_XML'
      | 'UNSUPPORTED_FORMAT'
      | 'EMPTY_FEED',
    message: string,
  ) {
    super(message);
    this.name = 'FeedParseError';
  }
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: false,
  htmlEntities: false,
  trimValues: true,
});

function decodeBasicXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

function asRecord(val: unknown): XmlNode {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return val as XmlNode;
  }
  return {};
}

function toNodeArray(val: unknown): XmlNode[] {
  if (val === undefined || val === null) return [];
  const list = Array.isArray(val) ? val : [val];
  return list.map((item) => asRecord(item));
}

function toRawArray(val: unknown): unknown[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function extractText(val: unknown): string {
  if (typeof val === 'string') return decodeBasicXmlEntities(val);
  if (typeof val === 'number') return String(val);
  if (val && typeof val === 'object') {
    const obj = val as XmlNode;
    if (typeof obj['#text'] === 'string') return decodeBasicXmlEntities(obj['#text']);
    if (typeof obj['@_href'] === 'string') return decodeBasicXmlEntities(obj['@_href']);
  }
  return '';
}

function extractImageFromItem(item: XmlNode, rawHtml: string): string | undefined {
  for (const m of toNodeArray(item['media:content'])) {
    const url = m['@_url'];
    if (typeof url === 'string' && url.startsWith('http')) {
      return decodeBasicXmlEntities(url);
    }
  }

  for (const t of toNodeArray(item['media:thumbnail'])) {
    const url = t['@_url'];
    if (typeof url === 'string' && url.startsWith('http')) {
      return decodeBasicXmlEntities(url);
    }
  }

  for (const enc of toNodeArray(item.enclosure)) {
    const type = String(enc['@_type'] || '');
    const url = enc['@_url'];
    if (
      typeof url === 'string' &&
      url.startsWith('http') &&
      (!type || type.startsWith('image/'))
    ) {
      return decodeBasicXmlEntities(url);
    }
  }

  const imgMatch = rawHtml.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  if (imgMatch?.[1]) return decodeBasicXmlEntities(imgMatch[1]);

  return undefined;
}

function extractAtomLink(links: unknown): string {
  const list = toRawArray(links);
  for (const entry of list) {
    if (typeof entry === 'string') return decodeBasicXmlEntities(entry);
    if (entry && typeof entry === 'object') {
      const node = entry as XmlNode;
      const rel = String(node['@_rel'] || 'alternate');
      const href = node['@_href'];
      if (rel === 'alternate' && typeof href === 'string') {
        return decodeBasicXmlEntities(href);
      }
    }
  }
  const first = list[0];
  if (first && typeof first === 'object') {
    const href = (first as XmlNode)['@_href'];
    if (typeof href === 'string') return decodeBasicXmlEntities(href);
  }
  return '';
}

export function parseFeedXml(rawXml: string, fallbackBaseUrl?: string): ParsedFeedResult {
  const trimmed = rawXml.trim();
  if (!trimmed) {
    throw new FeedParseError('INVALID_XML', 'Feed response body is empty.');
  }

  if (/<!DOCTYPE\b/i.test(trimmed) || /<!ENTITY\b/i.test(trimmed)) {
    throw new FeedParseError(
      'XXE_REJECTED',
      'External XML entities and DOCTYPE declarations are rejected for security.',
    );
  }

  let doc: XmlNode;
  try {
    doc = asRecord(xmlParser.parse(trimmed));
  } catch {
    throw new FeedParseError('INVALID_XML', 'Feed XML could not be parsed.');
  }

  const rss = doc.rss ? asRecord(doc.rss) : undefined;
  if (rss && rss.channel) {
    const channel = asRecord(rss.channel);
    const title = stripHtmlToText(extractText(channel.title)) || 'Untitled RSS Feed';
    const description = stripHtmlToText(extractText(channel.description));
    const siteUrl = extractText(channel.link) || fallbackBaseUrl;
    const rawItems = toNodeArray(channel.item);

    if (rawItems.length === 0) {
      throw new FeedParseError('EMPTY_FEED', 'RSS feed contains zero articles.');
    }

    const articles: ParsedFeedArticle[] = rawItems
      .map((item) => {
        const itemTitle = stripHtmlToText(extractText(item.title));
        const itemUrl = extractText(item.link) || extractText(item.guid);
        const rawDesc =
          extractText(item['content:encoded']) ||
          extractText(item.description) ||
          '';
        const cleanDesc = stripHtmlToText(rawDesc);
        const categories = toRawArray(item.category)
          .map((c) => stripHtmlToText(extractText(c)).toLowerCase())
          .filter(Boolean);

        return {
          guid: extractText(item.guid) || undefined,
          title: itemTitle || 'Untitled story',
          url: itemUrl,
          normalizedUrl: normalizeArticleUrl(itemUrl),
          description: cleanDesc.slice(0, 260) || itemTitle,
          excerpt: cleanDesc || itemTitle,
          author:
            stripHtmlToText(
              extractText(item['dc:creator']) || extractText(item.author),
            ) || undefined,
          publishedAtIso: normalizePublishedDate(
            extractText(item.pubDate) || extractText(item['dc:date']),
          ),
          imageUrl: extractImageFromItem(item, rawDesc),
          readTimeMinutes: estimateReadTimeMinutes(cleanDesc || itemTitle),
          keywords: categories,
        };
      })
      .filter((a) => Boolean(a.url));

    if (articles.length === 0) {
      throw new FeedParseError('EMPTY_FEED', 'RSS feed had no valid article links.');
    }

    return { format: 'RSS', title, description, siteUrl, articles };
  }

  const feed = doc.feed ? asRecord(doc.feed) : undefined;
  if (feed && (feed.entry !== undefined || feed.title !== undefined)) {
    const title = stripHtmlToText(extractText(feed.title)) || 'Untitled Atom Feed';
    const description = stripHtmlToText(extractText(feed.subtitle));
    const siteUrl = extractAtomLink(feed.link) || fallbackBaseUrl;
    const entries = toNodeArray(feed.entry);

    if (entries.length === 0) {
      throw new FeedParseError('EMPTY_FEED', 'Atom feed contains zero entries.');
    }

    const articles: ParsedFeedArticle[] = entries
      .map((entry) => {
        const entryTitle = stripHtmlToText(extractText(entry.title));
        const entryUrl = extractAtomLink(entry.link) || extractText(entry.id);
        const rawContent =
          extractText(entry.content) || extractText(entry.summary) || '';
        const cleanDesc = stripHtmlToText(rawContent);
        const authorObj = entry.author ? asRecord(entry.author) : undefined;
        const authorName = authorObj && authorObj.name !== undefined
          ? stripHtmlToText(extractText(authorObj.name))
          : stripHtmlToText(extractText(entry.author));
        const categories = toRawArray(entry.category)
          .map((c) => {
            if (c && typeof c === 'object') {
              return String((c as XmlNode)['@_term'] || '').trim().toLowerCase();
            }
            return stripHtmlToText(extractText(c)).toLowerCase();
          })
          .filter(Boolean);

        return {
          guid: extractText(entry.id) || undefined,
          title: entryTitle || 'Untitled story',
          url: entryUrl,
          normalizedUrl: normalizeArticleUrl(entryUrl),
          description: cleanDesc.slice(0, 260) || entryTitle,
          excerpt: cleanDesc || entryTitle,
          author: authorName || undefined,
          publishedAtIso: normalizePublishedDate(
            extractText(entry.published) || extractText(entry.updated),
          ),
          imageUrl: extractImageFromItem(entry, rawContent),
          readTimeMinutes: estimateReadTimeMinutes(cleanDesc || entryTitle),
          keywords: categories,
        };
      })
      .filter((a) => Boolean(a.url));

    if (articles.length === 0) {
      throw new FeedParseError('EMPTY_FEED', 'Atom feed had no valid entry links.');
    }

    return { format: 'Atom', title, description, siteUrl, articles };
  }

  throw new FeedParseError(
    'UNSUPPORTED_FORMAT',
    'Document is neither a valid RSS 2.0 nor Atom 1.0 feed.',
  );
}
