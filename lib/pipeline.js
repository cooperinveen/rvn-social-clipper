// Shared request handling for the API: validate untrusted input, then build the card.
import { toDataUri } from './sources.js';
import { verifyPost, textEditAllowed, TokenError } from './token.js';
import { renderCard } from './card.js';

// Avatars are fetched server-side, so only these hosts are allowed (no SSRF).
const AVATAR_HOSTS = [/^pbs\.twimg\.com$/, /^static-assets-\d+\.truthsocial\.com$/];

export class InputError extends Error {}

const str = (v, max, field) => {
  if (v == null) return '';
  if (typeof v !== 'string') throw new InputError(`${field} must be text.`);
  if (v.length > max) throw new InputError(`${field} is too long (max ${max} characters).`);
  return v;
};

// The post always comes from a signed fetch (see token.js). The client can only
// supply edited text, and only a shorter version of what was fetched.
export function postFromToken(token, editedText) {
  let signed;
  try { signed = verifyPost(token); } catch (err) { if (err instanceof TokenError) throw new InputError(err.message); throw err; }
  let text = signed.text, shift = 0;
  if (editedText != null) {
    const raw = str(editedText, 20000, 'Post text').replace(/\r\n/g, '\n');
    shift = raw.length - raw.trimStart().length;
    text = raw.trim();
    if (!text) throw new InputError('The post text is empty.');
    if (text !== signed.text && !textEditAllowed(signed.text, text)) {
      throw new InputError('The text can only be shortened from the end. Reset it, or fetch the post again.');
    }
  }
  return {
    platform: signed.platform, name: signed.name, handle: signed.handle, verified: signed.verified,
    text, avatarUrl: signed.avatarUrl && validAvatar(signed.avatarUrl), avatarDataUri: null,
    shift,        // characters trimmed off the start of the text, to realign highlight ranges
  };
}

function validAvatar(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && AVATAR_HOSTS.some(re => re.test(u.hostname)) ? u.href : null;
  } catch { return null; }
}

// Highlights arrive as character ranges over the (untrimmed) text the client sent.
export function cleanRanges(raw, shift, length) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 100) throw new InputError('Highlights must be a short list of ranges.');
  const out = [];
  for (const r of raw) {
    if (!r || !Number.isInteger(r.start) || !Number.isInteger(r.end)) throw new InputError('Bad highlight range.');
    const start = Math.max(0, r.start - shift), end = Math.min(length, r.end - shift);
    if (end > start) out.push({ start, end });
  }
  return out;
}

export async function buildCard(token, editedText, rawHighlights) {
  const post = postFromToken(token, editedText);
  const ranges = cleanRanges(rawHighlights, post.shift, post.text.length);
  if (!post.avatarDataUri && post.avatarUrl) post.avatarDataUri = await toDataUri(post.avatarUrl);
  const card = await renderCard(post, { ranges });
  return { post, ranges, card };
}

// Browsers only send a JSON content type from our own page without asking permission first (a
// "preflight"), so insisting on it, and refusing cross-site requests, stops another website from
// making a visitor's browser call these endpoints (CSRF). Plain `curl`/scripts still work.
function sameSiteOnly(req) {
  const h = req.headers || {};
  const type = String(h['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new InputError('Requests must be sent as application/json.');
  if (h['sec-fetch-site'] && !['same-origin', 'none'].includes(h['sec-fetch-site'])) throw new InputError('Cross-site requests are not accepted.');
  if (h.origin) {
    let host;
    try { host = new URL(h.origin).host; } catch { throw new InputError('Cross-site requests are not accepted.'); }
    if (host !== (h['x-forwarded-host'] || h.host)) throw new InputError('Cross-site requests are not accepted.');
  }
}

// Vercel parses JSON bodies itself; the local dev server does the same. Accept either an object or a JSON string.
export function readJson(req) {
  sameSiteOnly(req);
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { throw new InputError('Invalid JSON.'); } }
  throw new InputError('Expected a JSON body.');
}

export function sendError(res, err) {
  const known = err instanceof InputError || err?.code;
  const status = err instanceof InputError ? 400
    : err?.code === 'not_found' ? 404
    : err?.code ? 422 : 500;
  if (!known) console.error(err);
  if (!res.headersSent) {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
  }
  res.end(JSON.stringify({ error: known ? err.message : 'Something went wrong on the server. Try again; if it keeps happening, tell the maintainer.', code: err?.code }));
}
