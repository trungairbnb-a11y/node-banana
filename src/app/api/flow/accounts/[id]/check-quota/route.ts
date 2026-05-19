import { NextRequest, NextResponse } from "next/server";
import { checkFlowAccountQuota } from "@/lib/flow/router";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await checkFlowAccountQuota(decodeURIComponent(id));
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to check Flow quota",
        quota: (error as { quota?: unknown })?.quota,
      },
      { status: 400 }
    );
  }
}
