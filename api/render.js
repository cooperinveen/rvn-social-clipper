import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildCard, readJson, sendError, InputError } from '../lib/pipeline.js';
import { renderVideo } from '../lib/video.js';
import { renderGate, renderRate, claimRenderSlot, clientKey } from '../lib/limits.js';

// POST { token, text?, highlights?, format, opening, baseSeconds, zoom, scroll, scrollSeconds, ticket? }
// -> the finished .mov, streamed back, and deleted from disk once sent.
// Renders wait their turn (lib/limits.js); `ticket` lets the page ask /api/queue where it is
// in line. If the producer closes the tab, the request is dropped from the line, or the
// running ffmpeg is stopped.
export default async function handler(req, res) {
  let out, release, unclaim;
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableFinished) abort.abort(); });
  try {
    if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
    const body = readJson(req);
    const format = body.format === '50i' ? '50i' : '60i';
    const opening = body.opening === 'top' ? 'top' : 'fit';
    const baseSeconds = [5, 10, 20, 30].includes(Number(body.baseSeconds)) ? Number(body.baseSeconds) : 10;
    let scrollSeconds;
    if (body.scrollSeconds != null && body.scrollSeconds !== '' && body.scrollSeconds !== 'auto') {
      scrollSeconds = Number(body.scrollSeconds);
      if (!(scrollSeconds >= 4 && scrollSeconds <= 180)) throw new InputError('Scroll length must be between 4 and 180 seconds.');
    }
    const ticket = typeof body.ticket === 'string' && /^[\w-]{8,64}$/.test(body.ticket) ? body.ticket : undefined;

    const who = clientKey(req);
    unclaim = claimRenderSlot(who);        // one render per person at a time
    renderRate.hit(who);
    release = await renderGate.enter({ signal: abort.signal, ticket });

    const { card, post } = await buildCard(body.token, body.text, body.highlights);
    if (abort.signal.aborted) return;
    out = path.join(os.tmpdir(), `social-video-${crypto.randomUUID()}.mov`);
    const result = await renderVideo(card.clean, {
      format, opening, baseSeconds, scrollSeconds,
      zoom: !!body.zoom, scroll: !!body.scroll,
      highlightedPng: card.highlighted,
      signal: abort.signal,
    }, out);
    release(); release = null;            // the next video can start while this one downloads
    unclaim(); unclaim = null;

    const size = (await fs.promises.stat(out)).size;
    const slug = (post.handle || 'post').replace(/[^\w-]+/g, '').slice(0, 30) || 'post';
    res.statusCode = 200;
    res.setHeader('content-type', 'video/quicktime');
    res.setHeader('content-length', size);
    res.setHeader('content-disposition', `attachment; filename="social-${slug}-${format}.mov"`);
    res.setHeader('x-video-seconds', String(result.durationSeconds));
    res.setHeader('x-render-ms', String(result.renderMs));
    const file = out; out = null;
    const cleanup = () => fs.promises.rm(file, { force: true }).catch(() => {});
    fs.createReadStream(file).on('close', cleanup).on('error', cleanup).pipe(res);
  } catch (err) {
    if (err?.name !== 'AbortError' && !abort.signal.aborted) sendError(res, err);
  } finally {
    release?.();
    unclaim?.();
    if (out) fs.promises.rm(out, { force: true }).catch(() => {});
  }
}
