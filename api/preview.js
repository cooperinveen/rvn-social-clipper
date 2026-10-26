import sharp from 'sharp';
import { buildCard, readJson, sendError } from '../lib/pipeline.js';
import { planFor, openingFrame } from '../lib/video.js';

// POST { token, text?, highlights? } -> the video's opening frame as a 16:9 JPEG for each
// opening-shot choice, plus what the UI needs to know: card height, number of highlighted
// passages, and what zoom/scroll can do for a card this tall.
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
    const body = readJson(req);
    const { card } = await buildCard(body.token, body.text, body.highlights);
    const src = card.highlighted || card.clean;   // show highlights here so producers can check them
    const jpeg = async opening => `data:image/jpeg;base64,${(await sharp(await openingFrame(src, opening))
      .resize({ width: 1280 }).jpeg({ quality: 85 }).toBuffer()).toString('base64')}`;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      frames: { fit: await jpeg('fit'), top: await jpeg('top') },
      cardHeight: card.height,
      matchCount: card.matchCount,
      plan: planFor(card.height),
    }));
  } catch (err) { sendError(res, err); }
}
