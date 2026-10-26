// Headless Chromium launcher: serverless build on Vercel, installed Chrome locally.
import { chromium } from 'playwright-core';

export async function launchBrowser() {
  if (process.env.VERCEL) {
    const sparticuz = (await import('@sparticuz/chromium')).default;
    return chromium.launch({
      args: sparticuz.args,
      executablePath: await sparticuz.executablePath(),
      headless: true,
    });
  }
  return chromium.launch({ channel: 'chrome', headless: true });
}
