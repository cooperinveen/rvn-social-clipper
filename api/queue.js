import { requireUser } from '../lib/auth.js';
import { sendError } from '../lib/pipeline.js';
import { renderGate } from '../lib/limits.js';

// GET /api/queue?ticket=<the ticket sent with a render> -> where that render is:
//   { state: 'rendering' } | { state: 'waiting', ahead: <videos before it> } | { state: 'unknown' }
export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
    requireUser(req);
    const ticket = new URL(req.url, 'http://x').searchParams.get('ticket');
    const pos = renderGate.position(ticket);
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(pos === 0 ? { state: 'rendering' } : pos ? { state: 'waiting', ahead: renderGate.active.size + pos - 1 } : { state: 'unknown' }));
  } catch (err) { sendError(res, err); }
}
