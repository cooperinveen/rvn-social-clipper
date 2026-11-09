// Microsoft sign-in: the gate, the cookies, and the failure paths (no network — the
// real round trip to Microsoft is checked by hand in the browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AZURE_CLIENT_ID = '00000000-0000-0000-0000-000000000001';
process.env.AZURE_TENANT_ID = '00000000-0000-0000-0000-000000000002';
process.env.AZURE_CLIENT_SECRET = 'test-secret';
process.env.SIGNING_SECRET = 'test-signing-secret';
const { requireUser, currentUser, sessionValue, isAllowedEmail, handleAuth, AuthError } = await import('../lib/auth.js');
const { readJson, sendError } = await import('../lib/pipeline.js');

const withCookie = value => ({ headers: { cookie: `other=1; rsc_session=${encodeURIComponent(value)}` } });
function fakeRes() {
  const h = {};
  return { statusCode: 200, headersSent: false, body: '', setHeader: (k, v) => { h[k.toLowerCase()] = v; }, getHeader: k => h[k.toLowerCase()], end(b = '') { this.body = b; }, h };
}

test('the API refuses a request with no session, or a forged/expired one', () => {
  assert.throws(() => requireUser({ headers: {} }), AuthError);
  const good = sessionValue({ email: 'a.b@thomsonreuters.com', name: 'A B' });
  const [body, sig] = good.split('.');
  const forged = Buffer.from(JSON.stringify({ email: 'evil@thomsonreuters.com', exp: Date.now() + 1e9 })).toString('base64url') + '.' + sig;
  assert.throws(() => requireUser(withCookie(forged)), AuthError);
  assert.throws(() => requireUser(withCookie(body + '.' + sig.slice(1))), AuthError);
  assert.throws(() => requireUser(withCookie('garbage')), AuthError);
});

test('a valid session cookie lets the request through', () => {
  const user = requireUser(withCookie(sessionValue({ email: 'a.b@thomsonreuters.com', name: 'A B' })));
  assert.equal(user.email, 'a.b@thomsonreuters.com');
  const req = { ...withCookie(sessionValue({ email: 'a.b@thomsonreuters.com' })), body: { url: 'x' } };
  req.headers.host = 'app.example'; req.headers['content-type'] = 'application/json';
  assert.deepEqual(readJson(req), { url: 'x' });
});

test('an unsigned-in API call gets a 401 JSON error, not a 500', () => {
  const res = fakeRes();
  try { readJson({ headers: { host: 'a', 'content-type': 'application/json' }, body: {} }); } catch (e) { sendError(res, e); }
  assert.equal(res.statusCode, 401);
  assert.match(JSON.parse(res.body).error, /sign-in has expired/);
});

test('only TR email domains are allowed', () => {
  assert.ok(isAllowedEmail('x@thomsonreuters.com'));
  assert.ok(isAllowedEmail('x@Reuters.com'));
  assert.ok(!isAllowedEmail('x@gmail.com'));
  assert.ok(!isAllowedEmail('x@thomsonreuters.com.evil.com'));
  assert.ok(!isAllowedEmail(''));
});

test('callback failures show a page instead of bouncing back to Microsoft (no loop)', async () => {
  for (const [url, status] of [['/auth/callback?code=x&state=y', 400], ['/auth/callback?error=access_denied', 401]]) {
    const res = fakeRes();
    await handleAuth({ method: 'GET', url, headers: {} }, res, 'callback');
    assert.equal(res.statusCode, status, url);
    assert.ok(!res.h.location, 'no redirect');
    assert.match(res.body, /Couldn’t sign you in/);
  }
});

test('logout clears the session cookie', async () => {
  const res = fakeRes();
  await handleAuth({ method: 'GET', url: '/auth/logout', headers: {} }, res, 'logout');
  assert.ok(res.h['set-cookie'].some(c => c.startsWith('rsc_session=;') && c.includes('Max-Age=0')));
  assert.equal(currentUser({ headers: {} }), null);
});
