// api/get-report/[token].js
// Fetches shared report data by token — used by the /r/[token] page

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req) {
  const url   = new URL(req.url);
  const token = url.pathname.split('/').pop();

  if (!token) return new Response(JSON.stringify({ error: 'No token' }), { status: 400 });

  const { data, error } = await supabase
    .from('shared_reports')
    .select('*')
    .eq('token', token)
    .single();

  if (error || !data) {
    return new Response(JSON.stringify({ error: 'Report not found' }), { status: 404 });
  }

  // Increment view count
  await supabase
    .from('shared_reports')
    .update({ views: (data.views || 0) + 1 })
    .eq('token', token);

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, s-maxage=60',
    },
  });
}
