# RVN Social Clipper as one container (for EDEn; also runs in Docker / Rancher Desktop).
# Official Docker Hub image only (EDEn rule). Debian 13 ("trixie") gives a current
# Chromium and ffmpeg from the distro, so nothing is downloaded at npm-install time.
FROM node:24-trixie-slim

# Chromium renders the post card; ffmpeg makes the video. The card asks Google Fonts for
# Inter + Noto, but font downloads can be blocked (on the TR network Zscaler re-signs
# fonts.gstatic.com and Chromium rejects it), so the same families are installed locally
# and the card looks the same either way.
RUN apt-get -o Acquire::Retries=5 update \
 && apt-get -o Acquire::Retries=5 install -y --no-install-recommends chromium ffmpeg fonts-inter fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: skip ffmpeg-static's binary download; the distro ffmpeg is used instead.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY . .

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5002 \
    CHROME_PATH=/usr/bin/chromium \
    FFMPEG_PATH=/usr/bin/ffmpeg

USER node
EXPOSE 5002
CMD ["node", "server.js"]
