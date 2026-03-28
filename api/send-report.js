// api/send-report.js
// ─────────────────────────────────────────────────────────────────────────────
// AI Audit lead capture + Resend email
// Uses shared lib/leads.js for Supabase + Notion sync
// ─────────────────────────────────────────────────────────────────────────────

import { captureLead, APPS } from '../lib/leads.js';

export const config = { runtime: 'edge' };

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = 'audit@email.attomik.co';
const NOTIFY_EMAIL   = 'pablo@attomik.co';

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

  // ── 2. Send report email to user via Resend ───────────────────────────────
  const scoreColor = combined >= 70 ? '#00cc78' : combined >= 45 ? '#f59e0b' : '#ef4444';
  const scoreLabel = combined >= 70
    ? 'Decent foundation — but gaps are costing you'
    : combined >= 45 ? 'Largely invisible to AI search engines'
    : 'AI cannot confidently recommend your brand';

  const issuesHtml = issues.slice(0, 8).map(issue => `
    <tr><td style="padding:12px 16px;border-bottom:1px solid #1a1a1a;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td width="26" valign="top">
          <div style="width:20px;height:20px;border-radius:50%;text-align:center;line-height:20px;font-size:11px;font-weight:700;background:${issue.sev === 'danger' ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.18)'};color:${issue.sev === 'danger' ? '#ef4444' : '#f59e0b'};">
            ${issue.sev === 'danger' ? '!' : '~'}
          </div>
        </td>
        <td style="padding-left:10px;">
          <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:3px;">${issue.headline}</div>
          <div style="font-size:13px;color:#999;line-height:1.5;">${issue.why}</div>
        </td>
      </tr></table>
    </td></tr>`).join('');

  const enginesHtml = engines.map(e => `
    <td style="padding:0 5px;text-align:center;width:25%;">
      <div style="background:#111;border:1px solid #222;border-radius:10px;padding:14px 8px;">
        <div style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#555;margin-bottom:6px;">${e.name}</div>
        <div style="font-size:30px;font-weight:900;letter-spacing:-0.04em;color:${e.pct >= 50 ? '#f59e0b' : '#ef4444'};">${e.pct}<span style="font-size:15px;">%</span></div>
        <div style="font-size:11px;color:${e.pct >= 50 ? '#f59e0b' : '#ef4444'};margin-top:4px;">${e.label}</div>
      </div>
    </td>`).join('');

  await sendViaResend({
    from:    `Attomik AI Audit <${FROM_EMAIL}>`,
    to:      [email],
    subject: `Your AI Visibility Report: ${domain} scored ${combined}/100`,
    html:    buildReportEmail({ domain, combined, scoreColor, scoreLabel, aiScore, seoScore, critCount, warnCount, issuesHtml, enginesHtml, engines, issues }),
    text:    `Your AI visibility score for ${domain} is ${combined}/100. ${critCount} critical issues are preventing AI from recommending you. Get your free fix plan: https://attomik.co`,
  });

  // ── 3. Internal lead notification ─────────────────────────────────────────
  await sendViaResend({
    from:    `Attomik Leads <${FROM_EMAIL}>`,
    to:      [NOTIFY_EMAIL],
    subject: `🟢 New lead: ${domain} — ${combined}/100 — ${email}`,
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

function buildReportEmail({ domain, combined, scoreColor, scoreLabel, aiScore, seoScore, critCount, warnCount, issuesHtml, enginesHtml, engines, issues }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Your AI Visibility Report — ${domain}</title></head>
<body style="margin:0;padding:0;background:#000;font-family:Arial,sans-serif;">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#000;">
<tr><td align="center" style="padding:32px 16px;">
<table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">

  <tr><td style="padding-bottom:28px;text-align:center;">
    <a href="https://attomik.co" style="font-size:20px;font-weight:900;color:#fff;text-decoration:none;letter-spacing:-0.03em;">ATTOMIK</a>
    <div style="font-family:monospace;font-size:10px;color:#444;margin-top:4px;letter-spacing:0.1em;text-transform:uppercase;">AI Visibility Report</div>
  </td></tr>

  <tr><td style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:16px;padding:36px 32px;text-align:center;">
    <div style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#555;margin-bottom:8px;">AI VISIBILITY SCORE</div>
    <div style="font-size:80px;font-weight:900;letter-spacing:-0.05em;line-height:1;color:${scoreColor};">${combined}<span style="font-size:32px;color:#333;">/100</span></div>
    <div style="color:#888;font-size:14px;margin-top:8px;">${scoreLabel}</div>
    <div style="margin-top:24px;">
      <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>
        <td style="padding:0 18px;text-align:center;border-right:1px solid #1e1e1e;"><div style="font-size:26px;font-weight:900;color:#ef4444;">${critCount}</div><div style="font-family:monospace;font-size:10px;color:#555;text-transform:uppercase;margin-top:2px;">Critical</div></td>
        <td style="padding:0 18px;text-align:center;border-right:1px solid #1e1e1e;"><div style="font-size:26px;font-weight:900;color:#f59e0b;">${warnCount}</div><div style="font-family:monospace;font-size:10px;color:#555;text-transform:uppercase;margin-top:2px;">Warnings</div></td>
        <td style="padding:0 18px;text-align:center;border-right:1px solid #1e1e1e;"><div style="font-size:26px;font-weight:900;color:#00ff97;">${aiScore}</div><div style="font-family:monospace;font-size:10px;color:#555;text-transform:uppercase;margin-top:2px;">AI Ready</div></td>
        <td style="padding:0 18px;text-align:center;"><div style="font-size:26px;font-weight:900;color:#888;">${seoScore}</div><div style="font-family:monospace;font-size:10px;color:#555;text-transform:uppercase;margin-top:2px;">SEO Base</div></td>
      </tr></table>
    </div>
  </td></tr>

  <tr><td style="height:12px;"></td></tr>

  ${engines.length ? `
  <tr><td style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:12px;padding:20px;">
    <div style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#00ff97;margin-bottom:4px;">AI ENGINE VISIBILITY</div>
    <div style="font-size:13px;color:#666;margin-bottom:14px;">How each platform currently sees your brand</div>
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>${enginesHtml}</tr></table>
  </td></tr>
  <tr><td style="height:12px;"></td></tr>` : ''}

  ${issues.length ? `
  <tr><td style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:12px;overflow:hidden;">
    <div style="padding:18px 16px 10px;">
      <div style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#00ff97;margin-bottom:2px;">${issues.length} ISSUES FOUND</div>
      <div style="font-size:13px;color:#666;">Active reasons AI is skipping your brand</div>
    </div>
    <table cellpadding="0" cellspacing="0" border="0" width="100%">${issuesHtml}</table>
  </td></tr>
  <tr><td style="height:12px;"></td></tr>` : ''}

  <tr><td style="background:#0d0d0d;border:1px solid rgba(0,255,151,0.25);border-radius:16px;padding:32px;text-align:center;">
    <div style="font-family:monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#000;background:#00ff97;display:inline-block;padding:4px 14px;border-radius:99px;margin-bottom:16px;font-weight:700;">FREE DEEPER AUDIT</div>
    <div style="font-size:24px;font-weight:900;color:#fff;letter-spacing:-0.03em;margin-bottom:8px;line-height:1.15;">We'll show you exactly<br>how to fix this.</div>
    <div style="font-size:14px;color:#888;line-height:1.6;margin-bottom:24px;">Hands-on review of your site, prioritized fix plan — no pitch call, no commitment.</div>
    <a href="https://attomik.co?utm_source=audit-email&utm_medium=email&utm_campaign=ai-audit&domain=${domain}" style="display:inline-block;background:#00ff97;color:#000;font-size:15px;font-weight:800;padding:14px 32px;border-radius:8px;text-decoration:none;">Get my free fix plan →</a>
    <div style="margin-top:12px;font-family:monospace;font-size:11px;color:#333;">Or reply to this email — we read every one.</div>
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
