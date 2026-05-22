import { NextResponse } from "next/server";
import { hasFalKey } from "@/lib/serverEnv";

export interface EnvStatusResponse {
  gemini: boolean;
  openai: boolean;
  ccs: boolean;
  anthropic: boolean;
  replicate: boolean;
  fal: boolean;
  kie: boolean;
  wavespeed: boolean;
  flow: boolean;
  // Additional providers used by X-Node nodes — surface them so the UI can
  // show accurate "API key required" badges without inventing a new endpoint.
  elevenlabs: boolean;
  xai: boolean;
  cloudinary: boolean;
  dropbox: boolean;
  topaz: boolean;
}

export async function GET() {
  // Check which API keys are configured via environment variables
  const status: EnvStatusResponse = {
    gemini: !!process.env.GEMINI_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    ccs: !!process.env.OPENAI_BASE_URL,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    replicate: !!process.env.REPLICATE_API_KEY,
    // Accept either FAL_KEY (X-Node convention) or FAL_API_KEY (legacy)
    fal: hasFalKey(),
    kie: !!process.env.KIE_API_KEY,
    wavespeed: !!process.env.WAVESPEED_API_KEY,
    flow: true,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    xai: !!process.env.XAI_API_KEY,
    cloudinary: !!process.env.CLOUDINARY_API_KEY,
    dropbox: !!process.env.DROPBOX_ACCESS_TOKEN,
    topaz: !!process.env.TOPAZ_API_KEY,
  };

  return NextResponse.json(status);
}
