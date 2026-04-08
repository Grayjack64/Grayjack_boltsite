/**
 * Best Time to Post Edge Function
 *
 * GET /best-times?company_id={id}
 *
 * Analyzes post_metrics joined with content_drafts to determine
 * the best times to post based on historical engagement rates.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const companyId = url.searchParams.get("company_id");

    if (!companyId) {
      return jsonResponse({ error: "company_id is required" }, 400);
    }

    // Query post_metrics joined with content_drafts to get published_at timestamps
    const { data: metricsData, error: metricsError } = await supabase
      .from("post_metrics")
      .select(
        "likes, comments, shares, impressions, posted_at",
      )
      .eq("company_id", companyId)
      .not("posted_at", "is", null);

    if (metricsError) {
      return jsonResponse({ error: metricsError.message }, 500);
    }

    if (!metricsData || metricsData.length === 0) {
      return jsonResponse({
        top_times: [],
        heatmap: Array.from({ length: 7 }, () => Array(24).fill(0)),
        recommendation: "Not enough data yet. Publish some posts to get recommendations.",
      });
    }

    // Build day+hour buckets
    const buckets: Record<
      string,
      { totalEngagement: number; count: number; day: number; hour: number }
    > = {};

    for (const row of metricsData) {
      if (!row.posted_at) continue;

      const date = new Date(row.posted_at);
      const day = date.getUTCDay(); // 0=Sunday...6=Saturday
      const hour = date.getUTCHours(); // 0-23
      const key = `${day}-${hour}`;

      const engagementRate =
        (row.likes + row.comments + row.shares) /
        Math.max(row.impressions, 1);

      if (!buckets[key]) {
        buckets[key] = { totalEngagement: 0, count: 0, day, hour };
      }
      buckets[key].totalEngagement += engagementRate;
      buckets[key].count += 1;
    }

    // Build top_times sorted by avg engagement desc
    const allBuckets = Object.values(buckets).map((b) => ({
      day: b.day,
      hour: b.hour,
      avg_engagement: parseFloat(
        (b.totalEngagement / b.count).toFixed(4),
      ),
      post_count: b.count,
    }));

    allBuckets.sort((a, b) => b.avg_engagement - a.avg_engagement);
    const topTimes = allBuckets.slice(0, 5);

    // Build 7x24 heatmap matrix
    const heatmap: number[][] = Array.from({ length: 7 }, () =>
      Array(24).fill(0),
    );
    for (const b of allBuckets) {
      heatmap[b.day][b.hour] = b.avg_engagement;
    }

    // Build recommendation string
    let recommendation =
      "Not enough data yet. Publish some posts to get recommendations.";
    if (topTimes.length >= 2) {
      const t1 = topTimes[0];
      const t2 = topTimes[1];
      recommendation = `Your best times are ${DAY_NAMES[t1.day]} at ${formatHour(t1.hour)} and ${DAY_NAMES[t2.day]} at ${formatHour(t2.hour)}`;
    } else if (topTimes.length === 1) {
      const t1 = topTimes[0];
      recommendation = `Your best time is ${DAY_NAMES[t1.day]} at ${formatHour(t1.hour)}`;
    }

    return jsonResponse({
      top_times: topTimes,
      heatmap,
      recommendation,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
});
