// RVN Social Clipper — front end. No framework, no build step.
// Flow: fetch a post (signed by the server) → check/fix its text and highlight passages →
// choose options → preview the first frame → render the video into the same stage.
import { buildShotlist, localDate, languageName, shotlistName, normalizeTitle, normalizeName, normalizeLanguage } from './shotlist.js';

const $ = id => document.getElementById(id);
const checked = name => document.querySelector(`input[name=${name}]:checked`).value;
// Zoom is how the video gets to the scroll (the alternative is a straight cut); it only exists with Scroll.
const zoomOn = () => $('scroll').checked && checked('approach') === 'zoom';

const state = {
  post: null,       // the fetched post: { name, handle, ... }
  token: null,      // server signature for that post; preview/render refuse a post without one
  plan: null,       // what zoom/scroll can do for this post's height (from /api/preview)
  cardHeight: 0,
  frames: null,     // opening-frame previews, { fit, top }
  busy: false,
};

function say(el, text, kind) {
  el.hidden = !text;
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

async function api(name, body) {
  const res = await fetch('/api/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = `Request failed (${res.status}).`;
    try { msg = (await res.json()).error || msg; } catch { /* body wasn't JSON */ }
    throw new Error(msg);
  }
  return res;
}

// ── Post text box: plain text, with highlighted passages kept as <mark> ──────────
// The server only trusts what it fetched, so all we send back is the (lightly edited)
// text plus highlight ranges: character offsets into that text.
const box = $('text');
if (box.contentEditable !== 'plaintext-only') {      // browsers without plaintext-only: editable, plain-text paste forced
  box.contentEditable = 'true';
  box.dataset.mode = 'true';
  box.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
}

function serialize(root) {                           // a node or fragment -> { text, ranges }
  let text = '';
  const ranges = [];
  const walk = (node, inMark) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        if (inMark && n.textContent) ranges.push({ start: text.length, end: text.length + n.textContent.length });
        text += n.textContent;
      } else if (n.nodeName === 'BR') {
        text += '\n';
      } else if (n.nodeName === 'MARK') {
        walk(n, true);
      } else {
        if (n.nodeName === 'DIV' && text && !text.endsWith('\n')) text += '\n';
        walk(n, inMark);
      }
    }
  };
  walk(root, false);
  return { text, ranges: mergeRanges(ranges) };
}

function mergeRanges(ranges) {
  const out = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end); else out.push({ ...r });
  }
  return out;
}

const readBox = () => serialize(box);

function renderBox(text, ranges) {                   // rebuild the box from text + highlight ranges
  box.textContent = '';
  let pos = 0;
  for (const r of mergeRanges(ranges)) {
    if (r.start > pos) box.append(text.slice(pos, r.start));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(r.start, r.end);
    box.append(mark);
    pos = r.end;
  }
  if (pos < text.length) box.append(text.slice(pos));
}

function offsetAt(node, offset) {                    // character offset of a DOM point, counted like serialize()
  const r = document.createRange();
  r.selectNodeContents(box);
  r.setEnd(node, offset);
  return serialize(r.cloneContents()).text.length;
}

function selectOffsets(start, end) {                 // restore the selection after a re-render
  const where = target => {
    let n = 0;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (target <= n + t.length) return [t, target - n];
      n += t.length;
    }
    return [box, box.childNodes.length];
  };
  const [sn, so] = where(start);
  const [en, eo] = where(end);
  const r = document.createRange();
  r.setStart(sn, so);
  r.setEnd(en, eo);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

function currentSelection() {                        // { start, end, covered, rect } for the selection inside the box, or null
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!box.contains(r.startContainer) || !box.contains(r.endContainer)) return null;
  const { text, ranges } = readBox();
  let start = offsetAt(r.startContainer, r.startOffset);
  let end = offsetAt(r.endContainer, r.endOffset);
  while (start < end && /\s/.test(text[start])) start++;       // never highlight stray spaces at the edges
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (end <= start) return null;
  return { start, end, covered: ranges.some(x => x.start <= start && x.end >= end), rect: r.getBoundingClientRect() };
}

function setHighlight(start, end, on) {
  const { text, ranges } = readBox();
  const next = on
    ? [...ranges, { start, end }]
    : ranges.flatMap(x => x.end <= start || x.start >= end ? [x] : [
        ...(x.start < start ? [{ start: x.start, end: start }] : []),
        ...(x.end > end ? [{ start: end, end: x.end }] : []),
      ]);
  renderBox(text, next);
  selectOffsets(start, end);
  $('previewInfo').textContent = 'Highlights changed — click Update preview to check them.';
  updatePop();
  updateShotlist();
}

