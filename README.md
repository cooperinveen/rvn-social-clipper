# Social Video Generator

Turn an X or Truth Social post into a broadcast-ready video. Paste a link, check the text,
optionally highlight key passages, pick a few options, and download a 1080 interlaced `.mov`
that can go straight into an edit.

Built for the Reuters video desk. Posts are drawn as a clean card — no timestamps, view
counts or engagement buttons — on a white matte, so the result drops cleanly under a voiceover.

---

## What It Does

1. **Fetch** — paste an X or Truth Social link. The app reads the post's text, name, handle,
   profile picture and verified badge straight from the source (it never screenshots the live
   page, so it keeps working when those sites change their layout).
2. **Check** — shorten a long post from the end, and highlight passages directly in the text.
3. **Choose** — format, opening hold, how the opening shot looks, and an optional scroll (reached by a straight cut or a zoom)
   for long posts.
4. **Create** — preview the first frame, then render. The finished video plays in the same
   window and downloads as a `.mov`.
5. **Shotlist** — a suggested Reuters shotlist is written alongside, ready to copy into the edit.

## Using It (day-to-day)

Everything is explained in the app's **Help** button (top right). The short version:

| Step | What to do |
|---|---|
| **1. Get the post** | Paste the link and press **Fetch post** (or Enter). |
| **2. Check the text** | Trim a long post from the end only. To highlight, select words and click **Highlight** (select highlighted words and click **Remove highlight** to undo). Highlights fade in yellow 5 seconds into the video. Click **Update preview** to see them. |
| **3. Make the video** | **Format** 60i or 50i · **Opening hold** 10 / 20 / 30 s · **Opening shot** whole post shrunk to fit, or the top of the post fading out · **Scroll to the end** (long posts only), reached by a **Straight cut** (default) or a **Zoom in**. |
| **4. Preview** | Shows the video's first frame; after **Create video** it plays the result. **Download .mov** saves it. |
| **5. Shotlist** | Check the **title** (read from the poster's bio when it says so clearly), **name**, **date** and **language**, then **Copy shotlist**. |

Long posts can take a minute or two to render — keep the tab open.

### What's supported

| Source | Works for | Notes |
|---|---|---|
| **X** (x.com, twitter.com) | Any public post | Long posts are fetched in full. If the full text can't be retrieved the app refuses rather than make a video that cuts off mid-post. |
| **Truth Social** | `@realDonaldTrump`, his ~100 most recent posts | Truth Social blocks automated access, so these come from the trumpstruth.org archive feed. No other accounts, no older posts, no reposts or quote posts. |

The name, handle, profile picture and verified badge always come from the post and can't be
changed. The text can only be shortened from the end — nothing added, changed or cut from the middle (see CONTRIBUTING.md §2.1). Reposts, quote posts and posts with no text (image, video or link only) are refused.

### The suggested shotlist

Written in the page from the post and the options you chose, following the RVN social-media
screenshot guidance:

```
INTERNET (OCTOBER 25, 2026) (SOCIAL MEDIA WEBSITE - Access All) (MUTE)

1. SCREENSHOT OF TRUTH SOCIAL POST BY US PRESIDENT, DONALD TRUMP, ZOOMING IN AND SCROLLING DOWN, READING (English):

    “Let’s talk about this COMPLETE AND TOTAL LOSER, Bill Maher. …”
```

- **One shot per cut.** A zoom into the scroll is one continuous shot. Scrolling
  after a straight cut from the opening shot is two shots (`SCREENSHOT OF SAME TRUMP TRUTH SOCIAL POST, SCROLLING DOWN`).
- **The whole post is quoted once**, exactly as written (capitalisation untouched) — on the first
  shot, or on the scroll shot when the opening shot shows only the top of a long post.
- **Date** is when the post was made: in New York time for Trump's Truth Social posts (so a post
  at 00:00 UTC is dated the day before), and the UTC date for X, which gives no time zone. Change it
  if the poster's local day differs. **Language** is named for every post, English included.
