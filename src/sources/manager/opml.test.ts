import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CATEGORIES } from '../../news/categories/defaultCategories';
import { SAMPLE_SOURCES } from './sampleSources';
import { exportSourcesToOpml, parseOpmlXml } from './opml';

test('exportSourcesToOpml produces valid OPML 2.0 that round-trips cleanly', () => {
  const opml = exportSourcesToOpml(SAMPLE_SOURCES.slice(0, 3), DEFAULT_CATEGORIES);
  assert.ok(opml.includes('<opml version="2.0">'));
  assert.ok(opml.includes('Meridian Science &amp; Space'));

  const imported = parseOpmlXml(opml);
  assert.equal(imported.length, 3);
  assert.equal(imported[0].name, 'Meridian Science & Space');
  assert.equal(imported[0].categoryName, 'Space');
});

test('parseOpmlXml skips private/localhost URLs and rejects XXE payloads', () => {
  const mixed = `<?xml version="1.0"?>
  <opml version="2.0">
    <body>
      <outline text="Tech">
        <outline text="Local" xmlUrl="http://127.0.0.1:9000/rss" />
        <outline text="Public" xmlUrl="https://feeds.arstechnica.com/arstechnica/index" />
      </outline>
    </body>
  </opml>`;
  const parsed = parseOpmlXml(mixed);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'Public');
  assert.equal(parsed[0].categoryName, 'Tech');

  assert.throws(
    () => parseOpmlXml('<!DOCTYPE opml [<!ENTITY x SYSTEM "file:///etc/passwd">]><opml/>'),
    /DOCTYPE/,
  );
});
