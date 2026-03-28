// lib/leads.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared lead capture + Notion sync utility for all Attomik apps.
// Usage:
//   import { captureLead } from '@/lib/leads';
//   await captureLead({ email, name, app: 'ai-audit', ... });
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Free/personal email domains — these go to Supabase only, no auto Notion push
const PERSONAL_DOMAINS = new Set([
  'gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com',
  'aol.com','protonmail.com','me.com','live.com','msn.com','ymail.com',
  'mail.com','inbox.com','gmx.com','fastmail.com','hey.com','pm.me',
]);

const AUTO_PUSH_MIN_SCORE = 40; // combined score threshold for auto Notion push

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point — call this from any app's API route
// ─────────────────────────────────────────────────────────────────────────────
export async function captureLead({
  email,
  name        = null,
  company     = null,
  domain      = null,
  url         = null,
  app,                    // 'ai-audit' | 'marketing-os' | 'onboarding' | ...
  source      = 'unknown',
  score       = null,
  scoreLabel  = null,
  scoreSecondary = null,  // { ai: 72, seo: 61 }
  metadata    = {},       // app-specific payload
  utmSource   = null,
  utmMedium   = null,
  utmCampaign = null,
}) {
  if (!email || !app) throw new Error('email and app are required');

  const emailDomain  = email.split('@')[1]?.toLowerCase() ?? '';
  const isPersonal   = PERSONAL_DOMAINS.has(emailDomain);
  const qualifies    = !isPersonal && (score === null || score >= AUTO_PUSH_MIN_SCORE);
  const initialStatus = qualifies ? 'new' : 'pending_review';

  // ── 1. Upsert into Supabase ───────────────────────────────────────────────
  const { data: lead, error } = await supabase
    .from('leads')
    .upsert(
      {
        email,
        name,
        company,
        domain,
        url,
        app,
        source,
        score,
        score_label:     scoreLabel,
        score_secondary: scoreSecondary,
        status:          initialStatus,
        metadata,
        utm_source:      utmSource,
        utm_medium:      utmMedium,
        utm_campaign:    utmCampaign,
      },
      { onConflict: 'email,app', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) {
    console.error('[leads] Supabase upsert error:', error.message);
    throw error;
  }

  // ── 2. Auto-push to Notion if qualifies ──────────────────────────────────
  if (qualifies) {
    try {
      const notionPageId = await pushToNotion(lead);
      // Store notion_page_id back in Supabase
      await supabase
        .from('leads')
        .update({ notion_page_id: notionPageId, notion_synced: true })
        .eq('id', lead.id);
      lead.notion_page_id = notionPageId;
    } catch (err) {
      console.error('[leads] Notion sync error:', err.message);
      // Don't throw — Supabase is source of truth, Notion sync is best-effort
    }
  }

  return lead;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual push — call from HQ "Push to Notion" button
// ─────────────────────────────────────────────────────────────────────────────
export async function pushLeadToNotion(leadId) {
  const { data: lead, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (error || !lead) throw new Error('Lead not found');
  if (lead.notion_synced) return { alreadySynced: true, notionPageId: lead.notion_page_id };

  const notionPageId = await pushToNotion(lead);

  await supabase
    .from('leads')
    .update({
      notion_page_id: notionPageId,
      notion_synced:  true,
      status: lead.status === 'pending_review' ? 'new' : lead.status,
    })
    .eq('id', leadId);

  return { notionPageId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Notion write
// ─────────────────────────────────────────────────────────────────────────────
async function pushToNotion(lead) {
  const NOTION_TOKEN   = process.env.NOTION_TOKEN;
  const NOTION_LEADS_DB = process.env.NOTION_LEADS_DB_ID; // your new Leads DB id

  if (!NOTION_TOKEN || !NOTION_LEADS_DB) {
    throw new Error('Notion env vars not set');
  }

  // Page title = company name or domain or email
  const title = lead.company || lead.domain || lead.email;

  const properties = {
    // Title (required by Notion)
    'Name': {
      title: [{ text: { content: title } }],
    },
    'Email': {
      email: lead.email,
    },
    'Contact Name': {
      rich_text: [{ text: { content: lead.name || '' } }],
    },
    'Domain': {
      url: lead.domain ? `https://${lead.domain}` : null,
    },
    'App': {
      select: { name: lead.app },
    },
    'Source': {
      select: { name: lead.source },
    },
    'Score': {
      number: lead.score ?? null,
    },
    'Status': {
      select: { name: 'New Lead' },
    },
    'Created': {
      date: { start: lead.created_at },
    },
  };

  // Only add Score Label if present
  if (lead.score_label) {
    properties['Score Label'] = {
      rich_text: [{ text: { content: lead.score_label } }],
    };
  }

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_LEADS_DB },
      properties,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API error: ${err}`);
  }

  const page = await res.json();
  return page.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// App registry — documents all apps feeding this table
// ─────────────────────────────────────────────────────────────────────────────
export const APPS = {
  AI_AUDIT:    'ai-audit',
  MARKETING_OS: 'marketing-os',
  ONBOARDING:  'onboarding',
  // add more as you build them
};
