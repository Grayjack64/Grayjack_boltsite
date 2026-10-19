import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const XAI_API_KEY = Deno.env.get("XAI_API_KEY") || "";
const XAI_BASE_URL = "https://api.x.ai/v1";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function grokChat(messages: Array<{role: string; content: string}>, temp = 0.8) {
  const res = await fetch(`${XAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${XAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "grok-4-1-fast-reasoning", messages, temperature: temp, max_tokens: 2048 }),
  });
  if (!res.ok) throw new Error(`Grok error: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function grokImage(prompt: string) {
  const res = await fetch(`${XAI_BASE_URL}/images/generations`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${XAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "grok-imagine-image", prompt, n: 1, response_format: "b64_json" }),
  });
  if (!res.ok) throw new Error(`Image error: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].b64_json;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const {
      company_id, prompt, tone, must_include, media_asset_url,
      link, platforms, generate_image,
    } = await req.json();

    if (!company_id || !prompt) {
      return jsonResponse({ error: "company_id and prompt are required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get company info
    const { data: company } = await supabase.from("companies").select("name,slug").eq("id", company_id).single();
    if (!company) return jsonResponse({ error: "Company not found" }, 404);

    // Get company knowledge for context
    const { data: knowledge } = await supabase.from("company_knowledge")
      .select("category,title,content").eq("company_id", company_id).eq("active", true)
      .order("priority", { ascending: false }).limit(10);

    let knowledgeContext = "";
    if (knowledge?.length) {
      knowledgeContext = "\n\nCompany Knowledge:\n" + knowledge.map(k => `- [${k.category}] ${k.title}: ${k.content}`).join("\n");
    }

    // Get active events
    const today = new Date().toISOString().split("T")[0];
    const { data: events } = await supabase.from("company_events")
      .select("*").eq("company_id", company_id).eq("active", true)
      .lte("start_date", today).order("start_date");

    let eventsContext = "";
    if (events?.length) {
      eventsContext = "\n\nActive Events:\n" + events.map(e => `- ${e.event_name}: ${e.description}${e.promo_text ? ` (${e.promo_text})` : ""}`).join("\n");
    }

    const toneInstruction = tone ? `\nTone override: ${tone}` : "";
    const mustIncludeInstruction = must_include ? `\nMUST include this text somewhere: "${must_include}"` : "";
    const linkInstruction = link ? `\nInclude this link: ${link}` : "";

    // Generate the posts
    const systemPrompt = `You are a social media content creator for ${company.name}.${knowledgeContext}${eventsContext}${toneInstruction}

Generate social media posts based on the user's instructions.${mustIncludeInstruction}${linkInstruction}`;

    const result = await grokChat([
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Create social media posts for this prompt: "${prompt}"

Return ONLY valid JSON:
{
  "tweet": "Twitter post (max 280 chars with any link, punchy and engaging)",
  "facebook": "Facebook post (2-4 sentences, conversational)",
  "instagram": "Instagram caption (hook + value + CTA + 10-15 hashtags)",
  "image_prompt": "A detailed image generation prompt that matches the post content (or null if using existing media)"
}`
      }
    ], 0.8);

    let posts;
    try {
      const cleaned = result.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      posts = JSON.parse(cleaned);
    } catch {
      return jsonResponse({ error: "Failed to parse AI response", raw: result }, 500);
    }

    // Generate image if requested and no media asset provided
    let imageUrl = media_asset_url || null;
    let imageBase64 = null;

    if (generate_image && !media_asset_url && posts.image_prompt) {
      try {
        imageBase64 = await grokImage(posts.image_prompt);
        // Upload to Supabase storage (use the first available storage bucket)
        const buffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
        const filename = `oneoff-${Date.now()}.png`;

        // Try uploading to blog-images bucket
        const { error: uploadError } = await supabase.storage
          .from("blog-images")
          .upload(filename, buffer, { contentType: "image/png" });

        if (!uploadError) {
          const { data: urlData } = supabase.storage.from("blog-images").getPublicUrl(filename);
          imageUrl = urlData.publicUrl;
        }
      } catch (imgErr) {
        // Image generation failed, continue without
        console.error("Image generation failed:", imgErr.message);
      }
    }

    return jsonResponse({
      success: true,
      posts,
      image_url: imageUrl,
      image_base64: imageBase64 ? `data:image/png;base64,${imageBase64.substring(0, 100)}...` : null,
      company: company.name,
    });

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
});
