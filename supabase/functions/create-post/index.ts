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
    const body = await req.json();
    const {
      company_id, prompt, tone, must_include, media_asset_url,
      link, platforms, generate_image, mode, video_style, video_duration,
    } = body;

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

    // ── VIDEO SCRIPT MODE ──
    if (mode === "video_script") {
      const style = video_style || "voiceover_only";
      const duration = video_duration || 30;

      // Get brand characters
      const { data: chars } = await supabase.from("brand_characters")
        .select("*").eq("company_id", company_id).eq("active", true).limit(1);
      const character = chars?.[0] || null;

      let charContext = "";
      if (character && style !== "voiceover_only") {
        charContext = `\nBRAND CHARACTER: "${character.name}"\n- Appearance: ${character.appearance}\n- Personality: ${character.personality}\n- Wardrobe: ${character.wardrobe}`;
      }

      const styleInstructions: Record<string, string> = {
        voiceover_only: "All scenes are 'lifestyle' or 'product' type — NO character scenes. Narration plays over beautiful b-roll footage.",
        combined: "Almost all scenes should be product/lifestyle b-roll. Brand character appears in AT MOST 1 scene as a background element. Voiceover does all storytelling.",
        character: "Focus on product/lifestyle footage. Brand character may appear in AT MOST 1 scene as a brief background shot. Character should NEVER be the main focus.",
      };

      const scriptResult = await grokChat([
        {
          role: "system",
          content: `You are an expert short-form video scriptwriter for ${company.name}.${knowledgeContext}${eventsContext}${charContext}\n\nVIDEO STYLE: ${style}\n${styleInstructions[style] || styleInstructions.voiceover_only}\n\nRules:\n- Target duration: ${duration} seconds\n- 4-6 scenes, each 5-10 seconds\n- Scene types: "product", "lifestyle", or "character"\n- First scene: HOOK — grab attention\n- Last scene: CTA\n- Visual prompts must be extremely detailed (lighting, camera angle, colors, movement)\n- Text overlays: 2-5 words max\n- 90% product/lifestyle footage, 10% or less character`,
        },
        {
          role: "user",
          content: `Create a ${duration}-second video script about: "${prompt}"\n\nReturn ONLY valid JSON:\n{\n  "title": "Short catchy title",\n  "style": "${style}",\n  "total_duration": ${duration},\n  "music_prompt": "genre, mood, tempo for instrumental background",\n  "hook": "Attention-grabbing opening line",\n  "scenes": [\n    {\n      "scene": 1,\n      "type": "product|lifestyle|character",\n      "duration": 5,\n      "visual_prompt": "Extremely detailed visual description for AI video generation",\n      "narration": "What the voiceover says",\n      "text_overlay": "2-5 word overlay",\n      "transition": "cut|fade|slide"\n    }\n  ]\n}`,
        },
      ], 0.8);

      try {
        const cleaned = scriptResult.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const script = JSON.parse(cleaned);
        if (character) script._character = character;
        return jsonResponse({ success: true, script, company: company.name });
      } catch {
        return jsonResponse({ error: "Failed to parse video script", raw: scriptResult }, 500);
      }
    }

    // ── STANDARD POST MODE ──
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
