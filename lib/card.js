// Render a post (as data) into a card PNG exactly 1920px wide — the video's frame width.
// The card is drawn from the post's data rather than screenshotted from the live site,
// so it can't break when X or Truth Social change their markup, and a highlight is just
// a <mark> around text we control.
import sharp from 'sharp';
import { launchBrowser } from './browser.js';

const CARD_W = 960;      // CSS px; rendered at 2x -> 1920px, the video width
const SCALE = 2;

// The card takes the look of the site the post came from.
const THEMES = {
  x:     { accent: '#1d9bf0', handle: '#536471', text: '#0f1419', badgeStyle: 'burst' },
  truth: { accent: '#5448ee', handle: '#6b7280', text: '#0b0b19', badgeStyle: 'check' },
};

const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Link-ish tokens (URLs, @mentions, #hashtags) are coloured like the platform does.
const LINKISH = /(https?:\/\/\S+|\b(?:[a-z0-9-]+\.)+(?:com|org|net|gov|edu|io|co|uk|us|news|tv|info|ly|me)\/\S*|[@＠][\w]+|[#＃][\p{L}\p{N}_]+)/giu;

// ranges: [{start, end}] character offsets into `text` that get the yellow highlight.
export function textToHtml(text, ranges = []) {
  const link = new Uint8Array(text.length), hl = new Uint8Array(text.length);
  for (const m of text.matchAll(LINKISH)) link.fill(1, m.index, m.index + m[0].length);
  for (const r of ranges) hl.fill(1, Math.max(0, r.start), Math.min(text.length, r.end));
  let out = '', pos = 0;
  for (const line of text.split('\n')) {
    let html = '', i = 0;
    while (i < line.length) {                       // runs of identical (link, highlight) state
      let j = i + 1;
      while (j < line.length && link[pos + j] === link[pos + i] && hl[pos + j] === hl[pos + i]) j++;
      let seg = escapeHtml(line.slice(i, j));
      if (hl[pos + i]) seg = `<mark>${seg}</mark>`;
      if (link[pos + i]) seg = `<span class="lnk">${seg}</span>`;
      html += seg; i = j;
    }
    // One block per line, each with dir=auto, so mixed-direction posts align per paragraph.
    out += `<div class="ln" dir="auto">${html || '<br>'}</div>`;
    pos += line.length + 1;
  }
  return out;
}

const BADGE = {
  burst: c => `<svg viewBox="0 0 22 22" width="30" height="30"><path fill="${c}" d="M20.4 11c0-.9-.5-1.7-1.3-2.2.3-.9.1-1.8-.5-2.5s-1.6-1-2.5-.8c-.4-.8-1.2-1.4-2.2-1.4-.5 0-1 .2-1.4.5-.8-.5-1.8-.5-2.6 0-.4-.3-.9-.5-1.4-.5-1 0-1.8.6-2.2 1.4-.9-.2-1.9.1-2.5.8s-.8 1.6-.5 2.5C3.5 9.3 3 10.1 3 11s.5 1.7 1.3 2.2c-.3.9-.1 1.8.5 2.5s1.6 1 2.5.8c.4.8 1.2 1.4 2.2 1.4.5 0 1-.2 1.4-.5.8.5 1.8.5 2.6 0 .4.3.9.5 1.4.5 1 0 1.8-.6 2.2-1.4.9.2 1.9-.1 2.5-.8s.8-1.6.5-2.5c.8-.5 1.3-1.3 1.3-2.2z"/><path fill="#fff" d="M9.6 14.5l-2.6-2.6 1-1 1.6 1.6 4.2-4.4 1 1z"/></svg>`,
  check: c => `<svg viewBox="0 0 24 24" width="30" height="30"><circle cx="12" cy="12" r="11" fill="${c}"/><path fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M7 12.5l3.2 3.2L17 8.8"/></svg>`,
};

// Fonts: Inter for Latin/Cyrillic/Greek, Noto for everything else. Google Fonts
// serves unicode-range subsets, so only the scripts actually used get downloaded.
const FONT_LINK = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans:wght@400;700&family=Noto+Sans+Arabic:wght@400;700&family=Noto+Sans+Devanagari:wght@400;700&family=Noto+Sans+Bengali:wght@400;700&family=Noto+Sans+Hebrew:wght@400;700&family=Noto+Sans+Thai:wght@400;700&family=Noto+Sans+SC:wght@400;700&family=Noto+Sans+JP:wght@400;700&family=Noto+Sans+KR:wght@400;700&family=Noto+Color+Emoji&display=swap';

export function cardHtml({ platform = 'x', name, handle, verified, avatarDataUri, text, ranges = [], showHighlights = false }) {
  const t = THEMES[platform] || THEMES.x;
  const initial = escapeHtml((name || handle || '?').trim().charAt(0).toUpperCase());
  const avatar = /^data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=]+$/.test(avatarDataUri || '')   // only a plain image data URI goes into the page
    ? `<img class="av" src="${avatarDataUri}">`
    : `<div class="av ph">${initial}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_LINK}">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:#fff}
  body{width:${CARD_W}px;font-family:Inter,"Noto Sans","Noto Sans Arabic","Noto Sans Devanagari","Noto Sans Bengali","Noto Sans Hebrew","Noto Sans Thai","Noto Sans SC","Noto Sans JP","Noto Sans KR","Noto Color Emoji",-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
       color:${t.text};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  .card{padding:48px 56px 52px}
  .hd{display:flex;align-items:center;gap:22px;margin-bottom:30px}
  .av{width:92px;height:92px;border-radius:50%;object-fit:cover;flex:none;background:#e5e7eb}
  .av.ph{display:flex;align-items:center;justify-content:center;font-size:42px;font-weight:700;color:#fff;background:${t.accent}}
  .who{min-width:0}
  .nm{display:flex;align-items:center;gap:9px;font-weight:700;font-size:36px;line-height:1.2}
  .nm span.t{min-width:0;overflow-wrap:anywhere}
  .nm svg{flex:none}
  .hn{font-size:30px;color:${t.handle};line-height:1.3;margin-top:2px}
  .tx{font-size:38px;line-height:1.42;overflow-wrap:anywhere;word-break:normal}
  .lnk{color:${t.accent}}
  mark{background:${showHighlights ? '#ffff00' : 'transparent'};color:inherit;padding:0;border-radius:2px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
</style></head><body><div class="card" id="card">
  <div class="hd">${avatar}<div class="who">
    <div class="nm"><span class="t">${escapeHtml(name || '')}</span>${verified ? BADGE[t.badgeStyle](t.accent) : ''}</div>
    ${handle ? `<div class="hn">@${escapeHtml(handle.replace(/^@/, ''))}</div>` : ''}
  </div></div>
  <div class="tx">${textToHtml(text, ranges)}</div>
</div></body></html>`;
}

// Chromium silently wraps screenshots taller than ~16,384 device px (the top of the page
// reappears at the bottom). Long posts are taller than that, so tall cards are captured
// in slices and stitched; the slices are pixel-exact, so there is no seam.
const SLICE_CSS = 4000;
async function shootTall(page, cssH) {
  if (cssH <= SLICE_CSS) return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: CARD_W, height: cssH }, fullPage: true });
  const parts = [];
  for (let y = 0; y < cssH; y += SLICE_CSS) {
    const h = Math.min(SLICE_CSS, cssH - y);
    parts.push({ y, buf: await page.screenshot({ type: 'png', clip: { x: 0, y, width: CARD_W, height: h }, fullPage: true }) });
  }
  return sharp({ create: { width: CARD_W * SCALE, height: cssH * SCALE, channels: 3, background: '#ffffff' } })
    .composite(parts.map(p => ({ input: p.buf, left: 0, top: p.y * SCALE })))
    .png().toBuffer();
}

// post: { platform, name, handle, verified, avatarDataUri, text }; ranges: [{start, end}] to highlight.
// Returns { clean, highlighted, width, height, matchCount } — PNG buffers (highlighted is null
// when there are no ranges), pixel size, and the number of highlighted ranges.
export async function renderCard(post, { ranges = [] } = {}) {
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({ viewport: { width: CARD_W, height: 800 }, deviceScaleFactor: SCALE });
    const page = await ctx.newPage();
    const shoot = async (showHighlights) => {
      // If the web fonts can't load (offline, blocked), the wait times out and the card
      // falls back to system fonts rather than failing.
      await page.setContent(cardHtml({ ...post, ranges, showHighlights }), { waitUntil: 'networkidle' }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      const box = await page.locator('#card').boundingBox();
      const cssH = Math.ceil(box.height);
      return { buf: await shootTall(page, cssH), height: cssH * SCALE };
    };
    const clean = await shoot(false);
    const hl = ranges.length ? await shoot(true) : null;
    return {
      clean: clean.buf,
      highlighted: hl ? hl.buf : null,
      matchCount: ranges.length,
      width: CARD_W * SCALE,
      height: clean.height,
    };
  } finally {
    await browser.close();
  }
}
