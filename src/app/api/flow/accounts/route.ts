import { NextResponse } from "next/server";
import { createFlowAccount, listFlowAccounts } from "@/lib/flow/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const accounts = await listFlowAccounts();
  return NextResponse.json({ success: true, accounts });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const account = await createFlowAccount({
      label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : undefined,
      email: typeof body.email === "string" && body.email.trim() ? body.email.trim() : null,
      profilePath: typeof body.profilePath === "string" && body.profilePath.trim() ? body.profilePath.trim() : undefined,
      browserSource: body.browserSource === "gpm" || body.browserSource === "local" ? body.browserSource : undefined,
      gpmProfileId: typeof body.gpmProfileId === "string" && body.gpmProfileId.trim() ? body.gpmProfileId.trim() : null,
      gpmProfileName: typeof body.gpmProfileName === "string" && body.gpmProfileName.trim() ? body.gpmProfileName.trim() : null,
      gpmBrowser: typeof body.gpmBrowser === "string" && body.gpmBrowser.trim() ? body.gpmBrowser.trim() : null,
      extensionInstanceId: typeof body.extensionInstanceId === "string" && body.extensionInstanceId.trim() ? body.extensionInstanceId.trim() : null,
      priority: typeof body.priority === "number" ? body.priority : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      status: body.status === "connected" || body.status === "needs_login" ? body.status : undefined,
    });
    return NextResponse.json({ success: true, account });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create Flow account" },
      { status: 500 }
    );
  }
}
