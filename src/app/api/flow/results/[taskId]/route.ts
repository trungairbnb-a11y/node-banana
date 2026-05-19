import * as fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getFlowResultFilePath } from "@/lib/flow/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const decodedTaskId = decodeURIComponent(taskId);
  if (!/^flow_task_\d+_[a-z0-9]+$/i.test(decodedTaskId)) {
    return NextResponse.json(
      { success: false, error: "Invalid Flow task id" },
      { status: 400 }
    );
  }

  try {
    const buffer = await fs.readFile(getFlowResultFilePath(decodedTaskId));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Flow video not found" },
      { status: 404 }
    );
  }
}
