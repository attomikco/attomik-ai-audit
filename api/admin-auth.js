// api/admin-auth.js
// Server-side password check for the admin tool.
// Password is stored in ADMIN_PASSWORD env var.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors(new Response(null));
  if (req.method !== 'POST') return cors(new Response('POST only', { status: 405 }));

  let body;
  try { body = await req.json(); }
  catch { return cors(new Response(JSON.stringify({ ok: false }), { status: 400 })); }

  const correct = body.password === process.env.ADMIN_PASSWORD;

  return cors(new Response(
    JSON.stringify({ ok: correct }),
    { status: correct ? 200 : 401, headers: { 'Content-Type': 'application/json' } }
  ));
}

function cors(res) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(res.body, { status: res.status, headers: h });
}
