# Contributing to Social Video Generator

This is the video desk's tool for turning an X or Truth Social post into a broadcast-ready
video — a small Node app (plain `(req, res)` handlers plus a vanilla-JS page) that fetches a
post as data, draws it as a card in headless Chrome, and renders it with one ffmpeg filter
graph. This guide is for anyone picking up the code, especially if you're pairing with Claude
or another AI. Read it once before your first change — it covers the traps that have already
cost real debugging time here.

**Golden rule:** the output is a video that may go to air. A wrong word, a missing last
paragraph, a highlight on the wrong phrase or a jump in the motion is an editorial error, not a
cosmetic one — and none of it shows up in a passing build. Bias hard toward "render a real video
and look at it" (§3.3), and when the app can't do something correctly, make it **refuse with a
clear message** rather than quietly produce something degraded.

---

## 1. What you need to know first (the mental model)

- **Posts are data, not screenshots.** `lib/sources.js` fetches a post's text, name, handle,
  avatar and verified flag from a data source; `lib/card.js` draws the card from that data.
  Nothing scrapes a live page, so nothing breaks when X or Truth Social restyle themselves, and
  highlights are just `<mark>` tags around text we control.

- **A post must come from a fetch.** `/api/post` returns the post plus an HMAC-signed token
  (`lib/token.js`). `/api/preview` and `/api/render` accept *only* that token plus the
  producer's edited text and highlight ranges — never a name, handle, avatar or badge. The
  signature locks the author details and the original text; the only thing a producer may change
  is the text, and only to cut it short from the end (§2.1).

- **One ffmpeg filter graph makes the whole video** (`lib/video.js`): opening hold, highlight
  cross-fade, zoom, sub-pixel scroll, colour conversion and interlacing. There is no
  frame-by-frame JavaScript. This is deliberate — it is why the same code runs on a laptop and
  in a serverless function.

- **Three endpoints, three files** (`api/post.js`, `api/preview.js`, `api/render.js`). They are
  Vercel-format handlers; `server.js` is only a local shim that serves `public/` and calls the
  same handlers. There is no database and no session — every request is self-contained, which
  is also why the signed token exists.

- **The front end is plain.** `public/app.js` and `help.js` are ES modules loaded straight from
  the page — no framework, no bundler, no build step. Don't introduce one for a small feature.

- **Stateless and disposable.** Nothing is stored. Render temp files are written to the OS temp
  directory and deleted as soon as the response ends (or the request fails).

- **Highlights are character ranges, not phrases.** The page sends `{start, end}` offsets into
  the text; the server paints exactly those characters. (A phrase match would light up every
  repeat of "does not want it", not just the one the producer selected.)

---

## 2. The non-negotiables (break these and you break the output)

### 2.1 Never accept a post the server didn't fetch, and never let the text be rewritten
`postFromToken()` in `lib/pipeline.js` is the only way a post enters preview/render. Don't add
an endpoint or field that takes name, handle, avatar, badge or free text from the client, and
don't loosen the checks:
- The token's signed fields are authoritative; client-supplied ones are ignored.
- Edited text must be the opening of the original, word for word (`textEditAllowed()` in
  `lib/token.js`): the only edit is cutting from the end. Adding, changing, reordering and cutting
  from the middle or start are all refused. It can't stop someone trimming hard and then
  adding words to a different post; that's an editorial-trust question, not a technical one.
- `SIGNING_SECRET` must be set on any shared deployment. Without it, `/api/post` errors
  rather than falling back to something guessable.
- Avatars are fetched server-side, so only hosts in `AVATAR_HOSTS` (`lib/pipeline.js`) are
  allowed. Don't widen that to "any URL".

### 2.2 Never make a video from a truncated post
X's embed endpoint returns only a ~280-character preview of a long post ("note tweet") and
no way to tell from the text itself. `fetchX()` detects the `note_tweet` marker and gets the
full text from FxTwitter, checking it starts with the text X gave us. If that fails it throws
`long_post_unavailable`. **Keep it that way** — do not add a fallback that "uses what we have".
A producer must never receive a video that stops mid-sentence without knowing.

### 2.3 Verify motion by measuring frames, not by looking at a still
Two bugs here looked fine in screenshots and were broken in the video:
- A per-frame `scale` (`eval=frame`) piped into `overlay` appears to work and never animates.
  Zoom is built with `zoompan` on a white 16:9 canvas for this reason (see the comment in
  `lib/video.js`).
- ffmpeg's `perspective` filter counts frames from 1 (`on` is 1-based, `n` in `crop` is
  0-based) — the sub-pixel scroll uses `on-1`. And `zoompan`'s `x` needs `round()` or the
  zoom→scroll hand-over jumps by one pixel.

`test/video.test.js` measures real rendered frames (text width growing during the zoom, no
jump at the seam, the scroll changing every frame). If you touch the filter graph, run it, then
render a real long post and watch it (§3.3).

