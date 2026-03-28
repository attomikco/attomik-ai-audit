// api/verify-email.js
// Marks a lead as email-verified after they click the report link.
// Triggers Notion push if the lead qualifies.

import { supabase, pushToNotion, PERSONAL_DOMAINS, AUTO_PUSH_MIN_SCORE } from '../lib/leads.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors(new Response(null));
  if (req.method !== 'POST') return cors(new Response(JSON.stringify({ error: 'POST only' }), { status: 405 }));

  let body;
  try { body = await req.json(); }
  catch { return cors(new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })); }

  const { token } = body;
  if (!token) {
    return cors(new Response(JSON.stringify({ error: 'token required' }), { status: 400 }));
  }

  // 1. Look up the shared report by token
  const { data: report, error: reportErr } = await supabase
    .from('shared_reports')
    .select('email, domain')
    .eq('token', token)
    .single();

  if (reportErr || !report) {
    return cors(new Response(JSON.stringify({ error: 'Report not found' }), { status: 404 }));
  }

  // 2. Find the matching lead
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('*')
    .eq('email', report.email)
    .eq('app', 'ai-audit')
    .single();

  if (leadErr || !lead) {
    return cors(new Response(JSON.stringify({ error: 'Lead not found' }), { status: 404 }));
  }

  // 3. Mark as verified (skip if already verified)
  if (!lead.email_verified) {
    await supabase
      .from('leads')
      .update({ email_verified: true, verified_at: new Date().toISOString() })
      .eq('id', lead.id);

    // 4. Push to Notion if qualifies (business email + score >= threshold)
    const emailDomain = lead.email.split('@')[1]?.toLowerCase() ?? '';
    const isPersonal = PERSONAL_DOMAINS.has(emailDomain);
    const qualifies = !isPersonal && (lead.score === null || lead.score >= AUTO_PUSH_MIN_SCORE);

    if (qualifies && !lead.notion_synced) {
      try {
        const notionPageId = await pushToNotion(lead);
        await supabase
          .from('leads')
          .update({ notion_page_id: notionPageId, notion_synced: true })
          .eq('id', lead.id);
      } catch (err) {
        console.error('[verify-email] Notion sync error:', err.message);
      }
    }
  }

  return cors(new Response(
    JSON.stringify({ ok: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  ));
}

function cors(res) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(res.body, { status: res.status, headers: h });
}
