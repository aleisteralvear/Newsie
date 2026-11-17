import { XMLParser } from 'fast-xml-parser';
import { Category, NewsSource } from '../../core/common/types';
import { validateExternalFeedUrlSyntax } from '../../core/security/urlGuard';

export interface OpmlImportEntry {
  name: string;
  url: string;
  categoryName?: string;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  trimValues: true,
});

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function exportSourcesToOpml(
  sources: NewsSource[],
  categories: Category[],
): string {
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const grouped = new Map<string, NewsSource[]>();

  for (const src of sources) {
    const catName = catMap.get(src.categoryId) ?? 'General';
    const list = grouped.get(catName) ?? [];
    list.push(src);
    grouped.set(catName, list);
  }

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    '    <title>Newsie Subscriptions</title>',
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    '  </head>',
    '  <body>',
  ];

  for (const [catName, list] of grouped.entries()) {
    lines.push(`    <outline text="${escapeXml(catName)}" title="${escapeXml(catName)}">`);
    for (const s of list) {
      const type = s.format === 'Atom' ? 'atom' : 'rss';
      lines.push(
        `      <outline type="${type}" text="${escapeXml(s.name)}" title="${escapeXml(s.name)}" xmlUrl="${escapeXml(s.url)}" />`,
      );
    }
    lines.push('    </outline>');
  }

  lines.push('  </body>', '</opml>');
  return lines.join('\n');
}

export function parseOpmlXml(rawOpml: string): OpmlImportEntry[] {
  const trimmed = rawOpml.trim();
  if (!trimmed) {
    throw new Error('OPML document is empty.');
  }
  if (/<!DOCTYPE\b/i.test(trimmed) || /<!ENTITY\b/i.test(trimmed)) {
    throw new Error('External XML entities and DOCTYPE declarations are rejected.');
  }

  let doc: Record<string, unknown>;
  try {
    doc = xmlParser.parse(trimmed) as Record<string, unknown>;
  } catch {
    throw new Error('Malformed OPML XML document.');
  }

  const opml = doc.opml as Record<string, unknown> | undefined;
  const body = opml?.body as Record<string, unknown> | undefined;
  if (!body || body.outline === undefined) {
    throw new Error('OPML file contains no subscription outlines.');
  }

  const entries: OpmlImportEntry[] = [];
  const seenUrls = new Set<string>();

function decodeBasicXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

  const walk = (node: unknown, parentCategory?: string) => {
    if (!node) return;
    const list = Array.isArray(node) ? node : [node];
    for (const rawItem of list) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const item = rawItem as Record<string, unknown>;
      const xmlUrl =
        typeof item['@_xmlUrl'] === 'string'
          ? decodeBasicXmlEntities(item['@_xmlUrl'].trim())
          : '';
      const rawLabel =
        (typeof item['@_title'] === 'string' && item['@_title'].trim()) ||
        (typeof item['@_text'] === 'string' && item['@_text'].trim()) ||
        '';
      const label = decodeBasicXmlEntities(rawLabel);

      if (xmlUrl) {
        try {
          const validUrl = validateExternalFeedUrlSyntax(xmlUrl).toString();
          if (!seenUrls.has(validUrl.toLowerCase())) {
            seenUrls.add(validUrl.toLowerCase());
            entries.push({
              name: label || new URL(validUrl).hostname.replace(/^www\./, ''),
              url: validUrl,
              categoryName: parentCategory,
            });
          }
        } catch {
          // Skip unsafe/private OPML URLs silently during import validation
        }
      }

      if (item.outline !== undefined) {
        walk(item.outline, xmlUrl ? parentCategory : label || parentCategory);
      }
    }
  };

  walk(body.outline);
  if (entries.length === 0) {
    throw new Error('No valid public RSS/Atom URLs found in OPML file.');
  }
  return entries;
}