### 2.4 Chromium wraps screenshots taller than ~16,384 px
A long post's card is far taller than that, and a single screenshot silently repeats the top of
the page at the bottom — the video then scrolls into the repeat. `shootTall()` in `lib/card.js`
captures in 4,000-CSS-px slices and stitches them. Don't "simplify" it back to one screenshot;
check the **last** lines of a long post in the output.

### 2.5 Highlight offsets must be counted the same way on both sides
The page counts characters with `serialize()` in `public/app.js`; the server realigns them with
`cleanRanges()` in `lib/pipeline.js` (it shifts by the whitespace it trims off the start). If you
change how text is trimmed, normalised or joined on either side, change both, and keep the
tests in `test/text.test.js` passing — an off-by-a-few highlight is silent.

### 2.6 Know what we depend on, and fail loudly when it's gone
| Dependency | Used for | If it fails |
|---|---|---|
| `cdn.syndication.twimg.com` | X post text and author details | clear error ("X returned HTTP …") |
| `api.fxtwitter.com` (FxTwitter, open source, third party) | full text of long X posts; the poster's bio for the shotlist title | long post: refuses (§2.2). Bio: shotlist title is left blank |
| `trumpstruth.org/feed` | @realDonaldTrump's Truth Social posts | clear error; only his ~100 latest posts exist |
| Google Fonts | Inter + Noto fonts on the card | card falls back to system fonts (non-Latin scripts may look wrong) |

None of these is a licensed, supported API. Truth Social itself is deliberately **not** scraped —
it answers every automated client with a Cloudflare block. `TRUMP_AVATAR` in `lib/sources.js` is
a fixed URL and needs updating if his profile picture changes. If you add a source, add it with
the same rules: data not screenshots, a signed token, an explicit failure mode, tests with a
mocked `fetch`.

### 2.7 The look is fixed on purpose
White matte around the card (not black); the card takes the look of the site the post came
from; verified badge, name, handle and picture always from the post; no timestamps, counts or
buttons. These were deliberate editorial/design decisions — don't make them options without
asking.

### 2.8 The shotlist follows the desk's format — and never guesses
`public/shotlist.js` writes the shotlist from the RVN social-media guidance and the desk's worked
example (`test/shotlist.test.js` reproduces it line for line). The rules that matter:
- **A shot is a cut.** Zoom, or zoom then scroll, is one shot; scroll after a straight cut is two.
- **Quote the whole post once, untouched** — no case changes, no trimming (only line-end spaces) —
  with `[START HIGHLIGHT]` / `[END HIGHLIGHT]` around highlighted passages. Highlight offsets count
  from the untrimmed text the page sends, exactly as `cleanRanges()` does (§2.5).
- **Missing information is a visible `[PLACEHOLDER]`.** Never fill a title, date or language by
  guessing. `lib/title.js` answers only when a bio plainly says "<role> of <country>" or
  "<organisation> CEO"; otherwise it returns `null`. Keep it conservative: a wrong title in a
  shotlist is an editorial error.
- **Archive:** a date more than a calendar month before today is labelled `ARCHIVE - ` in the
  dateline (`isArchive()`; exactly one month ago is not yet archive). It's judged against the reader's
  current date, so tests pass `today` explicitly.
- **Date is the post's local date** (Truth Social/Trump: New York time; X: UTC, editable).
The shotlist is built in the page — the server only supplies `postedAt`, `tz`, `lang`, `bio` and
`title`, none of which are signed or used in the video.

### 2.9 Interlacing is part of the format
60i is **30 fps** and 50i is **25 fps** (frames are rendered at 60/50 fps and interlaced by
`tinterlace`, top field first). Don't "fix" the frame rate to 29.97 or 59.94 without asking the
desks what their ingest expects.

### 2.10 Never commit secrets or machine-specific files
`.env`, `.signing-secret` and `.corp-ca.pem` are gitignored — keep it that way, and check
`git status` after a broad `git add`. The Clario fonts and TR logo in `public/` are Thomson
Reuters assets: fine in this repo, not for copying elsewhere.

