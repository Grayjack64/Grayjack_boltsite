/**
 * Weekly Performance Report Edge Function
 *
 * Generates and sends weekly performance reports via Brevo email.
 *
 * POST /weekly-report/generate
 * Body: { org_id } (optional — omit to generate for ALL active orgs)
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!;
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL")!;
const BREVO_SENDER_NAME = Deno.env.get("BREVO_SENDER_NAME")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

// ── Helpers ──────────────────────────────────────────────────────────────────

interface MetricsRow {
  likes: number;
  comments: number;
  shares: number;
  impressions: number;
  post_id: string;
}

interface CompanyMetrics {
  companyName: string;
  totalPosts: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalImpressions: number;
  engagementRate: number;
  topPost: { title: string; engagement: number } | null;
  prevTotalPosts: number;
  prevTotalLikes: number;
  prevTotalComments: number;
  prevTotalShares: number;
  prevTotalImpressions: number;
  prevEngagementRate: number;
  draftsPending: number;
  videosGenerated: number;
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function changeArrow(current: number, previous: number): string {
  const pct = pctChange(current, previous);
  const abs = Math.abs(pct).toFixed(1);
  if (pct > 0) return `<span style="color:#22c55e;">&#9650; ${abs}%</span>`;
  if (pct < 0) return `<span style="color:#ef4444;">&#9660; ${abs}%</span>`;
  return `<span style="color:#94a3b8;">&#8212; 0%</span>`;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

// ── Data fetching ────────────────────────────────────────────────────────────

async function getCompanyMetrics(companyId: string, companyName: string): Promise<CompanyMetrics> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Current week metrics
  const { data: currentMetrics } = await supabase
    .from("post_metrics")
    .select("likes, comments, shares, impressions, post_id")
    .eq("company_id", companyId)
    .gte("recorded_at", weekAgo.toISOString())
    .lte("recorded_at", now.toISOString());

  // Previous week metrics
  const { data: prevMetrics } = await supabase
    .from("post_metrics")
    .select("likes, comments, shares, impressions, post_id")
    .eq("company_id", companyId)
    .gte("recorded_at", twoWeeksAgo.toISOString())
    .lt("recorded_at", weekAgo.toISOString());

  // Current week posts published
  const { count: postsThisWeek } = await supabase
    .from("content_drafts")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "published")
    .gte("published_at", weekAgo.toISOString());

  // Previous week posts published
  const { count: postsLastWeek } = await supabase
    .from("content_drafts")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "published")
    .gte("published_at", twoWeeksAgo.toISOString())
    .lt("published_at", weekAgo.toISOString());

  // Drafts pending
  const { count: draftsPending } = await supabase
    .from("content_drafts")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "draft");

  // Videos generated this week
  const { count: videosGenerated } = await supabase
    .from("content_drafts")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .not("video_url", "is", null)
    .gte("created_at", weekAgo.toISOString());

  const rows = (currentMetrics || []) as MetricsRow[];
  const prevRows = (prevMetrics || []) as MetricsRow[];

  const totalLikes = rows.reduce((s, r) => s + (r.likes || 0), 0);
  const totalComments = rows.reduce((s, r) => s + (r.comments || 0), 0);
  const totalShares = rows.reduce((s, r) => s + (r.shares || 0), 0);
  const totalImpressions = rows.reduce((s, r) => s + (r.impressions || 0), 0);
  const interactions = totalLikes + totalComments + totalShares;
  const engagementRate = totalImpressions > 0 ? (interactions / totalImpressions) * 100 : 0;

  const prevTotalLikes = prevRows.reduce((s, r) => s + (r.likes || 0), 0);
  const prevTotalComments = prevRows.reduce((s, r) => s + (r.comments || 0), 0);
  const prevTotalShares = prevRows.reduce((s, r) => s + (r.shares || 0), 0);
  const prevTotalImpressions = prevRows.reduce((s, r) => s + (r.impressions || 0), 0);
  const prevInteractions = prevTotalLikes + prevTotalComments + prevTotalShares;
  const prevEngagementRate = prevTotalImpressions > 0 ? (prevInteractions / prevTotalImpressions) * 100 : 0;

  // Top post by engagement
  let topPost: { title: string; engagement: number } | null = null;
  if (rows.length > 0) {
    const postEngagement = new Map<string, number>();
    for (const r of rows) {
      const eng = (r.likes || 0) + (r.comments || 0) + (r.shares || 0);
      postEngagement.set(r.post_id, (postEngagement.get(r.post_id) || 0) + eng);
    }
    let bestId = "";
    let bestEng = 0;
    for (const [id, eng] of postEngagement) {
      if (eng > bestEng) { bestId = id; bestEng = eng; }
    }
    if (bestId) {
      const { data: postData } = await supabase
        .from("content_drafts")
        .select("title")
        .eq("id", bestId)
        .single();
      topPost = { title: postData?.title || "Untitled Post", engagement: bestEng };
    }
  }

  return {
    companyName,
    totalPosts: postsThisWeek || 0,
    totalLikes,
    totalComments,
    totalShares,
    totalImpressions,
    engagementRate,
    topPost,
    prevTotalPosts: postsLastWeek || 0,
    prevTotalLikes,
    prevTotalComments,
    prevTotalShares,
    prevTotalImpressions,
    prevEngagementRate,
    draftsPending: draftsPending || 0,
    videosGenerated: videosGenerated || 0,
  };
}

// ── HTML builder ─────────────────────────────────────────────────────────────

function buildCompanyCard(m: CompanyMetrics): string {
  const topPostHtml = m.topPost
    ? `<div style="margin-top:16px;padding:12px;background-color:#0f172a;border-radius:8px;border-left:3px solid #3b82f6;">
        <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Top Performing Post</div>
        <div style="color:#e2e8f0;font-size:13px;font-weight:600;">${m.topPost.title}</div>
        <div style="color:#3b82f6;font-size:12px;margin-top:2px;">${fmt(m.topPost.engagement)} total engagements</div>
      </div>`
    : "";

  return `
  <div style="background-color:#1e293b;border-radius:12px;border:1px solid #334155;padding:24px;margin-bottom:16px;">
    <h2 style="color:#ffffff;font-size:18px;margin:0 0 16px;border-bottom:1px solid #334155;padding-bottom:12px;">${m.companyName}</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 12px;"><span style="color:#94a3b8;font-size:12px;">Posts Published</span><br/><span style="color:#ffffff;font-size:20px;font-weight:700;">${m.totalPosts}</span><br/>${changeArrow(m.totalPosts, m.prevTotalPosts)}</td>
        <td style="padding:8px 12px;"><span style="color:#94a3b8;font-size:12px;">Impressions</span><br/><span style="color:#ffffff;font-size:20px;font-weight:700;">${fmt(m.totalImpressions)}</span><br/>${changeArrow(m.totalImpressions, m.prevTotalImpressions)}</td>
        <td style="padding:8px 12px;"><span style="color:#94a3b8;font-size:12px;">Engagement Rate</span><br/><span style="color:#ffffff;font-size:20px;font-weight:700;">${m.engagementRate.toFixed(2)}%</span><br/>${changeArrow(m.engagementRate, m.prevEngagementRate)}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;"><span style="color:#94a3b8;font-size:12px;">Likes</span><br/><span style="color:#ffffff;font-size:18px;font-weight:600;">${fmt(m.totalLikes)}</span><br/>${changeArrow(m.totalLikes, m.prevTotalLikes)}</td>
        <td style="padding:8px 12px;"><span style="color:#94a3b8;font-size:12px;">Comments</span><br/><span style="color:#ffffff;font-size:18px;font-weight:600;">${fmt(m.totalComments)}</span><br/>${changeArrow(m.totalComments, m.prevTotalComments)}</td>
        <td style="padding:8px 12px;"><span style="color:#94a3b8;font-size:12px;">Shares</span><br/><span style="color:#ffffff;font-size:18px;font-weight:600;">${fmt(m.totalShares)}</span><br/>${changeArrow(m.totalShares, m.prevTotalShares)}</td>
      </tr>
    </table>
    <div style="margin-top:12px;display:flex;gap:16px;">
      <span style="color:#94a3b8;font-size:12px;">Drafts Pending: <strong style="color:#f59e0b;">${m.draftsPending}</strong></span>
      <span style="color:#94a3b8;font-size:12px;">Videos Generated: <strong style="color:#8b5cf6;">${m.videosGenerated}</strong></span>
    </div>
    ${topPostHtml}
  </div>`;
}

function buildReportHtml(orgName: string, allMetrics: CompanyMetrics[], weekLabel: string): string {
  // Summary totals
  const totalPosts = allMetrics.reduce((s, m) => s + m.totalPosts, 0);
  const totalImpressions = allMetrics.reduce((s, m) => s + m.totalImpressions, 0);
  const totalEngagements = allMetrics.reduce((s, m) => s + m.totalLikes + m.totalComments + m.totalShares, 0);
  const avgEngRate = allMetrics.length > 0
    ? allMetrics.reduce((s, m) => s + m.engagementRate, 0) / allMetrics.length
    : 0;

  const companyCards = allMetrics.map(m => buildCompanyCard(m)).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:40px 24px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="color:#ffffff;font-size:24px;margin:0 0 4px;">Weekly Performance Report</h1>
      <p style="color:#94a3b8;font-size:14px;margin:0;">${orgName} &mdash; ${weekLabel}</p>
    </div>

    <!-- Quick Stats -->
    <div style="background-color:#1e293b;border-radius:12px;border:1px solid #334155;padding:20px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;text-align:center;">
        <tr>
          <td style="padding:8px;">
            <div style="color:#3b82f6;font-size:28px;font-weight:800;">${fmt(totalPosts)}</div>
            <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Posts</div>
          </td>
          <td style="padding:8px;">
            <div style="color:#3b82f6;font-size:28px;font-weight:800;">${fmt(totalImpressions)}</div>
            <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Impressions</div>
          </td>
          <td style="padding:8px;">
            <div style="color:#3b82f6;font-size:28px;font-weight:800;">${fmt(totalEngagements)}</div>
            <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Engagements</div>
          </td>
          <td style="padding:8px;">
            <div style="color:#3b82f6;font-size:28px;font-weight:800;">${avgEngRate.toFixed(2)}%</div>
            <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Avg Eng. Rate</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Company-by-company breakdown -->
    ${companyCards}

    <!-- Footer -->
    <p style="color:#475569;font-size:11px;text-align:center;margin-top:32px;">
      Xignil &mdash; AI-powered social media management<br/>
      <a href="https://xignil.com/analytics" style="color:#3b82f6;text-decoration:none;">View full analytics dashboard</a>
    </p>
  </div>
</body>
</html>`;
}

// ── Send email ───────────────────────────────────────────────────────────────

async function sendBrevoEmail(
  toEmail: string,
  toName: string,
  subject: string,
  htmlContent: string,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
      to: [{ email: toEmail, name: toName }],
      subject,
      htmlContent,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { success: false, error: `Brevo API error ${res.status}: ${text}` };
  }
  return { success: true };
}

// ── Generate report for one org ──────────────────────────────────────────────

async function generateReportForOrg(orgId: string): Promise<{ success: boolean; error?: string }> {
  // Get org details
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, name, owner_id")
    .eq("id", orgId)
    .single();

  if (orgError || !org) {
    return { success: false, error: `Org not found: ${orgId}` };
  }

  // Get all companies for this org
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name")
    .eq("org_id", orgId)
    .order("name");

  if (!companies || companies.length === 0) {
    return { success: false, error: "No companies found for this org" };
  }

  // Gather metrics for each company
  const allMetrics: CompanyMetrics[] = [];
  for (const company of companies) {
    const metrics = await getCompanyMetrics(company.id, company.name);
    allMetrics.push(metrics);
  }

  // Build week label
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekLabel = `${weekAgo.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  // Build HTML
  const html = buildReportHtml(org.name, allMetrics, weekLabel);

  // Get owner email
  const { data: ownerData, error: ownerError } = await supabase.auth.admin.getUserById(org.owner_id);
  if (ownerError || !ownerData?.user?.email) {
    return { success: false, error: "Could not find owner email" };
  }

  const ownerEmail = ownerData.user.email;
  const ownerName = ownerData.user.user_metadata?.full_name || ownerEmail;

  // Send email
  const result = await sendBrevoEmail(
    ownerEmail,
    ownerName,
    `Weekly Report: ${org.name} - ${weekLabel}`,
    html,
  );

  return result;
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/weekly-report\/?/, "").replace(/\/$/, "");

  if (path !== "generate") {
    return jsonResponse({ error: `Unknown route: ${path}` }, 404);
  }

  try {
    let body: { org_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine — generate for all orgs
    }

    if (body.org_id) {
      // Single org
      const result = await generateReportForOrg(body.org_id);
      if (!result.success) {
        return jsonResponse({ success: false, error: result.error }, 500);
      }
      return jsonResponse({ success: true, org_id: body.org_id });
    }

    // All active orgs
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("status", "active");

    if (!orgs || orgs.length === 0) {
      return jsonResponse({ success: true, message: "No active organizations found", sent: 0 });
    }

    const results: { org: string; success: boolean; error?: string }[] = [];
    for (const org of orgs) {
      const result = await generateReportForOrg(org.id);
      results.push({ org: org.name, ...result });
    }

    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);

    return jsonResponse({
      success: true,
      sent,
      total: orgs.length,
      ...(failed.length > 0 ? { failures: failed } : {}),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return jsonResponse({ error: message }, 500);
  }
});
