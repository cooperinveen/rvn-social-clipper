// Card PNG -> broadcast interlaced MOV, built as a single ffmpeg filter graph
// (ffmpeg only: it runs the same on a laptop and in a serverless function).
//
// Timeline:  [ opening hold ] -> [ zoom ] -> [ scroll ]   (zoom and scroll optional)
//   hold   : the card on a white matte, centred — whole (shrunk to fit) or just
//            its top 1620 rows with a fade, as the producer chooses.
//            With highlights: clean for 5s (2s when the hold is only 5s), a 0.4s fade, then highlighted.
//   zoom   : push in from that opening shot to the top 1080 rows at full width.
//   scroll : pan from the top to the bottom at 1:1, eased and sub-pixel.
//
// Output: 1920x1080 H.264 in a QuickTime file, interlaced top-field-first (60i = 30 fps,
// 50i = 25 fps), BT.709. Frames are rendered at 60/50 fps progressive and interlaced
// by ffmpeg's tinterlace filter, so each output frame carries two moments in time.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';

export const OUT_W = 1920;
export const OUT_H = 1080;

// Tunables. Seconds unless the name says otherwise.
export const CONFIG = {
  zoomSeconds: 10,
  preHighlightSeconds: 5,
  highlightFadeSeconds: 0.4,
  overviewMaxRows: 1620,        // tallest slice of the card shown when the opening shot is "top of the post"
  scrollPxPerSecond: 150,       // "auto" scroll pace
  scrollMinSeconds: 8,
  scrollMaxSeconds: 60,
  zoomFitMaxRows: 4500,         // zoom can start from the whole post only if the card is at most this many rows tall
  crf: 20,
  preset: 'veryfast',
};

const even = n => 2 * Math.round(n / 2);
const smootherstep = p => `(${p}*${p}*${p}*(${p}*(${p}*6-15)+10))`;

export function ffmpegPath() {
  return process.env.FFMPEG_PATH || ffmpegStatic;
}

// What a card of this height (in px at 1920 wide) can do, so the UI can say so up front.
// Zoom and scroll only make sense when the card is clearly taller than the frame.
export function planFor(cardHeight, { scrollSeconds } = {}) {
  const canMotion = cardHeight >= 1200;
  const overviewRows = Math.min(cardHeight, CONFIG.overviewMaxRows);
  const pan = Math.max(0, cardHeight - OUT_H);
  const auto = Math.round(Math.min(CONFIG.scrollMaxSeconds, Math.max(CONFIG.scrollMinSeconds, pan / CONFIG.scrollPxPerSecond)));
  const secs = scrollSeconds ? Math.max(4, Math.round(scrollSeconds)) : auto;
  return { canMotion, overviewRows, zoomFitMaxRows: CONFIG.zoomFitMaxRows, pan, autoScrollSeconds: auto, scrollSeconds: secs };
}

// Top `rows` rows of a card. If that cuts the card short, fade the bottom edge
// to the white matte so it reads as "continues" rather than a clipped line.
const FADE_ROWS = 260;
const FADE_SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${FADE_ROWS}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
async function overviewSlice(png, cardHeight, rows) {
  let img = sharp(png).extract({ left: 0, top: 0, width: OUT_W, height: rows });
  if (rows < cardHeight) img = sharp(await img.png().toBuffer()).composite([{ input: FADE_SVG, top: rows - FADE_ROWS, left: 0 }]);
  return img.png().toBuffer();
}

// The video's opening frame as a 1920x1080 PNG (for the on-page preview).
export async function openingFrame(cardPng, opening = 'fit') {
  const H = (await sharp(cardPng).metadata()).height;
  const rows = opening === 'top' ? Math.min(H, CONFIG.overviewMaxRows) : H;
  const s0 = Math.min(1, OUT_H / rows);
  const w = even(OUT_W * s0), h = even(rows * s0);
  const slice = await sharp(await overviewSlice(cardPng, H, rows)).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
  return sharp({ create: { width: OUT_W, height: OUT_H, channels: 3, background: '#ffffff' } })
    .composite([{ input: slice, left: Math.floor((OUT_W - w) / 2), top: Math.floor((OUT_H - h) / 2) }]).png().toBuffer();
}

