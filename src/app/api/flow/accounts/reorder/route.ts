import { NextResponse } from "next/server";
import { listFlowAccounts, updateFlowAccount } from "@/lib/flow/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orderedIds: string[] = Array.isArray(body?.accountIds)
      ? body.accountIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
      : [];
    if (orderedIds.length === 0) {
      return NextResponse.json({ success: false, error: "accountIds is required" }, { status: 400 });
    }

    await Promise.all(orderedIds.map((id: string, index: number) => updateFlowAccount(id, { priority: index })));
    const accounts = await listFlowAccounts();
    return NextResponse.json({ success: true, accounts });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to reorder Flow accounts" },
      { status: 500 }
    );
  }
}
