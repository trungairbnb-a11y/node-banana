import { basename } from "path";
import {
  getCachedImageMedia,
  hashBuffer,
  setCachedImageMedia,
} from "./registry";
import { uploadImage } from "./sdk";
import type { FlowBridgeTarget } from "./bridge";

export interface NormalizedMedia {
  buffer: Buffer;
  base64: string;
  mimeType: string;
  hash: string;
  fileName: string;
}

function parseDataUrl(value: string): NormalizedMedia | null {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const buffer = Buffer.from(match[2], "base64");
  const hash = hashBuffer(buffer);
  return {
    buffer,
    base64: match[2],
    mimeType,
    hash,
    fileName: `banana-${hash.slice(0, 12)}.${extensionForMime(mimeType)}`,
  };
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "bin";
}

function toAbsoluteUrl(value: string, requestOrigin?: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/") && requestOrigin) return `${requestOrigin.replace(/\/+$/, "")}${value}`;
  return value;
}

export async function normalizeImage(value: string, requestOrigin?: string): Promise<NormalizedMedia> {
  const parsed = parseDataUrl(value);
  if (parsed) return parsed;

  const url = toAbsoluteUrl(value, requestOrigin);
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Flow image input must be a data URL or HTTP URL");
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to read Flow image input: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  const hash = hashBuffer(buffer);
  const urlName = (() => {
    try {
      return basename(new URL(url).pathname) || "";
    } catch {
      return "";
    }
  })();
  return {
    buffer,
    base64: buffer.toString("base64"),
    mimeType: contentType.split(";")[0],
    hash,
    fileName: urlName || `banana-${hash.slice(0, 12)}.${extensionForMime(contentType)}`,
  };
}

export async function ensureFlowImage(input: {
  accountId?: string | null;
  bridgeTarget?: FlowBridgeTarget;
  projectId: string;
  image: string;
  requestOrigin?: string;
}): Promise<{ mediaId: string; hash: string }> {
  const normalized = await normalizeImage(input.image, input.requestOrigin);
  const cached = await getCachedImageMedia(input.projectId, normalized.hash, input.accountId);
  if (cached?.mediaId) {
    return { mediaId: cached.mediaId, hash: normalized.hash };
  }

  const mediaId = await uploadImage({
    projectId: input.projectId,
    imageBase64: normalized.base64,
    mimeType: normalized.mimeType,
    fileName: normalized.fileName,
    bridgeTarget: input.bridgeTarget,
  });

  await setCachedImageMedia({
    accountId: input.accountId ?? null,
    projectId: input.projectId,
    hash: normalized.hash,
    mediaId,
    mimeType: normalized.mimeType,
    createdAt: Date.now(),
  });

  return { mediaId, hash: normalized.hash };
}
