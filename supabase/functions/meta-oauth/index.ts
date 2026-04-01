import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const META_APP_ID = Deno.env.get("META_APP_ID") || "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") || "";
const GRAPH_API_VERSION = "v22.0";
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

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
    const path = url.pathname.replace("/meta-oauth", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // -----------------------------------------------------------------------
    // Authorize — redirect user to Facebook Login
    // -----------------------------------------------------------------------
    if (path === "/authorize") {
      const companyId = url.searchParams.get("company_id");
      const origin = url.searchParams.get("origin") || "https://grayjackholdings.com";

      if (!companyId) {
        return jsonResponse({ error: "company_id is required" }, 400);
      }

      if (!META_APP_ID || !META_APP_SECRET) {
        return jsonResponse({
          error: "Meta app credentials not configured",
        }, 500);
      }

      const redirectUri = `${origin}/callback-meta.html`;
      const state = `meta_${companyId}_${Math.random().toString(36).substring(2, 10)}`;

      // Store state for validation
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      const { error: stateError } = await supabase
        .from("oauth_states")
        .insert({
          company_id: companyId,
          state,
          code_verifier: "", // not used for Meta OAuth
          redirect_uri: redirectUri,
          platform: "meta",
          expires_at: expiresAt.toISOString(),
        });

      if (stateError) {
        return jsonResponse({ error: "Failed to store OAuth state", details: stateError }, 500);
      }

      const scopes = [
        "pages_manage_posts",
        "pages_read_engagement",
        "pages_show_list",
        "instagram_basic",
        "instagram_content_publish",
      ].join(",");

      const authUrl = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`
        + `?client_id=${META_APP_ID}`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}`
        + `&scope=${scopes}`
        + `&state=${state}`
        + `&response_type=code`;

      return jsonResponse({ authorization_url: authUrl });
    }

    // -----------------------------------------------------------------------
    // Callback — exchange code for tokens, get Page + IG info
    // -----------------------------------------------------------------------
    if (path === "/callback" && req.method === "POST") {
      const { code, state, page_id: selectedPageId } = await req.json();

      if (!code || !state) {
        return jsonResponse({ error: "code and state are required" }, 400);
      }

      // Validate state
      const { data: oauthState, error: stateError } = await supabase
        .from("oauth_states")
        .select("*")
        .eq("state", state)
        .eq("platform", "meta")
        .maybeSingle();

      if (stateError || !oauthState) {
        return jsonResponse({ error: "Invalid or expired state parameter" }, 400);
      }

      if (new Date(oauthState.expires_at) < new Date()) {
        await supabase.from("oauth_states").delete().eq("state", state);
        return jsonResponse({ error: "OAuth state has expired" }, 400);
      }

      const companyId = oauthState.company_id;
      const redirectUri = oauthState.redirect_uri;

      // Clean up state
      await supabase.from("oauth_states").delete().eq("state", state);

      // Step 1: Exchange code for short-lived user token
      const tokenRes = await fetch(
        `${GRAPH_URL}/oauth/access_token`
        + `?client_id=${META_APP_ID}`
        + `&client_secret=${META_APP_SECRET}`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}`
        + `&code=${code}`
      );

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        return jsonResponse({ error: "Failed to exchange code for token", details: err }, 400);
      }

      const tokenData = await tokenRes.json();
      const shortLivedToken = tokenData.access_token;

      // Step 2: Exchange for long-lived user token (60 days)
      const longTokenRes = await fetch(
        `${GRAPH_URL}/oauth/access_token`
        + `?grant_type=fb_exchange_token`
        + `&client_id=${META_APP_ID}`
        + `&client_secret=${META_APP_SECRET}`
        + `&fb_exchange_token=${shortLivedToken}`
      );

      if (!longTokenRes.ok) {
        const err = await longTokenRes.text();
        return jsonResponse({ error: "Failed to get long-lived token", details: err }, 400);
      }

      const longTokenData = await longTokenRes.json();
      const longLivedUserToken = longTokenData.access_token;

      // Step 3: Get user's Pages (returns Page Access Tokens that never expire)
      const pagesRes = await fetch(
        `${GRAPH_URL}/me/accounts?access_token=${longLivedUserToken}`
      );

      if (!pagesRes.ok) {
        const err = await pagesRes.text();
        return jsonResponse({ error: "Failed to fetch pages", details: err }, 400);
      }

      const pagesData = await pagesRes.json();
      const pages = pagesData.data || [];

      if (pages.length === 0) {
        return jsonResponse({ error: "No Facebook Pages found for this account" }, 400);
      }

      // If multiple pages and no selection made, store token and return list
      if (pages.length > 1 && !selectedPageId) {
        // Store the user token temporarily so we can use it when the user picks a page
        const selectionKey = "sel_" + Math.random().toString(36).substring(2, 12);
        const selExpires = new Date();
        selExpires.setMinutes(selExpires.getMinutes() + 10);

        await supabase.from("oauth_states").insert({
          company_id: companyId,
          state: selectionKey,
          code_verifier: longLivedUserToken, // store user token here temporarily
          redirect_uri: "",
          platform: "meta_selection",
          expires_at: selExpires.toISOString(),
        });

        return jsonResponse({
          needs_page_selection: true,
          pages: pages.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })),
          selection_key: selectionKey,
        });
      }

      // If page was selected via selection_key, retrieve the user token
      // (selectedPageId means the user picked a page from the selector)

      // Use selected page, or first page if only one
      const page = selectedPageId
        ? pages.find((p: { id: string }) => p.id === selectedPageId) || pages[0]
        : pages[0];
      const pageId = page.id;
      const pageName = page.name;
      const pageAccessToken = page.access_token;

      // Step 4: Get Instagram Business Account linked to this Page
      const igRes = await fetch(
        `${GRAPH_URL}/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
      );

      let igBusinessAccountId: string | null = null;
      let igUsername: string | null = null;

      if (igRes.ok) {
        const igData = await igRes.json();
        if (igData.instagram_business_account) {
          igBusinessAccountId = igData.instagram_business_account.id;

          // Get IG username
          const igUserRes = await fetch(
            `${GRAPH_URL}/${igBusinessAccountId}?fields=username&access_token=${pageAccessToken}`
          );
          if (igUserRes.ok) {
            const igUserData = await igUserRes.json();
            igUsername = igUserData.username || null;
          }
        }
      }

      // Step 5: Store in database
      const { error: upsertError } = await supabase
        .from("meta_accounts")
        .upsert({
          company_id: companyId,
          facebook_page_id: pageId,
          facebook_page_name: pageName,
          instagram_business_account_id: igBusinessAccountId,
          instagram_username: igUsername,
          page_access_token: pageAccessToken,
          is_active: true,
        }, { onConflict: "company_id" });

      if (upsertError) {
        return jsonResponse({ error: "Failed to save account", details: upsertError }, 500);
      }

      return jsonResponse({
        success: true,
        facebook_page: pageName,
        instagram_username: igUsername || "Not linked",
        pages_available: pages.map((p: { id: string; name: string }) => ({
          id: p.id,
          name: p.name,
        })),
      });
    }

    // -----------------------------------------------------------------------
    // Select Page — complete connection after user picks a page
    // -----------------------------------------------------------------------
    if (path === "/select-page" && req.method === "POST") {
      const { selection_key, page_id } = await req.json();

      if (!selection_key || !page_id) {
        return jsonResponse({ error: "selection_key and page_id are required" }, 400);
      }

      // Retrieve the stored user token
      const { data: selState, error: selError } = await supabase
        .from("oauth_states")
        .select("*")
        .eq("state", selection_key)
        .eq("platform", "meta_selection")
        .maybeSingle();

      if (selError || !selState) {
        return jsonResponse({ error: "Invalid or expired selection key" }, 400);
      }

      if (new Date(selState.expires_at) < new Date()) {
        await supabase.from("oauth_states").delete().eq("state", selection_key);
        return jsonResponse({ error: "Selection expired. Please reconnect." }, 400);
      }

      const userToken = selState.code_verifier; // stored here during callback
      const companyId = selState.company_id;

      // Clean up
      await supabase.from("oauth_states").delete().eq("state", selection_key);

      // Get the page's access token from the user token
      const pagesRes = await fetch(
        `${GRAPH_URL}/me/accounts?access_token=${userToken}`
      );

      if (!pagesRes.ok) {
        return jsonResponse({ error: "Failed to fetch pages with stored token" }, 400);
      }

      const pagesData = await pagesRes.json();
      const page = (pagesData.data || []).find((p: { id: string }) => p.id === page_id);

      if (!page) {
        return jsonResponse({ error: "Selected page not found" }, 400);
      }

      const pageAccessToken = page.access_token;

      // Get Instagram Business Account
      const igRes = await fetch(
        `${GRAPH_URL}/${page_id}?fields=instagram_business_account&access_token=${pageAccessToken}`
      );

      let igBusinessAccountId: string | null = null;
      let igUsername: string | null = null;

      if (igRes.ok) {
        const igData = await igRes.json();
        if (igData.instagram_business_account) {
          igBusinessAccountId = igData.instagram_business_account.id;
          const igUserRes = await fetch(
            `${GRAPH_URL}/${igBusinessAccountId}?fields=username&access_token=${pageAccessToken}`
          );
          if (igUserRes.ok) {
            const igUserData = await igUserRes.json();
            igUsername = igUserData.username || null;
          }
        }
      }

      // Save
      const { error: upsertError } = await supabase
        .from("meta_accounts")
        .upsert({
          company_id: companyId,
          facebook_page_id: page_id,
          facebook_page_name: page.name,
          instagram_business_account_id: igBusinessAccountId,
          instagram_username: igUsername,
          page_access_token: pageAccessToken,
          is_active: true,
        }, { onConflict: "company_id" });

      if (upsertError) {
        return jsonResponse({ error: "Failed to save account", details: upsertError }, 500);
      }

      return jsonResponse({
        success: true,
        facebook_page: page.name,
        instagram_username: igUsername || "Not linked",
      });
    }

    // -----------------------------------------------------------------------
    // Post to Facebook Page
    // -----------------------------------------------------------------------
    if (path === "/post-facebook" && req.method === "POST") {
      const { company_id, text, image_url } = await req.json();

      if (!company_id || !text) {
        return jsonResponse({ error: "company_id and text are required" }, 400);
      }

      const { data: account, error: fetchError } = await supabase
        .from("meta_accounts")
        .select("*")
        .eq("company_id", company_id)
        .eq("is_active", true)
        .maybeSingle();

      if (fetchError || !account) {
        return jsonResponse({ error: "No active Meta account found for this company" }, 404);
      }

      let postRes: Response;

      if (image_url) {
        // Photo post
        postRes = await fetch(
          `${GRAPH_URL}/${account.facebook_page_id}/photos`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: image_url,
              caption: text,
              access_token: account.page_access_token,
            }),
          }
        );
      } else {
        // Text-only post
        postRes = await fetch(
          `${GRAPH_URL}/${account.facebook_page_id}/feed`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: text,
              access_token: account.page_access_token,
            }),
          }
        );
      }

      if (!postRes.ok) {
        const err = await postRes.text();
        return jsonResponse({ error: "Failed to post to Facebook", details: err }, 400);
      }

      const postData = await postRes.json();

      return jsonResponse({
        success: true,
        post_id: postData.id || postData.post_id,
      });
    }

    // -----------------------------------------------------------------------
    // Post to Instagram (two-step: create container, then publish)
    // -----------------------------------------------------------------------
    if (path === "/post-instagram" && req.method === "POST") {
      const { company_id, caption, image_url } = await req.json();

      if (!company_id || !caption || !image_url) {
        return jsonResponse({
          error: "company_id, caption, and image_url are required (Instagram requires an image)",
        }, 400);
      }

      const { data: account, error: fetchError } = await supabase
        .from("meta_accounts")
        .select("*")
        .eq("company_id", company_id)
        .eq("is_active", true)
        .maybeSingle();

      if (fetchError || !account) {
        return jsonResponse({ error: "No active Meta account found for this company" }, 404);
      }

      if (!account.instagram_business_account_id) {
        return jsonResponse({
          error: "No Instagram Business account linked to this Facebook Page",
        }, 400);
      }

      // Step 1: Create media container
      const containerRes = await fetch(
        `${GRAPH_URL}/${account.instagram_business_account_id}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_url,
            caption,
            access_token: account.page_access_token,
          }),
        }
      );

      if (!containerRes.ok) {
        const err = await containerRes.text();
        return jsonResponse({ error: "Failed to create Instagram media container", details: err }, 400);
      }

      const containerData = await containerRes.json();
      const creationId = containerData.id;

      // Brief wait for Instagram to process the image
      await new Promise((r) => setTimeout(r, 3000));

      // Step 2: Publish
      const publishRes = await fetch(
        `${GRAPH_URL}/${account.instagram_business_account_id}/media_publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creation_id: creationId,
            access_token: account.page_access_token,
          }),
        }
      );

      if (!publishRes.ok) {
        const err = await publishRes.text();
        return jsonResponse({ error: "Failed to publish Instagram post", details: err }, 400);
      }

      const publishData = await publishRes.json();

      return jsonResponse({
        success: true,
        media_id: publishData.id,
      });
    }

    // -----------------------------------------------------------------------
    // Reply to a Facebook comment
    // -----------------------------------------------------------------------
    if (path === "/reply-facebook" && req.method === "POST") {
      const { company_id, text, comment_id } = await req.json();

      if (!company_id || !text || !comment_id) {
        return jsonResponse({ error: "company_id, text, and comment_id are required" }, 400);
      }

      const { data: account, error: fetchError } = await supabase
        .from("meta_accounts")
        .select("*")
        .eq("company_id", company_id)
        .eq("is_active", true)
        .maybeSingle();

      if (fetchError || !account) {
        return jsonResponse({ error: "No active Meta account found" }, 404);
      }

      const replyRes = await fetch(
        `${GRAPH_URL}/${comment_id}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            access_token: account.page_access_token,
          }),
        }
      );

      if (!replyRes.ok) {
        const err = await replyRes.text();
        return jsonResponse({ error: "Failed to reply to Facebook comment", details: err }, 400);
      }

      const replyData = await replyRes.json();
      return jsonResponse({ success: true, comment_id: replyData.id });
    }

    // -----------------------------------------------------------------------
    // Reply to an Instagram comment
    // -----------------------------------------------------------------------
    if (path === "/reply-instagram" && req.method === "POST") {
      const { company_id, text, comment_id, media_id } = await req.json();

      if (!company_id || !text || !media_id) {
        return jsonResponse({ error: "company_id, text, and media_id are required" }, 400);
      }

      const { data: account, error: fetchError } = await supabase
        .from("meta_accounts")
        .select("*")
        .eq("company_id", company_id)
        .eq("is_active", true)
        .maybeSingle();

      if (fetchError || !account) {
        return jsonResponse({ error: "No active Meta account found" }, 404);
      }

      const replyRes = await fetch(
        `${GRAPH_URL}/${media_id}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            access_token: account.page_access_token,
          }),
        }
      );

      if (!replyRes.ok) {
        const err = await replyRes.text();
        return jsonResponse({ error: "Failed to reply to Instagram comment", details: err }, 400);
      }

      const replyData = await replyRes.json();
      return jsonResponse({ success: true, comment_id: replyData.id });
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
