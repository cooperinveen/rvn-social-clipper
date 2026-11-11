// Local server. Mirrors Vercel's layout — public/ is static, api/*.js are (req, res)
// handlers — so the same files run unchanged in both places.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authEnabled, currentUser, handleAuth } from './lib/auth.js';
import { ensureSecret } from './lib/token.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5002;
// Only this Mac by default; a container sets HOST=0.0.0.0 so the platform can reach it.
const HOST = process.env.HOST || '127.0.0.1';
const SIGN_IN = authEnabled();
ensureSecret();
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function body(req) {
  const chunks = [];
  for await (const c of req) { chunks.push(c); if (chunks.reduce((n, b) => n + b.length, 0) > 5e6) throw new Error('Request too large'); }
  const raw = Buffer.concat(chunks).toString();
  try { return raw ? JSON.parse(raw) : {}; } catch { return raw; }
}

// Browser safety rules for every response. The page loads only its own files; preview
// images are data: URIs and the finished video is a blob: URL. (style-src-attr allows the
// inline styles on the plain sign-in error page.)
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:", "media-src 'self' blob:", "font-src 'self'", "connect-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');
function securityHeaders(req, res) {
  res.setHeader('content-security-policy', CSP);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('strict-transport-security', 'max-age=31536000');
}

http.createServer(async (req, res) => {
  try {
    securityHeaders(req, res);
    const url = new URL(req.url, 'http://localhost');
    // Liveness check for the hosting platform (EDEn asks for one): no sign-in, no work.
    if (url.pathname === '/healthz') { res.setHeader('content-type', 'text/plain'); res.setHeader('cache-control', 'no-store'); return res.end('ok'); }
    if (url.pathname.startsWith('/auth/')) return await handleAuth(req, res, url.pathname.slice(6));
    // Pages need a signed-in user; the API checks for itself (lib/pipeline.js) and answers 401.
    if (SIGN_IN && !url.pathname.startsWith('/api/') && !currentUser(req)) {
      res.statusCode = 302; res.setHeader('location', '/auth/login'); res.setHeader('cache-control', 'no-store'); return res.end();
    }
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^\w-]/g, '');
      const file = path.join(root, 'api', `${name}.js`);
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('{"error":"No such endpoint"}'); }
      req.body = req.method === 'POST' ? await body(req) : undefined;
      return (await import(pathToFileURL(file).href)).default(req, res);
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const publicDir = path.join(root, 'public');
    const file = path.join(publicDir, rel);
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  } catch (e) { console.error(e); if (!res.headersSent) res.statusCode = 500; res.end('Server error'); }
}).listen(PORT, HOST, () => console.log(`RVN Social Clipper → http://localhost:${PORT}  (Microsoft sign-in ${SIGN_IN ? 'ON' : 'off — no AZURE_CLIENT_ID'})`));
