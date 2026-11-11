// Headless Chromium launcher: serverless build on Vercel, installed Chrome locally.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

// Playwright's `channel: 'chrome'` only looks in /Applications. The tester launcher installs Chrome
// into ~/Applications when it has no admin rights, so look there too (or at CHROME_PATH).
function localChrome() {
  const rel = 'Google Chrome.app/Contents/MacOS/Google Chrome';
  return [process.env.CHROME_PATH, path.join('/Applications', rel), path.join(os.homedir(), 'Applications', rel)]
    .find((p) => p && fs.existsSync(p));
}

export async function launchBrowser() {
  if (process.env.VERCEL) {
    const sparticuz = (await import('@sparticuz/chromium')).default;
    return chromium.launch({
      args: sparticuz.args,
      executablePath: await sparticuz.executablePath(),
      headless: true,
    });
  }
  const executablePath = localChrome();
  // In a Linux container (EDEn) Chromium's own sandbox needs kernel privileges the platform
  // doesn't grant, so it runs without it; the container is the isolation boundary there.
  const args = process.platform === 'linux' ? ['--no-sandbox'] : [];
  return executablePath
    ? chromium.launch({ executablePath, headless: true, args })
    : chromium.launch({ channel: 'chrome', headless: true });
}
