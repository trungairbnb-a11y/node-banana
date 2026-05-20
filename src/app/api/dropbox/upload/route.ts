/**
 * /api/dropbox/upload
 *
 * Server-side handler for the X-Node `dropboxUpload` node. Matches the
 * request/response contract used by the netlify bundle exactly so the
 * client code in `dropboxUploadExecutor` does not need to know we are
 * the implementation.
 *
 * Request body:
 *   {
 *     inputType: "image" | "video" | "audio" | "text",
 *     data: string,           // base64 data URL (image/video/audio) or text
 *     folderPath: string,
 *     fileName?: string,
 *   }
 *
 * Request headers:
 *   X-Dropbox-API-Key (optional) — user-provided access token; falls back to
 *                                  DROPBOX_ACCESS_TOKEN env var.
 *
 * Response on success (200):
 *   { success: true, url: string, path: string, mimeType: string, size: number }
 *
 * Response on failure (4xx/5xx):
 *   { success: false, error: string }
 */
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;

interface DropboxUploadRequest {
  inputType?: "image" | "video" | "audio" | "text";
  data?: string;
  folderPath?: string;
  fileName?: string;
}

interface DropboxUploadOk {
  success: true;
  url: string;
  path: string;
  mimeType: string;
  size: number;
}

interface DropboxUploadErr {
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

function dropboxPath(folderPath: string | undefined, fileName: string): string {
  const folder = (folderPath ?? "/node-banana").trim() || "/node-banana";
  const normalisedFolder = folder.startsWith("/") ? folder : `/${folder}`;
  return `${normalisedFolder.replace(/\/+$/, "")}/${fileName.replace(/^\/+/, "")}`;
}

async function createSharedLink(accessToken: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(
      "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path, settings: { requested_visibility: "public" } }),
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (res.ok) {
      const json = (await res.json()) as { url?: string };
      return json.url ?? null;
    }
    if (res.status === 409) {
      // Already shared — fetch existing link
      const list = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path, direct_only: true }),
        signal: AbortSignal.timeout(30_000),
      });
      if (list.ok) {
        const json = (await list.json()) as { links?: Array<{ url?: string }> };
        return json.links?.[0]?.url ?? null;
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse<DropboxUploadOk | DropboxUploadErr>> {
  let body: DropboxUploadRequest;
  try {
    body = (await request.json()) as DropboxUploadRequest;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const accessToken =
    request.headers.get("X-Dropbox-API-Key") ?? process.env.DROPBOX_ACCESS_TOKEN ?? null;
  if (!accessToken) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Dropbox access token is required. Set DROPBOX_ACCESS_TOKEN on the server or pass X-Dropbox-API-Key.",
      },
      { status: 401 }
    );
  }

  const { inputType, data, folderPath, fileName: requestedName } = body;
  if (!inputType || !data) {
    return NextResponse.json(
      { success: false, error: "Both 'inputType' and 'data' are required" },
      { status: 400 }
    );
  }

  // For media uploads the client sends a base64 data URL. For text inputs we
  // upload the raw string with mime text/plain.
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

  const fileName =
    (requestedName?.trim() ?? "") || `upload-${Date.now()}.${extFromMime(mimeType)}`;
  const path = dropboxPath(folderPath, fileName);

  // 1. Upload
  let uploadRes: Response;
  try {
    uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Dropbox-API-Arg": JSON.stringify({
          path,
          mode: "overwrite",
          autorename: false,
          mute: true,
        }),
        "Content-Type": "application/octet-stream",
      },
      body: bytes as unknown as BodyInit,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `Dropbox upload network error: ${message}` },
      { status: 502 }
    );
  }

  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    return NextResponse.json(
      {
        success: false,
        error: `Dropbox upload failed (${uploadRes.status}): ${text.slice(0, 500)}`,
      },
      { status: 502 }
    );
  }

  // 2. Create / look up shared link
  const sharedUrl = await createSharedLink(accessToken, path);
  // Dropbox shared links serve a preview by default; ?dl=1 streams the
  // raw file, which is what downstream nodes need.
  const directUrl = sharedUrl ? sharedUrl.replace(/[?&]dl=0/, "?dl=1") : null;

  if (!directUrl) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Upload succeeded but Dropbox did not return a shared URL. Check sharing permissions on the access token.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    url: directUrl,
    path,
    mimeType,
    size: bytes.length,
  });
}
