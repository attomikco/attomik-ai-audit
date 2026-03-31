// api/send-report.js
// ─────────────────────────────────────────────────────────────────────────────
// AI Audit lead capture + Resend email
// Uses shared lib/leads.js for Supabase + Notion sync
// ─────────────────────────────────────────────────────────────────────────────

import { captureLead, APPS } from '../lib/leads.js';

export const config = { runtime: 'edge' };

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = 'audit@email.attomik.co';
const NOTIFY_EMAIL   = 'hello@attomik.co';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return cors(new Response(null));
  if (req.method !== 'POST') return cors(new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 }));

  let body;
  try { body = await req.json(); }
  catch { return cors(new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })); }

  const {
    email, name, domain, url,
    aiScore, seoScore, combined,
    critCount, warnCount,
    issues  = [],
    engines = [],
    source  = 'gate',
    token   = null,
  } = body;

  if (!email?.includes('@')) {
    return cors(new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400 }));
  }

  // ── 1. Capture lead → Supabase + conditional Notion ──────────────────────
  let lead;
  try {
    lead = await captureLead({
      email, name, domain, url,
      app:            APPS.AI_AUDIT,
      source,
      score:          combined,
      scoreLabel:     'AI Visibility Score',
      scoreSecondary: { ai: aiScore, seo: seoScore },
      metadata:       { critCount, warnCount, issues, engines },
    });
  } catch (err) {
    console.error('[send-report] captureLead error:', err.message);
  }

  // ── 2. Pre-create shared report if token provided ──────────────────────
  let reportUrl = 'https://audit.attomik.co';
  if (token) {
    try {
      const origin = new URL(req.url).origin;
      const shareRes = await fetch(`${origin}/api/create-share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token, email, domain, url,
          aiScore, seoScore, combined,
          critCount, warnCount, issues, engines,
        }),
      });
      const shareJson = await shareRes.json();
      reportUrl = shareJson.url || `https://audit.attomik.co/r/${token}`;
    } catch (err) {
      console.error('[send-report] create-share error:', err.message);
      reportUrl = `https://audit.attomik.co/r/${token}`;
    }
    // Append ?verified=true so the original user doesn't see "shared report" banner
    reportUrl += '?verified=true';
  }

  // ── 3. Send verification email to user via Resend ─────────────────────
  await sendViaResend({
    from:    `Attomik AI Audit <${FROM_EMAIL}>`,
    to:      [email],
    subject: `Your AI Visibility Report is ready — tap to unlock`,
    html:    buildVerificationEmail({ domain, critCount, reportUrl }),
    text:    `Your AI visibility report for ${domain} is ready. We found ${critCount} critical issues preventing AI from recommending your brand. View your full report: ${reportUrl}`,
  });

  // ── 3. Internal lead notification ─────────────────────────────────────────
  const subjectMap = {
    'gate':                `🔍 New audit lead: ${domain} scored ${combined}/100`,
    'cta':                 `🎯 CTA lead: ${domain} wants help — ${email}`,
    'shared-report-gate':  `🔗 Shared report lead: ${domain} — ${email}`,
    'shared-report-cta':   `🎯 Shared CTA: ${domain} wants help — ${email}`,
    'report-cta-form':     `🤝 Contact request: ${domain} scored ${combined}/100 — ${email}`,
  };
  const notifySubject = subjectMap[source] || `📥 New lead: ${domain} — ${email}`;

  await sendViaResend({
    from:    `Attomik Leads <${FROM_EMAIL}>`,
    to:      [NOTIFY_EMAIL],
    subject: notifySubject,
    html: `<div style="font-family:monospace;background:#000;color:#fff;padding:24px;border-radius:8px;max-width:480px;">
      <div style="color:#00ff97;font-weight:700;margin-bottom:16px;font-size:13px;">NEW AI AUDIT LEAD</div>
      ${tableRow('Email',   email)}
      ${tableRow('Name',    name || '—')}
      ${tableRow('Domain',  domain)}
      ${tableRow('Score',   `${combined}/100`)}
      ${tableRow('Critical issues', String(critCount))}
      ${tableRow('Source',  source)}
      ${tableRow('Notion',  lead?.notion_synced ? '✓ Auto-synced' : '⏳ Pending review in Supabase')}
    </div>`,
    text: `New lead: ${email} | ${domain} | ${combined}/100 | source: ${source} | notion: ${lead?.notion_synced ? 'synced' : 'pending'}`,
  });

  return cors(new Response(
    JSON.stringify({ ok: true, notionSynced: lead?.notion_synced ?? false }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  ));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sendViaResend(payload) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error('[resend] error:', await res.text());
    return res.ok;
  } catch (err) {
    console.error('[resend] fetch error:', err.message);
    return false;
  }
}

function tableRow(label, value) {
  return `<div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid #111;">
    <span style="color:#555;font-size:12px;min-width:100px;">${label}</span>
    <span style="color:#fff;font-size:13px;font-weight:700;">${value}</span>
  </div>`;
}

function cors(res) {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(res.body, { status: res.status, headers });
}

function buildVerificationEmail({ domain, critCount, reportUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Your AI Visibility Report — ${domain}</title></head>
<body style="margin:0;padding:0;background:#000;font-family:Arial,sans-serif;">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#000;">
<tr><td align="center" style="padding:32px 16px;">
<table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">

  <tr><td style="padding-bottom:32px;text-align:center;">
    <a href="https://attomik.co" style="font-size:20px;font-weight:900;color:#fff;text-decoration:none;letter-spacing:-0.03em;">ATTOMIK</a>
    <div style="font-family:monospace;font-size:10px;color:#444;margin-top:4px;letter-spacing:0.1em;text-transform:uppercase;">AI Visibility Report</div>
  </td></tr>

  <tr><td style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:16px;padding:48px 32px;text-align:center;">
    <div style="font-size:36px;font-weight:900;color:#fff;letter-spacing:-0.04em;margin-bottom:12px;line-height:1.1;">Your report is ready.</div>
    <div style="font-size:16px;color:#888;line-height:1.7;margin-bottom:36px;max-width:440px;margin-left:auto;margin-right:auto;">We scanned <strong style="color:#fff;">${domain}</strong> and found <strong style="color:#ef4444;">${critCount} critical issue${critCount !== 1 ? 's' : ''}</strong> actively preventing AI from recommending your brand.</div>
    <a href="${reportUrl}" style="display:inline-block;background:#00ff97;color:#000;font-size:17px;font-weight:800;padding:16px 40px;border-radius:8px;text-decoration:none;letter-spacing:-0.02em;">View my full report →</a>
    <div style="margin-top:16px;font-family:monospace;font-size:11px;color:#333;">This link is unique to you. It expires in 7 days.</div>
  </td></tr>

  <tr><td style="padding:24px 0 0;text-align:center;">
    <div style="font-family:monospace;font-size:11px;color:#2a2a2a;">
      <a href="https://attomik.co" style="color:#3a3a3a;text-decoration:none;">Attomik</a> · AI visibility tools for CPG brands<br/>
      ${domain} · ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}
    </div>
  </td></tr>

</table></td></tr></table>
</body></html>`;
}
