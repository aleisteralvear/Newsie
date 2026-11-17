import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedParseError, parseFeedXml } from './feedParser';
import {
  computeArticleFingerprint,
  computeTitleTokenSimilarity,
  normalizeArticleUrl,
} from '../engine/normalizer';
import {
  isPrivateOrReservedIp,
  UnsafeUrlError,
  validateExternalFeedUrlSyntax,
} from '../../core/security/urlGuard';

test('parseFeedXml parses RSS 2.0 feeds with media image extraction and HTML stripping', () => {
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
    <channel>
      <title>Observatory Dispatch</title>
      <description>Space and astronomy bulletins</description>
      <item>
        <title>Comet Tail Spectroscopy Update</title>
        <link>https://obs.example.org/comet?utm_source=rss&amp;id=7</link>
        <guid>comet-7</guid>
        <pubDate>Tue, 17 Nov 2026 08:00:00 GMT</pubDate>
        <description>&lt;p&gt;New optical filters resolved &lt;strong&gt;cyanogen&lt;/strong&gt; bands.&lt;/p&gt;</description>
        <media:content url="https://obs.example.org/img/comet.jpg" medium="image" />
      </item>
    </channel>
  </rss>`;

  const parsed = parseFeedXml(rss);
  assert.equal(parsed.format, 'RSS');
  assert.equal(parsed.title, 'Observatory Dispatch');
  assert.equal(parsed.articles.length, 1);
  assert.equal(parsed.articles[0].normalizedUrl, 'https://obs.example.org/comet?id=7');
  assert.equal(parsed.articles[0].description, 'New optical filters resolved cyanogen bands.');
  assert.equal(parsed.articles[0].imageUrl, 'https://obs.example.org/img/comet.jpg');
});

test('parseFeedXml parses Atom 1.0 feeds cleanly', () => {
  const atom = `<?xml version="1.0" encoding="utf-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <title>Polar Ledger</title>
    <subtitle>Marine science updates</subtitle>
    <entry>
      <id>urn:uuid:1234</id>
      <title>Salinity Sensor Array</title>
      <link rel="alternate" href="https://polar.example.org/salinity/" />
      <updated>2026-11-17T06:30:00Z</updated>
      <author><name>Henrik Solberg</name></author>
      <summary>Acoustic beacons deployed across northern straits.</summary>
      <category term="Environment" />
    </entry>
  </feed>`;

  const parsed = parseFeedXml(atom);
  assert.equal(parsed.format, 'Atom');
  assert.equal(parsed.articles[0].author, 'Henrik Solberg');
  assert.equal(parsed.articles[0].normalizedUrl, 'https://polar.example.org/salinity');
  assert.deepEqual(parsed.articles[0].keywords, ['environment']);
});

test('parseFeedXml rejects XXE/DOCTYPE payloads and malformed XML', () => {
  const xxe = `<?xml version="1.0"?>
  <!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
  <rss><channel><title>&xxe;</title></channel></rss>`;

  assert.throws(
    () => parseFeedXml(xxe),
    (err: unknown) => err instanceof FeedParseError && err.code === 'XXE_REJECTED',
  );

  assert.throws(
    () => parseFeedXml('<notafeed><hello/></notafeed>'),
    (err: unknown) => err instanceof FeedParseError && err.code === 'UNSUPPORTED_FORMAT',
  );
});

test('URL normalization, fingerprinting, and SSRF protection guard against unsafe destinations', () => {
  assert.equal(
    normalizeArticleUrl('HTTPS://News.Example.org/Story/?utm_medium=email&b=2&a=1#comments'),
    'https://news.example.org/Story?a=1&b=2',
  );

  const fp1 = computeArticleFingerprint('Daily Wire', 'Hello World!', 'https://a.org/1');
  const fp2 = computeArticleFingerprint('daily wire', 'hello world', 'https://a.org/1');
  assert.equal(fp1, fp2);

  assert.ok(computeTitleTokenSimilarity('Lunar relay completes handshake', 'Lunar relay laser handshake') > 0.4);

  assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
  assert.equal(isPrivateOrReservedIp('10.20.30.40'), true);
  assert.equal(isPrivateOrReservedIp('93.184.216.34'), false);

  assert.throws(
    () => validateExternalFeedUrlSyntax('http://169.254.169.254/latest/meta-data/'),
    (err: unknown) => err instanceof UnsafeUrlError && err.code === 'SSRF_BLOCKED',
  );
});