function updatePop() {                               // the floating Highlight / Remove highlight button
  const s = box.isContentEditable ? currentSelection() : null;
  $('hlPop').hidden = !s;
  if (!s) return;
  const field = $('hlPop').parentElement.getBoundingClientRect();
  $('hlBtn').textContent = s.covered ? 'Remove highlight' : 'Highlight';
  $('hlPop').style.left = Math.min(Math.max(s.rect.left + s.rect.width / 2 - field.left, 60), field.width - 60) + 'px';
  $('hlPop').style.top = Math.max(s.rect.top - field.top - 6, 24) + 'px';
}

document.addEventListener('selectionchange', updatePop);
$('hlBtn').addEventListener('mousedown', e => e.preventDefault());     // keep the text selected while clicking
$('hlBtn').onclick = () => { const s = currentSelection(); if (s) setHighlight(s.start, s.end, !s.covered); };
box.addEventListener('input', refreshButtons);

const postFields = () => { const { text, ranges } = readBox(); return { token: state.token, text, highlights: ranges }; };
const hasText = () => !!state.post && readBox().text.trim().length > 0;    // only ever a fetched post, never one built from scratch

function refreshButtons() {
  $('previewBtn').disabled = state.busy || !hasText();
  checkZoomLimit();
  updateShotlist();
}

// Step 2 is always visible, but greyed out until there is a fetched post to check.
function setEditor(on) {
  $('editor').classList.toggle('off', !on);
  $('builder').classList.toggle('off', !on);      // steps 3 and 4 wait for a post too
  $('previewBtn').disabled = !on;
  box.contentEditable = on ? (box.dataset.mode || 'plaintext-only') : 'false';
  if (!on) $('hlPop').hidden = true;
}
setEditor(false);

// ── Step 1: fetch ────────────────────────────────────────────────────────────────
$('fetchBtn').onclick = async () => {
  const url = $('url').value.trim();
  if (!url) return say($('fetchMsg'), 'Paste a link first.', 'err');
  state.busy = true;
  $('fetchBtn').disabled = true;
  say($('fetchMsg'), 'Fetching…');
  try {
    const { post, token } = await (await api('post', { url })).json();
    state.post = post;
    state.token = token;
    setEditor(true);
    $('name').value = post.name || '';
    $('handle').value = post.handle || '';
    renderBox(post.text || '', []);
    fillShotlistFields(post);
    say($('fetchMsg'), `Got ${post.name} (@${post.handle}).`);
    state.busy = false;
    refreshButtons();
    await preview();
  } catch (err) {
    say($('fetchMsg'), err.message, 'err');
  } finally {
    state.busy = false;
    $('fetchBtn').disabled = false;
    refreshButtons();
  }
};
$('url').addEventListener('keydown', e => { if (e.key === 'Enter') $('fetchBtn').click(); });

// ── Step 5: suggested shotlist ───────────────────────────────────────────────────
// Built in the page from the post, the video options and four fields the producer can correct.
// Everything the app can't know is left as a visible [PLACEHOLDER] rather than guessed.
const slFields = ['slTitle', 'slName', 'slDate', 'slLang'];

function fillShotlistFields(post) {
  $('slTitle').value = post.title || '';
  $('slName').value = shotlistName(post.name);
  $('slDate').value = post.postedAt ? localDate(post.postedAt, post.tz) : '';
  $('slLang').value = languageName(post.lang);
  const tzNote = post.tz === 'UTC'
    ? 'X gives the time in UTC, so the date is the UTC date — change it if the poster’s local date differs.'
    : 'The date is read in the poster’s time zone.';
  const bioQuote = post.bio ? `“${post.bio.length > 160 ? post.bio.slice(0, 157) + '…' : post.bio}”` : '';
  $('slHint').textContent = (post.bio
    ? (post.title ? `Title suggested from the poster’s bio: ${bioQuote}` : 'No title could be determined from bio; please enter one manually.')
    : post.title ? 'Title suggested for this account — check it.' : 'No bio was available — type the title.')
    + ' ' + tzNote;
  $('shotlistPanel').hidden = false;      // step 5 only appears once there is a post
}

function shotlistText() {
  const openingCut = checked('opening') === 'top' && !!state.plan && state.cardHeight > state.plan.overviewRows;
  return buildShotlist({
    platform: state.post.platform,
    title: $('slTitle').value, name: $('slName').value, date: $('slDate').value, language: $('slLang').value,
    text: readBox().text, highlights: readBox().ranges,
  }, { zoom: zoomOn(), scroll: $('scroll').checked, openingCut });
}

