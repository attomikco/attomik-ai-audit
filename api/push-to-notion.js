// api/push-to-notion.js
// ─────────────────────────────────────────────────────────────────────────────
// Called from Attomik HQ when you manually approve a pending_review lead
// Body: { leadId: "uuid" }
// ─────────────────────────────────────────────────────────────────────────────

import { pushLeadToNotion } from '../lib/leads.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  const { leadId } = await req.json();
  if (!leadId) return new Response(JSON.stringify({ error: 'leadId required' }), { status: 400 });

  try {
    const result = await pushLeadToNotion(leadId);
    return new Response(JSON.stringify({ ok: true, ...result }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500 });
  }
}
