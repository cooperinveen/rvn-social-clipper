// Keeping one small server healthy when several producers use it at once.
//
//   renders : at most RENDER_CONCURRENCY at a time (default 1); the rest wait in line, up to
//             RENDER_QUEUE_MAX (default 8), and each person can only have one in the system.
//   cards   : the Chromium card step (preview) runs at most CARD_CONCURRENCY at a time (default 2).
//   rates   : per person, a cap on API calls per minute and renders per hour.
//
// Everything is in memory, which is right for a single container (EDEn runs one task).
import { currentUser } from './auth.js';
import { hosted } from './token.js';

export class LimitError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

const envInt = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

// Who is asking: the signed-in email, else the client address.
export function clientKey(req) {
  const user = currentUser(req);
  if (user?.email) return `u:${user.email.toLowerCase()}`;
  // Behind a hosting platform's load balancer the real address is in x-forwarded-for.
  const fwd = hosted() ? String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return `ip:${fwd || req.socket?.remoteAddress || 'unknown'}`;
}

// A first-come-first-served gate with `max` slots. `enter` waits for a slot and returns a
// `release` function; an AbortSignal takes a waiting request out of the line.
export class Gate {
  constructor(max, maxWaiting = Infinity) { this.max = max; this.maxWaiting = maxWaiting; this.active = new Set(); this.waiting = []; }

  enter({ signal, ticket } = {}) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.active.size < this.max && this.waiting.length === 0) return Promise.resolve(this.#admit(ticket));
    if (this.waiting.length >= this.maxWaiting) {
      return Promise.reject(new LimitError(`The app is busy right now (${this.waiting.length} videos waiting). Try again in a few minutes.`, 503, 'busy'));
    }
    return new Promise((resolve, reject) => {
      const entry = { ticket, resolve, reject };
      const onAbort = () => { this.#drop(entry); reject(abortError()); };
      entry.cleanup = () => signal?.removeEventListener('abort', onAbort);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(entry);
    });
  }

  // 0 = running now, n = n-th in line, null = not known here.
  position(ticket) {
    if (!ticket) return null;
    for (const a of this.active) if (a.ticket === ticket) return 0;
    const i = this.waiting.findIndex(w => w.ticket === ticket);
    return i < 0 ? null : i + 1;
  }

  #admit(ticket) {
    const slot = { ticket };
    this.active.add(slot);
    let done = false;
    return () => { if (done) return; done = true; this.active.delete(slot); this.#next(); };
  }
  #next() {
    while (this.active.size < this.max && this.waiting.length) {
      const entry = this.waiting.shift();
      entry.cleanup();
      entry.resolve(this.#admit(entry.ticket));
    }
  }
  #drop(entry) {
    const i = this.waiting.indexOf(entry);
    if (i >= 0) this.waiting.splice(i, 1);
  }
}

function abortError() {
  return Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' });
}

// Sliding-window counter: at most `limit` hits per `windowMs` for each key.
export class RateLimit {
  constructor(limit, windowMs, message) { this.limit = limit; this.windowMs = windowMs; this.message = message; this.hits = new Map(); }
  hit(key, now = Date.now()) {
    const since = now - this.windowMs;
    const list = (this.hits.get(key) || []).filter(t => t > since);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      throw new LimitError(this.message, 429, 'rate_limited');
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some(t => t > since)) this.hits.delete(k);
  }
}

export const renderGate = new Gate(envInt('RENDER_CONCURRENCY', 1), envInt('RENDER_QUEUE_MAX', 8));
export const cardGate = new Gate(envInt('CARD_CONCURRENCY', 2));
export const apiRate = new RateLimit(envInt('API_PER_MINUTE', 60), 60e3,
  'Too many requests in the last minute. Wait a moment and try again.');
export const renderRate = new RateLimit(envInt('RENDERS_PER_HOUR', 30), 3600e3,
  'You have made a lot of videos in the last hour. Wait a while and try again.');

// One render per person in the system at a time (running or waiting).
const rendering = new Set();
export function claimRenderSlot(key) {
  if (rendering.has(key)) {
    throw new LimitError('You already have a video rendering. Wait for it to finish, or close that tab, then try again.', 429, 'already_rendering');
  }
  rendering.add(key);
  return () => rendering.delete(key);
}