function updateShotlist() {
  if (!state.post) return;
  const out = $('shotlistOut');
  out.textContent = '';
  // Placeholders like [LANGUAGE] are marked so they are hard to miss; so are the highlight tags.
  for (const part of shotlistText().split(/(\[(?:DATE|TITLE|NAME|LANGUAGE)\]|\[(?:START|END) HIGHLIGHT\])/)) {
    if (/^\[(?:DATE|TITLE|NAME|LANGUAGE)\]$/.test(part) || /^\[(?:START|END) HIGHLIGHT\]$/.test(part)) {
      const mark = document.createElement('span');
      mark.className = part.includes('HIGHLIGHT') ? 'hlm' : 'gap';
      mark.textContent = part;
      out.append(mark);
    } else out.append(part);
  }
}

slFields.forEach(id => $(id).addEventListener('input', () => { $(id).classList.remove('invalid'); updateShotlist(); }));
// The shotlist always uses the required capitalisation; once you leave a box it shows it too.
const NORMALIZERS = { slTitle: normalizeTitle, slName: normalizeName, slLang: normalizeLanguage };
Object.entries(NORMALIZERS).forEach(([id, fix]) => $(id).addEventListener('change', () => { $(id).value = fix($(id).value); updateShotlist(); }));

// Copying needs the title, name, date and language: the shotlist must never leave with a gap in it.
const SL_REQUIRED = [['slTitle', 'title'], ['slName', 'name'], ['slDate', 'date'], ['slLang', 'language']];

function showNotice(message, focusId) {
  $('slDialogMsg').textContent = message;
  $('slDialog').showModal();
  $('slDialog').addEventListener('close', () => $(focusId)?.focus(), { once: true });
}
$('slDialogOk').onclick = () => $('slDialog').close();

$('copyShotlist').onclick = async () => {
  const missing = SL_REQUIRED.filter(([id]) => !$(id).value.trim());
  if (missing.length) {
    missing.forEach(([id]) => $(id).classList.add('invalid'));
    const names = missing.map(([, label]) => label);
    showNotice(names.length === 1 ? `Please add a ${names[0]}.` : `Please add: ${names.join(', ')}.`, missing[0][0]);
    return;
  }
  const text = shotlistText();
  try {
    await navigator.clipboard.writeText(text);
  } catch {                                           // no clipboard permission: fall back to selecting the text
    const r = document.createRange();
    r.selectNodeContents($('shotlistOut'));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    document.execCommand('copy');
  }
  $('copyShotlist').textContent = 'Copied ✓';
  setTimeout(() => { $('copyShotlist').textContent = 'Copy shotlist'; }, 1500);
};

// ── Step 3: options ──────────────────────────────────────────────────────────────
function applyPlan(plan, cardHeight) {
  state.plan = plan;
  state.cardHeight = cardHeight;
  const can = plan.canMotion;
  $('motion').classList.toggle('off', !can);
  $('scroll').disabled = !can;
  if (!can) $('scroll').checked = false;
  syncScrollOpts();
  $('motion').title = can ? '' : 'This post fits on screen, so there is nothing to scroll.';

  const sel = $('scrollSeconds');
  const keep = sel.value;
  const options = [['auto', `auto (${plan.autoScrollSeconds}s)`], ...[15, 30, 45, 60, 90, 120, 180].map(s => [String(s), `${s}s`])];
  sel.innerHTML = options.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
  if (options.some(([v]) => v === keep)) sel.value = keep;

  $('openingSet').title = plan.overviewRows < cardHeight
    ? `This post is about ${(cardHeight / 1080).toFixed(1)} screens tall. “Whole post” shrinks all of it into the frame; “Top of the post” stays readable and fades to show there is more.`
    : 'This post fits on one screen, so both choices look the same.';
  updateScrollHint();
  refreshButtons();
}

// Zoom can start from the whole post only up to a height limit. While Zoom is on and the post is
// too tall, "Whole post" is greyed out (hover says why) and "Top of the post" takes over.
const ZOOM_LIMIT_TIP = 'Zoom can only start from the whole post when it is under about 4 screens tall. Pick “Top of the post” as the opening shot, or turn Zoom off.';
function checkZoomLimit() {
  const p = state.plan;
  const limited = !!p && state.cardHeight > p.zoomFitMaxRows && zoomOn();
  const fit = $('openingFit');
  fit.querySelector('input').disabled = limited;
  fit.classList.toggle('disabled', limited);
  if (limited) fit.dataset.tip = ZOOM_LIMIT_TIP; else delete fit.dataset.tip;
  if (limited && checked('opening') === 'fit') {
    document.querySelector('input[name=opening][value=top]').checked = true;
    showFrame();
    updateShotlist();
  }
  $('makeBtn').disabled = state.busy || !hasText();
}

