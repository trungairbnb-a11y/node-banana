/**
 * /api/cloudinary/upload
 *
 * Server-side handler for the X-Node `cloudinaryUpload` node. Matches the
 * request/response contract from the netlify bundle exactly.
 *
 * Request body:
 *   {
 *     inputType: "image" | "video" | "audio" | "text",
 *     data: string,           // base64 data URL or raw text
 *     cloudName: string,      // user's Cloudinary cloud name (per-node)
 *     apiKey: string,         // for unsigned upload, this is the upload_preset name
 *     fileName?: string,
 *   }
 *
 * Request headers:
 *   X-Cloudinary-API-Secret (optional) — if present, we sign the upload with
 *                                        api_secret instead of using an
 *                                        upload_preset. Falls back to
 *                                        CLOUDINARY_API_SECRET env var.
 *
 * Response on success (200):
 *   {
 *     success: true,
 *     url: string,
 *     publicId: string | null,
 *     resourceType: "image" | "video" | "raw" | "auto",
 *     mimeType: string,
 *     size: number,
 *   }
 *
 * Response on failure (4xx/5xx):
 *   { success: false, error: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

export const maxDuration = 120;

interface CloudinaryUploadRequest {
  inputType?: "image" | "video" | "audio" | "text";
  data?: string;
  cloudName?: string;
  apiKey?: string;
  fileName?: string;
}

interface CloudinaryUploadOk {
  success: true;
  url: string;
  publicId: string | null;
  resourceType: string;
  mimeType: string;
  size: number;
}

interface CloudinaryUploadErr {
  success: false;
  error: string;
}

function parseDataUrl(input: string): { mimeType: string; data: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(input.trim());
  if (!match) return null;
  return { mimeType: match[1], data: Buffer.from(match[2], "base64") };
}

function extFromMime(mime: string): string {
  const subtype = mime.split("/")[1]?.split(";")[0] ?? "bin";
  return subtype === "jpeg" ? "jpg" : subtype === "mpeg" ? "mp3" : subtype;
}

// Cloudinary's resource_type buckets: image / video / raw. Audio is stored
// as video; everything else goes to raw.
function resourceTypeFor(inputType: string, mimeType: string): "image" | "video" | "raw" {
  if (inputType === "image" || mimeType.startsWith("image/")) return "image";
  if (inputType === "video" || mimeType.startsWith("video/")) return "video";
  if (inputType === "audio" || mimeType.startsWith("audio/")) return "video";
  return "raw";
}

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<CloudinaryUploadOk | CloudinaryUploadErr>> {
  let body: CloudinaryUploadRequest;
  try {
    body = (await request.json()) as CloudinaryUploadRequest;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { inputType, data, cloudName, apiKey, fileName: requestedName } = body;
  if (!inputType || !data) {
    return NextResponse.json(
      { success: false, error: "Both 'inputType' and 'data' are required" },
      { status: 400 }
    );
  }
  if (!cloudName?.trim()) {
    return NextResponse.json(
      { success: false, error: "'cloudName' is required" },
      { status: 400 }
    );
  }
  if (!apiKey?.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: "'apiKey' is required (use your upload_preset name for unsigned uploads)",
      },
      { status: 400 }
    );
  }

  let mimeType: string;
  let bytes: Buffer;
  if (inputType === "text") {
    mimeType = "text/plain";
    bytes = Buffer.from(data, "utf-8");
  } else {
    const parsed = parseDataUrl(data);
    if (!parsed) {
      return NextResponse.json(
        { success: false, error: "Input data is not a base64 data URL" },
        { status: 400 }
      );
    }
    mimeType = parsed.mimeType;
    bytes = parsed.data;
  }

  const fileName = requestedName?.trim() || `upload-${Date.now()}.${extFromMime(mimeType)}`;
  const publicId = fileName.replace(/\.[^.]+$/, "");
  const resourceType = resourceTypeFor(inputType, mimeType);

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  formData.append("file", blob, fileName);
  formData.append("public_id", publicId);

  // Signed upload mode — if api_secret is provided, sign the request with
  // sha1(params + secret) per Cloudinary's auth spec. Otherwise treat apiKey
  // as the unsigned upload_preset name (the netlify mode).
  const apiSecret =
    request.headers.get("X-Cloudinary-API-Secret") ?? process.env.CLOUDINARY_API_SECRET ?? null;
  if (apiSecret) {
    const timestamp = Math.floor(Date.now() / 1000);
    // Params to sign — Cloudinary requires alphabetical order, exclude
    // file/api_key/signature/cloud_name/resource_type.
    const toSign = `public_id=${publicId}&timestamp=${timestamp}`;
    const signature = sha1(toSign + apiSecret);
    formData.append("api_key", apiKey);
    formData.append("timestamp", String(timestamp));
    formData.append("signature", signature);
  } else {
    formData.append("upload_preset", apiKey);
  }

  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${resourceType}/upload`;

  let uploadRes: Response;
  try {
    uploadRes = await fetch(url, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `Cloudinary upload network error: ${message}` },
      { status: 502 }
    );
  }

  const json = (await uploadRes.json().catch(() => ({}))) as {
    secure_url?: string;
    url?: string;
    public_id?: string;
    resource_type?: string;
    bytes?: number;
    error?: { message?: string };
  };

  if (!uploadRes.ok) {
    return NextResponse.json(
      {
        success: false,
        error:
          json.error?.message ??
          `Cloudinary upload failed (${uploadRes.status})`,
      },
      { status: 502 }
    );
  }

  const finalUrl = json.secure_url ?? json.url ?? null;
  if (!finalUrl) {
    return NextResponse.json(
      { success: false, error: "Cloudinary upload succeeded but no URL was returned" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    url: finalUrl,
    publicId: json.public_id ?? null,
    resourceType: json.resource_type ?? resourceType,
    mimeType,
    size: json.bytes ?? bytes.length,
  });
}
