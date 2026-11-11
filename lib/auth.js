// Microsoft sign-in (Azure AD / Entra, TR tenant), same pattern as the RVN Usage Tracker.
//
//   /auth/login     -> Microsoft's sign-in page (authorization code flow + PKCE)
//   /auth/callback  -> swap Microsoft's code for the user's identity, check it's a TR
//                      account, then set a signed session cookie
//   /auth/logout    -> clear the session cookie
//
// No server-side session store (serverless-friendly): the session and the in-flight
// sign-in are both small cookies signed with the app's secret (see token.js).
//
// Sign-in is ON when AZURE_CLIENT_ID is set. Without it (testers running the app on their
// own Mac) the app stays open, as before. Hosted (Vercel, or HOSTED=1) it refuses to run without it.
import crypto from 'node:crypto';
import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import { hmac, hosted } from './token.js';

const SESSION_COOKIE = 'rsc_session';
const FLOW_COOKIE = 'rsc_signin';
const SESSION_HOURS = 12;
const FLOW_MINUTES = 10;
const SCOPES = ['User.Read'];
const ALLOWED_DOMAINS = new Set(['thomsonreuters.com', 'reuters.com', 'tr.com']);

export class AuthError extends Error {}

export function authEnabled() {
  if (process.env.AZURE_CLIENT_ID) return true;
  if (hosted()) throw new Error('Sign-in is not configured. Set AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET and REDIRECT_URI in the hosting platform\'s secrets.');
  return false;
}

function config() {
  const { AZURE_CLIENT_ID: clientId, AZURE_TENANT_ID: tenantId, AZURE_CLIENT_SECRET: clientSecret } = process.env;
  const redirectUri = process.env.REDIRECT_URI || `http://localhost:${process.env.PORT || 5002}/auth/callback`;
  const missing = [!tenantId && 'AZURE_TENANT_ID', !clientSecret && 'AZURE_CLIENT_SECRET'].filter(Boolean);
  if (missing.length) throw new Error(`Sign-in is half configured: ${missing.join(' and ')} not set.`);
  return { clientId, tenantId, clientSecret, redirectUri };
}

let msal;
function client() {
  const { clientId, tenantId, clientSecret } = config();
  return (msal ??= new ConfidentialClientApplication({
    auth: { clientId, clientSecret, authority: `https://login.microsoftonline.com/${tenantId}` },
  }));
}

// ── Signed cookies ───────────────────────────────────────────────────────────────
// "<base64url json>.<hmac>", with a purpose label in the HMAC so a cookie of one kind
// (or a post token) can never be passed off as another.
function seal(purpose, data) {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${body}.${hmac(`${purpose}:${body}`)}`;
}
function unseal(purpose, value) {
  if (typeof value !== 'string' || value.length > 4000) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const good = Buffer.from(hmac(`${purpose}:${body}`)), got = Buffer.from(sig);
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return data && data.exp > Date.now() ? data : null;
  } catch { return null; }
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  return req.headers?.['x-forwarded-proto'] === 'https' || hosted();
}

function setCookie(res, req, name, value, maxAgeSeconds) {
  // SameSite=Lax: still sent when Microsoft redirects the browser back to /auth/callback.
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (isHttps(req)) parts.push('Secure');
  const prev = res.getHeader('set-cookie');
  res.setHeader('set-cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), parts.join('; ')]);
}

export const sessionValue = user => seal('session', { ...user, exp: Date.now() + SESSION_HOURS * 3600e3 });

// ── Checking a request ───────────────────────────────────────────────────────────
// The signed-in user ({ email, name }), or null. Always null-safe.
export function currentUser(req) {
  return unseal('session', cookies(req)[SESSION_COOKIE]);
}

// For the API: throws AuthError (-> 401) unless sign-in is off or the user is signed in.
export function requireUser(req) {
  if (!authEnabled()) return null;
  const user = currentUser(req);
  if (!user) throw new AuthError('Your sign-in has expired. Reload the page to sign in again.');
  return user;
}

export const isAllowedEmail = email => ALLOWED_DOMAINS.has(String(email || '').split('@').pop().toLowerCase());

// ── The /auth/* pages ────────────────────────────────────────────────────────────
function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.setHeader('cache-control', 'no-store');
  res.end();
}

// A plain page instead of bouncing back to Microsoft, so a failure can never loop.
function page(res, status, heading, message, link) {
  res.statusCode = status;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RVN Social Clipper</title>
<body style="font:16px system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#222">
<h1 style="font-size:20px">${heading}</h1><p>${message}</p><p><a href="/auth/login">${link}</a></p></body>`);
}
const failPage = (res, status, message) => page(res, status, 'Couldn’t sign you in', message, 'Try again');

