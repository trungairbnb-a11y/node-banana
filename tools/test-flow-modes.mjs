#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: npm run test:flow:live

Runs a live Google Flow smoke test through the local Banana API.

Environment:
  FLOW_TEST_BASE_URL              Default: http://127.0.0.1:3001
  FLOW_TEST_IMAGE_A               Default: logs/ccs-proxy-test-gpt-image-2.png
  FLOW_TEST_IMAGE_B               Default: logs/node-banana-ccs-gpt-image-2.png
  FLOW_TEST_UPSCALE_RESOLUTION    Default: 1080p
  FLOW_TEST_POLL_INTERVAL_MS      Default: 15000
  FLOW_TEST_POLL_TIMEOUT_MS       Default: 600000
`);
  process.exit(0);
}

const baseUrl = (process.env.FLOW_TEST_BASE_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
const imageAPath = process.env.FLOW_TEST_IMAGE_A || path.resolve("logs", "ccs-proxy-test-gpt-image-2.png");
const imageBPath = process.env.FLOW_TEST_IMAGE_B || path.resolve("logs", "node-banana-ccs-gpt-image-2.png");
const pollIntervalMs = Number(process.env.FLOW_TEST_POLL_INTERVAL_MS || 15000);
const pollTimeoutMs = Number(process.env.FLOW_TEST_POLL_TIMEOUT_MS || 10 * 60 * 1000);
const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mimeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

async function imageDataUrl(filePath) {
  const buffer = await fs.readFile(filePath);
  return `data:${mimeForFile(filePath)};base64,${buffer.toString("base64")}`;
}

async function requestJson(route, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 180000);
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      method: options.method || "GET",
      headers: options.body ? { "content-type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: response.ok, status: response.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupTask(taskId) {
  try {
    const raw = await fs.readFile(path.resolve("video", "flow", "registry.json"), "utf-8");
    return JSON.parse(raw).tasks?.[taskId] ?? null;
  } catch {
    return null;
  }
}

function model(mode, displayName) {
  return {
    selectedModel: {
      provider: "flow",
      modelId: `flow-veo-3.1/${mode}`,
      displayName,
    },
  };
}

async function submitMode(mode, displayName, body) {
  const response = await requestJson("/api/generate", {
    method: "POST",
    timeoutMs: 180000,
    body: {
      ...model(mode, displayName),
      workflowId: `live_flow_${mode}_${runId}`,
      workflowName: `Live Flow ${mode} ${runId}`,
      ...body,
    },
  });

  if (!response.ok || response.json?.success === false) {
    throw new Error(response.json?.error || `HTTP ${response.status}`);
  }
  if (!response.json?.taskId) {
    throw new Error("Flow submit did not return a taskId");
  }
  return response.json;
}

async function pollTask(task, mode, displayName) {
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const response = await requestJson("/api/generate/poll", {
      method: "POST",
      timeoutMs: 120000,
      body: {
        taskId: task.taskId,
        provider: "flow",
        modelId: `flow-veo-3.1/${mode}`,
        modelName: displayName,
        mediaType: "video",
      },
    });

    if (!response.ok || response.json?.success === false) {
      throw new Error(response.json?.error || `HTTP ${response.status}`);
    }
    if (!response.json?.polling) {
      const stored = await lookupTask(task.taskId);
      return {
        taskId: task.taskId,
        videoUrl: response.json?.videoUrl ?? stored?.outputUrl ?? null,
        localPath: stored?.localPath ?? null,
        mediaId: stored?.outputMediaId ?? null,
      };
    }
  }
  throw new Error(`Timed out after ${Math.round(pollTimeoutMs / 1000)}s`);
}

async function runVideoMode(mode, displayName, body) {
  const startedAt = new Date().toISOString();
  console.log(`\n[flow-live] ${mode}: submitting`);
  try {
    const task = await submitMode(mode, displayName, body);
    console.log(`[flow-live] ${mode}: task ${task.taskId}`);
    const output = await pollTask(task, mode, displayName);
    console.log(`[flow-live] ${mode}: complete ${output.videoUrl || output.localPath || ""}`);
    return { mode, ok: true, startedAt, finishedAt: new Date().toISOString(), ...output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[flow-live] ${mode}: failed ${message}`);
    return { mode, ok: false, startedAt, finishedAt: new Date().toISOString(), error: message };
  }
}

