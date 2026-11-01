import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPost, detectPlatform, SourceError } from '../lib/sources.js';

// These tests never touch the network: global fetch is replaced with canned answers.
const realFetch = globalThis.fetch;
let routes;
beforeEach(() => {
  routes = [];
  globalThis.fetch = async url => {
    const hit = routes.find(([match]) => String(url).includes(match));
    if (!hit) throw new Error(`unexpected request: ${url}`);
    const [, status, body] = hit;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const user = { name: 'Ada', screen_name: 'ada', is_blue_verified: true, profile_image_url_https: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg' };
const tweet = (extra = {}) => ({ __typename: 'Tweet', text: 'Hello world. Second line.', display_text_range: [0, 25], entities: {}, user,
  created_at: '2026-06-15T18:39:09.000Z', lang: 'en', ...extra });

test('detectPlatform', () => {
  assert.equal(detectPlatform('https://x.com/a/status/1'), 'x');
  assert.equal(detectPlatform('https://twitter.com/a/status/1'), 'x');
  assert.equal(detectPlatform('https://mobile.twitter.com/a/status/1'), 'x');
  assert.equal(detectPlatform('https://truthsocial.com/@a/1'), 'truth');
  assert.equal(detectPlatform('https://example.com/'), null);
  assert.equal(detectPlatform('not a url'), null);
});

test('X: a normal post is read from the syndication endpoint; the bio is a bonus', async () => {
  routes.push(['syndication', 200, tweet()], ['fxtwitter', 200, { user: { description: 'Prime Minister of India' } }]);
  const p = await fetchPost('https://x.com/ada/status/123');
  assert.deepEqual(p, { platform: 'x', id: '123', name: 'Ada', handle: 'ada', verified: true,
    avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg', text: 'Hello world. Second line.',
    postedAt: '2026-06-15T18:39:09.000Z', tz: 'UTC', lang: 'en', bio: 'Prime Minister of India', title: 'INDIAN PRIME MINISTER' });
});

test('X: if the bio lookup fails the post still loads, with no title', async () => {
  routes.push(['syndication', 200, tweet()]);                      // no fxtwitter route: the bio request throws
  const p = await fetchPost('https://x.com/ada/status/123');
  assert.equal(p.bio, null);
  assert.equal(p.title, null);
  assert.equal(p.text, 'Hello world. Second line.');
});

test('X: t.co links are replaced by their display text, and trailing media links dropped', async () => {
  routes.push(['syndication', 200, tweet({
    text: 'Look https://t.co/abc and https://t.co/media', display_text_range: [0, 25],
    entities: { urls: [{ url: 'https://t.co/abc', display_url: 'example.com/story' }] } })]);
  assert.equal((await fetchPost('https://x.com/ada/status/1')).text, 'Look example.com/story and');
});

test('X: the text range counts UTF-16 units, so emoji do not leave a stray piece of the media link', async () => {
  routes.push(['syndication', 200, tweet({
    text: 'Happy birthday 🟡🔵 https://t.co/media', display_text_range: [0, 19] })]);
  assert.equal((await fetchPost('https://x.com/ada/status/1')).text, 'Happy birthday 🟡🔵');
});

test('X: a long ("note") post takes its full text from the lookup service', async () => {
  const full = 'Hello world. Second line. ' + 'More text. '.repeat(50);
  routes.push(['syndication', 200, tweet({ note_tweet: { id: 'x' } })], ['fxtwitter', 200, { tweet: { text: full } }]);
  assert.equal((await fetchPost('https://x.com/ada/status/1')).text, full.trimEnd());
});

test('X: a long post is refused, not truncated, when the lookup fails or disagrees', async () => {
  routes.push(['syndication', 200, tweet({ note_tweet: { id: 'x' } })], ['fxtwitter', 500, {}]);
  await assert.rejects(fetchPost('https://x.com/ada/status/1'), e => e.code === 'long_post_unavailable');
  routes[1] = ['fxtwitter', 200, { tweet: { text: 'Something unrelated entirely' } }];
  await assert.rejects(fetchPost('https://x.com/ada/status/1'), e => e.code === 'long_post_unavailable');
  routes[1] = ['fxtwitter', 200, {}];
  await assert.rejects(fetchPost('https://x.com/ada/status/1'), e => e.code === 'long_post_unavailable');
});

test('X: missing, deleted and text-less posts give clear errors', async () => {
  routes.push(['syndication', 404, {}]);
  await assert.rejects(fetchPost('https://x.com/ada/status/1'), e => e.code === 'not_found');
  routes[0] = ['syndication', 200, { __typename: 'TweetTombstone' }];
  await assert.rejects(fetchPost('https://x.com/ada/status/1'), e => e.code === 'not_found');
  routes[0] = ['syndication', 200, tweet({ text: '', display_text_range: [0, 0] })];
  await assert.rejects(fetchPost('https://x.com/ada/status/1'), e => e.code === 'no_text');
  await assert.rejects(fetchPost('https://x.com/ada'), e => e.code === 'bad_url');
});

const feed = items => `<rss><channel>${items.map(i => `<item>
  <description><![CDATA[${i.html}]]></description><dc:creator>Donald J. Trump</dc:creator>
  <pubDate>Mon, 26 Oct 2026 00:00:09 +0000</pubDate><truth:originalId>${i.id}</truth:originalId><archive:removed>${i.removed ? 'true' : 'false'}</archive:removed><archive:postType>${i.type || 'original'}</archive:postType></item>`).join('')}</channel></rss>`;

test('Truth Social: @realDonaldTrump posts come from the archive feed', async () => {
  routes.push(['trumpstruth.org/feed', 200, feed([{ id: '111', html: '<p>First</p>' }, { id: '222', html: '<p>Second &amp; last</p>' }])]);
  const p = await fetchPost('https://truthsocial.com/@realDonaldTrump/posts/222');
  assert.equal(p.platform, 'truth');
  assert.equal(p.handle, 'realDonaldTrump');
  assert.equal(p.verified, true);
  assert.equal(p.text, 'Second & last');
  assert.match(p.avatarUrl, /^https:\/\/static-assets-\d+\.truthsocial\.com\//);
  assert.equal(p.title, 'US PRESIDENT');
  assert.equal(p.lang, 'en');
  assert.equal(p.tz, 'America/New_York');
  assert.match(p.postedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('Truth Social: reposts, quote posts and posts with no text are refused; attachment lines are dropped', async () => {
  const link = '<a href="https://www.youtube.com/live/abc?si=1"><span class="invisible">https://www.</span><span class="ellipsis">youtube.com/live/abc?s</span><span class="invisible">i=1</span></a>';
  routes.push(['trumpstruth.org/feed', 200, feed([
    { id: '1', type: 'repost', html: '<p>RT @someone</p>' },
    { id: '2', type: 'quote', html: '<p>RT: https://truthsocial.com/users/x/statuses/1Hello</p>' },
    { id: '3', html: '<p></p><p><a href="https://x.test/a.mp4">View video</a></p>' },
    { id: '4', html: `<p>${link}</p>` },
    { id: '5', html: '<p>Big news today.</p><p></p><p><a href="https://x.test/a.jpg">View image</a></p><p><a href="https://x.test/b.jpg">View image</a></p>' },
  ])]);
  const code = id => fetchPost(`https://truthsocial.com/@realDonaldTrump/posts/${id}`);
  await assert.rejects(code(1), e => e.code === 'unsupported_post');
  await assert.rejects(code(2), e => e.code === 'unsupported_post');
  await assert.rejects(code(3), e => e.code === 'no_text');
  await assert.rejects(code(4), e => e.code === 'no_text');
  assert.equal((await code(5)).text, 'Big news today.');
});

test('Truth Social: other accounts, old posts and removed posts are refused', async () => {
  await assert.rejects(fetchPost('https://truthsocial.com/@someoneelse/posts/1'), e => e.code === 'unsupported_account');
  routes.push(['trumpstruth.org/feed', 200, feed([{ id: '111', html: '<p>x</p>' }, { id: '333', html: '<p>y</p>', removed: true }])]);
  await assert.rejects(fetchPost('https://truthsocial.com/@realDonaldTrump/posts/999'), e => e.code === 'not_found');
  await assert.rejects(fetchPost('https://truthsocial.com/@realDonaldTrump/posts/333'), e => e.code === 'not_found');
});

test('other sites are refused', async () => {
  await assert.rejects(fetchPost('https://example.com/post/1'), e => e instanceof SourceError && e.code === 'unsupported_site');
});
