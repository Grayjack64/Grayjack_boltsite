/**
 * Usage Enforcement Edge Function
 *
 * Checks tier limits before allowing content generation and video creation,
 * and tracks usage per company per month.
 *
 * Routes:
 *   GET  /usage/check   — check if an action is allowed
 *   POST /usage/track   — increment usage counter
 *   GET  /usage/summary — get usage summary for a company
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

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Map action names to tier_config column names and company_usage column names
const ACTION_MAP: Record<string, { limitCol: string; usageCol: string }> = {
  post: { limitCol: "posts_per_company", usageCol: "posts_generated" },
  video: { limitCol: "videos_per_company", usageCol: "videos_generated" },
  storyboard_preview: {
    limitCol: "storyboard_previews",
    usageCol: "storyboard_previews_used",
  },
  ai_response: {
    limitCol: "response_drafting_enabled",
    usageCol: "ai_responses_drafted",
  },
  ab_test: { limitCol: "ab_testing_enabled", usageCol: "ab_tests_run" },
};

// Credit costs per action
const CREDIT_COSTS: Record<string, Record<string, number>> = {
  video_standard: { cost: 100 },
  video_premium: { cost: 200 },
  scene_regen_standard: { cost: 20 },
  scene_regen_premium: { cost: 40 },
  voiceover_regen: { cost: 10 },
  recompose: { cost: 10 },
  storyboard_preview: { cost: 0 },
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getCompanyOrg(
  companyId: string,
): Promise<{ orgId: string; tier: string } | null> {
  const { data: company } = await supabase
    .from("companies")
    .select("org_id")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return null;

  const { data: org } = await supabase
    .from("organizations")
    .select("subscription_tier")
    .eq("id", company.org_id)
    .maybeSingle();
  if (!org) return null;

  return { orgId: company.org_id, tier: org.subscription_tier };
}

async function getTierLimits(
  tier: string,
): Promise<Record<string, number> | null> {
  const { data } = await supabase
    .from("tier_config")
    .select("*")
    .eq("tier", tier)
    .maybeSingle();
  return data || null;
}

async function getUsage(
  companyId: string,
  month: string,
): Promise<Record<string, number>> {
  const { data } = await supabase
    .from("company_usage")
    .select("*")
    .eq("company_id", companyId)
    .eq("month", month)
    .maybeSingle();
  return data || {};
}

// ── CHECK ────────────────────────────────────────────────────────────────────

async function handleCheck(url: URL) {
  const companyId = url.searchParams.get("company_id");
  const action = url.searchParams.get("action");

  if (!companyId || !action) {
    return jsonResponse({ error: "company_id and action are required" }, 400);
  }

  const mapping = ACTION_MAP[action];
  if (!mapping) {
    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  }

  const info = await getCompanyOrg(companyId);
  if (!info) {
    return jsonResponse({ error: "Company or organization not found" }, 404);
  }

  const limits = await getTierLimits(info.tier);
  if (!limits) {
    return jsonResponse({ error: `No tier config for tier: ${info.tier}` }, 404);
  }

  const limitVal = limits[mapping.limitCol];
  const usage = await getUsage(companyId, currentMonth());
  const used = (usage[mapping.usageCol] as number) || 0;

  // For boolean features (response_drafting_enabled, ab_testing_enabled)
  if (typeof limitVal === "boolean") {
    return jsonResponse({
      allowed: limitVal === true,
      used,
      limit: limitVal ? "unlimited" : 0,
      tier: info.tier,
    });
  }

  const limit = limitVal as number;

  // 0 = unlimited, -1 = unlimited, null = unlimited
  const isUnlimited = limit === 0 || limit === -1 || limit === null || limit === undefined;
  const allowed = isUnlimited || used < limit;

  return jsonResponse({
    allowed,
    used,
    limit: isUnlimited ? "unlimited" : limit,
    tier: info.tier,
  });
}

// ── TRACK ────────────────────────────────────────────────────────────────────

async function handleTrack(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.company_id || !body?.action) {
    return jsonResponse({ error: "company_id and action are required" }, 400);
  }

  const { company_id, action } = body;
  const mapping = ACTION_MAP[action];
  if (!mapping) {
    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  }

  const info = await getCompanyOrg(company_id);
  if (!info) {
    return jsonResponse({ error: "Company or organization not found" }, 404);
  }

  const month = currentMonth();
  const usage = await getUsage(company_id, month);
  const currentVal = (usage[mapping.usageCol] as number) || 0;

  if (Object.keys(usage).length === 0 || !usage.company_id) {
    // Insert new row
    const { error } = await supabase.from("company_usage").upsert(
      {
        company_id,
        month,
        [mapping.usageCol]: 1,
      },
      { onConflict: "company_id,month" },
    );
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  } else {
    // Update existing row
    const { error } = await supabase
      .from("company_usage")
      .update({ [mapping.usageCol]: currentVal + 1 })
      .eq("company_id", company_id)
      .eq("month", month);
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  }

  return jsonResponse({ success: true, [mapping.usageCol]: currentVal + 1 });
}

// ── SUMMARY ──────────────────────────────────────────────────────────────────

async function handleSummary(url: URL) {
  const companyId = url.searchParams.get("company_id");
  if (!companyId) {
    return jsonResponse({ error: "company_id is required" }, 400);
  }

  const info = await getCompanyOrg(companyId);
  if (!info) {
    return jsonResponse({ error: "Company or organization not found" }, 404);
  }

  const limits = await getTierLimits(info.tier);
  if (!limits) {
    return jsonResponse({ error: `No tier config for tier: ${info.tier}` }, 404);
  }

  const usage = await getUsage(companyId, currentMonth());

  const fmt = (v: number) => (v === 0 || v === -1 || v === null || v === undefined) ? "unlimited" : v;

  const postsLimit = limits.posts_per_company as number;
  const videosLimit = limits.videos_per_company as number;
  const postsUsed = (usage.posts_generated as number) || 0;
  const videosUsed = (usage.videos_generated as number) || 0;
  const previewsUsed = (usage.storyboard_previews_used as number) || 0;
  const aiResponsesUsed = (usage.ai_responses_drafted as number) || 0;
  const creditsUsed = (usage.video_credits_consumed as number) || 0;
  const creditsLimit = (limits as any).video_credits_per_company as number;

  const postsUnlimited = postsLimit === 0 || postsLimit === -1;
  const videosUnlimited = videosLimit === 0 || videosLimit === -1;
  const creditsUnlimited = creditsLimit === 0 || creditsLimit >= 99999;

  return jsonResponse({
    tier: info.tier,
    limits: {
      posts_per_company: fmt(postsLimit),
      videos_per_company: fmt(videosLimit),
      video_credits: creditsUnlimited ? "unlimited" : creditsLimit,
    },
    usage: {
      posts_generated: postsUsed,
      videos_generated: videosUsed,
      storyboard_previews_used: previewsUsed,
      ai_responses_drafted: aiResponsesUsed,
      video_credits_consumed: creditsUsed,
    },
    posts_remaining: postsUnlimited ? "unlimited" : Math.max(0, postsLimit - postsUsed),
    videos_remaining: videosUnlimited ? "unlimited" : Math.max(0, videosLimit - videosUsed),
    credits_remaining: creditsUnlimited ? "unlimited" : Math.max(0, creditsLimit - creditsUsed),
    credit_costs: CREDIT_COSTS,
  });
}

// ── CREDIT CHECK ────────────────────────────────────────────────────────────

async function handleCreditCheck(url: URL) {
  const companyId = url.searchParams.get("company_id");
  const action = url.searchParams.get("action"); // e.g. video_standard, scene_regen_premium, voiceover_regen, recompose, storyboard_preview

  if (!companyId || !action) {
    return jsonResponse({ error: "company_id and action are required" }, 400);
  }

  const costEntry = CREDIT_COSTS[action];
  if (!costEntry) {
    return jsonResponse({ error: `Unknown credit action: ${action}` }, 400);
  }

  const info = await getCompanyOrg(companyId);
  if (!info) return jsonResponse({ error: "Company or org not found" }, 404);

  const limits = await getTierLimits(info.tier);
  if (!limits) return jsonResponse({ error: `No tier config for: ${info.tier}` }, 404);

  const creditLimit = (limits as any).video_credits_per_company as number;
  const usage = await getUsage(companyId, currentMonth());
  const creditsUsed = (usage.video_credits_consumed as number) || 0;
  const cost = costEntry.cost;

  const isUnlimited = creditLimit === 0 || creditLimit >= 99999;
  const allowed = isUnlimited || (creditsUsed + cost) <= creditLimit;

  return jsonResponse({
    allowed,
    credits_used: creditsUsed,
    credits_limit: isUnlimited ? "unlimited" : creditLimit,
    credits_remaining: isUnlimited ? "unlimited" : Math.max(0, creditLimit - creditsUsed),
    cost,
    action,
    tier: info.tier,
  });
}

// ── CREDIT TRACK ────────────────────────────────────────────────────────────

async function handleCreditTrack(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.company_id || !body?.action) {
    return jsonResponse({ error: "company_id and action are required" }, 400);
  }

  const { company_id, action } = body;
  const costEntry = CREDIT_COSTS[action];
  if (!costEntry) {
    return jsonResponse({ error: `Unknown credit action: ${action}` }, 400);
  }

  const info = await getCompanyOrg(company_id);
  if (!info) return jsonResponse({ error: "Company or org not found" }, 404);

  const month = currentMonth();
  const usage = await getUsage(company_id, month);
  const currentCredits = (usage.video_credits_consumed as number) || 0;
  const newCredits = currentCredits + costEntry.cost;

  if (Object.keys(usage).length === 0 || !usage.company_id) {
    await supabase.from("company_usage").upsert(
      { company_id, org_id: info.orgId, month, video_credits_consumed: costEntry.cost },
      { onConflict: "company_id,month" },
    );
  } else {
    await supabase
      .from("company_usage")
      .update({ video_credits_consumed: newCredits })
      .eq("company_id", company_id)
      .eq("month", month);
  }

  return jsonResponse({ success: true, credits_consumed: newCredits, cost: costEntry.cost });
}

// ── ROUTER ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/usage", "");

    if (req.method === "GET" && (path === "/check" || path === "" || path === "/")) {
      // If no sub-path, check query params to decide
      if (url.searchParams.has("action")) {
        return await handleCheck(url);
      }
      // Default to summary if company_id present but no action
      if (url.searchParams.has("company_id")) {
        return await handleSummary(url);
      }
      return jsonResponse({ error: "Provide action or company_id param" }, 400);
    }

    if (req.method === "GET" && path === "/summary") {
      return await handleSummary(url);
    }

    if (req.method === "GET" && path === "/check") {
      return await handleCheck(url);
    }

    if (req.method === "POST" && path === "/track") {
      return await handleTrack(req);
    }

    if (req.method === "GET" && path === "/credit-check") {
      return await handleCreditCheck(url);
    }

    if (req.method === "POST" && path === "/credit-track") {
      return await handleCreditTrack(req);
    }

    return jsonResponse({ error: "Not found" }, 404);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
});