async function main() {
  const [imageA, imageB] = await Promise.all([imageDataUrl(imageAPath), imageDataUrl(imageBPath)]);
  const status = await requestJson("/api/flow/status", { timeoutMs: 30000 });
  const bridge = status.json?.bridge;
  if (!bridge?.connected || !bridge?.flowKeyPresent) {
    throw new Error("Google Flow bridge is not connected or has no Flow token. Open/refresh Google Flow first.");
  }

  const accountId = status.json?.accounts?.find((account) => account.active)?.id
    || status.json?.accounts?.[0]?.id
    || null;
  if (accountId) {
    await requestJson(`/api/flow/accounts/${encodeURIComponent(accountId)}/check-quota`, {
      method: "POST",
      timeoutMs: 30000,
    }).catch(() => null);
  }

  const results = [];
  results.push(await runVideoMode("reference-video", "Flow Reference Video", {
    prompt: "Create a short video using these workspace references while preserving the desk and monitor layout.",
    images: [imageA, imageB],
    dynamicInputs: {
      referenceImages: [imageA, imageB],
      prompt: "Create a short video using these workspace references while preserving the desk and monitor layout.",
    },
    parameters: { aspectRatio: "16:9" },
  }));

  const startResult = await runVideoMode("start-image-video", "Flow Start Image Video", {
    prompt: "Animate this workspace as a subtle slow camera push with realistic lighting.",
    images: [imageA],
    dynamicInputs: {
      startImage: imageA,
      prompt: "Animate this workspace as a subtle slow camera push with realistic lighting.",
    },
    parameters: { aspectRatio: "16:9" },
  });
  results.push(startResult);

  results.push(await runVideoMode("compose-start-video", "Flow Compose Start Video", {
    prompt: "Create a realistic workspace video, using the second image as an extra style and object reference.",
    images: [imageA, imageB],
    dynamicInputs: {
      startImage: imageA,
      extraRefs: [imageB],
      prompt: "Create a realistic workspace video, using the second image as an extra style and object reference.",
      seedPrompt: "Refine the starting frame with the extra reference while preserving the original desk geometry.",
    },
    parameters: { aspectRatio: "16:9" },
  }));

  results.push(await runVideoMode("start-end-frame", "Flow Start/End Frame", {
    prompt: "Transition from the first workspace frame into the second frame with a smooth camera move.",
    images: [imageA, imageB],
    dynamicInputs: {
      startImage: imageA,
      endImage: imageB,
      prompt: "Transition from the first workspace frame into the second frame with a smooth camera move.",
    },
    parameters: { aspectRatio: "16:9" },
  }));

  if (startResult.ok && startResult.videoUrl) {
    results.push(await runVideoMode("upscale-video", "Flow Upscale Video", {
      videos: [startResult.videoUrl],
      mediaRefs: { video: startResult.videoUrl },
      dynamicInputs: { video: startResult.videoUrl },
      parameters: { resolution: process.env.FLOW_TEST_UPSCALE_RESOLUTION || "1080p", aspectRatio: "16:9" },
    }));
  } else {
    results.push({
      mode: "upscale-video",
      ok: false,
      error: "Skipped because start-image-video did not produce a Flow video source.",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
  }

  const finalStatus = await requestJson("/api/flow/status", { timeoutMs: 30000 });
  const report = {
    runId,
    baseUrl,
    imageAPath,
    imageBPath,
    bridge: {
      connected: finalStatus.json?.bridge?.connected ?? null,
      flowKeyPresent: finalStatus.json?.bridge?.flowKeyPresent ?? null,
      activeSessionId: finalStatus.json?.bridge?.activeSessionId ?? null,
    },
    accounts: finalStatus.json?.accounts ?? [],
    results,
  };

  await fs.mkdir(path.resolve("logs"), { recursive: true });
  const reportPath = path.resolve("logs", `flow-live-test-${runId}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n[flow-live] report ${reportPath}`);

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.log(`[flow-live] failed modes: ${failed.map((result) => result.mode).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[flow-live] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
