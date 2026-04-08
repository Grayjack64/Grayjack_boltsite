/**
 * Image Edit Edge Function
 *
 * Handles image regeneration, product insertion, and AI-prompted edits.
 * Uses Grok for regeneration, Runway for image-to-image, Gemini for AI edits.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const XAI_API_KEY = Deno.env.get("XAI_API_KEY") || "";
const RUNWAY_API_KEY = Deno.env.get("RUNWAY_API_KEY") || "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Download image and convert to base64
 */
async function imageUrlToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/image-edit", "");
    const body = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // -----------------------------------------------------------------------
    // Regenerate — generate a completely new image from scratch
    // -----------------------------------------------------------------------
    if (path === "/regenerate") {
      const { prompt } = body;
      if (!prompt) return jsonResponse({ error: "prompt is required" }, 400);
      if (!XAI_API_KEY) return jsonResponse({ error: "XAI_API_KEY not configured" }, 500);

      const res = await fetch("https://api.x.ai/v1/images/generations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${XAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "grok-imagine-image",
          prompt,
          n: 1,
          response_format: "b64_json",
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return jsonResponse({ error: "Image generation failed", details: err }, 400);
      }

      const data = await res.json();
      const b64 = data.data[0].b64_json;

      // Upload to storage
      const buffer = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const filename = `regen-${Date.now()}.png`;
      await supabase.storage.from("blog-images").upload(filename, buffer, { contentType: "image/png" });
      const { data: urlData } = supabase.storage.from("blog-images").getPublicUrl(filename);

      return jsonResponse({ success: true, image_url: urlData.publicUrl });
    }

    // -----------------------------------------------------------------------
    // Insert Product — composite a product reference into the scene
    // Uses Runway image-to-image
    // -----------------------------------------------------------------------
    if (path === "/insert-product") {
      const { scene_image_url, product_image_url, prompt } = body;
      if (!scene_image_url || !product_image_url) {
        return jsonResponse({ error: "scene_image_url and product_image_url are required" }, 400);
      }

      const editPrompt = prompt || "Replace the product in the scene with the product shown in the reference image. Match lighting, scale, and perspective.";
      const errors: string[] = [];

      // Gemini first — natively supports multi-image input for compositing
      if (GEMINI_API_KEY) {
        try {
          const sceneB64 = await imageUrlToBase64(scene_image_url);
          const productB64 = await imageUrlToBase64(product_image_url);

          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{
                  role: "user",
                  parts: [
                    { inlineData: { mimeType: "image/png", data: sceneB64 } },
                    { inlineData: { mimeType: "image/png", data: productB64 } },
                    { text: `Take the first image (scene) and replace any product/bottle/jar in it with the exact product shown in the second image. Match the lighting, angle, scale, and perspective of the scene. Keep everything else in the scene unchanged. Photorealistic result.` },
                  ],
                }],
                generationConfig: { responseModalities: ["IMAGE"] },
              }),
            }
          );

          if (geminiRes.ok) {
            const geminiData = await geminiRes.json();
            const imgPart = geminiData.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
            if (imgPart) {
              const resultB64 = imgPart.inlineData.data;
              const buffer = Uint8Array.from(atob(resultB64), c => c.charCodeAt(0));
              const filename = `product-insert-${Date.now()}.png`;
              await supabase.storage.from("blog-images").upload(filename, buffer, { contentType: "image/png" });
              const { data: urlData } = supabase.storage.from("blog-images").getPublicUrl(filename);
              return jsonResponse({ success: true, image_url: urlData.publicUrl, provider: "gemini" });
            } else {
              errors.push("Gemini: no image in response - " + JSON.stringify(geminiData).substring(0, 200));
            }
          } else {
            const errText = await geminiRes.text();
            errors.push("Gemini: " + geminiRes.status + " - " + errText.substring(0, 200));
          }
        } catch (e) {
          errors.push("Gemini exception: " + e.message);
        }
      } else {
        errors.push("GEMINI_API_KEY not configured");
      }

      return jsonResponse({ error: "Image edit failed", details: errors.join(" | ") }, 500);
    }

    // -----------------------------------------------------------------------
    // AI Edit — modify image with a text prompt
    // -----------------------------------------------------------------------
    if (path === "/ai-edit") {
      const { image_url, edit_prompt } = body;
      if (!image_url || !edit_prompt) {
        return jsonResponse({ error: "image_url and edit_prompt are required" }, 400);
      }

      // Try Gemini first (better for text-prompted edits)
      if (GEMINI_API_KEY) {
        try {
          const imgB64 = await imageUrlToBase64(image_url);

          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{
                  role: "user",
                  parts: [
                    { inlineData: { mimeType: "image/png", data: imgB64 } },
                    { text: `Edit this image: ${edit_prompt}. Keep the overall composition and style. Return a high-quality photorealistic result.` },
                  ],
                }],
                generationConfig: { responseModalities: ["IMAGE"] },
              }),
            }
          );

          if (geminiRes.ok) {
            const geminiData = await geminiRes.json();
            const imgPart = geminiData.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
            if (imgPart) {
              const resultB64 = imgPart.inlineData.data;
              const buffer = Uint8Array.from(atob(resultB64), c => c.charCodeAt(0));
              const filename = `ai-edit-${Date.now()}.png`;
              await supabase.storage.from("blog-images").upload(filename, buffer, { contentType: "image/png" });
              const { data: urlData } = supabase.storage.from("blog-images").getPublicUrl(filename);
              return jsonResponse({ success: true, image_url: urlData.publicUrl, provider: "gemini" });
            }
          } else {
            console.error("Gemini edit failed:", await geminiRes.text());
          }
        } catch (e) {
          console.error("Gemini failed:", e.message);
        }
      }

      // Fallback: regenerate with the edit as part of the prompt
      if (XAI_API_KEY) {
        try {
          const res = await fetch("https://api.x.ai/v1/images/generations", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${XAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "grok-imagine-image",
              prompt: edit_prompt,
              n: 1,
              response_format: "b64_json",
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const b64 = data.data[0].b64_json;
            const buffer = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const filename = `ai-edit-fallback-${Date.now()}.png`;
            await supabase.storage.from("blog-images").upload(filename, buffer, { contentType: "image/png" });
            const { data: urlData } = supabase.storage.from("blog-images").getPublicUrl(filename);
            return jsonResponse({ success: true, image_url: urlData.publicUrl, provider: "grok_fallback" });
          }
        } catch (e) {
          console.error("Grok fallback failed:", e.message);
        }
      }

      return jsonResponse({ error: "Image edit failed with all providers" }, 500);
    }

    // -----------------------------------------------------------------------
    // Product Scene — generate an image with a real product composited into a scene
    // -----------------------------------------------------------------------
    if (path === "/product-scene") {
      const { product_image_url, scene_prompt, product_name } = body;
      if (!product_image_url || !scene_prompt) {
        return jsonResponse({ error: "product_image_url and scene_prompt are required" }, 400);
      }
      if (!GEMINI_API_KEY) return jsonResponse({ error: "GEMINI_API_KEY not configured" }, 500);

      try {
        const productB64 = await imageUrlToBase64(product_image_url);

        const prompt = `Generate a photorealistic image for a social media ad or video thumbnail.
The scene: ${scene_prompt}

CRITICAL: The exact product shown in the reference image MUST appear prominently in the generated scene.
This is ${product_name || 'the product'}. Keep the product's label, colors, shape, and branding exactly as shown.
Place the product naturally in the scene — on a surface, being held, or positioned where it makes sense.
The product should be clearly visible and recognizable, not tiny or hidden.
Photorealistic quality, commercial photography style, good lighting.`;

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_API_KEY ? 'gemini-3-pro-image-preview' : ''}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                role: "user",
                parts: [
                  { inlineData: { mimeType: "image/png", data: productB64 } },
                  { text: prompt },
                ],
              }],
              generationConfig: { responseModalities: ["IMAGE"] },
            }),
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const imgPart = geminiData.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
          if (imgPart) {
            const resultB64 = imgPart.inlineData.data;
            const buffer = Uint8Array.from(atob(resultB64), c => c.charCodeAt(0));
            const filename = `product-scene-${Date.now()}.png`;
            await supabase.storage.from("blog-images").upload(filename, buffer, { contentType: "image/png" });
            const { data: urlData } = supabase.storage.from("blog-images").getPublicUrl(filename);
            return jsonResponse({ success: true, image_url: urlData.publicUrl });
          }
        }

        const errText = await geminiRes.text();
        return jsonResponse({ error: "Product scene generation failed", details: errText.substring(0, 200) }, 500);
      } catch (e) {
        return jsonResponse({ error: "Product scene failed: " + e.message }, 500);
      }
    }

    return jsonResponse({ error: "Not found" }, 404);

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
});
