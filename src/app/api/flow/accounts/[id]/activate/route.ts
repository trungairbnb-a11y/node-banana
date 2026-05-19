import { NextRequest, NextResponse } from "next/server";
import { activateFlowAccount } from "@/lib/flow/store";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const account = await activateFlowAccount(decodeURIComponent(id));
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Flow account not found" },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true, account });
}
