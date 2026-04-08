/**
 * YouTube OAuth + Upload Edge Function
 *
 * Handles OAuth 2.0 flow for YouTube API and video uploads.
 * Supports: authorize, callback, upload-short.
 * Reuses google_accounts table with youtube-specific columns.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Refresh the access token if expired. Returns a valid access token.
 */
async function getValidAccessToken(
  supabase: ReturnType<typeof createClient>,
  account: { id: string; access_token: string; refresh_token: string | null; token_expires_at: string }
): Promise<string> {
  if (new Date(account.token_expires_at) > new Date()) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    throw new Error("Token expired and no refresh token available");
  }

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

  if (!refreshRes.ok) {
    throw new Error("Failed to refresh access token");
  }

  const refreshData = await refreshRes.json();
  const newToken = refreshData.access_token;

  await supabase.from("google_accounts").update({
    access_token: newToken,
    token_expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
  }).eq("id", account.id);

  return newToken;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/youtube-oauth", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // -----------------------------------------------------------------------
    // Authorize -- redirect user to Google consent screen with YouTube scopes
    // -----------------------------------------------------------------------
    if (path === "/authorize") {
      const companyId = url.searchParams.get("company_id");
      const origin = url.searchParams.get("origin") || "https://xignil.com";

      if (!companyId) return jsonResponse({ error: "company_id is required" }, 400);
      if (!GOOGLE_CLIENT_ID) return jsonResponse({ error: "Google OAuth not configured" }, 500);

      const redirectUri = `${origin}/callback/youtube`;
      const state = `youtube_${companyId}_${Math.random().toString(36).substring(2, 10)}`;

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      await supabase.from("oauth_states").insert({
        company_id: companyId,
        state,
        code_verifier: "",
        redirect_uri: redirectUri,
        platform: "youtube",
        expires_at: expiresAt.toISOString(),
      });

      const scopes = [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
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
    // Callback -- exchange code for tokens, fetch YouTube channel info
    // -----------------------------------------------------------------------
    if (path === "/callback" && req.method === "POST") {
      const { code, state } = await req.json();

      if (!code || !state) return jsonResponse({ error: "code and state are required" }, 400);

      // Validate state
      const { data: oauthState, error: stateError } = await supabase
        .from("oauth_states")
        .select("*")
        .eq("state", state)
        .eq("platform", "youtube")
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

      // Fetch YouTube channel info
      const channelRes = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { "Authorization": `Bearer ${accessToken}` } }
      );

      let channelId = null;
      let channelName = null;

      if (channelRes.ok) {
        const channelData = await channelRes.json();
        const channels = channelData.items || [];
        if (channels.length > 0) {
          channelId = channels[0].id;
          channelName = channels[0].snippet?.title || "YouTube Channel";
        }
      }

      if (!channelId) {
        return jsonResponse({ error: "No YouTube channel found for this Google account" }, 400);
      }

      // Check if a google_accounts row already exists for this company
      const { data: existingAccount } = await supabase
        .from("google_accounts")
        .select("id")
        .eq("company_id", companyId)
        .maybeSingle();

      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

      if (existingAccount) {
        // Update existing row with YouTube info and new tokens
        await supabase.from("google_accounts").update({
          access_token: accessToken,
          refresh_token: refreshToken || undefined,
          token_expires_at: expiresAt.toISOString(),
          youtube_channel_id: channelId,
          youtube_channel_name: channelName,
          youtube_enabled: true,
        }).eq("company_id", companyId);
      } else {
        // Create new row
        await supabase.from("google_accounts").insert({
          company_id: companyId,
          location_id: "_youtube_only",
          location_name: null,
          access_token: accessToken,
          refresh_token: refreshToken || null,
          token_expires_at: expiresAt.toISOString(),
          is_active: true,
          youtube_channel_id: channelId,
          youtube_channel_name: channelName,
          youtube_enabled: true,
        });
      }

      return jsonResponse({
        success: true,
        channel_name: channelName,
        channel_id: channelId,
      });
    }

    // -----------------------------------------------------------------------
    // Upload Short -- upload a video to YouTube as a Short
    // -----------------------------------------------------------------------
    if (path === "/upload-short" && req.method === "POST") {
      const { company_id, video_url, title, description } = await req.json();

      if (!company_id || !video_url || !title) {
        return jsonResponse({ error: "company_id, video_url, and title are required" }, 400);
      }

      // Get the company's Google account with YouTube enabled
      const { data: account } = await supabase
        .from("google_accounts")
        .select("*")
        .eq("company_id", company_id)
        .eq("youtube_enabled", true)
        .maybeSingle();

      if (!account) {
        return jsonResponse({ error: "No YouTube account connected for this company" }, 404);
      }

      // Get a valid access token (auto-refresh if expired)
      const accessToken = await getValidAccessToken(supabase, account);

      // Download the video from video_url
      const videoRes = await fetch(video_url);
      if (!videoRes.ok) {
        return jsonResponse({ error: "Failed to download video from video_url" }, 400);
      }
      const videoBuffer = await videoRes.arrayBuffer();
      const videoBytes = new Uint8Array(videoBuffer);

      // Ensure title includes #Shorts
      const shortsTitle = title.includes("#Shorts") ? title : `${title} #Shorts`;

      // Start resumable upload
      const metadata = {
        snippet: {
          title: shortsTitle,
          description: description || "",
          tags: ["Shorts"],
          categoryId: "22",
        },
        status: {
          privacyStatus: "public",
          selfDeclaredMadeForKids: false,
          madeForKids: false,
        },
      };

      const initRes = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(videoBytes.length),
            "X-Upload-Content-Type": "video/*",
          },
          body: JSON.stringify(metadata),
        }
      );

      if (!initRes.ok) {
        const err = await initRes.text();
        return jsonResponse({ error: "Failed to initiate upload", details: err }, 400);
      }

      const uploadUrl = initRes.headers.get("Location");
      if (!uploadUrl) {
        return jsonResponse({ error: "No upload URL returned from YouTube" }, 500);
      }

      // Upload the video data
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/*",
          "Content-Length": String(videoBytes.length),
        },
        body: videoBytes,
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        return jsonResponse({ error: "Video upload failed", details: err }, 400);
      }

      const uploadData = await uploadRes.json();

      return jsonResponse({
        success: true,
        video_id: uploadData.id,
        title: uploadData.snippet?.title,
        url: `https://youtube.com/shorts/${uploadData.id}`,
      });
    }

    return jsonResponse({ error: "Not found" }, 404);

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
});
