/**
 * Send Email Edge Function
 *
 * Uses Brevo's REST API to send transactional emails.
 *
 * Routes:
 *   POST /send-email/invite       — send team invite email
 *   POST /send-email/welcome      — send welcome email after signup
 *   POST /send-email/notification — send generic notification
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!;
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL")!;
const BREVO_SENDER_NAME = Deno.env.get("BREVO_SENDER_NAME")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function sendBrevoEmail(
  toEmail: string,
  toName: string,
  subject: string,
  htmlContent: string,
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
      to: [{ email: toEmail, name: toName }],
      subject,
      htmlContent,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { success: false, error: `Brevo API error ${res.status}: ${text}` };
  }
  return { success: true };
}

function inviteHtml(
  toName: string,
  orgName: string,
  inviterName: string,
  role: string,
  inviteId: string,
): string {
  const acceptUrl = `https://xignil.com/invite/${inviteId}`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="background-color:#1e293b;border-radius:12px;border:1px solid #334155;padding:32px;">
      <h1 style="color:#ffffff;font-size:22px;margin:0 0 8px;">You're invited to join ${orgName}</h1>
      <p style="color:#94a3b8;font-size:14px;margin:0 0 24px;">
        ${inviterName} has invited you to join <strong style="color:#e2e8f0;">${orgName}</strong> on Xignil as a <strong style="color:#60a5fa;">${role}</strong>.
      </p>
      <a href="${acceptUrl}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">
        Accept Invite
      </a>
      <p style="color:#64748b;font-size:12px;margin:24px 0 0;">
        This invite expires in 7 days. If you didn't expect this email, you can safely ignore it.
      </p>
    </div>
    <p style="color:#475569;font-size:11px;text-align:center;margin-top:24px;">Xignil &mdash; AI-powered social media management</p>
  </div>
</body>
</html>`;
}

function welcomeHtml(toName: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="background-color:#1e293b;border-radius:12px;border:1px solid #334155;padding:32px;">
      <h1 style="color:#ffffff;font-size:22px;margin:0 0 8px;">Welcome to Xignil!</h1>
      <p style="color:#94a3b8;font-size:14px;margin:0 0 24px;">
        Hi ${toName}, your account is all set. Start creating AI-powered social media content for your business today.
      </p>
      <a href="https://xignil.com/companies" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">
        Get Started
      </a>
    </div>
    <p style="color:#475569;font-size:11px;text-align:center;margin-top:24px;">Xignil &mdash; AI-powered social media management</p>
  </div>
</body>
</html>`;
}

function notificationHtml(toName: string, message: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="background-color:#1e293b;border-radius:12px;border:1px solid #334155;padding:32px;">
      <h1 style="color:#ffffff;font-size:22px;margin:0 0 8px;">Hi ${toName},</h1>
      <p style="color:#94a3b8;font-size:14px;margin:0 0 16px;">${message}</p>
    </div>
    <p style="color:#475569;font-size:11px;text-align:center;margin-top:24px;">Xignil &mdash; AI-powered social media management</p>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/send-email\/?/, "").replace(/\/$/, "");

  try {
    if (path === "invite") {
      const { to_email, to_name, org_name, inviter_name, role, invite_id } =
        await req.json();

      if (!to_email || !org_name || !inviter_name || !invite_id) {
        return jsonResponse(
          { error: "Missing required fields: to_email, org_name, inviter_name, invite_id" },
          400,
        );
      }

      const html = inviteHtml(
        to_name || to_email,
        org_name,
        inviter_name,
        role || "editor",
        invite_id,
      );
      const result = await sendBrevoEmail(
        to_email,
        to_name || to_email,
        `You're invited to join ${org_name} on Xignil`,
        html,
      );

      if (!result.success) {
        return jsonResponse({ error: result.error }, 500);
      }
      return jsonResponse({ success: true });
    }

    if (path === "welcome") {
      const { to_email, to_name } = await req.json();

      if (!to_email) {
        return jsonResponse({ error: "Missing required field: to_email" }, 400);
      }

      const html = welcomeHtml(to_name || "there");
      const result = await sendBrevoEmail(
        to_email,
        to_name || to_email,
        "Welcome to Xignil!",
        html,
      );

      if (!result.success) {
        return jsonResponse({ error: result.error }, 500);
      }
      return jsonResponse({ success: true });
    }

    if (path === "notification") {
      const { to_email, to_name, subject, message } = await req.json();

      if (!to_email || !subject || !message) {
        return jsonResponse(
          { error: "Missing required fields: to_email, subject, message" },
          400,
        );
      }

      const html = notificationHtml(to_name || "there", message);
      const result = await sendBrevoEmail(
        to_email,
        to_name || to_email,
        subject,
        html,
      );

      if (!result.success) {
        return jsonResponse({ error: result.error }, 500);
      }
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: `Unknown route: ${path}` }, 404);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return jsonResponse({ error: message }, 500);
  }
});