- **Archive.** A post more than a calendar month old reads `INTERNET (ARCHIVE - AUGUST 15, 2026) …`; the label follows the date if you edit it.
- **Highlights** are marked in the quote as `[START HIGHLIGHT] … [END HIGHLIGHT]` (with a space inside each marker).
- Anything the app can't know is shown as a yellow `[PLACEHOLDER]`, never guessed — and **Copy shotlist** refuses until the title, name, date and language are all filled in, with a pop-up saying what's missing.

## Output

| | |
|---|---|
| Container / codec | QuickTime `.mov`, H.264 (libx264, CRF 20) |
| Resolution | 1920 × 1080 |
| Scan | Interlaced, top field first — **60i = 30 fps**, **50i = 25 fps** |
| Colour | BT.709, limited range, tagged |
| Timeline | opening hold (10/20/30 s) → zoom (10 s, optional) → scroll (optional) |
| Highlights | clean for 5 s, a 0.4 s fade to yellow, then held |
| Size | a short post is a few hundred KB; a long scroll runs about 1.5 MB per second of video |

## Setup & Running

### Prerequisites

- **Node.js 22.9 or newer**
- **Google Chrome** installed — used headless to draw the post card (on Vercel the app uses a
  bundled serverless Chromium instead)
- Internet access — posts are fetched live, and web fonts (Inter and Noto, for every script
  from Latin to Arabic to Chinese) are loaded when a card is drawn

ffmpeg needs no install: a binary ships with the `ffmpeg-static` package.

### Install and run

```bash
npm install
npm run dev          # http://localhost:5002
```

### Tests

```bash
npm test             # ~35 seconds; renders short real videos, needs no network or Chrome
```

### Configuration

All optional locally — see `.env.example`.

| Variable | Purpose |
|---|---|
| `SIGNING_SECRET` | Secret that signs fetched posts. **Required on Vercel.** Locally a random one is created in `.signing-secret` (gitignored). |
| `PORT` | Local server port (default `5002`). |
| `FFMPEG_PATH` | Use a specific ffmpeg instead of the bundled one. |

### On the Reuters network

TLS inspection on the corporate network makes Node reject some HTTPS sites
(`unable to get local issuer certificate`). Point Node at a bundle that includes the corporate
CA before starting the server:

```bash
NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem npm run dev
```

`.corp-ca.pem` in the project folder is gitignored if you want to keep the bundle there.

## How It Works

```
 link ──► /api/post ──► post data + signed token
                              │
        text edits +          ▼
        highlight ranges ──► /api/preview ──► card drawn in headless Chrome ──► first-frame JPEGs
                              │
                              └─► /api/render ──► card PNG ──► ffmpeg filter graph ──► .mov (streamed back)
```

