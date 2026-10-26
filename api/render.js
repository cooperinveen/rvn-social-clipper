import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildCard, readJson, sendError, InputError } from '../lib/pipeline.js';
import { renderVideo } from '../lib/video.js';

// POST { token, text?, highlights?, format, opening, baseSeconds, zoom, scroll, scrollSeconds }
// -> the finished .mov, streamed back, and deleted from disk once sent.
export default async function handler(req, res) {
  let out;
  try {
    if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
    const body = readJson(req);
    const format = body.format === '50i' ? '50i' : '60i';
    const opening = body.opening === 'top' ? 'top' : 'fit';
    const baseSeconds = [10, 20, 30].includes(Number(body.baseSeconds)) ? Number(body.baseSeconds) : 10;
    let scrollSeconds;
    if (body.scrollSeconds != null && body.scrollSeconds !== '' && body.scrollSeconds !== 'auto') {
      scrollSeconds = Number(body.scrollSeconds);
      if (!(scrollSeconds >= 4 && scrollSeconds <= 180)) throw new InputError('Scroll length must be between 4 and 180 seconds.');
    }

    const { card, post } = await buildCard(body.token, body.text, body.highlights);
    out = path.join(os.tmpdir(), `svm-${crypto.randomUUID()}.mov`);
    const result = await renderVideo(card.clean, {
      format, opening, baseSeconds, scrollSeconds,
      zoom: !!body.zoom, scroll: !!body.scroll,
      highlightedPng: card.highlighted,
    }, out);

    const size = (await fs.promises.stat(out)).size;
    const slug = (post.handle || 'post').replace(/[^\w-]+/g, '').slice(0, 30) || 'post';
    res.statusCode = 200;
    res.setHeader('content-type', 'video/quicktime');
    res.setHeader('content-length', size);
    res.setHeader('content-disposition', `attachment; filename="social-${slug}-${format}.mov"`);
    res.setHeader('x-video-seconds', String(result.durationSeconds));
    res.setHeader('x-render-ms', String(result.renderMs));
    const cleanup = () => fs.promises.rm(out, { force: true }).catch(() => {});
    fs.createReadStream(out).on('close', cleanup).on('error', cleanup).pipe(res);
  } catch (err) {
    if (out) fs.promises.rm(out, { force: true }).catch(() => {});
    sendError(res, err);
  }
}
