import { createClient } from "npm:@supabase/supabase-js@2";

// OAuth 1.0a APP-level credentials (same for all companies)
const OAUTH_CONSUMER_KEY = Deno.env.get("TWITTER_CONSUMER_KEY") || "";
const OAUTH_CONSUMER_SECRET = Deno.env.get("TWITTER_CONSUMER_SECRET") || "";

/**
 * HMAC-SHA1 using Web Crypto API (works reliably in Deno/Supabase edge functions)
 */
async function hmacSha1(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Generate OAuth 1.0a Authorization header for Twitter API.
 *
 * @param extraParams - Additional params to include in the signature base string
 *   but NOT in the Authorization header (e.g. oauth_callback, oauth_verifier).
 *   For multipart/form-data requests, body params are NOT included.
 */
async function generateOAuth1Header(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  tokenSecret: string = "",
  token: string = "",
  extraParams: Record<string, string> = {},
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_version: "1.0",
  };

  if (token) {
    oauthParams.oauth_token = token;
  }

  // Merge extra params into signature computation (but they won't go in the header)
  const allSignatureParams: Record<string, string> = { ...oauthParams, ...extraParams };

  const paramString = Object.keys(allSignatureParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(allSignatureParams[k])}`)
    .join("&");

  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

  const signature = await hmacSha1(signingKey, baseString);
  oauthParams.oauth_signature = signature;

  const headerString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${headerString}`;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TwitterTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface TwitterUserResponse {
  data: {
    id: string;
    username: string;
    name: string;
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/twitter-oauth", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // -----------------------------------------------------------------------
    // OAuth 2.0 — Authorize (existing)
    // -----------------------------------------------------------------------
    if (path === "/authorize") {
      const companyId = url.searchParams.get("company_id");
      if (!companyId) {
        return jsonResponse({ error: "company_id is required" }, 400);
      }

      const clientId = Deno.env.get("TWITTER_CLIENT_ID");
      const redirectUri = "https://grayjackholdings.com/callback-twitter.html";

      const codeVerifier = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const codeChallenge = btoa(String.fromCharCode(...hashArray))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      const state = "st" + Math.random().toString(36).substring(2, 10);
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 5);

      const { error: stateError } = await supabase
        .from("oauth_states")
        .insert({
          company_id: companyId,
          state,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          platform: "twitter",
          expires_at: expiresAt.toISOString(),
        });

      if (stateError) {
        return jsonResponse({ error: "Failed to store OAuth state", details: stateError }, 500);
      }

      const authUrl = new URL("https://twitter.com/i/oauth2/authorize");
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", clientId!);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("scope", "tweet.read tweet.write users.read follows.read follows.write offline.access");
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");

      return jsonResponse({ authorization_url: authUrl.toString() });
    }

    // -----------------------------------------------------------------------
    // OAuth 2.0 — Callback (existing)
    // -----------------------------------------------------------------------
    if (path === "/callback" && req.method === "POST") {
      const { code, state } = await req.json();
      if (!code || !state) {
        return jsonResponse({ error: "code and state are required" }, 400);
      }

      const { data: oauthState, error: stateError } = await supabase
        .from("oauth_states")
        .select("*")
        .eq("state", state)
        .eq("platform", "twitter")
        .maybeSingle();

      if (stateError || !oauthState) {
        return jsonResponse({ error: "Invalid or expired state parameter" }, 400);
      }

      if (new Date(oauthState.expires_at) < new Date()) {
        await supabase.from("oauth_states").delete().eq("state", state);
        return jsonResponse({ error: "OAuth state has expired" }, 400);
      }

      const clientId = Deno.env.get("TWITTER_CLIENT_ID");
      const clientSecret = Deno.env.get("TWITTER_CLIENT_SECRET");

      const tokenResponse = await fetch("https://api.twitter.com/2/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
        body: new URLSearchParams({
          code,
          grant_type: "authorization_code",
          redirect_uri: oauthState.redirect_uri,
          code_verifier: oauthState.code_verifier,
        }),
      });

      await supabase.from("oauth_states").delete().eq("state", state);

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        return jsonResponse({ error: "Failed to exchange code for token", details: error }, 400);
      }

      const tokenData: TwitterTokenResponse = await tokenResponse.json();

      const userResponse = await fetch("https://api.twitter.com/2/users/me", {
        headers: { "Authorization": `Bearer ${tokenData.access_token}` },
      });

      if (!userResponse.ok) {
        return jsonResponse({ error: "Failed to fetch user data" }, 400);
      }

      const userData: TwitterUserResponse = await userResponse.json();

      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);

      const { error: upsertError } = await supabase
        .from("twitter_accounts")
        .upsert({
          company_id: oauthState.company_id,
          twitter_user_id: userData.data.id,
          username: userData.data.username,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || null,
          token_expires_at: expiresAt.toISOString(),
          is_active: true,
        }, { onConflict: "company_id" });

      if (upsertError) {
        return jsonResponse({ error: "Failed to save account", details: upsertError }, 500);
      }

      return jsonResponse({ success: true, username: userData.data.username });
    }

    // -----------------------------------------------------------------------
    // OAuth 1.0a — Authorize (NEW — for media posting)
    // -----------------------------------------------------------------------
    if (path === "/authorize-v1") {
      const companyId = url.searchParams.get("company_id");
      if (!companyId) {
        return jsonResponse({ error: "company_id is required" }, 400);
      }

      if (!OAUTH_CONSUMER_KEY || !OAUTH_CONSUMER_SECRET) {
        return jsonResponse({
          error: "Twitter OAuth 1.0a credentials not configured",
          details: "TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET must be set"
        }, 500);
      }

      const callbackUrl = "https://grayjackholdings.com/callback-twitter-v1.html";
      const requestTokenUrl = "https://api.twitter.com/oauth/request_token";

      // Sign the request with oauth_callback included in signature
      const oauth1Header = await generateOAuth1Header(
        "POST",
        requestTokenUrl,
        OAUTH_CONSUMER_KEY,
        OAUTH_CONSUMER_SECRET,
        "",  // no token secret yet
        "",  // no token yet
        { oauth_callback: callbackUrl },
      );

      const rtResponse = await fetch(requestTokenUrl, {
        method: "POST",
        headers: { "Authorization": oauth1Header },
      });

      if (!rtResponse.ok) {
        const error = await rtResponse.text();
        return jsonResponse({
          error: "Failed to get request token",
          details: error,
          status: rtResponse.status,
          debug: {
            has_consumer_key: !!OAUTH_CONSUMER_KEY,
            has_consumer_secret: !!OAUTH_CONSUMER_SECRET,
            consumer_key_length: OAUTH_CONSUMER_KEY?.length || 0,
            consumer_secret_length: OAUTH_CONSUMER_SECRET?.length || 0,
            consumer_key_first_4: OAUTH_CONSUMER_KEY?.substring(0, 4),
            consumer_secret_first_4: OAUTH_CONSUMER_SECRET?.substring(0, 4),
            authorization_header_preview: oauth1Header.substring(0, 150),
            callback_url: callbackUrl,
            request_url: requestTokenUrl
          }
        }, 400);
      }

      const rtBody = await rtResponse.text();
      const rtParams = new URLSearchParams(rtBody);
      const oauthToken = rtParams.get("oauth_token");
      const oauthTokenSecret = rtParams.get("oauth_token_secret");

      if (!oauthToken || !oauthTokenSecret) {
        return jsonResponse({ error: "Invalid request token response", details: rtBody }, 400);
      }

      // Store in oauth_states: state = oauth_token, code_verifier = oauth_token_secret
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      const { error: stateError } = await supabase
        .from("oauth_states")
        .insert({
          company_id: companyId,
          state: oauthToken,
          code_verifier: oauthTokenSecret,
          redirect_uri: callbackUrl,
          platform: "twitter_v1",
          expires_at: expiresAt.toISOString(),
        });

      if (stateError) {
        return jsonResponse({ error: "Failed to store OAuth state", details: stateError }, 500);
      }

      const authUrl = `https://api.twitter.com/oauth/authorize?oauth_token=${oauthToken}`;
      return jsonResponse({ authorization_url: authUrl });
    }

    // -----------------------------------------------------------------------
    // OAuth 1.0a — Callback (NEW — for media posting)
    // -----------------------------------------------------------------------
    if (path === "/callback-v1" && req.method === "POST") {
      const { oauth_token, oauth_verifier } = await req.json();

      if (!oauth_token || !oauth_verifier) {
        return jsonResponse({ error: "oauth_token and oauth_verifier are required" }, 400);
      }

      // Look up the request token state
      const { data: oauthState, error: stateError } = await supabase
        .from("oauth_states")
        .select("*")
        .eq("state", oauth_token)
        .eq("platform", "twitter_v1")
        .maybeSingle();

      if (stateError || !oauthState) {
        return jsonResponse({ error: "Invalid or expired OAuth token" }, 400);
      }

      if (new Date(oauthState.expires_at) < new Date()) {
        await supabase.from("oauth_states").delete().eq("state", oauth_token);
        return jsonResponse({ error: "OAuth state has expired" }, 400);
      }

      const requestTokenSecret = oauthState.code_verifier;  // stored here during /authorize-v1
      const companyId = oauthState.company_id;

      // Exchange request token + verifier for access token
      const accessTokenUrl = "https://api.twitter.com/oauth/access_token";
      const oauth1Header = await generateOAuth1Header(
        "POST",
        accessTokenUrl,
        OAUTH_CONSUMER_KEY,
        OAUTH_CONSUMER_SECRET,
        requestTokenSecret,
        oauth_token,
        { oauth_verifier },  // included in signature
      );

      const atResponse = await fetch(accessTokenUrl, {
        method: "POST",
        headers: {
          "Authorization": oauth1Header,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ oauth_verifier }),
      });

      // Clean up state
      await supabase.from("oauth_states").delete().eq("state", oauth_token);

      if (!atResponse.ok) {
        const error = await atResponse.text();
        return jsonResponse({ error: "Failed to exchange for access token", details: error }, 400);
      }

      const atBody = await atResponse.text();
      const atParams = new URLSearchParams(atBody);
      const accessToken = atParams.get("oauth_token");
      const accessTokenSecret = atParams.get("oauth_token_secret");
      const screenName = atParams.get("screen_name");

      if (!accessToken || !accessTokenSecret) {
        return jsonResponse({ error: "Invalid access token response", details: atBody }, 400);
      }

      // Check that the company already has a twitter_accounts row (from OAuth 2.0)
      const { data: existingAccount } = await supabase
        .from("twitter_accounts")
        .select("id")
        .eq("company_id", companyId)
        .maybeSingle();

      if (!existingAccount) {
        return jsonResponse({
          error: "No Twitter account found for this company. Please connect via OAuth 2.0 first (Connect Twitter button), then add media posting."
        }, 400);
      }

      // Store the OAuth 1.0a tokens
      const { error: updateError } = await supabase
        .from("twitter_accounts")
        .update({
          oauth1_access_token: accessToken,
          oauth1_access_token_secret: accessTokenSecret,
        })
        .eq("company_id", companyId);

      if (updateError) {
        return jsonResponse({ error: "Failed to save OAuth 1.0a tokens", details: updateError }, 500);
      }

      return jsonResponse({ success: true, username: screenName || "unknown" });
    }

    // -----------------------------------------------------------------------
    // Post Tweet (with per-company OAuth 1.0a for media)
    // -----------------------------------------------------------------------
    if (path === "/post" && req.method === "POST") {
      const contentType = req.headers.get("content-type") || "";
      let company_id: string;
      let text: string;
      let mediaFiles: File[] = [];

      if (contentType.includes("multipart/form-data")) {
        const formData = await req.formData();
        company_id = formData.get("company_id") as string;
        text = formData.get("text") as string;
        const media = formData.getAll("media");
        mediaFiles = media.filter((m): m is File => m instanceof File);
      } else {
        const body = await req.json();
        company_id = body.company_id;
        text = body.text;
      }

      if (!company_id || !text) {
        return jsonResponse({ error: "company_id and text are required" }, 400);
      }

      const { data: account, error: fetchError } = await supabase
        .from("twitter_accounts")
        .select("*")
        .eq("company_id", company_id)
        .eq("is_active", true)
        .maybeSingle();

      if (fetchError || !account) {
        return jsonResponse({ error: "No active Twitter account found for this company" }, 404);
      }

      // --- Media upload (OAuth 1.0a, per-company tokens) ---
      const mediaIds: string[] = [];

      if (mediaFiles.length > 0) {
        // Require per-company OAuth 1.0a tokens for media
        const oauth1Token = account.oauth1_access_token;
        const oauth1Secret = account.oauth1_access_token_secret;

        if (!oauth1Token || !oauth1Secret) {
          return jsonResponse({
            error: "Media posting requires OAuth 1.0a authorization. Use /authorize-v1 to connect media posting for this company."
          }, 400);
        }

        for (const file of mediaFiles) {
          const arrayBuffer = await file.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          // Convert to base64 in 8KB chunks to avoid stack overflow on large files
          let binaryString = "";
          const chunkSize = 8192;
          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.subarray(i, i + chunkSize);
            binaryString += String.fromCharCode(...chunk);
          }
          const base64Data = btoa(binaryString);

          const uploadFormData = new FormData();
          uploadFormData.append("media_data", base64Data);

          const mediaUploadUrl = "https://upload.twitter.com/1.1/media/upload.json";
          const uploadAuth = await generateOAuth1Header(
            "POST",
            mediaUploadUrl,
            OAUTH_CONSUMER_KEY,
            OAUTH_CONSUMER_SECRET,
            oauth1Secret,
            oauth1Token,
          );

          const uploadResponse = await fetch(mediaUploadUrl, {
            method: "POST",
            headers: { "Authorization": uploadAuth },
            body: uploadFormData,
          });

          if (!uploadResponse.ok) {
            const error = await uploadResponse.text();
            return jsonResponse({
              error: "Failed to upload media",
              details: error,
              status_code: uploadResponse.status,
            }, 400);
          }

          const uploadData = await uploadResponse.json();
          mediaIds.push(uploadData.media_id_string);
        }
      }

      // --- Post tweet ---
      const tweetBody: { text: string; media?: { media_ids: string[] } } = { text };
      if (mediaIds.length > 0) {
        tweetBody.media = { media_ids: mediaIds };
      }

      // Media tweets: OAuth 1.0a (same auth context as upload)
      // Text-only tweets: OAuth 2.0 Bearer (per-company token)
      let tweetAuthHeader: string;
      if (mediaIds.length > 0) {
        tweetAuthHeader = await generateOAuth1Header(
          "POST",
          "https://api.twitter.com/2/tweets",
          OAUTH_CONSUMER_KEY,
          OAUTH_CONSUMER_SECRET,
          account.oauth1_access_token_secret,
          account.oauth1_access_token,
        );
      } else {
        tweetAuthHeader = `Bearer ${account.access_token}`;
      }

      const postResponse = await fetch("https://api.twitter.com/2/tweets", {
        method: "POST",
        headers: {
          "Authorization": tweetAuthHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tweetBody),
      });

      if (!postResponse.ok) {
        const error = await postResponse.text();
        return jsonResponse({ error: "Failed to post tweet", details: error }, 400);
      }

      const postData = await postResponse.json();

      return jsonResponse({
        success: true,
        tweet_id: postData.data.id,
        text: postData.data.text,
      });
    }

    return jsonResponse({ error: "Not found" }, 404);

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
