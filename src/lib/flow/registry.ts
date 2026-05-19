import * as fs from "fs/promises";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import type { FlowVideoMode } from "./modes";
import type { FlowWorkflowRef } from "./sdk";

export type FlowTaskStatus = "processing" | "complete" | "failed";

export interface FlowImageRecord {
  hash: string;
  accountId?: string | null;
  projectId: string;
  mediaId: string;
  mimeType: string;
  sourceUrl?: string | null;
  createdAt: number;
}

export interface FlowVideoRecord {
  taskId: string;
  accountId?: string | null;
  projectId: string;
  mediaId: string;
  url: string;
  localPath: string;
  createdAt: number;
}

export interface FlowTaskRecord {
  id: string;
  mode: FlowVideoMode;
  status: FlowTaskStatus;
  workflowId: string;
  workflowName?: string | null;
  accountId?: string | null;
  sessionId?: string | null;
  extensionInstanceId?: string | null;
  attempts?: Array<{
    accountId?: string | null;
    sessionId?: string | null;
    extensionInstanceId?: string | null;
    status: "failed" | "submitted";
    error?: string | null;
    failureKind?: string | null;
    startedAt: number;
    finishedAt?: number | null;
  }>;
  usedFallbackAccount?: boolean | null;
  quotaSnapshot?: unknown;
  projectId: string;
  prompt: string;
  modelId: string;
  modelName: string;
  operationNames: string[];
  workflows: FlowWorkflowRef[];
  outputMediaId?: string | null;
  outputUrl?: string | null;
  localPath?: string | null;
  error?: string | null;
  generationTrace?: unknown;
  rawSubmit?: unknown;
  rawPoll?: unknown;
  createdAt: number;
  updatedAt: number;
}

interface FlowRegistryFile {
  projects: Record<string, string>;
  images: Record<string, FlowImageRecord>;
  videos: Record<string, FlowVideoRecord>;
  tasks: Record<string, FlowTaskRecord>;
}

function getFlowDir(): string {
  return path.join(process.cwd(), "video", "flow");
}

export function getFlowMediaPath(taskId: string): string {
  return path.join(getFlowDir(), `${taskId}.mp4`);
}

export function getFlowRegistryPath(): string {
  return path.join(getFlowDir(), "registry.json");
}

export function createFlowTaskId(): string {
  return `flow_task_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(getFlowDir(), { recursive: true });
}

async function readRegistry(): Promise<FlowRegistryFile> {
  await ensureDir();
  try {
    const raw = await fs.readFile(getFlowRegistryPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<FlowRegistryFile>;
    return {
      projects: parsed.projects ?? {},
      images: parsed.images ?? {},
      videos: parsed.videos ?? {},
      tasks: parsed.tasks ?? {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { projects: {}, images: {}, videos: {}, tasks: {} };
    }
    throw error;
  }
}

async function writeRegistry(file: FlowRegistryFile): Promise<void> {
  await ensureDir();
  await fs.writeFile(getFlowRegistryPath(), JSON.stringify(file, null, 2), "utf-8");
}

function projectKey(workflowId: string, accountId?: string | null): string {
  return `${accountId || "default"}:${workflowId || "default"}`;
}

function legacyProjectKey(workflowId: string): string {
  return workflowId || "default";
}

function imageKey(projectId: string, hash: string, accountId?: string | null): string {
  return `${accountId || "default"}:${projectId}:${hash}`;
}

function legacyImageKey(projectId: string, hash: string): string {
  return `${projectId}:${hash}`;
}

export async function getProjectIdForWorkflow(workflowId: string, accountId?: string | null): Promise<string | null> {
  const file = await readRegistry();
  if (accountId) return file.projects[projectKey(workflowId, accountId)] ?? null;
  return file.projects[projectKey(workflowId, accountId)] ?? file.projects[legacyProjectKey(workflowId)] ?? null;
}

export async function setProjectIdForWorkflow(
  workflowId: string,
  projectId: string,
  accountId?: string | null
): Promise<void> {
  const file = await readRegistry();
  file.projects[projectKey(workflowId, accountId)] = projectId;
  await writeRegistry(file);
}

export async function getCachedImageMedia(
  projectId: string,
  hash: string,
  accountId?: string | null
): Promise<FlowImageRecord | null> {
  const file = await readRegistry();
  if (accountId) return file.images[imageKey(projectId, hash, accountId)] ?? null;
  return file.images[imageKey(projectId, hash, accountId)] ?? file.images[legacyImageKey(projectId, hash)] ?? null;
}

export async function setCachedImageMedia(record: FlowImageRecord): Promise<void> {
  const file = await readRegistry();
  file.images[imageKey(record.projectId, record.hash, record.accountId)] = record;
  await writeRegistry(file);
}

export async function saveTask(task: FlowTaskRecord): Promise<FlowTaskRecord> {
  const file = await readRegistry();
  file.tasks[task.id] = { ...task, updatedAt: Date.now() };
  await writeRegistry(file);
  return file.tasks[task.id];
}

export async function getTask(taskId: string): Promise<FlowTaskRecord | null> {
  const file = await readRegistry();
  return file.tasks[taskId] ?? null;
}

export async function listTasks(limit = 30): Promise<FlowTaskRecord[]> {
  const file = await readRegistry();
  return Object.values(file.tasks)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function markTaskFailed(taskId: string, error: string): Promise<FlowTaskRecord | null> {
  const task = await getTask(taskId);
  if (!task) return null;
  return saveTask({ ...task, status: "failed", error });
}

export async function markTaskComplete(input: {
  taskId: string;
  mediaId: string;
  localPath: string;
  url: string;
  rawPoll?: unknown;
}): Promise<FlowTaskRecord | null> {
  const file = await readRegistry();
  const task = file.tasks[input.taskId];
  if (!task) return null;

  const updatedTask: FlowTaskRecord = {
    ...task,
    status: "complete",
    outputMediaId: input.mediaId,
    outputUrl: input.url,
    localPath: input.localPath,
    rawPoll: input.rawPoll,
    error: null,
    updatedAt: Date.now(),
  };
  file.tasks[input.taskId] = updatedTask;
  file.videos[input.url] = {
    taskId: input.taskId,
    accountId: task.accountId ?? null,
    projectId: task.projectId,
    mediaId: input.mediaId,
    url: input.url,
    localPath: input.localPath,
    createdAt: Date.now(),
  };
  await writeRegistry(file);
  return updatedTask;
}

export async function findVideoMedia(urlOrTaskId: string): Promise<FlowVideoRecord | null> {
  const file = await readRegistry();
  if (file.videos[urlOrTaskId]) return file.videos[urlOrTaskId];
  const taskIdMatch = urlOrTaskId.match(/flow_task_\d+_[a-z0-9]+/i);
  if (taskIdMatch) {
    const task = file.tasks[taskIdMatch[0]];
    if (task?.outputUrl && file.videos[task.outputUrl]) {
      return file.videos[task.outputUrl];
    }
  }
  return null;
}
