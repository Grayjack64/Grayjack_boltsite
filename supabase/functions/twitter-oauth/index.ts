import { createClient } from "npm:@supabase/supabase-js@2";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/twitter-oauth", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (path === "/authorize") {
      const companyId = url.searchParams.get("company_id");

      if (!companyId) {
        return new Response(
          JSON.stringify({ error: "company_id is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const clientId = Deno.env.get("TWITTER_CLIENT_ID");
      const redirectUri = "https://grayjackholdings.com/callback-twitter.html";

      // Generate a random code verifier (43-128 characters)
      const codeVerifier = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // Create SHA-256 hash of the code verifier
      const encoder = new TextEncoder();
      const data = encoder.encode(codeVerifier);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const codeChallenge = btoa(String.fromCharCode(...hashArray))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      // Generate a very simple state parameter (Twitter has known bugs with complex state values)
      const state = "st" + Math.random().toString(36).substring(2, 10);

      // Store state and code_verifier in database
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
        return new Response(
          JSON.stringify({ error: "Failed to store OAuth state", details: stateError }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const authUrl = new URL("https://twitter.com/i/oauth2/authorize");
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", clientId!);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("scope", "tweet.read tweet.write users.read follows.read follows.write offline.access");
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");

      return new Response(
        JSON.stringify({ authorization_url: authUrl.toString() }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (path === "/callback" && req.method === "POST") {
      const { code, state } = await req.json();

      if (!code || !state) {
        return new Response(
          JSON.stringify({ error: "code and state are required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Retrieve state from database
      const { data: oauthState, error: stateError } = await supabase
        .from("oauth_states")
        .select("*")
        .eq("state", state)
        .eq("platform", "twitter")
        .maybeSingle();

      if (stateError || !oauthState) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired state parameter" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Check if state has expired
      if (new Date(oauthState.expires_at) < new Date()) {
        await supabase.from("oauth_states").delete().eq("state", state);
        return new Response(
          JSON.stringify({ error: "OAuth state has expired" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const clientId = Deno.env.get("TWITTER_CLIENT_ID");
      const clientSecret = Deno.env.get("TWITTER_CLIENT_SECRET");
      const redirectUri = oauthState.redirect_uri;
      const codeVerifier = oauthState.code_verifier;
      const companyId = oauthState.company_id;

      const tokenResponse = await fetch("https://api.twitter.com/2/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
        body: new URLSearchParams({
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });

      // Delete the used state
      await supabase.from("oauth_states").delete().eq("state", state);

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        return new Response(
          JSON.stringify({ error: "Failed to exchange code for token", details: error }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const tokenData: TwitterTokenResponse = await tokenResponse.json();

      const userResponse = await fetch("https://api.twitter.com/2/users/me", {
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`,
        },
      });

      if (!userResponse.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to fetch user data" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const userData: TwitterUserResponse = await userResponse.json();

      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);

      const { error: upsertError } = await supabase
        .from("twitter_accounts")
        .upsert({
          company_id: companyId,
          twitter_user_id: userData.data.id,
          username: userData.data.username,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || null,
          token_expires_at: expiresAt.toISOString(),
          is_active: true,
        }, {
          onConflict: "company_id",
        });

      if (upsertError) {
        return new Response(
          JSON.stringify({ error: "Failed to save account", details: upsertError }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          username: userData.data.username,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

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
        return new Response(
          JSON.stringify({ error: "company_id and text are required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { data: account, error: fetchError } = await supabase
        .from("twitter_accounts")
        .select("*")
        .eq("company_id", company_id)
        .eq("is_active", true)
        .maybeSingle();

      if (fetchError || !account) {
        return new Response(
          JSON.stringify({ error: "No active Twitter account found for this company" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const mediaIds: string[] = [];

      if (mediaFiles.length > 0) {
        for (const file of mediaFiles) {
          // Step 1: Initialize upload via v2 media endpoint
          const initResponse = await fetch("https://api.twitter.com/2/media/upload/initialize", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${account.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              media_type: file.type || "image/png",
              total_bytes: file.size,
              media_category: "tweet_image",
            }),
          });

          if (!initResponse.ok) {
            const error = await initResponse.text();
            return new Response(
              JSON.stringify({ error: "Failed to initialize media upload", details: error, status_code: initResponse.status }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          const initData = await initResponse.json();
          const mediaId = initData.id || initData.media_id_string;

          // Step 2: Append the file data
          const arrayBuffer = await file.arrayBuffer();
          const appendFormData = new FormData();
          appendFormData.append("media_data", new Blob([arrayBuffer], { type: file.type || "image/png" }), file.name);

          const appendResponse = await fetch(`https://api.twitter.com/2/media/upload/${mediaId}/append`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${account.access_token}`,
            },
            body: appendFormData,
          });

          if (!appendResponse.ok) {
            const error = await appendResponse.text();
            return new Response(
              JSON.stringify({ error: "Failed to append media data", details: error, status_code: appendResponse.status }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          // Step 3: Finalize the upload
          const finalizeResponse = await fetch(`https://api.twitter.com/2/media/upload/${mediaId}/finalize`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${account.access_token}`,
            },
          });

          if (!finalizeResponse.ok) {
            const error = await finalizeResponse.text();
            return new Response(
              JSON.stringify({ error: "Failed to finalize media upload", details: error, status_code: finalizeResponse.status }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          mediaIds.push(mediaId);
        }
      }

      const tweetBody: { text: string; media?: { media_ids: string[] } } = { text };
      if (mediaIds.length > 0) {
        tweetBody.media = { media_ids: mediaIds };
      }

      const postResponse = await fetch("https://api.twitter.com/2/tweets", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${account.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tweetBody),
      });

      if (!postResponse.ok) {
        const error = await postResponse.text();
        return new Response(
          JSON.stringify({ error: "Failed to post tweet", details: error }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const postData = await postResponse.json();

      return new Response(
        JSON.stringify({
          success: true,
          tweet_id: postData.data.id,
          text: postData.data.text,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: "Not found" }),
      {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

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