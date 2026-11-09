#!/bin/bash
# Double-click launcher for macOS. Checks what's needed, installs anything missing WITHOUT admin
# rights or Homebrew, then starts the app and opens it in the browser. Safe to run again.
#   Node.js  -> downloaded from nodejs.org into ./.runtime/node (this folder only; delete it to undo)
#   Chrome   -> downloaded from google.com into ~/Applications (only if not already installed)
#   npm deps -> ./node_modules
cd "$(dirname "$0")" || exit 1

fail() { echo; echo "✖ $1"; echo; read -r -p "Press Return to close."; exit 1; }
step() { echo; echo "▸ $1"; }

NEED_NODE_MAJOR=22; NEED_NODE_MINOR=9
node_ok() { command -v node >/dev/null 2>&1 && node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>$NEED_NODE_MAJOR||(a===$NEED_NODE_MAJOR&&b>=$NEED_NODE_MINOR)?0:1)" 2>/dev/null; }

# ── 1. Node.js ────────────────────────────────────────────────────────────────
# Prefer a Node we installed earlier, then whatever is on the system.
[ -x ".runtime/node/bin/node" ] && export PATH="$PWD/.runtime/node/bin:$PATH"
if ! node_ok; then
  step "Node.js 22.9+ not found — installing a private copy (about 40 MB)…"
  case "$(uname -m)" in arm64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) fail "Unsupported Mac processor: $(uname -m)" ;; esac
  BASE="https://nodejs.org/dist/latest-v22.x"
  SUMS="$(curl -fsSL "$BASE/SHASUMS256.txt")" || fail "Couldn't reach nodejs.org. Check your internet connection (and VPN) and try again."
  LINE="$(echo "$SUMS" | grep "darwin-$ARCH.tar.gz\$")"
  FILE="${LINE##* }"; WANT="${LINE%% *}"
  [ -n "$FILE" ] || fail "Couldn't find a Node.js download for this Mac."
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  curl -fL --progress-bar -o "$TMP/$FILE" "$BASE/$FILE" || fail "Node.js download failed."
  [ "$(shasum -a 256 "$TMP/$FILE" | cut -d' ' -f1)" = "$WANT" ] || fail "Node.js download failed its checksum — not installing it. Try again."
  mkdir -p .runtime && rm -rf .runtime/node
  tar -xzf "$TMP/$FILE" -C "$TMP" && mv "$TMP/${FILE%.tar.gz}" .runtime/node || fail "Couldn't unpack Node.js."
  export PATH="$PWD/.runtime/node/bin:$PATH"
  node_ok || fail "Node.js was installed but doesn't run on this Mac."
  echo "  ✔ Node.js $(node -v) installed in .runtime/node"
fi

# ── 2. Google Chrome (drawn headless to render the post card) ─────────────────
CHROME_APP="Google Chrome.app"
if [ ! -d "/Applications/$CHROME_APP" ] && [ ! -d "$HOME/Applications/$CHROME_APP" ]; then
  step "Google Chrome not found — installing it for your user (about 250 MB)…"
  TMP2="$(mktemp -d)"; MNT="$TMP2/mnt"; mkdir -p "$MNT"
  curl -fL --progress-bar -o "$TMP2/chrome.dmg" "https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg" \
    || fail "Chrome download failed. Install it by hand from https://www.google.com/chrome and run this again."
  hdiutil attach -nobrowse -quiet -readonly -mountpoint "$MNT" "$TMP2/chrome.dmg" || fail "Couldn't open the Chrome installer."
  mkdir -p "$HOME/Applications" && ditto "$MNT/$CHROME_APP" "$HOME/Applications/$CHROME_APP"; RC=$?
  hdiutil detach -quiet "$MNT"; rm -rf "$TMP2"
  [ $RC -eq 0 ] || fail "Couldn't copy Chrome into ~/Applications."
  echo "  ✔ Chrome installed in ~/Applications"
fi

# ── 3. App dependencies (first run only) ──────────────────────────────────────
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  step "Installing app dependencies (about a minute)…"
  npm install --no-audit --no-fund --loglevel=error || fail "npm install failed (see above). Check your internet connection."
  touch node_modules
fi

# ── 4. Corporate networks (Zscaler etc.) re-sign HTTPS, which Node rejects ────
# If a test request fails on certificates, build a trust bundle from the Mac's keychains.
CERT_TEST='fetch("https://cdn.syndication.twimg.com/tweet-result?id=20&token=a").then(()=>process.exit(0)).catch(e=>process.exit(/CERT|SSL|TLS/.test(String(e.cause?.code||e)) ? 2 : 0))'
node -e "$CERT_TEST"
if [ $? -eq 2 ]; then
  step "Corporate network detected — building certificate bundle from your keychain…"
  security find-certificate -a -p /Library/Keychains/System.keychain \
    /System/Library/Keychains/SystemRootCertificates.keychain > .corp-ca.pem 2>/dev/null
  export NODE_EXTRA_CA_CERTS="$PWD/.corp-ca.pem"
fi

# ── 5. Run (open the browser once the server is up) ───────────────────────────
URL="http://localhost:${PORT:-5002}"
if curl -s -o /dev/null "$URL"; then
  echo "Already running — opening $URL"; open "$URL"; exit 0
fi
( for _ in $(seq 1 30); do curl -s -o /dev/null "$URL" && { open "$URL"; break; }; sleep 1; done ) &
step "Starting RVN Social Clipper at $URL — close this window (or press Ctrl+C) to stop it."
node --env-file-if-exists=.env server.js
