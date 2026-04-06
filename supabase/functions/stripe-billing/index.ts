/**
 * Stripe Billing Edge Function
 *
 * Handles checkout session creation and customer portal access.
 * Requires STRIPE_SECRET_KEY and STRIPE_PRICE_* env vars.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_API = "https://api.stripe.com/v1";

// Price IDs — set these in Supabase Edge Function secrets after creating products in Stripe
const PRICE_IDS: Record<string, string> = {
  growth: Deno.env.get("STRIPE_PRICE_GROWTH") || "",
  pro: Deno.env.get("STRIPE_PRICE_PRO") || "",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function stripeRequest(endpoint: string, params: Record<string, string>, method = "POST") {
  const res = await fetch(`${STRIPE_API}${endpoint}`, {
    method,
    headers: {
      "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" ? undefined : new URLSearchParams(params).toString(),
  });
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/stripe-billing", "");
    const { org_id, return_url, tier } = await req.json().catch(() => ({}));

    if (!STRIPE_SECRET_KEY) {
      return jsonResponse({ error: "Stripe not configured" }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // -----------------------------------------------------------------------
    // Create Checkout Session — for new subscriptions or upgrades
    // -----------------------------------------------------------------------
    if (path === "/checkout") {
      if (!org_id || !tier || !return_url) {
        return jsonResponse({ error: "org_id, tier, and return_url are required" }, 400);
      }

      const priceId = PRICE_IDS[tier];
      if (!priceId) {
        return jsonResponse({ error: `No price configured for tier: ${tier}` }, 400);
      }

      // Get org to check for existing Stripe customer
      const { data: org } = await supabase
        .from("organizations")
        .select("stripe_customer_id, name, owner_user_id")
        .eq("id", org_id)
        .single();

      if (!org) return jsonResponse({ error: "Organization not found" }, 404);

      // Get owner email
      const { data: { user: owner } } = await supabase.auth.admin.getUserById(org.owner_user_id);
      const email = owner?.email || "";

      let customerId = org.stripe_customer_id;

      // Create Stripe customer if none exists
      if (!customerId) {
        const customer = await stripeRequest("/customers", {
          email,
          name: org.name,
          "metadata[org_id]": org_id,
        });
        customerId = customer.id;

        // Save customer ID
        await supabase.from("organizations").update({ stripe_customer_id: customerId }).eq("id", org_id);
      }

      // Create checkout session
      const session = await stripeRequest("/checkout/sessions", {
        customer: customerId,
        mode: "subscription",
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        success_url: `${return_url}?session_id={CHECKOUT_SESSION_ID}&success=true`,
        cancel_url: `${return_url}?canceled=true`,
        "subscription_data[metadata][org_id]": org_id,
        "subscription_data[metadata][tier]": tier,
      });

      if (session.error) {
        return jsonResponse({ error: session.error.message }, 400);
      }

      return jsonResponse({ checkout_url: session.url, session_id: session.id });
    }

    // -----------------------------------------------------------------------
    // Customer Portal — for managing existing subscription
    // -----------------------------------------------------------------------
    if (path === "/portal") {
      if (!org_id || !return_url) {
        return jsonResponse({ error: "org_id and return_url are required" }, 400);
      }

      const { data: org } = await supabase
        .from("organizations")
        .select("stripe_customer_id")
        .eq("id", org_id)
        .single();

      if (!org?.stripe_customer_id) {
        return jsonResponse({ error: "No billing account found. Subscribe first." }, 400);
      }

      const session = await stripeRequest("/billing_portal/sessions", {
        customer: org.stripe_customer_id,
        return_url,
      });

      if (session.error) {
        return jsonResponse({ error: session.error.message }, 400);
      }

      return jsonResponse({ portal_url: session.url });
    }

    return jsonResponse({ error: "Not found" }, 404);

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
});
