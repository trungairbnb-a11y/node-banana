import * as fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getFlowMediaPath } from "@/lib/flow/registry";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const decoded = decodeURIComponent(taskId);
  if (!/^flow_task_\d+_[a-z0-9-]+$/i.test(decoded)) {
    return NextResponse.json({ success: false, error: "Invalid Flow task id" }, { status: 400 });
  }

  try {
    const buffer = await fs.readFile(getFlowMediaPath(decoded));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: "Flow media not found" }, { status: 404 });
  }
}