- **Posts are data, not screenshots.** `lib/sources.js` fetches the text and author details; `lib/card.js`
  draws the card (Inter/Noto fonts, the site's colours and badge) in headless Chrome at 1920 px wide.
- **Posts must come from a fetch.** `/api/post` signs what it fetched (`lib/token.js`); `/api/preview`
  and `/api/render` accept only that signature plus lightly edited text and highlight ranges.
- **One ffmpeg graph does the whole video** (`lib/video.js`): hold, highlight fade, zoom, sub-pixel
  scroll, colour conversion and interlacing. Nothing is rendered frame-by-frame in JavaScript.
- **Nothing is stored.** Temporary files are deleted as soon as the video has been sent.

### Project structure

```
social-video-generator/
├── api/                  # Vercel-style handlers: (req, res) functions, one per endpoint
│   ├── post.js           #   POST {url}            → { post, token }
│   ├── preview.js        #   POST {token, …}       → first-frame JPEGs + facts for the UI
│   └── render.js         #   POST {token, …opts}   → the .mov, streamed
├── lib/
│   ├── sources.js        # fetch a post from X / Truth Social as data
│   ├── token.js          # sign / verify fetched posts; the text-edit rule
│   ├── title.js          # suggest a shotlist title from a poster's bio
│   ├── pipeline.js       # validate request input, build the card
│   ├── card.js           # draw the post card (HTML → PNG via headless Chrome)
│   ├── browser.js        # launch Chrome locally, serverless Chromium on Vercel
│   └── video.js          # card PNG → interlaced .mov (ffmpeg filter graph)
├── public/               # the front end — plain HTML/CSS/JS, no build step
│   ├── index.html  style.css  app.js  help.js
│   ├── shotlist.js       # builds the shotlist text (pure functions; also used by the tests)
│   └── fonts/  images/   # Clario font and TR logo
├── test/                 # node:test suites
├── server.js             # local dev server (serves public/ and api/)
└── .env.example
```

### API

All endpoints take and return JSON, except `/api/render`, which returns the video. Errors are
`{ "error": "plain-English message", "code": "…" }`.

| Endpoint | Request | Response |
|---|---|---|
| `POST /api/post` | `{ url }` | `{ post: { platform, id, name, handle, verified, avatarUrl, text, postedAt, tz, lang, bio, title }, token }` — the last five feed the shotlist only |
| `POST /api/preview` | `{ token, text?, highlights? }` | `{ frames: { fit, top }, cardHeight, matchCount, plan }` — frames are 16:9 JPEG data URIs |
| `POST /api/render` | `{ token, text?, highlights?, format, opening, baseSeconds, zoom, scroll, scrollSeconds }` | `video/quicktime`, with `x-video-seconds` and `x-render-ms` headers |

`highlights` is a list of `{ start, end }` character offsets into `text`. `format` is `60i` or
`50i`; `opening` is `fit` or `top`; `baseSeconds` is 10, 20 or 30; `scrollSeconds` is a number
from 4 to 180, or `auto`.

## Known Limitations

- **Truth Social is limited to `@realDonaldTrump`'s recent posts** (see above).
- **Shotlist titles are only suggestions.** A title is filled in only when an English bio clearly
  says it ("President of Ukraine", "Anthropic CEO"); otherwise the field is blank. Bios in other
  languages are not read.
- **Third-party dependencies.** X's embed endpoint, FxTwitter (long X posts, and the poster's bio),
  trumpstruth.org (Truth Social) and Google Fonts are outside our control. If one fails, the
  app shows a clear error rather than producing a wrong video. See CONTRIBUTING.md §2.6.
- **No sign-in.** The app has no authentication, and rendering is expensive — add the
  organisation's SSO before exposing it beyond a trusted network.
- **Hosted deployment is not yet verified.** The code is laid out for Vercel
  (`api/*.js` + `public/`), but it has been run and tested locally only. Before deploying,
  check: function bundle size (Chromium + ffmpeg + sharp), render time against the plan's
  function timeout (a 110-second video took roughly 70–95 seconds on a recent MacBook), streaming
  a 100 MB+ response, and the Google Fonts fetch from the function. `SIGNING_SECRET` must be set.
- **Zoom from the whole post** works only on posts under about 4 screens tall (use "Top of the
  post" for longer ones).
- **Right-to-left and mixed-script posts** are laid out per line; very unusual scripts may
  need a font added to the list in `lib/card.js`.

## Tech Stack

- **Server:** Node.js (ES modules), no framework — plain `(req, res)` handlers
- **Card drawing:** `playwright-core` driving headless Chrome (`@sparticuz/chromium` on Vercel)
- **Images:** `sharp`
- **Video:** `ffmpeg-static` (libx264) — one filter graph, no frame-by-frame JavaScript
- **Front end:** vanilla HTML/CSS/JS, Reuters branding (Clario, TR Orange `#D64000`, Racing Green `#123015`)

## Licence

Internal Thomson Reuters tool — not licensed for outside use. The Clario font files and TR logo
in `public/` are Thomson Reuters assets.
