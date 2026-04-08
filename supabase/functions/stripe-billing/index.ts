/**
 * Stripe Billing Edge Function
 *
 * Handles checkout session creation, customer portal, and video credit purchases.
 * Supports per-company pricing with base subscription + extra company add-ons.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_API = "https://api.stripe.com/v1";

// Base subscription prices
const PRICE_IDS: Record<string, string> = {
  growth: Deno.env.get("STRIPE_PRICE_GROWTH") || "",
  pro: Deno.env.get("STRIPE_PRICE_PRO") || "",
};

// Extra company prices
const EXTRA_COMPANY_PRICES: Record<string, string> = {
  growth: Deno.env.get("STRIPE_PRICE_GROWTH_EXTRA_COMPANY") || "",
  pro: Deno.env.get("STRIPE_PRICE_PRO_EXTRA_COMPANY") || "",
};

// Video credit prices
const VIDEO_CREDIT_PRICES: Record<string, string> = {
  growth_single: Deno.env.get("STRIPE_PRICE_VIDEO_CREDIT_GROWTH") || "",
  pro_single: Deno.env.get("STRIPE_PRICE_VIDEO_CREDIT_PRO") || "",
  growth_10pack: Deno.env.get("STRIPE_PRICE_VIDEO_10PACK_GROWTH") || "",
  pro_10pack: Deno.env.get("STRIPE_PRICE_VIDEO_10PACK_PRO") || "",
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
    const body = await req.json().catch(() => ({}));

    if (!STRIPE_SECRET_KEY) {
      return jsonResponse({ error: "Stripe not configured" }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // -----------------------------------------------------------------------
    // Create Checkout Session — base subscription + extra companies
    // -----------------------------------------------------------------------
    if (path === "/checkout") {
      const { org_id, tier, return_url } = body;
      if (!org_id || !tier || !return_url) {
        return jsonResponse({ error: "org_id, tier, and return_url are required" }, 400);
      }

      const basePriceId = PRICE_IDS[tier];
      if (!basePriceId) {
        return jsonResponse({ error: `No price configured for tier: ${tier}` }, 400);
      }

      // Get org details
      const { data: org } = await supabase
        .from("organizations")
        .select("stripe_customer_id, name, owner_user_id")
        .eq("id", org_id)
        .single();

      if (!org) return jsonResponse({ error: "Organization not found" }, 404);

      // Count companies in this org (beyond the 1st included)
      const { count: companyCount } = await supabase
        .from("companies")
        .select("id", { count: "exact", head: true })
        .eq("org_id", org_id);

      const extraCompanies = Math.max(0, (companyCount || 1) - 1);

      // Get owner email
      const { data: { user: owner } } = await supabase.auth.admin.getUserById(org.owner_user_id);
      const email = owner?.email || "";

      let customerId = org.stripe_customer_id;
      if (!customerId) {
        const customer = await stripeRequest("/customers", {
          email,
          name: org.name,
          "metadata[org_id]": org_id,
        });
        customerId = customer.id;
        await supabase.from("organizations").update({ stripe_customer_id: customerId }).eq("id", org_id);
      }

      // Build line items: base price + extra companies
      const lineItems: Record<string, string> = {
        "line_items[0][price]": basePriceId,
        "line_items[0][quantity]": "1",
      };

      const extraCompanyPrice = EXTRA_COMPANY_PRICES[tier];
      if (extraCompanies > 0 && extraCompanyPrice) {
        lineItems["line_items[1][price]"] = extraCompanyPrice;
        lineItems["line_items[1][quantity]"] = String(extraCompanies);
      }

      const session = await stripeRequest("/checkout/sessions", {
        customer: customerId,
        mode: "subscription",
        ...lineItems,
        success_url: `${return_url}?session_id={CHECKOUT_SESSION_ID}&success=true`,
        cancel_url: `${return_url}?canceled=true`,
        "subscription_data[metadata][org_id]": org_id,
        "subscription_data[metadata][tier]": tier,
        "subscription_data[metadata][extra_companies]": String(extraCompanies),
      });

      if (session.error) {
        return jsonResponse({ error: session.error.message }, 400);
      }

      return jsonResponse({
        checkout_url: session.url,
        session_id: session.id,
        line_items_summary: {
          base: `${tier} plan`,
          extra_companies: extraCompanies,
          estimated_total: tier === "growth"
            ? `$${49 + extraCompanies * 29}/mo`
            : `$${149 + extraCompanies * 59}/mo`,
        },
      });
    }

    // -----------------------------------------------------------------------
    // Buy Video Credits — one-time purchase
    // -----------------------------------------------------------------------
    if (path === "/buy-credits") {
      const { org_id, pack, return_url } = body;
      if (!org_id || !pack || !return_url) {
        return jsonResponse({ error: "org_id, pack, and return_url are required" }, 400);
      }

      // Get org tier and customer
      const { data: org } = await supabase
        .from("organizations")
        .select("stripe_customer_id, subscription_tier, name, owner_user_id")
        .eq("id", org_id)
        .single();

      if (!org) return jsonResponse({ error: "Organization not found" }, 404);

      const tier = org.subscription_tier;
      if (tier === "starter") {
        return jsonResponse({ error: "Video credits require a Growth or Pro subscription" }, 400);
      }

      // Determine price ID and credit amount
      const packKey = `${tier}_${pack}`; // e.g. "growth_single", "pro_10pack"
      const priceId = VIDEO_CREDIT_PRICES[packKey];
      if (!priceId) {
        return jsonResponse({ error: `No price configured for pack: ${pack} on ${tier} tier` }, 400);
      }

      const creditAmounts: Record<string, number> = {
        single: 1,
        "10pack": 10,
      };
      const credits = creditAmounts[pack] || 1;

      let customerId = org.stripe_customer_id;
      if (!customerId) {
        const { data: { user: owner } } = await supabase.auth.admin.getUserById(org.owner_user_id);
        const customer = await stripeRequest("/customers", {
          email: owner?.email || "",
          name: org.name,
          "metadata[org_id]": org_id,
        });
        customerId = customer.id;
        await supabase.from("organizations").update({ stripe_customer_id: customerId }).eq("id", org_id);
      }

      const session = await stripeRequest("/checkout/sessions", {
        customer: customerId,
        mode: "payment",
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        success_url: `${return_url}?credits=true&amount=${credits}`,
        cancel_url: `${return_url}?canceled=true`,
        "payment_intent_data[metadata][org_id]": org_id,
        "payment_intent_data[metadata][credits]": String(credits),
        "payment_intent_data[metadata][pack]": pack,
      });

      if (session.error) {
        return jsonResponse({ error: session.error.message }, 400);
      }

      return jsonResponse({ checkout_url: session.url, session_id: session.id, credits });
    }

    // -----------------------------------------------------------------------
    // Customer Portal — manage subscription
    // -----------------------------------------------------------------------
    if (path === "/portal") {
      const { org_id, return_url } = body;
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
