import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

export type FlowAccountStatus =
  | "connected"
  | "needs_login"
  | "credit_exhausted"
  | "generation_failed";

export interface FlowQuotaSnapshot {
  remainingCredits?: number | null;
  paygateTier?: string | null;
  checkedAt?: number | null;
  lastError?: string | null;
  raw?: unknown;
}

export interface FlowAccount {
  id: string;
  label: string;
  email?: string | null;
  profilePath: string;
  active: boolean;
  status: FlowAccountStatus;
  createdAt: number;
  updatedAt: number;
  lastError?: string | null;
  browserSource?: "local" | "gpm" | null;
  gpmProfileId?: string | null;
  gpmProfileName?: string | null;
  gpmBrowser?: string | null;
  extensionInstanceId?: string | null;
  priority?: number | null;
  disabled?: boolean | null;
  quota?: FlowQuotaSnapshot | null;
}

export type FlowMediaType = "image" | "video";
export type FlowMediaSource = "connected" | "workflow-output" | "generated-output";

export interface FlowUploadedAsset {
  hash: string;
  type: FlowMediaType;
  filename: string;
  path?: string;
  source: FlowMediaSource;
  uploadedAt: number;
}

export interface FlowProject {
  accountId: string;
  workflowId: string;
  workflowName?: string | null;
  projectUrl: string;
  projectId?: string | null;
  uploadedAssets: Record<string, FlowUploadedAsset>;
  createdAt: number;
  updatedAt: number;
}

interface FlowAccountsFile {
  accounts: FlowAccount[];
}

interface FlowProjectsFile {
  projects: FlowProject[];
}

function getConfigRoot(): string {
  if (process.env.NODE_BANANA_FLOW_DIR) {
    return process.env.NODE_BANANA_FLOW_DIR;
  }

  const platformConfigRoot =
    process.platform === "win32"
      ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");

  return path.join(platformConfigRoot, "node-banana");
}

export function getFlowBaseDir(): string {
  return getConfigRoot();
}

export function getFlowProfilesDir(): string {
  return path.join(getFlowBaseDir(), "flow-profiles");
}

export function getFlowResultsDir(): string {
  return path.join(getFlowBaseDir(), "flow-results");
}

export function getFlowResultFilePath(taskId: string): string {
  return path.join(getFlowResultsDir(), `${taskId}.mp4`);
}

function getAccountsFilePath(): string {
  return path.join(getFlowBaseDir(), "flow-accounts.json");
}

function getProjectsFilePath(): string {
  return path.join(getFlowBaseDir(), "flow-projects.json");
}

async function ensureFlowDirs(): Promise<void> {
  await fs.mkdir(getFlowProfilesDir(), { recursive: true });
  await fs.mkdir(getFlowResultsDir(), { recursive: true });
}

