import { NextRequest, NextResponse } from "next/server";
import { pairFlowAccountSession } from "@/lib/flow/router";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const account = await pairFlowAccountSession({
      accountId: decodeURIComponent(id),
      sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
      extensionInstanceId: typeof body.extensionInstanceId === "string" ? body.extensionInstanceId : null,
    });
    return NextResponse.json({ success: true, account });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to pair Flow session" },
      { status: 400 }
    );
  }
}
