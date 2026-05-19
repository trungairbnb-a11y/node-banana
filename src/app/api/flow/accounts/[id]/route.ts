import { NextRequest, NextResponse } from "next/server";
import { deleteFlowAccount } from "@/lib/flow/store";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const accountId = decodeURIComponent(id);
    const deleted = await deleteFlowAccount(accountId);
  if (!deleted) {
    return NextResponse.json(
      { success: false, error: "Flow account not found" },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true });
}