async function readAccountsFile(): Promise<FlowAccountsFile> {
  await ensureFlowDirs();
  try {
    const raw = await fs.readFile(getAccountsFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as FlowAccountsFile;
    return { accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { accounts: [] };
    }
    throw error;
  }
}

async function writeAccountsFile(file: FlowAccountsFile): Promise<void> {
  await ensureFlowDirs();
  await fs.writeFile(getAccountsFilePath(), JSON.stringify(file, null, 2), "utf-8");
}

async function readProjectsFile(): Promise<FlowProjectsFile> {
  await ensureFlowDirs();
  try {
    const raw = await fs.readFile(getProjectsFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as FlowProjectsFile;
    return { projects: Array.isArray(parsed.projects) ? parsed.projects : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { projects: [] };
    }
    throw error;
  }
}

async function writeProjectsFile(file: FlowProjectsFile): Promise<void> {
  await ensureFlowDirs();
  await fs.writeFile(getProjectsFilePath(), JSON.stringify(file, null, 2), "utf-8");
}

function sanitizeAccount(account: FlowAccount): FlowAccount {
  return {
    id: account.id,
    label: account.label,
    email: account.email ?? null,
    profilePath: account.profilePath,
    active: account.active,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastError: account.lastError ?? null,
    browserSource: account.browserSource ?? null,
    gpmProfileId: account.gpmProfileId ?? null,
    gpmProfileName: account.gpmProfileName ?? null,
    gpmBrowser: account.gpmBrowser ?? null,
    extensionInstanceId: account.extensionInstanceId ?? null,
    priority: typeof account.priority === "number" ? account.priority : null,
    disabled: account.disabled ?? false,
    quota: account.quota ?? null,
  };
}

export async function listFlowAccounts(): Promise<FlowAccount[]> {
  const file = await readAccountsFile();
  return file.accounts.map(sanitizeAccount);
}

export async function getFlowAccount(id: string): Promise<FlowAccount | null> {
  const accounts = await listFlowAccounts();
  return accounts.find((account) => account.id === id) ?? null;
}

export async function getActiveFlowAccount(): Promise<FlowAccount | null> {
  const accounts = await listFlowAccounts();
  return accounts.find((account) => account.active) ?? accounts[0] ?? null;
}

export async function createFlowAccount(input: Partial<Pick<
  FlowAccount,
  | "label"
  | "email"
  | "profilePath"
  | "active"
  | "status"
  | "lastError"
  | "browserSource"
  | "gpmProfileId"
  | "gpmProfileName"
  | "gpmBrowser"
  | "extensionInstanceId"
  | "priority"
  | "disabled"
  | "quota"
>> = {}): Promise<FlowAccount> {
  const file = await readAccountsFile();
  const now = Date.now();
  const id = `flow_${now}_${randomUUID().slice(0, 8)}`;
  const account: FlowAccount = {
    id,
    label: input.label ?? `Flow Account ${file.accounts.length + 1}`,
    email: input.email ?? null,
    profilePath: input.profilePath ?? path.join(getFlowProfilesDir(), id),
    active: input.active ?? file.accounts.length === 0,
    status: input.status ?? "needs_login",
    createdAt: now,
    updatedAt: now,
    lastError: input.lastError ?? null,
    browserSource: input.browserSource ?? null,
    gpmProfileId: input.gpmProfileId ?? null,
    gpmProfileName: input.gpmProfileName ?? null,
    gpmBrowser: input.gpmBrowser ?? null,
    extensionInstanceId: input.extensionInstanceId ?? null,
    priority: input.priority ?? file.accounts.length,
    disabled: input.disabled ?? false,
    quota: input.quota ?? null,
  };

  if (account.active) {
    file.accounts = file.accounts.map((existing) => ({ ...existing, active: false }));
  }
  file.accounts.push(account);
  await writeAccountsFile(file);
  await fs.mkdir(account.profilePath, { recursive: true });
  return sanitizeAccount(account);
}

export async function updateFlowAccount(
  id: string,
  updates: Partial<
    Pick<
      FlowAccount,
      | "label"
      | "email"
      | "active"
      | "status"
      | "lastError"
      | "browserSource"
      | "gpmProfileId"
      | "gpmProfileName"
      | "gpmBrowser"
      | "extensionInstanceId"
      | "priority"
      | "disabled"
      | "quota"
    >
  >
): Promise<FlowAccount | null> {
  const file = await readAccountsFile();
  const index = file.accounts.findIndex((account) => account.id === id);
  if (index === -1) return null;

  const now = Date.now();
  file.accounts = file.accounts.map((account) => {
    if (updates.active && account.id !== id) {
      return { ...account, active: false, updatedAt: now };
    }
    if (account.id !== id) return account;
    return {
      ...account,
      ...updates,
      updatedAt: now,
    };
  });

  await writeAccountsFile(file);
  return sanitizeAccount(file.accounts.find((account) => account.id === id)!);
}

export async function activateFlowAccount(id: string): Promise<FlowAccount | null> {
  return updateFlowAccount(id, { active: true });
}

export async function deleteFlowAccount(id: string): Promise<boolean> {
  const file = await readAccountsFile();
  const account = file.accounts.find((candidate) => candidate.id === id);
  if (!account) return false;

  const profilesRoot = path.resolve(getFlowProfilesDir());
  const profilePath = path.resolve(account.profilePath);
  if (profilePath.startsWith(profilesRoot + path.sep)) {
    await fs.rm(profilePath, { recursive: true, force: true });
  }

  const remaining = file.accounts.filter((candidate) => candidate.id !== id);
  if (account.active && remaining.length > 0) {
    remaining[0] = { ...remaining[0], active: true, updatedAt: Date.now() };
  }
  await writeAccountsFile({ accounts: remaining });
  return true;
}

function sanitizeProject(project: FlowProject): FlowProject {
  return {
    ...project,
    workflowName: project.workflowName ?? null,
    projectId: project.projectId ?? null,
    uploadedAssets: project.uploadedAssets ?? {},
  };
}

export async function getFlowProject(accountId: string, workflowId: string): Promise<FlowProject | null> {
  const file = await readProjectsFile();
  const project = file.projects.find(
    (candidate) => candidate.accountId === accountId && candidate.workflowId === workflowId
  );
  return project ? sanitizeProject(project) : null;
}

export async function upsertFlowProject(input: {
  accountId: string;
  workflowId: string;
  workflowName?: string | null;
  projectUrl: string;
  projectId?: string | null;
}): Promise<FlowProject> {
  const file = await readProjectsFile();
  const now = Date.now();
  const index = file.projects.findIndex(
    (project) => project.accountId === input.accountId && project.workflowId === input.workflowId
  );

  if (index === -1) {
    const created: FlowProject = {
      accountId: input.accountId,
      workflowId: input.workflowId,
      workflowName: input.workflowName ?? null,
      projectUrl: input.projectUrl,
      projectId: input.projectId ?? null,
      uploadedAssets: {},
      createdAt: now,
      updatedAt: now,
    };
    file.projects.push(created);
    await writeProjectsFile(file);
    return sanitizeProject(created);
  }

  const existing = file.projects[index];
  const updated: FlowProject = {
    ...existing,
    workflowName: input.workflowName ?? existing.workflowName ?? null,
    projectUrl: input.projectUrl,
    projectId: input.projectId ?? existing.projectId ?? null,
    uploadedAssets: existing.uploadedAssets ?? {},
    updatedAt: now,
  };
  file.projects[index] = updated;
  await writeProjectsFile(file);
  return sanitizeProject(updated);
}

export async function markFlowAssetUploaded(input: {
  accountId: string;
  workflowId: string;
  workflowName?: string | null;
  projectUrl: string;
  projectId?: string | null;
  asset: FlowUploadedAsset;
}): Promise<FlowProject> {
  const project = await upsertFlowProject(input);
  const file = await readProjectsFile();
  const index = file.projects.findIndex(
    (candidate) => candidate.accountId === input.accountId && candidate.workflowId === input.workflowId
  );
  const updated: FlowProject = {
    ...project,
    uploadedAssets: {
      ...project.uploadedAssets,
      [input.asset.hash]: input.asset,
    },
    updatedAt: Date.now(),
  };

  if (index === -1) {
    file.projects.push(updated);
  } else {
    file.projects[index] = updated;
  }

  await writeProjectsFile(file);
  return sanitizeProject(updated);
}

export async function getActiveFlowProject(workflowId: string): Promise<FlowProject | null> {
  const account = await getActiveFlowAccount();
  if (!account) return null;
  return getFlowProject(account.id, workflowId);
}