async function login(req, res) {
  if (currentUser(req)) return redirect(res, '/');
  const { redirectUri } = config();
  const { verifier, challenge } = await new CryptoProvider().generatePkceCodes();
  const state = crypto.randomBytes(16).toString('base64url');
  const url = await client().getAuthCodeUrl({
    scopes: SCOPES, redirectUri, state, codeChallenge: challenge, codeChallengeMethod: 'S256',
  });
  setCookie(res, req, FLOW_COOKIE, seal('signin', { verifier, state, exp: Date.now() + FLOW_MINUTES * 60e3 }), FLOW_MINUTES * 60);
  redirect(res, url);
}

async function callback(req, res, params) {
  const flow = unseal('signin', cookies(req)[FLOW_COOKIE]);
  setCookie(res, req, FLOW_COOKIE, '', 0);              // single use
  if (params.get('error')) {
    console.error('[auth] Microsoft returned an error:', params.get('error'), params.get('error_description'));
    return failPage(res, 401, 'Microsoft didn’t complete the sign-in.');
  }
  if (!flow) {
    console.error('[auth] callback without a valid sign-in cookie (expired, or cookies blocked)');
    return failPage(res, 400, 'The sign-in took too long or your browser blocked cookies.');
  }
  const a = Buffer.from(String(params.get('state') || '')), b = Buffer.from(flow.state);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.error('[auth] state mismatch on callback');
    return failPage(res, 400, 'The sign-in response didn’t match this browser.');
  }
  let result;
  try {
    result = await client().acquireTokenByCode({
      code: String(params.get('code') || ''), scopes: SCOPES, redirectUri: config().redirectUri, codeVerifier: flow.verifier,
    });
  } catch (err) {
    // Log Microsoft's real reason (e.g. AADSTS7000215 = secret ID pasted instead of its value).
    console.error('[auth] code exchange failed:', err?.errorCode || '', err?.errorMessage || err?.message || err);
    return failPage(res, 502, 'Microsoft rejected the sign-in. The app’s settings may be wrong — tell the maintainer.');
  }
  const claims = result?.idTokenClaims || {};
  const email = claims.preferred_username || claims.email || result?.account?.username || '';
  if (claims.tid && claims.tid !== config().tenantId) {
    console.error('[auth] token from another tenant:', claims.tid);
    return failPage(res, 403, 'That account isn’t a Thomson Reuters account.');
  }
  if (!isAllowedEmail(email)) {
    console.error('[auth] refused account outside allowed domains:', email);
    return failPage(res, 403, 'Sign in with your Thomson Reuters account.');
  }
  const user = { email, name: claims.name || result?.account?.name || email };
  setCookie(res, req, SESSION_COOKIE, sessionValue(user), SESSION_HOURS * 3600);
  console.log('[auth] signed in:', email);
  redirect(res, '/');
}

function logout(req, res) {
  setCookie(res, req, SESSION_COOKIE, '', 0);
  page(res, 200, 'Signed out', 'You’re signed out of RVN Social Clipper.', 'Sign in again');
}

// Entry point for /auth/<step>.
export async function handleAuth(req, res, step) {
  try {
    if (!authEnabled()) return redirect(res, '/');
    if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
    const params = new URL(req.url, 'http://localhost').searchParams;
    if (step === 'login') return await login(req, res);
    if (step === 'callback') return await callback(req, res, params);
    if (step === 'logout') return logout(req, res);
    res.statusCode = 404; res.end('Not found');
  } catch (err) {
    console.error('[auth]', err);
    if (!res.headersSent) failPage(res, 500, 'Sign-in isn’t set up correctly on the server. Tell the maintainer.');
  }
}
