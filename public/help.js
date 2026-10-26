// Help drawer: a searchable guide to every control, opened from the Help button.
const $ = id => document.getElementById(id);

const HELP = [
  { title: 'Getting a post', entries: [
    { t: 'Fetch post', b: ['Paste a link to an X post or a Truth Social post and click <strong>Fetch post</strong> (or press <kbd>Enter</kbd>). Everything in the video comes from that post: the name, handle, profile picture and verified badge are taken from it and can’t be changed.',
      'X works for any public post. Truth Social works for <strong>@realDonaldTrump</strong>’s most recent posts (about 100) only — Truth Social blocks other ways of reading it.'] },
    { t: 'Fixing the text', b: ['Click in the Post text box to correct anything the app got wrong or to trim a long post. You can delete words and fix typos, but most of the words must still come from the original post — the app refuses text that has been rewritten.'] },
  ]},
  { title: 'Highlighting', entries: [
    { t: 'Highlight words', b: ['Select words in the Post text box and click the <span class="hl">Highlight</span> button that appears above them. Only the words you selected are highlighted, even if the same phrase appears elsewhere in the post.',
      'In the video the highlight fades in yellow after 5 seconds. The preview shows highlights from the start so you can check them.'] },
    { t: 'Remove a highlight', b: ['Select highlighted words and click <strong>Remove highlight</strong>. Select only part of a highlight to remove just that part.'] },
    { t: 'Update preview', b: ['The preview doesn’t refresh on its own when you highlight or edit. Click <strong>Update preview</strong> to check your changes. The video always uses your latest text and highlights.'] },
  ]},
  { title: 'Video options', entries: [
    { t: 'Format — 60i / 50i', b: ['Interlaced HD (1920×1080). Use <strong>60i</strong> (30 frames a second) for NTSC-region desks and <strong>50i</strong> (25 frames a second) for PAL-region desks.'] },
    { t: 'Opening hold', b: ['How long the opening shot stays on screen before any highlight, zoom or scroll: 10, 20 or 30 seconds. The highlight always arrives 5 seconds in.'] },
    { t: 'Opening shot', b: ['<strong>Whole post, shrunk to fit</strong> shows all of the post in the frame, however long it is — text gets tiny on long posts.',
      '<strong>Top of the post, fading out</strong> keeps the text readable and fades the bottom edge to show there is more. On a post that fits on one screen the two look the same.'] },
    { t: 'Movement — long posts only', b: ['<strong>Zoom in</strong> (+10 seconds) pushes in from the opening shot to the top of the post at full size. From “Whole post” it only works on posts under about 4 screens tall; for longer ones choose “Top of the post” or turn Zoom off.',
      '<strong>Scroll to the end</strong> pans from the top of the post to the last line. Choose how long it takes; the note shows how many lines a second that is — over about 4 is too fast to read.'] },
  ]},
  { title: 'Preview and download', entries: [
    { t: 'The preview box', b: ['Before you create a video it shows the first frame. After you click <strong>Create video</strong> it plays the finished video in the same place — long scrolls can take a minute or two to render, so keep the tab open.'] },
    { t: 'Download', b: ['<strong>Download .mov</strong> saves the video (H.264 in a QuickTime file). Clicking <strong>Update preview</strong> afterwards swaps the video back out for the still, so download first.'] },
  ]},
  { title: 'Keys', entries: [
    { t: 'Keyboard', b: ['<kbd>Enter</kbd> in the link box fetches the post. <kbd>Esc</kbd> closes this panel.'] },
  ]},
];
const plain = h => h.replace(/<[^>]+>/g, '');
function renderHelp() {
  const terms = $('help-search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  const html = HELP.map(sec => {
    const es = sec.entries.filter(e => !terms.length || terms.every(t => (e.t + ' ' + e.b.map(plain).join(' ')).toLowerCase().includes(t)));
    shown += es.length;
    return es.length ? `<h3 class="help-section-title">${sec.title}</h3>` + es.map(e => `<div class="help-entry"><h4 class="help-entry-title">${e.t}</h4>${e.b.map(p => `<p>${p}</p>`).join('')}</div>`).join('') : '';
  }).join('');
  $('help-body').innerHTML = shown
    ? (terms.length ? `<p class="help-count">${shown} result${shown === 1 ? '' : 's'}</p>` : '') + html
    : `<div class="help-empty">Nothing matches “${terms.join(' ').replace(/[&<]/g, c => (c === '&' ? '&amp;' : '&lt;'))}”. Try a simpler word.</div>`;
}
function openHelp() { $('help-drawer').hidden = false; document.body.style.overflow = 'hidden'; renderHelp(); $('help-search').focus(); }
function closeHelp() { if ($('help-drawer').hidden) return; $('help-drawer').hidden = true; document.body.style.overflow = ''; $('btn-help').focus(); }
$('btn-help').onclick = openHelp;
$('help-close').onclick = closeHelp;
$('help-drawer').addEventListener('click', e => { if (e.target === $('help-drawer')) closeHelp(); });
$('help-search').addEventListener('input', renderHelp);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHelp(); });
