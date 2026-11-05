#!/bin/bash
# Double-click launcher for macOS: checks prerequisites, installs dependencies on first run,
# starts the app and opens it in the browser. Safe to run again; nothing here edits your system.
cd "$(dirname "$0")" || exit 1

fail() { echo; echo "✖ $1"; echo; read -r -p "Press Return to close."; exit 1; }

# 1. Node.js 22.9 or newer
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Download the LTS installer from https://nodejs.org, install it, then double-click this file again."
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=9)?0:1)' \
  || fail "Node.js $(node -v) is too old (need 22.9 or newer). Install the current LTS from https://nodejs.org and try again."

# 2. Google Chrome (used headless to draw the post card)
[ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ] \
  || fail "Google Chrome is not installed. Get it from https://www.google.com/chrome and try again."

# 3. Dependencies (first run only; needs internet, ~1 min)
if [ ! -d node_modules ]; then
  echo "First run: installing dependencies…"
  npm install --no-audit --no-fund || fail "npm install failed (see above). Check your internet connection."
fi

# 4. Corporate networks (Zscaler etc.) re-sign HTTPS traffic, which Node rejects by default.
#    If a test request fails on certificates, build a trust bundle from the Mac's keychains.
CERT_TEST='fetch("https://cdn.syndication.twimg.com/tweet-result?id=20&token=a").then(()=>process.exit(0)).catch(e=>process.exit(/CERT|SSL|TLS/.test(String(e.cause?.code||e)) ? 2 : 0))'
node -e "$CERT_TEST"
if [ $? -eq 2 ]; then
  echo "Corporate network detected — building certificate bundle from your keychain…"
  security find-certificate -a -p /Library/Keychains/System.keychain \
    /System/Library/Keychains/SystemRootCertificates.keychain > .corp-ca.pem 2>/dev/null
  export NODE_EXTRA_CA_CERTS="$PWD/.corp-ca.pem"
fi

# 5. Run (open the browser once the server is up)
URL="http://localhost:${PORT:-5002}"
if curl -s -o /dev/null "$URL"; then
  echo "Already running — opening $URL"; open "$URL"; exit 0
fi
( for _ in $(seq 1 30); do curl -s -o /dev/null "$URL" && { open "$URL"; break; }; sleep 1; done ) &
echo "Starting Social Video Generator at $URL — close this window (or press Ctrl+C) to stop it."
node --env-file-if-exists=.env server.js
