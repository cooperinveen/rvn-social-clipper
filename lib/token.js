// Signed post tokens. /api/post returns the post it fetched plus a signature;
// preview/render only accept a post that carries a valid one. The signed data
// (who posted, avatar, badge, original text) can't be changed by the client —
// the only thing a producer may change is the text, and only to cut it short
// from the end (see textEditAllowed), never to write something new.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export class TokenError extends Error {}

let cachedSecret;
function secret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.SIGNING_SECRET) return (cachedSecret = process.env.SIGNING_SECRET);
  if (process.env.VERCEL) throw new Error('SIGNING_SECRET is not set. Add it in the Vercel project settings.');
  // Local dev: keep one random secret on disk (gitignored) so tokens survive restarts.
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.signing-secret');
  try { cachedSecret = fs.readFileSync(file, 'utf8').trim(); } catch { /* first run */ }
  if (!cachedSecret) { cachedSecret = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(file, cachedSecret, { mode: 0o600 }); }
  return cachedSecret;
}

const sign = body => crypto.createHmac('sha256', secret()).update(body).digest('base64url');
export const hmac = sign;   // also signs the sign-in cookies (lib/auth.js), with a purpose label

export function signPost(post) {
  const body = Buffer.from(JSON.stringify({
    platform: post.platform, id: post.id, name: post.name, handle: post.handle,
    verified: !!post.verified, avatarUrl: post.avatarUrl || null, text: post.text, iat: Date.now(),
  })).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyPost(token) {
  if (typeof token !== 'string' || token.length > 200000 || !token.includes('.')) throw new TokenError('Fetch the post again — this one was not loaded from a link.');
  const [body, sig] = token.split('.');
  const good = Buffer.from(sign(body)), got = Buffer.from(sig || '');
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) throw new TokenError('Fetch the post again — this one was not loaded from a link.');
  const post = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (Date.now() - post.iat > MAX_AGE_MS) throw new TokenError('That post was fetched more than a day ago. Fetch it again.');
  return post;
}

// A producer may only shorten the fetched text from the end: the edited text must be the
// opening of the original, word for word. Nothing can be added, changed, reordered or cut
// from the middle or the start.
export function textEditAllowed(original, edited) {
  return edited.trim().length > 0 && original.startsWith(edited.trim());
}
