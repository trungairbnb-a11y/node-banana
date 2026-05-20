/**
 * X-Node generic execution endpoint.
 *
 * This route dispatches generation requests for any of the 72 X-Node model
 * types (registered in `src/lib/xnode/models.ts`) to the appropriate provider.
 *
 * Behaviour by provider:
 *  - `gemini`        — real call using GEMINI_API_KEY when present
 *  - everything else — returns a structured 501 with the required env var
 *    name so the user can add the credential later. We intentionally avoid
 *    silently failing — the UI surfaces this as "API key required".
 *
 * Request body:
 *   {
 *     type: string;                 // X-Node model type, e.g. "kling26"
 *     prompt?: string;
 *     negativePrompt?: string;
 *     inputImage?: string;          // base64 data URL or external URL
 *     inputImages?: string[];
 *     inputVideo?: string;
 *     inputAudio?: string;
 *     parameters?: Record<string, unknown>;
 *   }
 *
 * Response on success:
 *   { ok: true, kind: "image" | "video" | "audio" | "text", value: string }
 *
 * Response on missing provider key:
 *   { ok: false, error: string, missingEnv: string, provider: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { getXNodeModel } from "@/lib/xnode/models";
import { getFalModelId } from "@/lib/xnode/falModels";
import { generateWithFalQueue } from "@/app/api/generate/providers/fal";
import type { GenerationInput } from "@/lib/providers/types";

export const maxDuration = 600;
export const dynamic = "force-dynamic";

interface XNodeRunRequest {
  type?: string;
  prompt?: string;
  negativePrompt?: string;
  inputImage?: string;
  inputImages?: string[];
  inputVideo?: string;
  inputAudio?: string;
  parameters?: Record<string, unknown>;
}

const PROVIDER_ENV_VAR: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  fal: "FAL_KEY",
  kie: "KIE_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  xai: "XAI_API_KEY",
  cloudinary: "CLOUDINARY_API_KEY",
  dropbox: "DROPBOX_ACCESS_TOKEN",
  topaz: "TOPAZ_API_KEY",
  custom: "",
};

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

async function callGeminiImage(
  prompt: string,
  inputImages: string[],
  apiKey: string
): Promise<{ ok: true; kind: "image"; value: string } | { ok: false; error: string }> {
  const parts: GeminiPart[] = [{ text: prompt }];
  for (const image of inputImages) {
    const parsed = parseDataUrl(image);
    if (parsed) {
      parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
    }
  }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=" +
    encodeURIComponent(apiKey);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return { ok: false, error: `Gemini API error (${response.status}): ${errorText.slice(0, 500)}` };
  }

  const result = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  };

  const candidate = result.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find((p) => p.inlineData);
  if (!imagePart?.inlineData) {
    return { ok: false, error: "Gemini returned no image data" };
  }
  return {
    ok: true,
    kind: "image",
    value: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
  };
}

async function callGeminiText(
  prompt: string,
  apiKey: string
): Promise<{ ok: true; kind: "text"; value: string } | { ok: false; error: string }> {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
    encodeURIComponent(apiKey);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return { ok: false, error: `Gemini API error (${response.status}): ${errorText.slice(0, 500)}` };
  }

  const result = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const textPart = result.candidates?.[0]?.content?.parts?.find((p) => p.text);
  if (!textPart?.text) {
    return { ok: false, error: "Gemini returned no text" };
  }
  return { ok: true, kind: "text", value: textPart.text };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: XNodeRunRequest;
  try {
    body = (await request.json()) as XNodeRunRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const type = body.type;
  if (!type) {
    return NextResponse.json({ ok: false, error: "Missing 'type' field" }, { status: 400 });
  }

  const schema = getXNodeModel(type);
  if (!schema) {
    return NextResponse.json(
      { ok: false, error: `Unknown X-Node model: ${type}` },
      { status: 404 }
    );
  }

  const prompt = (body.prompt ?? "").trim();
  const inputImages: string[] = body.inputImages
    ?? (body.inputImage ? [body.inputImage] : []);

  // Output type the model declares (used to dispatch to the right Gemini call).
  const outputType = schema.outputs[0]?.type ?? "image";

  // Gemini — real execution.
  if (schema.provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          provider: "gemini",
          missingEnv: "GEMINI_API_KEY",
          error: "GEMINI_API_KEY is not configured on the server",
        },
        { status: 501 }
      );
    }

    if (!prompt) {
      return NextResponse.json(
        { ok: false, error: "Prompt is required for Gemini models" },
        { status: 400 }
      );
    }

    if (outputType === "text") {
      const result = await callGeminiText(prompt, apiKey);
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }

    // Default to image generation (Gemini doesn't support direct video here —
    // video models route through the existing Flow video integration).
    const result = await callGeminiImage(prompt, inputImages, apiKey);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  }

  // fal.ai — real execution via the existing queue pipeline. Any X-Node
  // model that has a known fal.ai endpoint (see FAL_MODEL_ID_MAP) routes
  // here, regardless of the schema's nominal `provider` field — several
  // entries (e.g. kling26, grokImagine) are actually fal-backed despite
  // being categorised as "kie" or "xai" upstream.
  const falModelId = getFalModelId(type);
  if (falModelId) {
    const apiKey = process.env.FAL_KEY ?? null;
    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          provider: "fal",
          missingEnv: "FAL_KEY",
          error: "FAL_KEY is not configured on the server",
        },
        { status: 501 }
      );
    }

    const requestId = `xnode-${Math.random().toString(36).slice(2, 10)}`;
    const dynamicInputs: Record<string, string | string[]> = {};
    if (body.inputVideo) dynamicInputs.video_url = body.inputVideo;
    if (body.inputAudio) dynamicInputs.audio_url = body.inputAudio;
    if (body.parameters) {
      for (const [k, v] of Object.entries(body.parameters)) {
        if (typeof v === "string") dynamicInputs[k] = v;
        else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
          dynamicInputs[k] = v as string[];
        }
      }
    }
    if (body.negativePrompt) dynamicInputs.negative_prompt = body.negativePrompt;

    const genInput: GenerationInput = {
      model: {
        id: falModelId,
        name: schema.displayName,
        provider: "fal",
        capabilities: [],
        description: null,
      },
      prompt,
      images: inputImages,
      parameters: body.parameters ?? {},
      dynamicInputs,
    };

    const result = await generateWithFalQueue(requestId, apiKey, genInput);
    if (!result.success) {
      return NextResponse.json(
        { ok: false, provider: "fal", error: result.error || "fal.ai generation failed" },
        { status: 502 }
      );
    }
    const out = result.outputs?.[0];
    if (!out) {
      return NextResponse.json(
        { ok: false, provider: "fal", error: "fal.ai returned no output" },
        { status: 502 }
      );
    }
    const kind: "image" | "video" | "audio" =
      out.type === "image" || out.type === "video" || out.type === "audio"
        ? out.type
        : "image";
    return NextResponse.json({
      ok: true,
      kind,
      value: out.data || out.url || "",
      ...(out.url ? { url: out.url } : {}),
    });
  }

  // All other providers — surface a clear "API key required" error so the
  // UI can prompt the user to add the credential. We intentionally do NOT
  // fall back to a mocked response.
  const envVar = PROVIDER_ENV_VAR[schema.provider] ?? "";
  return NextResponse.json(
    {
      ok: false,
      provider: schema.provider,
      missingEnv: envVar,
      error: envVar
        ? `${schema.displayName} requires ${envVar} to be configured on the server`
        : `${schema.displayName} is not yet wired up to a provider`,
    },
    { status: 501 }
  );
}
