// api/generate-fix-plan.js
// Streams a fix plan from the Anthropic API for the internal admin tool.
// Accepts POST { prompt } and returns an SSE stream.

export const config = { runtime: 'edge' };

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors(new Response(null));
  if (req.method !== 'POST') return cors(new Response('POST only', { status: 405 }));

  let body;
  try { body = await req.json(); }
  catch { return cors(new Response('Invalid JSON', { status: 400 })); }

  const { prompt } = body;
  if (!prompt) return cors(new Response('prompt required', { status: 400 }));

  if (!ANTHROPIC_API_KEY) {
    return cors(new Response('ANTHROPIC_API_KEY not configured', { status: 500 }));
  }

  // Stream from Anthropic
  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    console.error('[generate-fix-plan] Anthropic error:', errText);
    return cors(new Response(errText, { status: apiRes.status }));
  }

  // Pass through the SSE stream
  return cors(new Response(apiRes.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  }));
}

function cors(res) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(res.body, { status: res.status, headers: h });
}