async function writeTmp(dir, name, buf) {
  const p = path.join(dir, name);
  await fs.promises.writeFile(p, buf);
  return p;
}

// opts: { format: '60i'|'50i', opening: 'fit'|'top', zoom, scroll, baseSeconds, scrollSeconds, highlightedPng }
// Writes the .mov to outPath; resolves to { durationSeconds, renderMs }.
export async function renderVideo(cleanPng, opts = {}, outPath) {
  const { format = '60i', opening = 'fit', zoom = false, scroll = false, baseSeconds = 10 } = opts;
  let { highlightedPng = null } = opts;
  if (!['60i', '50i'].includes(format)) throw new Error('format must be 60i or 50i');
  const fps = format === '60i' ? 60 : 50;

  // Cards are rendered at exactly the frame width; normalise anything else.
  const atFrameWidth = async png => (await sharp(png).metadata()).width === OUT_W ? png : sharp(png).resize({ width: OUT_W }).png().toBuffer();
  cleanPng = await atFrameWidth(cleanPng);
  if (highlightedPng) highlightedPng = await atFrameWidth(highlightedPng);
  const H = (await sharp(cleanPng).metadata()).height;

  const plan = planFor(H, opts);
  const doZoom = zoom && plan.canMotion;
  const doScroll = scroll && plan.canMotion;
  const base = Math.max(5, Math.round(baseSeconds));

  // Overview = what the opening shot shows. The producer chooses:
  //   'fit' -> the whole card, shrunk to fit the frame (nothing cut off)
  //   'top' -> the top slice at a readable size, fading out where it's cut
  // (a card shorter than the slice is shown whole either way, with no fade)
  const overviewRows = opening === 'top' ? plan.overviewRows : H;
  if (doZoom && overviewRows > CONFIG.zoomFitMaxRows) {
    throw Object.assign(new Error(
      'Zoom can only start from the whole post when it is under about 4 screens tall. ' +
      'Choose "Top of the post, fading out" as the opening shot, or turn Zoom off.'), { code: 'zoom_limit' });
  }
  const s0 = Math.min(1, OUT_H / overviewRows);
  const ovW = even(OUT_W * s0), ovH = even(overviewRows * s0);

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'social-video-'));
  try {
    const top = png => overviewSlice(png, H, overviewRows);
    const inputs = [];           // temp image files, one ffmpeg input each
    const add = async (name, buf) => { inputs.push(await writeTmp(dir, name, buf)); return inputs.length - 1; };
    const filters = [];
    const labels = [];

    // Each still becomes a `secs`-long stream at the working frame rate.
    const loopTrim = (i, secs) =>
      `[${i}:v]loop=loop=-1:size=1,trim=duration=${secs},setpts=N/${fps}/TB,fps=${fps}`;
    const staticScene = (i, secs) =>
      `${loopTrim(i, secs)},scale=${ovW}:${ovH}:flags=lanczos,pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2:white,format=rgb24`;

    // ── opening hold (with optional highlight fade) ──
    const topClean = await top(cleanPng);
    const topHl = highlightedPng ? await top(highlightedPng) : null;
    const iClean = await add('top_clean.png', topClean);
    if (topHl) {
      const iHl = await add('top_hl.png', topHl);
      const pre = Math.min(CONFIG.preHighlightSeconds, base - 3), fade = CONFIG.highlightFadeSeconds;   // a 5s hold highlights at 2s so the highlight is actually seen
      filters.push(`${staticScene(iClean, pre + fade)}[sa]`);
      filters.push(`${staticScene(iHl, Math.max(fade, base - pre))}[sb]`);
      filters.push(`[sa][sb]xfade=transition=fade:duration=${fade}:offset=${pre},format=rgb24,setpts=N/${fps}/TB[seg0]`);
    } else {
      filters.push(`${staticScene(iClean, base)}[seg0]`);
    }
    labels.push('seg0');

    // Zoom / scroll both start from the highlighted version when there is one.
    const motionTop = topHl || topClean;
    const motionFull = highlightedPng || cleanPng;

    // ── zoom: overview -> top 1080 rows at 1:1 ──
    // zoompan on a 16:9 white canvas holding the overview at 1:1 (its top edge on
    // the canvas top). Window = whole canvas at the start (== the static shot),
    // shrinking to the top 1080 rows at the end (== scroll's first frame).
    // (Don't build this from a per-frame `scale` + `overlay` graph: it looks plausible
    // but never actually animates.)
    if (doZoom) {
      const N = CONFIG.zoomSeconds * fps;
      const cw = even(Math.ceil(overviewRows * 16 / 9));
      const canvas = await sharp({ create: { width: cw, height: overviewRows, channels: 3, background: '#ffffff' } })
        .composite([{ input: motionTop, left: (cw - OUT_W) / 2, top: 0 }]).png().toBuffer();
      const iZ = await add('zoom_canvas.png', canvas);
      const zEnd = overviewRows / OUT_H;
      const p = `(on/${N - 1})`;
      const S = `(${s0}+(1-${s0})*${smootherstep(p)})`;          // eased scale, s0 -> 1
      filters.push(
        `${loopTrim(iZ, CONFIG.zoomSeconds)},` +
        `zoompan=z='min(${zEnd},${S}/${s0})':x='round((iw-iw/zoom)/2)':y='0':d=1:s=${OUT_W}x${OUT_H}:fps=${fps},` +
        `format=rgb24[seg1]`);
      labels.push('seg1');
    }

    // ── scroll: top -> bottom, sub-pixel ──
    // Integer crop for the whole-pixel part, then a cubic `perspective` shift for the
    // fractional part, so slow scrolls glide instead of stepping.
    if (doScroll) {
      // 4 spare rows below the card so the 1084-row window is always valid.
      const full = await sharp(motionFull).extend({ bottom: 4, background: '#ffffff' }).png().toBuffer();
      const iS = await add('full_scroll.png', full);
      const D = plan.scrollSeconds, N = D * fps, PAN = H - OUT_H;
      const yN = `(${PAN}*${smootherstep(`(n/${N - 1})`)})`;
      const yO = `(${PAN}*${smootherstep(`((on-1)/${N - 1})`)})`;   // perspective's `on` is 1-based
      const fr = `(${yO}-floor(${yO}))`;
      filters.push(
        `${loopTrim(iS, D)},` +
        `crop=${OUT_W}:1084:0:'floor(min(${PAN},${yN}))',` +
        `perspective=x0=0:y0='${fr}':x1=W:y1='${fr}':x2=0:y2='H+${fr}':x3=W:y3='H+${fr}':interpolation=cubic:eval=frame,` +
        `crop=${OUT_W}:${OUT_H}:0:0,format=rgb24[seg2]`);
      labels.push('seg2');
    }

    // ── join, colour-convert once (BT.709, tagged), interlace ──
    // (scale rounding can leave odd SARs on a segment; concat needs them all equal)
    for (const l of labels) filters.push(`[${l}]setsar=1[${l}n]`);
    const join = labels.length > 1
      ? `${labels.map(l => `[${l}n]`).join('')}concat=n=${labels.length}:v=1:a=0[cat]`
      : `[${labels[0]}n]null[cat]`;
    filters.push(join);
    filters.push(`[cat]scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=lanczos+accurate_rnd,format=yuv420p,tinterlace=mode=interleave_top[out]`);

    const args = ['-hide_banner', '-loglevel', 'error', '-y'];
    for (const f of inputs) args.push('-framerate', String(fps), '-i', f);
    args.push(
      '-filter_complex', filters.join(';'),
      '-map', '[out]',
      '-c:v', 'libx264', '-preset', CONFIG.preset, '-crf', String(CONFIG.crf),
      '-pix_fmt', 'yuv420p', '-r', String(fps / 2),
      '-flags', '+ilme+ildct', '-top', '1',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart',
      '-f', 'mov', outPath,
    );

    const started = Date.now();
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      proc.stderr.on('data', d => { err = (err + d).slice(-8000); });
      proc.on('error', reject);
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}):\n${err}`)));
    });
    const durationSeconds = base + (doZoom ? CONFIG.zoomSeconds : 0) + (doScroll ? plan.scrollSeconds : 0);
    return { durationSeconds, renderMs: Date.now() - started };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}
