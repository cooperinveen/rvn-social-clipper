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
    { t: 'Movement — long posts only', b: ['<strong>Scroll to the end</strong> pans from the top of the post to the last line. Choose how long it takes; the note shows how many lines a second that is — over about 4 is too fast to read.',
      'Scrolling starts from a close-up of the top of the post, so choose how the video gets there: <strong>Straight cut</strong> (the default) jumps from the opening shot to the close-up, which is two shots in the shotlist; <strong>Zoom in</strong> (+10 seconds) pushes in smoothly, which keeps it one shot. Zooming from “Whole post” only works on posts under about 4 screens tall; for longer ones choose “Top of the post” as the opening shot.'] },
  ]},
  { title: 'Preview and download', entries: [
    { t: 'The preview box', b: ['Before you create a video it shows the first frame. After you click <strong>Create video</strong> it plays the finished video in the same place — long scrolls can take a minute or two to render, so keep the tab open.'] },
    { t: 'Download', b: ['<strong>Download .mov</strong> saves the video (H.264 in a QuickTime file). Clicking <strong>Update preview</strong> afterwards swaps the video back out for the still, so download first.'] },
  ]},
  { title: 'Shotlist', entries: [
    { t: 'Suggested shotlist', b: ['Step 5 writes a Reuters shotlist for the video you’re making — dateline, shot description and the whole post in quotes, exactly as the poster wrote it. It follows your choices: a zoom or a zoom-and-scroll is one shot; scrolling after a straight cut is two shots, with the post quoted once. Highlighted passages are marked <strong>[START HIGHLIGHT]</strong> … <strong>[END HIGHLIGHT]</strong> in the quote. Click <strong>Copy shotlist</strong> to paste it into your edit.'] },
    { t: 'Title, name, date, language', b: ['Fill in from the post. The <strong>title</strong> is read from the poster’s bio when the bio says it clearly (“President of Ukraine”, “Anthropic CEO”); the bio is shown under the fields so you can check it, and you can change the title. If nothing can be read, type it.',
      'The <strong>date</strong> is when the post was made, in the poster’s time zone for Truth Social. X only gives UTC, so change the date if the poster’s local day is different. The <strong>language</strong> comes from X; correct it if it’s wrong. The shotlist forces the capitalisation it needs whatever you type: title and name in capitals, language like “English”. A post more than a month old gets <strong>ARCHIVE -</strong> in the dateline, and the label follows the date if you change it. Anything missing shows as a yellow [PLACEHOLDER] in the shotlist, and <strong>Copy shotlist</strong> won’t copy until the title, name, date and language are all filled in.'] },
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
