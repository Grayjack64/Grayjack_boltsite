/**
 * Google Business Profile OAuth Edge Function
 *
 * Handles OAuth 2.0 flow for Google Business Profile API.
 * Supports: authorize, callback, list-reviews, reply-review.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const GOOGLE_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const GOOGLE_BIZ_API = "https://mybusiness.googleapis.com/v4";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/google-oauth", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // -----------------------------------------------------------------------
    // Authorize — redirect user to Google consent screen
    // -----------------------------------------------------------------------
    if (path === "/authorize") {
      const companyId = url.searchParams.get("company_id");
      const origin = url.searchParams.get("origin") || "https://xignil.com";

      if (!companyId) return jsonResponse({ error: "company_id is required" }, 400);
      if (!GOOGLE_CLIENT_ID) return jsonResponse({ error: "Google OAuth not configured" }, 500);

      const redirectUri = `${origin}/callback/google`;
      const state = `google_${companyId}_${Math.random().toString(36).substring(2, 10)}`;

      // Store state for validation
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      await supabase.from("oauth_states").insert({
        company_id: companyId,
        state,
        code_verifier: "",
        redirect_uri: redirectUri,
        platform: "google",
        expires_at: expiresAt.toISOString(),
      });

      const scopes = [
        "https://www.googleapis.com/auth/business.manage",
      ].join(" ");

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth`
        + `?client_id=${GOOGLE_CLIENT_ID}`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}`
        + `&scope=${encodeURIComponent(scopes)}`
        + `&state=${state}`
        + `&response_type=code`
        + `&access_type=offline`
        + `&prompt=consent`;

      return jsonResponse({ authorization_url: authUrl });
    }

    // -----------------------------------------------------------------------
    // Callback — exchange code for tokens, get business location
    // -----------------------------------------------------------------------
    if (path === "/callback" && req.method === "POST") {
      const { code, state } = await req.json();

      if (!code || !state) return jsonResponse({ error: "code and state are required" }, 400);

      // Validate state
      const { data: oauthState, error: stateError } = await supabase
        .from("oauth_states")
        .select("*")
        .eq("state", state)
        .eq("platform", "google")
        .maybeSingle();

      if (stateError || !oauthState) return jsonResponse({ error: "Invalid or expired state" }, 400);

      if (new Date(oauthState.expires_at) < new Date()) {
        await supabase.from("oauth_states").delete().eq("state", state);
        return jsonResponse({ error: "OAuth state expired" }, 400);
      }

      const companyId = oauthState.company_id;
      const redirectUri = oauthState.redirect_uri;
      await supabase.from("oauth_states").delete().eq("state", state);

      // Exchange code for tokens
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        return jsonResponse({ error: "Token exchange failed", details: err }, 400);
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token;

      // Get business accounts
      const accountsRes = await fetch(`${GOOGLE_API}/accounts`, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });

      if (!accountsRes.ok) {
        const err = await accountsRes.text();
        return jsonResponse({ error: "Failed to fetch business accounts", details: err }, 400);
      }

      const accountsData = await accountsRes.json();
      const accounts = accountsData.accounts || [];

      if (accounts.length === 0) {
        return jsonResponse({ error: "No Google Business Profile accounts found" }, 400);
      }

      // Get locations for the first account
      const account = accounts[0];
      const accountName = account.name; // format: "accounts/123456"

      const locationsRes = await fetch(`${GOOGLE_BIZ_API}/${accountName}/locations`, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });

      let locations = [];
      if (locationsRes.ok) {
        const locData = await locationsRes.json();
        locations = locData.locations || [];
      }

      // If multiple locations, return list for selection
      if (locations.length > 1) {
        // Store token temporarily for location selection
        await supabase.from("google_accounts").upsert({
          company_id: companyId,
          location_id: "_pending",
          location_name: null,
          access_token: accessToken,
          refresh_token: refreshToken || null,
          token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
          is_active: false,
        }, { onConflict: "company_id" });

        return jsonResponse({
          needs_location_selection: true,
          locations: locations.map((l: any) => ({
            id: l.name,
            name: l.locationName || l.title || l.name,
            address: l.address?.formattedAddress || "",
          })),
          company_id: companyId,
        });
      }

      // Single location — save directly
      const location = locations[0] || { name: accountName, locationName: account.accountName || "Business" };
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

      await supabase.from("google_accounts").upsert({
        company_id: companyId,
        location_id: location.name,
        location_name: location.locationName || location.title || "Business",
        access_token: accessToken,
        refresh_token: refreshToken || null,
        token_expires_at: expiresAt.toISOString(),
        is_active: true,
      }, { onConflict: "company_id" });

      return jsonResponse({
        success: true,
        location_name: location.locationName || location.title || "Business",
      });
    }

    // -----------------------------------------------------------------------
    // Select Location — for multi-location businesses
    // -----------------------------------------------------------------------
    if (path === "/select-location" && req.method === "POST") {
      const { company_id, location_id, location_name } = await req.json();

      if (!company_id || !location_id) return jsonResponse({ error: "company_id and location_id required" }, 400);

      await supabase.from("google_accounts").update({
        location_id,
        location_name: location_name || "Business",
        is_active: true,
      }).eq("company_id", company_id);

      return jsonResponse({ success: true, location_name });
    }

    // -----------------------------------------------------------------------
    // List Reviews — get recent reviews for a company
    // -----------------------------------------------------------------------
    if (path === "/reviews" && req.method === "POST") {
      const { company_id } = await req.json();

      if (!company_id) return jsonResponse({ error: "company_id required" }, 400);

      const { data: account } = await supabase
        .from("google_accounts")
        .select("*")
        .eq("company_id", company_id)
        .eq("is_active", true)
        .maybeSingle();

      if (!account) return jsonResponse({ error: "No Google account connected" }, 404);

      // Refresh token if expired
      let accessToken = account.access_token;
      if (new Date(account.token_expires_at) < new Date() && account.refresh_token) {
        const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            refresh_token: account.refresh_token,
            grant_type: "refresh_token",
          }),
        });

        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          accessToken = refreshData.access_token;
          await supabase.from("google_accounts").update({
            access_token: accessToken,
            token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
          }).eq("id", account.id);
        }
      }

      const reviewsRes = await fetch(`${GOOGLE_BIZ_API}/${account.location_id}/reviews`, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });

      if (!reviewsRes.ok) {
        const err = await reviewsRes.text();
        return jsonResponse({ error: "Failed to fetch reviews", details: err }, 400);
      }

      const reviewsData = await reviewsRes.json();

      return jsonResponse({
        success: true,
        reviews: (reviewsData.reviews || []).map((r: any) => ({
          id: r.reviewId,
          author: r.reviewer?.displayName || "Anonymous",
          rating: r.starRating, // ONE, TWO, THREE, FOUR, FIVE
          text: r.comment || "",
          reply: r.reviewReply?.comment || null,
          create_time: r.createTime,
          update_time: r.updateTime,
        })),
        total: reviewsData.totalReviewCount || 0,
        average_rating: reviewsData.averageRating || 0,
      });
    }

    // -----------------------------------------------------------------------
    // Reply to Review
    // -----------------------------------------------------------------------
    if (path === "/reply-review" && req.method === "POST") {
      const { company_id, review_id, text } = await req.json();

      if (!company_id || !review_id || !text) {
        return jsonResponse({ error: "company_id, review_id, and text required" }, 400);
      }

      const { data: account } = await supabase
        .from("google_accounts")
        .select("*")
        .eq("company_id", company_id)
        .eq("is_active", true)
        .maybeSingle();

      if (!account) return jsonResponse({ error: "No Google account connected" }, 404);

      // Refresh token if needed (same as above)
      let accessToken = account.access_token;
      if (new Date(account.token_expires_at) < new Date() && account.refresh_token) {
        const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            refresh_token: account.refresh_token,
            grant_type: "refresh_token",
          }),
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          accessToken = refreshData.access_token;
          await supabase.from("google_accounts").update({
            access_token: accessToken,
            token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
          }).eq("id", account.id);
        }
      }

      const replyRes = await fetch(
        `${GOOGLE_BIZ_API}/${account.location_id}/reviews/${review_id}/reply`,
        {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ comment: text }),
        }
      );

      if (!replyRes.ok) {
        const err = await replyRes.text();
        return jsonResponse({ error: "Failed to reply to review", details: err }, 400);
      }

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Not found" }, 404);

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
});