function updateScrollHint() {
  const p = state.plan;
  if (!p || !p.canMotion) { $('scrollSeconds').title = ''; return; }
  const secs = $('scrollSeconds').value === 'auto' ? p.autoScrollSeconds : Number($('scrollSeconds').value);
  const linesPerSec = p.pan / secs / 54;              // one line of card text is about 54px
  $('scrollSeconds').title = `${Math.round(p.pan / 1080 * 10) / 10} screens to scroll through — at ${secs}s that is about ${linesPerSec.toFixed(1)} lines a second.`
    + (linesPerSec > 4 ? ' Too fast to read; pick a longer time if viewers need to follow along.' : '');
}

$('scrollSeconds').onchange = updateScrollHint;
document.querySelectorAll('input[name=approach]').forEach(r => r.addEventListener('change', () => { checkZoomLimit(); updateShotlist(); }));
// The scroll choices stay visible but greyed (and unclickable) until Scroll is ticked.
function syncScrollOpts() {
  const on = $('scroll').checked;
  $('scrollOpts').classList.toggle('off', !on);
  $('scrollOpts').querySelectorAll('input, select').forEach(el => { el.disabled = !on; });
}
$('scroll').onchange = () => { syncScrollOpts(); checkZoomLimit(); updateShotlist(); };
document.querySelectorAll('input[name=opening]').forEach(r => r.addEventListener('change', () => {
  checkZoomLimit();
  updateShotlist();
  if (!$('stageImg').hidden) showFrame();
}));

// ── Step 4: one 16:9 stage — the opening-frame preview, then the finished video ──
function showStage(mode, message) {                  // 'empty' | 'image' | 'video'
  $('stageEmpty').hidden = mode !== 'empty';
  $('stageImg').hidden = mode !== 'image';
  $('player').hidden = mode !== 'video';
  if (mode === 'empty') $('stageEmpty').textContent = message || 'Fetch a post to see it here.';
  if (mode !== 'video') { $('player').pause(); $('result').hidden = true; }
}

function showFrame() {
  if (state.frames) $('stageImg').src = state.frames[checked('opening')];
}

async function preview() {
  if (!hasText()) return;
  state.busy = true;
  refreshButtons();
  showStage('empty', 'Rendering preview…');
  try {
    const r = await (await api('preview', postFields())).json();
    state.frames = r.frames;
    showFrame();
    showStage('image');
    $('previewInfo').textContent = 'This is the first frame of the video.'
      + (r.matchCount ? ` ${r.matchCount} highlighted passage${r.matchCount === 1 ? '' : 's'} shown.` : '');
    applyPlan(r.plan, r.cardHeight);
  } catch (err) {
    showStage('empty', err.message);
  } finally {
    state.busy = false;
    refreshButtons();
  }
}
$('previewBtn').onclick = preview;

$('makeBtn').onclick = async () => {
  state.busy = true;
  refreshButtons();
  $('result').hidden = true;
  const t0 = Date.now();
  const label = $('makeBtn').textContent;
  $('makeBtn').innerHTML = '<span class="spin"></span> Rendering…';
  const tick = setInterval(() => say($('makeMsg'), `Rendering… ${Math.round((Date.now() - t0) / 1000)}s. Long scrolls can take a minute or two — keep this tab open.`), 500);
  try {
    const res = await api('render', {
      ...postFields(),
      format: checked('format'),
      opening: checked('opening'),
      baseSeconds: Number($('base').value),
      zoom: zoomOn(),
      scroll: $('scroll').checked,
      scrollSeconds: $('scroll').checked ? $('scrollSeconds').value : undefined,
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const filename = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'social-video.mov';
    $('player').src = url;
    $('download').href = url;
    $('download').download = filename;
    showStage('video');
    $('previewInfo').textContent = '';
    $('resultInfo').textContent = `${res.headers.get('x-video-seconds') || '?'}s · ${(blob.size / 1e6).toFixed(1)} MB · rendered in ${Math.round((Date.now() - t0) / 1000)}s`;
    $('result').hidden = false;
    say($('makeMsg'), '');
    $('stage').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    say($('makeMsg'), err.message, 'err');
  } finally {
    clearInterval(tick);
    state.busy = false;
    $('makeBtn').textContent = label;
    refreshButtons();
  }
};

refreshButtons();
