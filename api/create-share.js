// api/create-share.js
// Creates a shareable report token and stores the report data in Supabase
// Returns: { url: 'https://audit.attomik.co/r/abc123' }

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BASE_URL = 'https://audit.attomik.co';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors(new Response(null));
  if (req.method !== 'POST') return cors(new Response('Method not allowed', { status: 405 }));

  let body;
  try { body = await req.json(); }
  catch { return cors(new Response('Invalid JSON', { status: 400 })); }

  const {
    token, email, domain, url,
    aiScore, seoScore, combined,
    critCount, warnCount,
    issues = [], engines = [],
  } = body;

  if (!token || !domain) {
    return cors(new Response(JSON.stringify({ error: 'token and domain required' }), { status: 400 }));
  }

  const { error } = await supabase.from('shared_reports').insert({
    token,
    email:      email || null,
    domain,
    url:        url || null,
    ai_score:   aiScore,
    seo_score:  seoScore,
    combined_score: combined,
    crit_count: critCount,
    warn_count: warnCount,
    issues_json:  issues,
    engines_json: engines,
    views:      0,
  });

  if (error) {
    console.error('[create-share] Supabase error:', error.message);
    return cors(new Response(JSON.stringify({ error: error.message }), { status: 500 }));
  }

  return cors(new Response(
    JSON.stringify({ url: `${BASE_URL}/r/${token}` }),
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
