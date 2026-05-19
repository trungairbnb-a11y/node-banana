import { NextResponse } from "next/server";

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
}

export async function GET() {
  // Check which API keys are configured via environment variables
  const status: EnvStatusResponse = {
    gemini: !!process.env.GEMINI_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    ccs: !!process.env.OPENAI_BASE_URL,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    replicate: !!process.env.REPLICATE_API_KEY,
    fal: !!process.env.FAL_API_KEY,
    kie: !!process.env.KIE_API_KEY,
    wavespeed: !!process.env.WAVESPEED_API_KEY,
    flow: true,
  };

  return NextResponse.json(status);
}
