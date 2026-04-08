/**
 * Stripe Webhook Edge Function
 *
 * Handles subscription lifecycle events and video credit purchases.
 * Updates organization subscription_tier and fulfills credit packs.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const STRIPE_API = "https://api.stripe.com/v1";

async function verifyWebhook(req: Request): Promise<{ event: any; verified: boolean }> {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig || !STRIPE_WEBHOOK_SECRET) {
    try {
      return { event: JSON.parse(body), verified: false };
    } catch {
      return { event: null, verified: false };
    }
  }

  try {
    return { event: JSON.parse(body), verified: true };
  } catch {
    return { event: null, verified: false };
  }
}

// Map Stripe price IDs to tier names
const PRICE_TO_TIER: Record<string, string> = {};
function initPriceTiers() {
  const growth = Deno.env.get("STRIPE_PRICE_GROWTH");
  const pro = Deno.env.get("STRIPE_PRICE_PRO");
  if (growth) PRICE_TO_TIER[growth] = "growth";
  if (pro) PRICE_TO_TIER[pro] = "pro";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  initPriceTiers();

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { event } = await verifyWebhook(req);

  if (!event) {
    return new Response("Invalid payload", { status: 400 });
  }

  console.log(`[Stripe Webhook] Event: ${event.type}`);

  try {
    switch (event.type) {
      // Checkout completed — activate subscription or fulfill credits
      case "checkout.session.completed": {
        const session = event.data.object;
        const mode = session.mode; // 'subscription' or 'payment'

        if (mode === "payment") {
          // One-time payment — video credit purchase
          const orgId = session.metadata?.org_id || session.payment_intent_data?.metadata?.org_id;
          const credits = parseInt(session.metadata?.credits || "0");
          const paymentId = session.payment_intent;

          if (orgId && credits > 0) {
            // Try to get metadata from payment intent if not on session
            let finalOrgId = orgId;
            let finalCredits = credits;

            if (!finalOrgId && paymentId) {
              const piRes = await fetch(`${STRIPE_API}/payment_intents/${paymentId}`, {
                headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` },
              });
              const pi = await piRes.json();
              finalOrgId = pi.metadata?.org_id;
              finalCredits = parseInt(pi.metadata?.credits || "0");
            }

            if (finalOrgId && finalCredits > 0) {
              await supabase.from("video_credit_packs").insert({
                org_id: finalOrgId,
                credits_purchased: finalCredits,
                credits_remaining: finalCredits,
                price_cents: session.amount_total || 0,
                stripe_payment_id: paymentId,
              });
              console.log(`[Stripe] Org ${finalOrgId}: +${finalCredits} video credits`);
            }
          }
        } else {
          // Subscription checkout
          const orgId = session.metadata?.org_id;
          const subscriptionId = session.subscription;

          if (orgId && subscriptionId) {
            const subRes = await fetch(`${STRIPE_API}/subscriptions/${subscriptionId}`, {
              headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` },
            });
            const subscription = await subRes.json();

            // Find the base price to determine tier
            const tier = subscription.metadata?.tier
              || subscription.items?.data?.reduce((found: string, item: any) => {
                return PRICE_TO_TIER[item.price?.id] || found;
              }, "growth");

            await supabase.from("organizations").update({
              subscription_tier: tier,
              stripe_subscription_id: subscriptionId,
              stripe_customer_id: session.customer,
            }).eq("id", orgId);

            console.log(`[Stripe] Org ${orgId} activated: ${tier}`);
          }
        }
        break;
      }

      // Subscription updated — tier change or company count change
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const orgId = subscription.metadata?.org_id;

        if (orgId) {
          // Determine tier from base price
          const tier = subscription.items?.data?.reduce((found: string, item: any) => {
            return PRICE_TO_TIER[item.price?.id] || found;
          }, subscription.metadata?.tier || "growth");

          const status = subscription.status;

          if (status === "active" || status === "trialing") {
            await supabase.from("organizations").update({
              subscription_tier: tier,
            }).eq("id", orgId);
            console.log(`[Stripe] Org ${orgId} updated to: ${tier}`);
          } else if (status === "past_due" || status === "unpaid") {
            console.log(`[Stripe] Org ${orgId} payment issue: ${status}`);
          }
        }
        break;
      }

      // Subscription deleted — downgrade to free
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const orgId = subscription.metadata?.org_id;

        if (orgId) {
          await supabase.from("organizations").update({
            subscription_tier: "starter",
            stripe_subscription_id: null,
          }).eq("id", orgId);
          console.log(`[Stripe] Org ${orgId} downgraded to starter`);
        } else {
          const customerId = subscription.customer;
          if (customerId) {
            await supabase.from("organizations").update({
              subscription_tier: "starter",
              stripe_subscription_id: null,
            }).eq("stripe_customer_id", customerId);
            console.log(`[Stripe] Customer ${customerId} downgraded to starter`);
          }
        }
        break;
      }

      // Payment intent succeeded — fulfill video credits (backup for checkout)
      case "payment_intent.succeeded": {
        const pi = event.data.object;
        const orgId = pi.metadata?.org_id;
        const credits = parseInt(pi.metadata?.credits || "0");

        if (orgId && credits > 0) {
          // Check if already fulfilled (idempotency)
          const { data: existing } = await supabase
            .from("video_credit_packs")
            .select("id")
            .eq("stripe_payment_id", pi.id)
            .maybeSingle();

          if (!existing) {
            await supabase.from("video_credit_packs").insert({
              org_id: orgId,
              credits_purchased: credits,
              credits_remaining: credits,
              price_cents: pi.amount || 0,
              stripe_payment_id: pi.id,
            });
            console.log(`[Stripe] Org ${orgId}: +${credits} video credits (via payment_intent)`);
          }
        }
        break;
      }

      // Payment failed
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        console.log(`[Stripe] Payment failed for customer: ${customerId}`);
        break;
      }

      default:
        console.log(`[Stripe] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`[Stripe Webhook] Error processing ${event.type}:`, err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
