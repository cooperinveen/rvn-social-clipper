// Suggested Reuters shotlist for a social-post video. Pure functions with no DOM access, so
// the page and the tests (test/shotlist.test.js) use the same code.
//
// The format follows the RVN social-media screenshot guidance:
//   INTERNET (OCTOBER 26, 2026) (SOCIAL MEDIA WEBSITE - Access All) (MUTE)
//
//   1. SCREENSHOT OF TRUTH SOCIAL POST BY US PRESIDENT, DONALD TRUMP, DATED OCTOBER 25, 2026, ZOOMING IN AND SCROLLING DOWN, READING (English):
//
// The dateline carries the date of the screenshot (today). The post's own date goes in the first shot,
// as DATED …, only when it differs from the dateline date.
//
//       "The post, exactly as written…"
//
// Highlighted passages are listed after the quote, so nothing is added inside the poster's words:
//       "…the post…" / HIGHLIGHTS APPEAR OVER "a total loser" AND "should be praised."
// Each CUT is a new shot: a hold that zooms and/or scrolls without a cut is one shot; a hold that
// cuts straight to a scroll is two. The whole post is quoted once.

export const DATELINE_SOURCE = 'SOCIAL MEDIA WEBSITE - Access All';
const PLATFORM_NAMES = { x: 'X', truth: 'TRUTH SOCIAL' };
const INLINE_MAX = 280;                       // a single paragraph up to this long is quoted on the shot line

// 'YYYY-MM-DD' for an instant, read in a time zone.
export function localDate(isoInstant, tz = 'UTC') {
  const d = new Date(isoInstant);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// 'YYYY-MM-DD' -> 'OCTOBER 25, 2026'
export function datelineDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(d).toUpperCase();
}

// BCP-47 code from the post -> 'Spanish'. Codes that mean "no language" give '' so the
// producer is asked, rather than guessed for.
const NO_LANGUAGE = new Set(['und', 'zxx', 'qme', 'qht', 'qam', 'qst', 'art', '']);
export function languageName(code) {
  const c = String(code || '').toLowerCase();
  if (NO_LANGUAGE.has(c)) return '';
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(c) || ''; } catch { return ''; }
}

// A display name as it appears in a shotlist: the first name if several are given
// ("Volodymyr Zelenskyy / Володимир Зеленський"), no emoji, no middle initial, capitals.
export function shotlistName(name) {
  return String(name || '')
    .split(/\s[/|]\s/)[0]
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}‍️]/gu, '')
    .replace(/\s+[A-Z]\.(?=\s)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// Capitalisation the shotlist requires, whatever was typed: title and name in capitals, the
// language named like a proper noun (English, Brazilian Portuguese).
export const normalizeTitle = s => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
export const normalizeName = normalizeTitle;
export const normalizeLanguage = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
  .replace(/(^|[\s(/-])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase());

// The shots implied by the video's options. `openingCut` is true when the opening shot shows only
// the top of a longer post (so the scroll is where the whole post is seen).
export function shotsFor({ zoom, scroll, openingCut }) {
  if (zoom && scroll) return [{ motion: 'ZOOMING IN AND SCROLLING DOWN', quote: true }];
  if (zoom) return [{ motion: 'ZOOMING IN', quote: true }];
  if (scroll) return [
    { motion: '', quote: !openingCut },
    { motion: 'SCROLLING DOWN', samePost: true, quote: !!openingCut },
  ];
  return [{ motion: '', quote: true }];
}

// The note that follows the quote, naming each highlighted passage in the order it appears
// ({start, end} character offsets into `text`): HIGHLIGHT APPEARS OVER "a", or
// HIGHLIGHTS APPEAR OVER "a", "b" AND "c". Empty when nothing is highlighted.
export function highlightNote(text, ranges = []) {
  const parts = [];
  let pos = 0;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const start = Math.max(pos, r.start), end = Math.min(text.length, r.end);
    if (end <= start) continue;
    const words = text.slice(start, end).replace(/\s+/g, ' ').trim();   // a passage across lines reads as one
    if (words) parts.push(`"${words}"`);
    pos = end;
  }
  if (!parts.length) return '';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} AND ${parts[parts.length - 1]}`;
  return `${parts.length === 1 ? 'HIGHLIGHT APPEARS' : 'HIGHLIGHTS APPEAR'} OVER ${list}`;
}

// The post in quotes: inline on the shot line if it's one short paragraph, else an indented block.
function quoteBlock(text) {
  const paragraphs = text.replace(/\r\n/g, '\n').trim().split('\n').map(l => l.trimEnd());   // trailing spaces are invisible; the words are untouched
  if (paragraphs.length === 1 && text.length <= INLINE_MAX) return { inline: `“${paragraphs[0]}”` };
  const lines = [...paragraphs];
  lines[0] = `“${lines[0]}`;
  lines[lines.length - 1] = `${lines[lines.length - 1]}”`;
  return { block: lines.map(l => (l ? `    ${l}` : '')).join('\n') };
}

// fields: { platform, title, name, date ('YYYY-MM-DD'), language, text, highlights: [{start, end}] }
// options: { zoom, scroll, openingCut, today ('YYYY-MM-DD' — the dateline date; defaults to the current date) }
export function buildShotlist(fields, options = {}) {
  const platform = PLATFORM_NAMES[fields.platform] || String(fields.platform || '').toUpperCase();
  const name = normalizeName(fields.name);
  const title = normalizeTitle(fields.title);
  const who = `${title || '[TITLE]'}, ${name || '[NAME]'}`;          // always a comma after the title
  const language = normalizeLanguage(fields.language) || '[LANGUAGE]';
  const today = options.today || localDate(Date.now(), undefined);   // the screenshot's date: the reader's own date
  const dated = fields.date === today ? '' : `, DATED ${datelineDate(fields.date) || '[DATE]'}`;   // only when the post is from another day
  const raw = String(fields.text || '');
  const lead = raw.length - raw.trimStart().length;            // highlight offsets count from the untrimmed text
  const text = raw.trim();
  const note = highlightNote(text, (fields.highlights || []).map(r => ({ start: r.start - lead, end: r.end - lead })));
  const after = note ? ` / ${note}` : '';

  const out = [`INTERNET (${datelineDate(today)}) (${DATELINE_SOURCE}) (MUTE)`];
  shotsFor(options).forEach((shot, i) => {
    let line = `${i + 1}. ` + (shot.samePost ? `SCREENSHOT OF SAME ${name ? name.split(' ').pop() : '[NAME]'} ${platform} POST` : `SCREENSHOT OF ${platform} POST BY ${who}${dated}`);
    if (shot.motion) line += `, ${shot.motion}`;
    if (shot.quote && text) {
      line += `, READING (${language}):`;
      const q = quoteBlock(text);
      out.push('', q.inline ? `${line} ${q.inline}${after}` : `${line}\n\n${q.block}${after}`);
    } else {
      out.push('', line);
    }
  });
  return out.join('\n');
}
