/**
 * TikTok OAuth + Upload Edge Function
 *
 * Handles OAuth 2.0 flow for TikTok API and video uploads.
 * Supports: authorize, callback, upload.
 * Uses tiktok_accounts table.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const TIKTOK_CLIENT_KEY = Deno.env.get("TIKTOK_CLIENT_KEY") || "";
const TIKTOK_CLIENT_SECRET = Deno.env.get("TIKTOK_CLIENT_SECRET") || "";

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
    const path = url.pathname.replace("/tiktok-oauth", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // -----------------------------------------------------------------------
    // Authorize -- redirect user to TikTok consent screen
    // -----------------------------------------------------------------------
    if (path === "/authorize") {
      const companyId = url.searchParams.get("company_id");
      const origin = url.searchParams.get("origin") || "https://xignil.com";

      if (!companyId) return jsonResponse({ error: "company_id is required" }, 400);
      if (!TIKTOK_CLIENT_KEY) return jsonResponse({ error: "TikTok OAuth not configured" }, 500);

      const redirectUri = `${origin}/callback/tiktok`;
      const state = `tiktok_${companyId}_${Math.random().toString(36).substring(2, 10)}`;

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      await supabase.from("oauth_states").insert({
        company_id: companyId,
        state,
        code_verifier: "",
        redirect_uri: redirectUri,
        platform: "tiktok",
        expires_at: expiresAt.toISOString(),
      });

      const scopes = "video.upload,video.publish,user.info.basic";

      const authUrl = `https://www.tiktok.com/v2/auth/authorize/`
        + `?client_key=${TIKTOK_CLIENT_KEY}`
        + `&scope=${encodeURIComponent(scopes)}`
        + `&response_type=code`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}`
        + `&state=${state}`;

      return jsonResponse({ authorization_url: authUrl });
    }

    // -----------------------------------------------------------------------
    // Callback -- exchange code for tokens, fetch user info
    // -----------------------------------------------------------------------
    if (path === "/callback" && req.method === "POST") {
      const { code, state } = await req.json();

      if (!code || !state) return jsonResponse({ error: "code and state are required" }, 400);

      // Validate state
      const { data: oauthState, error: stateError } = await supabase
        .from("oauth_states")
        .select("*")
        .eq("state", state)
        .eq("platform", "tiktok")
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
      const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: TIKTOK_CLIENT_KEY,
          client_secret: TIKTOK_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        return jsonResponse({ error: "Token exchange failed", details: err }, 400);
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token || null;
      const openId = tokenData.open_id;
      const expiresIn = tokenData.expires_in || 86400;

      if (!accessToken || !openId) {
        return jsonResponse({ error: "TikTok returned no access token or open_id", details: tokenData }, 400);
      }

      // Fetch user info
      const userRes = await fetch(
        "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
        { headers: { "Authorization": `Bearer ${accessToken}` } }
      );

      let displayName = "TikTok User";
      let avatarUrl: string | null = null;

      if (userRes.ok) {
        const userData = await userRes.json();
        const user = userData.data?.user;
        if (user) {
          displayName = user.display_name || displayName;
          avatarUrl = user.avatar_url || null;
        }
      }

      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      // Upsert tiktok_accounts
      const { data: existing } = await supabase
        .from("tiktok_accounts")
        .select("id")
        .eq("company_id", companyId)
        .maybeSingle();

      if (existing) {
        await supabase.from("tiktok_accounts").update({
          open_id: openId,
          display_name: displayName,
          avatar_url: avatarUrl,
          access_token: accessToken,
          refresh_token: refreshToken,
          token_expires_at: tokenExpiresAt,
          is_active: true,
          updated_at: new Date().toISOString(),
        }).eq("company_id", companyId);
      } else {
        await supabase.from("tiktok_accounts").insert({
          company_id: companyId,
          open_id: openId,
          display_name: displayName,
          avatar_url: avatarUrl,
          access_token: accessToken,
          refresh_token: refreshToken,
          token_expires_at: tokenExpiresAt,
          is_active: true,
        });
      }

      return jsonResponse({
        success: true,
        username: displayName,
      });
    }

    // -----------------------------------------------------------------------
    // Upload -- initiate video upload via TikTok Content Posting API
    // -----------------------------------------------------------------------
    if (path === "/upload" && req.method === "POST") {
      const { company_id, video_url, description } = await req.json();

      if (!company_id || !video_url) {
        return jsonResponse({ error: "company_id and video_url are required" }, 400);
      }

      // Get the company's TikTok account
      const { data: account } = await supabase
        .from("tiktok_accounts")
        .select("*")
        .eq("company_id", company_id)
        .eq("is_active", true)
        .maybeSingle();

      if (!account) {
        return jsonResponse({ error: "No TikTok account connected for this company" }, 404);
      }

      const accessToken = account.access_token;

      // Init upload via Content Posting API
      const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          post_info: {
            title: description || "",
            privacy_level: "PUBLIC_TO_EVERYONE",
            disable_duet: false,
            disable_stitch: false,
            disable_comment: false,
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: video_url,
          },
        }),
      });

      if (!initRes.ok) {
        const err = await initRes.text();
        return jsonResponse({ error: "TikTok upload init failed", details: err }, 400);
      }

      const initData = await initRes.json();

      return jsonResponse({
        success: true,
        publish_id: initData.data?.publish_id,
        upload_url: initData.data?.upload_url,
      });
    }

    return jsonResponse({ error: "Not found" }, 404);

  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 500);
  }
});
