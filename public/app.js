// Social Video Maker — front end. No framework, no build step.
// Flow: fetch a post (signed by the server) → check/fix its text and highlight passages →
// choose options → preview the first frame → render the video into the same stage.
const $ = id => document.getElementById(id);
const checked = name => document.querySelector(`input[name=${name}]:checked`).value;

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
}

// Step 2 is always visible, but greyed out until there is a fetched post to check.
function setEditor(on) {
  $('editor').classList.toggle('off', !on);
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

// ── Step 3: options ──────────────────────────────────────────────────────────────
function applyPlan(plan, cardHeight) {
  state.plan = plan;
  state.cardHeight = cardHeight;
  const can = plan.canMotion;
  $('motion').classList.toggle('off', !can);
  $('zoom').disabled = !can;
  $('scroll').disabled = !can;
  if (!can) { $('zoom').checked = false; $('scroll').checked = false; $('scrollLenRow').hidden = true; }
  $('motionNote').textContent = can ? '' : '(this post fits on screen, so there is nothing to scroll)';

  const sel = $('scrollSeconds');
  const keep = sel.value;
  const options = [['auto', `auto (${plan.autoScrollSeconds}s)`], ...[15, 30, 45, 60, 90, 120, 180].map(s => [String(s), `${s}s`])];
  sel.innerHTML = options.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
  if (options.some(([v]) => v === keep)) sel.value = keep;

  $('openingHint').textContent = plan.overviewRows < cardHeight
    ? `This post is about ${(cardHeight / 1080).toFixed(1)} screens tall. “Whole post” shrinks all of it into the frame; “Top of the post” stays readable and fades to show there is more.`
    : 'This post fits on one screen, so both choices look the same.';
  updateScrollHint();
  refreshButtons();
}

// Zoom can start from the whole post only up to a height limit; say so as soon as it applies.
function checkZoomLimit() {
  const p = state.plan;
  const blocked = !!p && state.cardHeight > p.zoomFitMaxRows && checked('opening') === 'fit' && $('zoom').checked;
  $('zoomWarn').hidden = !blocked;
  $('makeBtn').disabled = state.busy || !hasText() || blocked;
}

function updateScrollHint() {
  const p = state.plan;
  if (!p || !p.canMotion) { $('scrollHint').textContent = ''; return; }
  const secs = $('scrollSeconds').value === 'auto' ? p.autoScrollSeconds : Number($('scrollSeconds').value);
  const linesPerSec = p.pan / secs / 54;              // one line of card text is about 54px
  $('scrollHint').textContent = `${Math.round(p.pan / 1080 * 10) / 10} screens to scroll through — at ${secs}s that is about ${linesPerSec.toFixed(1)} lines a second.`
    + (linesPerSec > 4 ? ' Too fast to read; pick a longer time if viewers need to follow along.' : '');
}

$('scrollSeconds').onchange = updateScrollHint;
$('zoom').onchange = checkZoomLimit;
$('scroll').onchange = () => { $('scrollLenRow').hidden = !$('scroll').checked; };
document.querySelectorAll('input[name=opening]').forEach(r => r.addEventListener('change', () => {
  checkZoomLimit();
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
      baseSeconds: Number(checked('base')),
      zoom: $('zoom').checked,
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
