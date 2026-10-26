// Fetch a post's content as data (no page scraping), so it works from any host.
//   X       -> the syndication endpoint X's own embeds use (no login). Long posts come
//              back truncated there, so their full text comes from FxTwitter instead.
//   Truth   -> truthsocial.com answers every non-browser client with a Cloudflare 403, so
//              @realDonaldTrump's posts are read from the trumpstruth.org archive feed.
//              Other Truth Social accounts are not available.
//
// Every function returns the same shape: { platform, id, name, handle, verified, avatarUrl, text }.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

export class SourceError extends Error {
  constructor(message, code = 'source_error') { super(message); this.code = code; }
}

export function detectPlatform(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^www\./, '').replace(/^mobile\./, ''); }
  catch { return null; }
  if (host === 'x.com' || host === 'twitter.com') return 'x';
  if (host === 'truthsocial.com') return 'truth';
  return null;
}

const get = url => fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });

// ── X ──────────────────────────────────────────────────────────────────────
// The token X's own embed script sends with every syndication request.
function xToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

async function fetchX(url) {
  const m = new URL(url).pathname.match(/\/status(?:es)?\/(\d+)/);
  if (!m) throw new SourceError('Could not find a post ID in that X link.', 'bad_url');
  const id = m[1];
  const res = await get(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${xToken(id)}`);
  if (res.status === 404) throw new SourceError('X says that post does not exist (deleted, protected, or the link is wrong).', 'not_found');
  if (!res.ok) throw new SourceError(`X returned HTTP ${res.status}.`, 'upstream');
  const t = await res.json();
  if (!t || !t.user || t.__typename === 'TweetTombstone') throw new SourceError('That post is unavailable (deleted, protected, or age-restricted).', 'not_found');

  // Strip trailing t.co media links and the leading reply @-run, as X's own UI does.
  const [from, to] = t.display_text_range || [0, (t.text || '').length];
  const chars = [...(t.text || '')];
  let text = chars.slice(from, to).join('').replace(/\s+$/, '');
  const urls = (t.entities?.urls || []);
  for (const u of urls) text = text.split(u.url).join(u.display_url);
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  // Long posts ("note tweets") come back from the syndication endpoint cut off after a
  // few lines, with only a note_tweet id. Fetch the full text separately — and if that
  // fails, refuse: a silently truncated post is worse than an error.
  if (t.note_tweet) text = await fetchFullXText(t.user.screen_name, id, t.text);
  if (!text) throw new SourceError('That post has no text to show (it may be only an image or video).', 'no_text');

  return {
    platform: 'x',
    id,
    name: t.user.name,
    handle: t.user.screen_name,
    verified: !!(t.user.is_blue_verified || t.user.verified),
    avatarUrl: (t.user.profile_image_url_https || '').replace('_normal.', '_400x400.'),
    text,
  };
}

// Full text of a long X post via the FxTwitter public API (api.fxtwitter.com). It is a
// third-party service, so it is used ONLY for long posts, and its answer is checked
// against the start of the text X itself gave us before we trust it.
async function fetchFullXText(handle, id, previewText) {
  const fail = why => new SourceError(
    `This is a long X post and the app could not get its full text (${why}). ` +
    'It has not been made, to avoid a video that cuts off mid-post. Try again in a minute.', 'long_post_unavailable');
  let full;
  try {
    const res = await get(`https://api.fxtwitter.com/${encodeURIComponent(handle)}/status/${id}`);
    if (!res.ok) throw fail(`HTTP ${res.status}`);
    full = (await res.json())?.tweet?.text;
  } catch (err) {
    if (err instanceof SourceError) throw err;
    throw fail('the lookup service did not answer');
  }
  const norm = x => x.replace(/\s+/g, ' ').trim();
  const head = norm(previewText).slice(0, 80);
  if (typeof full !== 'string' || !full || !norm(full).startsWith(head)) throw fail('the lookup returned something unexpected');
  return full.replace(/\s+$/, '');
}

// ── Truth Social (via trumpstruth.org feed) ────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });
}

// Mastodon-style post HTML -> plain text, keeping link text the way Truth
// Social displays it (hidden scheme/tail spans dropped, long URLs ellipsised).
export function postHtmlToText(html) {
  const s = html
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (_, inner) => inner
      .replace(/<span class="invisible">[\s\S]*?<\/span>/gi, '')
      .replace(/<span class="ellipsis">([\s\S]*?)<\/span>/gi, '$1…')
      .replace(/<[^>]+>/g, ''))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(s).replace(/[ \t]+\n/g, '\n').trim();
}

// First <name>…</name> in an RSS item, with any CDATA wrapper removed.
function tag(item, name) {
  const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return null;
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
}

const TRUMP_AVATAR = 'https://static-assets-1.truthsocial.com/tmtg:prime-ts-assets/accounts/avatars/107/780/257/626/128/497/original/454286ac07a6f6e6.jpeg';

async function fetchTruth(url) {
  const u = new URL(url);
  const m = u.pathname.match(/^\/@([^/]+)\/(?:posts\/)?(\d+)/);
  if (!m) throw new SourceError('Could not find a post ID in that Truth Social link.', 'bad_url');
  const [, account, id] = m;
  if (account.toLowerCase() !== 'realdonaldtrump') {
    throw new SourceError(
      `Truth Social blocks automated access, and the only archive we can read covers @realDonaldTrump. ` +
      `@${account} is not available.`, 'unsupported_account');
  }
  const res = await get('https://www.trumpstruth.org/feed');
  if (!res.ok) throw new SourceError(`The trumpstruth.org archive returned HTTP ${res.status}.`, 'upstream');
  const xml = await res.text();
  const item = xml.split('<item>').slice(1).find(it => tag(it, 'truth:originalId') === id);
  if (!item) {
    throw new SourceError(
      'That post is not in the archive feed, which only holds Trump\'s ~100 most recent posts. ' +
      'Older posts are not available.', 'not_found');
  }
  if (tag(item, 'archive:removed') === 'true') throw new SourceError('That post has been removed.', 'not_found');
  const text = postHtmlToText(tag(item, 'description') || '');
  if (!text) throw new SourceError('That post has no text to show (it may be only an image or video).', 'no_text');
  return {
    platform: 'truth',
    id,
    name: tag(item, 'dc:creator') || 'Donald J. Trump',
    handle: 'realDonaldTrump',
    verified: true,
    avatarUrl: TRUMP_AVATAR,
    text,
  };
}

export async function fetchPost(url) {
  const platform = detectPlatform(url);
  if (platform === 'x') return fetchX(url);
  if (platform === 'truth') return fetchTruth(url);
  throw new SourceError('Only X and Truth Social links are supported right now.', 'unsupported_site');
}

// Download an image as a data URI, so rendering the card needs no further network. Null on failure.
export async function toDataUri(imageUrl) {
  if (!imageUrl) return null;
  try {
    const res = await get(imageUrl);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/jpeg';
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  } catch { return null; }
}
