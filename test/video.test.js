import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { renderVideo, planFor, openingFrame, ffmpegPath, CONFIG, OUT_W } from '../lib/video.js';

// These render real (short) videos with the bundled ffmpeg — no browser or network needed.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-video-test-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

// A white card of the given height, with a dark block 200px wide whose width we can measure.
// Horizontal stripes every 60px give the scroll and zoom something to move.
async function card(height, { highlight = false } = {}) {
  const stripes = [];
  for (let y = 100; y < height - 100; y += 60) stripes.push({ input: { create: { width: 1200, height: 20, channels: 3, background: '#222' } }, left: 360, top: y });
  if (highlight) stripes.push({ input: { create: { width: 400, height: 30, channels: 3, background: '#ffff00' } }, left: 360, top: 70 });
  return sharp({ create: { width: OUT_W, height, channels: 3, background: '#fff' } }).composite(stripes).png().toBuffer();
}

const info = file => spawnSync(ffmpegPath(), ['-i', file], { encoding: 'utf8' }).stderr;
const seconds = file => { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(info(file)); return +m[1] * 3600 + +m[2] * 60 + +m[3]; };
function frameAt(file, t) {                                  // grayscale 480x270 frame at t seconds
  return execFileSync(ffmpegPath(), ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'yadif=0,scale=480:270,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1e8 });
}
const darkColumns = f => { let min = 480, max = 0; for (let i = 0; i < f.length; i++) if (f[i] < 100) { const x = i % 480; min = Math.min(min, x); max = Math.max(max, x); } return max - min; };
const meanDiff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

test('planFor: short cards can\'t zoom or scroll; tall ones can', () => {
  assert.equal(planFor(900).canMotion, false);
  const p = planFor(18000);
  assert.equal(p.canMotion, true);
  assert.equal(p.overviewRows, CONFIG.overviewMaxRows);
  assert.equal(p.autoScrollSeconds, CONFIG.scrollMaxSeconds);          // very long posts cap out
  assert.equal(planFor(1500).autoScrollSeconds, CONFIG.scrollMinSeconds);
  assert.equal(planFor(5000, { scrollSeconds: 30 }).scrollSeconds, 30);
});

test('openingFrame: always 1920x1080, whole card or top slice', async () => {
  for (const [h, opening] of [[900, 'fit'], [3000, 'fit'], [3000, 'top']]) {
    const m = await sharp(await openingFrame(await card(h), opening)).metadata();
    assert.deepEqual([m.width, m.height], [1920, 1080]);
  }
});

test('a short card renders a 10s interlaced 1080 video that is correctly tagged', async () => {
  const out = path.join(tmp, 'static.mov');
  const r = await renderVideo(await card(900), { baseSeconds: 10 }, out);
  assert.equal(r.durationSeconds, 10);
  assert.ok(Math.abs(seconds(out) - 10) < 0.2);
  const i = info(out);
  assert.match(i, /1920x1080/);
  assert.match(i, /h264/);
  assert.match(i, /30 fps/);
  assert.match(i, /bt709/);
  assert.match(i, /top first/);
});

test('50i is 25 fps', async () => {
  const out = path.join(tmp, '50i.mov');
  await renderVideo(await card(900), { format: '50i' }, out);
  assert.match(info(out), /25 fps/);
});

test('highlights fade in after the pre-highlight hold, and not before', async () => {
  const out = path.join(tmp, 'hl.mov');
  await renderVideo(await card(900), { baseSeconds: 10, highlightedPng: await card(900, { highlight: true }) }, out);
  const yellow = f => execFileSync(ffmpegPath(), ['-v', 'error', '-ss', String(f), '-i', out, '-frames:v', '1', '-vf', 'format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1e8 });
  const count = buf => { let n = 0; for (let i = 0; i < buf.length; i += 3) if (buf[i] > 240 && buf[i + 1] > 240 && buf[i + 2] < 60) n++; return n; };
  assert.equal(count(yellow(3)), 0);
  assert.ok(count(yellow(8)) > 5000);
});

test('zoom really zooms (the text grows) and ends where the scroll begins', async () => {
  const out = path.join(tmp, 'zoom.mov');
  await renderVideo(await card(3000), { opening: 'top', zoom: true, scroll: true, scrollSeconds: 6, baseSeconds: 10 }, out);
  assert.ok(Math.abs(seconds(out) - (10 + CONFIG.zoomSeconds + 6)) < 0.3);
  const start = darkColumns(frameAt(out, 10.2)), mid = darkColumns(frameAt(out, 15)), end = darkColumns(frameAt(out, 19.8));
  assert.ok(mid > start * 1.15, `zoom should be growing: ${start} -> ${mid}`);
  assert.ok(end > mid * 1.05, `zoom should keep growing: ${mid} -> ${end}`);
  // no jump where the zoom hands over to the scroll (t = 20s)
  const before = frameAt(out, 19.9), after = frameAt(out, 20.1);
  assert.ok(meanDiff(before, after) < 1.5, `jump at the zoom→scroll seam: ${meanDiff(before, after)}`);
});

test('scroll moves through the whole card', async () => {
  const out = path.join(tmp, 'scroll.mov');
  await renderVideo(await card(3000), { opening: 'top', scroll: true, scrollSeconds: 6 }, out);
  const a = frameAt(out, 10.3), b = frameAt(out, 13), c = frameAt(out, 15.9);
  assert.ok(meanDiff(a, b) > 1 && meanDiff(b, c) > 1, 'frames should keep changing during the scroll');
});

test('zoom from the whole post is refused on very tall cards, with a clear error', async () => {
  await assert.rejects(renderVideo(await card(6000), { opening: 'fit', zoom: true }, path.join(tmp, 'x.mov')), e => e.code === 'zoom_limit');
});

test('bad format is refused', async () => {
  await assert.rejects(renderVideo(await card(900), { format: '24p' }, path.join(tmp, 'y.mov')), /60i or 50i/);
});