### 2.11 Interactive elements don't inherit the site font
Clario is set on `body`; buttons, inputs and selects fall back to the system font unless they
set `font: inherit` / `font-family: inherit`. Check any new control (and `.hl-pop button`,
which is easy to miss because it's created by script).

---

## 3. The workflow

### 3.1 Setup
```bash
npm install
cp .env.example .env     # optional — the defaults work locally
npm run dev              # http://localhost:5002
```
Needs Node 22.9+ and Google Chrome installed (the card is drawn in headless Chrome). On the
Reuters network, Node needs the corporate CA to reach HTTPS sites — see the README.

### 3.2 Making a change

**Adding or changing a video option** touches several places — miss one and the option silently
does nothing or fails validation:
1. `public/index.html` — the control.
2. `public/app.js` — read it in the `render` call (and in `applyPlan()`/`checkZoomLimit()` if
   it depends on the post's height).
3. `api/render.js` — validate it (never trust the page) and pass it on.
4. `lib/video.js` — implement it; put any tunable in `CONFIG`.
5. `public/help.js` and `README.md` — document it. The Help panel is the user's manual.
6. `test/` — add a case.

**Changing what's fetched** (a new source, new fields): `lib/sources.js`, then the token payload
in `lib/token.js`, then `postFromToken()` in `lib/pipeline.js`. Keep every source returning the
same shape.

**Changing the card's look:** `lib/card.js` only — it's HTML/CSS in a template string, rendered
at 960 CSS px × 2 = 1920 px. Render a real post in each theme, including a non-Latin one, a very
long one and one with links/mentions/hashtags.

### 3.3 Testing
- `npm test` (about 35 seconds) — token and text rules, source parsing with a mocked `fetch`,
  highlight offsets, and real short renders checked frame by frame. It needs neither network
  nor Chrome. A green run is **necessary, not sufficient**: it doesn't draw a card or touch a
  live site.
- **Then run the real app** and exercise the path you changed: fetch a real post, change the
  option, create a video, play it. For anything that touches fetching, try one X post, one
  *long* X post and one Truth Social post.
- For anything visual, look at it in a browser; for anything about motion, watch the video
  start to finish and measure the frames (§2.3). Compare against what you expect — "it rendered
  without error" is not a pass.
- A good long-post check: a Trump post with 7,000 characters scrolls to its sign-off, and a long X
  post ends on its real last sentence. Highlight the *last* passage as well as the first.
- `test-output/` is gitignored — keep your sample videos there.

### 3.4 Before you push
- `npm test` is green and you've rendered at least one real video from the changed path.
- `git status` shows nothing from §2.10.
- Help (`public/help.js`) and `README.md` match the behaviour — not the old behaviour.

---

## 4. Versioning & releases

- The version lives in `package.json`. Bump it (patch for fixes, minor for new options, major if
  an option or output format changes in a way desks will notice) in the same change.
- **The app is not deployed yet**, and hosting is unverified (see README → Known Limitations).
  Treat the first deployment as a project of its own: bundle size, render time against the
  function timeout, streaming a large response, SSO in front of it. Use a preview deployment from
  a branch before anything is promoted.
- Commits are fine; **don't push to a shared remote or open/close pull requests without being
  asked.**

---

## 5. Working with Claude / AI on this repo

Most changes here are made with AI help. It's good at this codebase, but it will get a few
things wrong unless you tell it. Paste the relevant bits in:

**Tell the AI, up front:**
- "Posts only enter via the signed token in `lib/token.js` / `postFromToken()`. Never add a path
  that takes name, handle, avatar, badge or arbitrary text from the client."
- "Never produce a video from a truncated or partial post — refuse with a clear error instead.
  See §2.2."
- "The video is built by one ffmpeg filter graph in `lib/video.js`. Don't replace it with
  frame-by-frame rendering, and don't use `scale eval=frame` + `overlay` for the zoom."
- "Verify motion by measuring decoded frames, not by looking at one screenshot."
- "There is no build step and no framework in `public/`. Don't add either."
- "Highlights are `{start, end}` character ranges counted identically in `public/app.js` and
  `lib/pipeline.js`."

**Then verify what it did — don't trust "done":**
- Run `npm test`, then **actually fetch a real post and render a video**, and watch it. This is
  the one thing an AI can't confirm for you — it can't see whether a zoom feels smooth or a long
  scroll ends on the right sentence.
- Check the last line of a long post and the position of any highlight.
- If it touched `lib/sources.js`, ask what happens when each upstream is down.
- If it added an option, check all six places in §3.2.
- Check `git diff` for anything outside the task, and `git status` for the files in §2.10.

**Good prompt shape for a change:** describe the *editorial* problem ("long X posts stop after
four lines"), point at the relevant file from the quick reference below, and say what a correct
result looks like in the video — then review against §2 before you run it.

---

## 6. Quick reference

| Thing | Where |
|---|---|
| Fetching posts (X, Truth Social) | `lib/sources.js` |
| Signing posts, the text-edit rule | `lib/token.js` |
| Input validation, building the card | `lib/pipeline.js` |
| Drawing the card (fonts, themes, badges, slicing) | `lib/card.js` |
| Launching Chrome (local vs Vercel) | `lib/browser.js` |
| The video — timeline, zoom, scroll, interlacing, `CONFIG` | `lib/video.js` |
| The shotlist text | `public/shotlist.js` |
| Suggesting a shotlist title from a bio | `lib/title.js` |
| API handlers | `api/post.js`, `api/preview.js`, `api/render.js` |
| Local server | `server.js` |
| Page, styling, behaviour | `public/index.html`, `style.css`, `app.js` |
| In-app manual | `public/help.js` |
| Tests | `test/*.test.js` (`npm test`) |
| Environment variables | `.env.example` |
| Local-only, gitignored | `.env`, `.signing-secret`, `.corp-ca.pem`, `test-output/` |

When in doubt: refuse rather than degrade, measure the frames, keep the signature in the loop,
and don't push anything to a shared remote without being asked.
