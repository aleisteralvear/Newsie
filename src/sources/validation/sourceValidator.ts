import { FeedFormat } from '../../news/parser/feedParser';
import { fetchAndParseFeed, FeedFetchError } from '../../news/feeds/aggregator';

export interface ValidatedFeedPreview {
  valid: boolean;
  url: string;
  httpsRecommendedWarning?: string;
  format?: FeedFormat;
  title?: string;
  description?: string;
  articleCount?: number;
  sampleHeadlines?: string[];
  errorCode?: string;
  errorMessage?: string;
}

export async function validateAndPreviewFeed(
  rawUrl: string,
): Promise<ValidatedFeedPreview> {
  const trimmed = rawUrl.trim();
  let httpsWarning: string | undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:') {
      httpsWarning = 'This feed uses unencrypted HTTP; HTTPS is preferred when supported by the publisher.';
    }
  } catch {
    return {
      valid: false,
      url: trimmed,
      errorCode: 'INVALID_URL',
      errorMessage: 'Enter a valid RSS or Atom feed URL starting with https://.',
    };
  }

  try {
    const res = await fetchAndParseFeed(trimmed);
    if (!res.parsed) {
      return {
        valid: false,
        url: trimmed,
        errorCode: 'EMPTY_FEED',
        errorMessage: 'Feed returned no parsable content.',
      };
    }

    return {
      valid: true,
      url: trimmed,
      httpsRecommendedWarning: httpsWarning,
      format: res.parsed.format,
      title: res.parsed.title,
      description: res.parsed.description,
      articleCount: res.parsed.articles.length,
      sampleHeadlines: res.parsed.articles.slice(0, 3).map((a) => a.title),
    };
  } catch (err) {
    if (err instanceof FeedFetchError) {
      return {
        valid: false,
        url: trimmed,
        errorCode: err.code,
        errorMessage: err.message,
      };
    }
    return {
      valid: false,
      url: trimmed,
      errorCode: 'NETWORK_FAILURE',
      errorMessage: 'Unable to validate feed URL.',
    };
  }
}
