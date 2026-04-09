/**
 * Regenerate Scene Edge Function
 *
 * Handles regenerating a single scene's voiceover or queuing clip regeneration.
 *
 * POST /regenerate-scene/voiceover — regenerate voiceover for a single scene
 * POST /regenerate-scene/clip — queue clip regeneration for a single scene
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";
const DEFAULT_VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID") || "yj30vwTGJxSHezdAGsv9";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // Last segment is the action: "voiceover" or "clip"
  const action = pathParts[pathParts.length - 1];

  if (action !== "voiceover" && action !== "clip") {
    return jsonResponse({ error: `Unknown action: ${action}. Use /voiceover or /clip` }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const { draft_id, scene_number, voice_id } = body;

    if (!draft_id || scene_number === undefined) {
      return jsonResponse({ error: "draft_id and scene_number are required" }, 400);
    }

    // Get the draft
    const { data: draft, error: draftErr } = await supabase
      .from("content_drafts")
      .select("id, video_script, status")
      .eq("id", draft_id)
      .single();

    if (draftErr || !draft) {
      return jsonResponse({ error: "Draft not found" }, 404);
    }

    const script = draft.video_script;
    if (!script?.scenes) {
      return jsonResponse({ error: "Draft has no video script" }, 400);
    }

    const sceneIndex = script.scenes.findIndex(
      (s: { scene: number }) => s.scene === scene_number
    );
    if (sceneIndex === -1) {
      return jsonResponse({ error: `Scene ${scene_number} not found` }, 404);
    }

    const scene = script.scenes[sceneIndex];

    if (action === "voiceover") {
      // Regenerate voiceover for this scene
      if (!scene.narration) {
        return jsonResponse({ error: "Scene has no narration text" }, 400);
      }

      const voiceId =
        voice_id ||
        script._voice?.voice_id ||
        script._character?.voice_id ||
        DEFAULT_VOICE_ID;

      // Call ElevenLabs
      const ttsRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: scene.narration,
            model_id: "eleven_turbo_v2_5",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.3,
              use_speaker_boost: true,
            },
          }),
        }
      );

      if (!ttsRes.ok) {
        const err = await ttsRes.text();
        return jsonResponse(
          { error: `ElevenLabs error (${ttsRes.status}): ${err}` },
          500
        );
      }

      const audioBuffer = new Uint8Array(await ttsRes.arrayBuffer());

      // Upload to storage
      const storageFilename = `voiceover-scene-${scene_number}-${Date.now()}.mp3`;
      const { error: uploadErr } = await supabase.storage
        .from("blog-images")
        .upload(`voiceover/${storageFilename}`, audioBuffer, {
          contentType: "audio/mpeg",
        });

      if (uploadErr) {
        return jsonResponse(
          { error: `Storage upload failed: ${uploadErr.message}` },
          500
        );
      }

      const { data: urlData } = supabase.storage
        .from("blog-images")
        .getPublicUrl(`voiceover/${storageFilename}`);

      // Update the scene's voiceover_url in the script
      scene.voiceover_url = urlData.publicUrl;

      const { error: updateErr } = await supabase
        .from("content_drafts")
        .update({
          video_script: script,
          updated_at: new Date().toISOString(),
        })
        .eq("id", draft_id);

      if (updateErr) {
        return jsonResponse(
          { error: `Failed to update draft: ${updateErr.message}` },
          500
        );
      }

      return jsonResponse({
        success: true,
        voiceover_url: urlData.publicUrl,
      });
    }

    if (action === "clip") {
      // Flag scene for regeneration — does NOT trigger recompose.
      // User clicks "Recompose Video" when ready.
      scene.clip_url = null;
      scene.needs_regen = true;

      const { error: updateErr } = await supabase
        .from("content_drafts")
        .update({
          video_script: script,
          updated_at: new Date().toISOString(),
        })
        .eq("id", draft_id);

      if (updateErr) {
        return jsonResponse(
          { error: `Failed to update draft: ${updateErr.message}` },
          500
        );
      }

      return jsonResponse({
        success: true,
        message:
          "Scene flagged for regeneration. Click 'Recompose Video' when you're done editing to rebuild the video.",
      });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("regenerate-scene error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
