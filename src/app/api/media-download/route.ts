import { execFile } from "child_process";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const MAX_INLINE_BYTES = 50 * 1024 * 1024;

interface MediaDownloadRequest {
  url?: string;
  format?: "video" | "audio";
  quality?: "best" | "medium" | "low";
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function pickYtDlpFormat(format: "video" | "audio", quality: "best" | "medium" | "low"): string {
  if (format === "audio") {
    if (quality === "low") return "bestaudio[abr<=96]/bestaudio/best";
    if (quality === "medium") return "bestaudio[abr<=160]/bestaudio/best";
    return "bestaudio/best";
  }
  if (quality === "low") return "bestvideo[height<=480]+bestaudio/best[height<=480]/best";
  if (quality === "medium") return "bestvideo[height<=720]+bestaudio/best[height<=720]/best";
  return "bestvideo+bestaudio/best";
}

async function resolveWithYtDlp(
  url: string,
  format: "video" | "audio",
  quality: "best" | "medium" | "low"
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      ["-f", pickYtDlpFormat(format, quality), "-g", url],
      { timeout: 30000, maxBuffer: 1024 * 1024 }
    );
    const resolved = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => isHttpUrl(line));
    return resolved ?? null;
  } catch {
    return null;
  }
}

async function fetchMedia(url: string): Promise<{ media: string; contentType: string; bytes: number }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 NodeBananaMediaDownload/1.0",
      Accept: "video/*,audio/*,*/*",
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength > MAX_INLINE_BYTES) {
    return { media: url, contentType, bytes: contentLength };
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_INLINE_BYTES) {
    return { media: url, contentType, bytes: arrayBuffer.byteLength };
  }

  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return {
    media: `data:${contentType};base64,${base64}`,
    contentType,
    bytes: arrayBuffer.byteLength,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as MediaDownloadRequest;
    const url = (body.url || "").trim();
    const format = body.format === "audio" ? "audio" : "video";
    const quality = body.quality === "medium" || body.quality === "low" ? body.quality : "best";

    if (!isHttpUrl(url)) {
      return NextResponse.json({ error: "A valid http(s) URL is required" }, { status: 400 });
    }

    let targetUrl = url;
    const directExtension = /\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a|flac)(\?|$)/i.test(url);
    if (!directExtension) {
      targetUrl = (await resolveWithYtDlp(url, format, quality)) ?? url;
    }

    const media = await fetchMedia(targetUrl);
    if (!media.contentType.startsWith("audio/") && !media.contentType.startsWith("video/")) {
      return NextResponse.json(
        { error: "URL did not resolve to audio/video media. Install yt-dlp for page URLs." },
        { status: 422 }
      );
    }
    const contentType = format === "audio" && !media.contentType.startsWith("audio/")
      ? "audio/mpeg"
      : media.contentType;

    return NextResponse.json({
      ...media,
      contentType,
      sourceUrl: url,
      resolvedUrl: targetUrl,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Media download failed" },
      { status: 500 }
    );
  }
}
