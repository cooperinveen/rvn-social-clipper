import { fetchPost } from '../lib/sources.js';
import { signPost } from '../lib/token.js';
import { readJson, sendError, InputError } from '../lib/pipeline.js';

// POST { url } -> { post, token }. The token is what preview/render require (see lib/token.js).
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
    const { url } = readJson(req);
    if (typeof url !== 'string' || url.length > 500) throw new InputError('Paste a link to an X or Truth Social post.');
    const post = await fetchPost(url.trim());
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ post, token: signPost(post) }));
  } catch (err) { sendError(res, err); }
}
