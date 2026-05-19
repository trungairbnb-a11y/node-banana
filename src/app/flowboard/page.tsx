"use client";

import { useEffect, useState } from "react";
import { FLOW_MODELS } from "@/lib/flow/modes";
import { FLOWBOARD_RESULT_KEY } from "@/store/utils/localStorage";

interface FlowBridgeStatus {
  attached: boolean;
  connected: boolean;
  flowKeyPresent: boolean;
  tokenAgeMs: number | null;
  expectedBridgeUrl: string | null;
  extensionBridgeUrl: string | null;
  remoteAddress: string | null;
  pending: number;
  lastError: string | null;
}

interface FlowStatusPeer {
  origin: string;
  port: number;
  bridge: FlowBridgeStatus;
}

interface FlowStatusResponse {
  success: boolean;
  server?: {
    origin: string;
    port: number | null;
    pid: number;
  };
  bridge: FlowBridgeStatus;
  peerServers?: FlowStatusPeer[];
  tasks: Array<{
    id: string;
    mode: string;
    status: string;
    modelName: string;
    outputUrl?: string | null;
    error?: string | null;
    createdAt: number;
  }>;
}

export default function FlowboardPage() {
  const [state, setState] = useState<FlowStatusResponse | null>(null);
  const [mode, setMode] = useState(FLOW_MODELS[0].id);
  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState("");
  const [extraRefs, setExtraRefs] = useState("");
  const [startImage, setStartImage] = useState("");
  const [endImage, setEndImage] = useState("");
  const [videoInput, setVideoInput] = useState("");
  const [seedPrompt, setSeedPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("4K");
  const [submitting, setSubmitting] = useState(false);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedModel = FLOW_MODELS.find((model) => model.id === mode) ?? FLOW_MODELS[0];
  const flowMode = selectedModel.mode;
  const connectedPeer = state?.peerServers?.find((peer) => peer.bridge.connected);
  const bridgeUrl = state?.bridge.extensionBridgeUrl || state?.bridge.expectedBridgeUrl || "-";
  const bridgeWarning = getBridgeWarning(state, connectedPeer);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const response = await fetch("/api/flow/status", { cache: "no-store" });
      const json = await response.json();
      if (!cancelled) setState(json);
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-6 py-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Flowboard</h1>
            <p className="text-sm text-neutral-400">Google Flow control center for Banana Node video tasks.</p>
          </div>
          <button
            type="button"
            className="rounded border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800"
            onClick={() => window.open("https://labs.google/fx/tools/flow", "_blank")}
          >
            Open Google Flow
          </button>
        </header>

        {bridgeWarning && (
          <section className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            <div className="font-medium">{bridgeWarning.title}</div>
            <div className="mt-1 text-amber-100/80">{bridgeWarning.body}</div>
            {connectedPeer && (
              <a className="mt-2 inline-block text-xs text-blue-300 hover:text-blue-200" href={connectedPeer.origin}>
                Open Banana on {connectedPeer.origin}
              </a>
            )}
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-5">
          <StatusTile label="Bridge" value={state?.bridge.connected ? "Connected" : "Offline"} />
          <StatusTile label="Token" value={state?.bridge.flowKeyPresent ? "Captured" : "Missing"} />
          <StatusTile label="Pending" value={String(state?.bridge.pending ?? 0)} />
          <StatusTile
            label="Token Age"
            value={state?.bridge.tokenAgeMs == null ? "-" : `${Math.round(state.bridge.tokenAgeMs / 60000)}m`}
          />
          <StatusTile label="Bridge URL" value={bridgeUrl} />
        </section>

        <section className="rounded border border-neutral-800 bg-neutral-900/50 p-4">
          <label className="block text-xs uppercase tracking-wide text-neutral-500">Flow Mode</label>
          <select
            className="mt-2 w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            {FLOW_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-neutral-500">
            Use this same mode from a Generate Video node to write output back into the Banana workflow.
          </p>
        </section>

        <section className="rounded border border-neutral-800 bg-neutral-900/50 p-4">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-sm font-medium">Generate</h2>
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span>{flowMode}</span>
              {submitting && <span className="text-amber-400">running</span>}
            </div>
          </div>

          <form className="grid gap-4" onSubmit={handleGenerate}>
            {flowMode !== "upscale-video" && (
              <label className="grid gap-1 text-sm">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Prompt</span>
                <textarea
                  className="min-h-24 rounded border border-neutral-700 bg-neutral-950 px-3 py-2"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>
            )}

            {flowMode === "reference-video" && (
              <UrlListField
                label="Refs"
                value={referenceImages}
                onChange={setReferenceImages}
                placeholder="One image URL or data URL per line"
              />
            )}

            {(flowMode === "start-image-video" || flowMode === "compose-start-video" || flowMode === "start-end-frame") && (
              <TextField label="Start" value={startImage} onChange={setStartImage} placeholder="Image URL or data URL" />
            )}

            {flowMode === "compose-start-video" && (
              <>
                <UrlListField
                  label="Extra Refs"
                  value={extraRefs}
                  onChange={setExtraRefs}
                  placeholder="One reference image URL or data URL per line"
                />
                <TextField
                  label="Seed Prompt"
                  value={seedPrompt}
                  onChange={setSeedPrompt}
                  placeholder="Optional; falls back to Prompt"
                />
              </>
            )}

            {flowMode === "start-end-frame" && (
              <TextField label="End" value={endImage} onChange={setEndImage} placeholder="Image URL or data URL" />
            )}

            {flowMode === "upscale-video" && (
              <TextField label="Video" value={videoInput} onChange={setVideoInput} placeholder="Flow video URL from Banana" />
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {flowMode !== "upscale-video" && (
                <label className="grid gap-1 text-sm">
                  <span className="text-xs uppercase tracking-wide text-neutral-500">Aspect Ratio</span>
                  <select
                    className="rounded border border-neutral-700 bg-neutral-950 px-3 py-2"
                    value={aspectRatio}
                    onChange={(event) => setAspectRatio(event.target.value)}
                  >
                    <option value="16:9">16:9</option>
                    <option value="9:16">9:16</option>
                  </select>
                </label>
              )}
              {flowMode === "upscale-video" && (
                <label className="grid gap-1 text-sm">
                  <span className="text-xs uppercase tracking-wide text-neutral-500">Resolution</span>
                  <select
                    className="rounded border border-neutral-700 bg-neutral-950 px-3 py-2"
                    value={resolution}
                    onChange={(event) => setResolution(event.target.value)}
                  >
                    <option value="1080p">1080p</option>
                    <option value="4K">4K</option>
                  </select>
                </label>
              )}
            </div>

            <div className="flex items-center justify-between gap-4">
              <button
                type="submit"
                disabled={submitting}
                className="rounded border border-neutral-600 px-4 py-2 text-sm hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Generate
              </button>
              <div className="min-w-0 text-right text-xs">
                {error && <div className="text-red-400">{error}</div>}
                {taskMessage && <div className="text-neutral-400">{taskMessage}</div>}
              </div>
            </div>
          </form>
        </section>

        <section className="rounded border border-neutral-800 bg-neutral-900/50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">Recent Flow Tasks</h2>
            {state?.bridge.lastError && <span className="text-xs text-red-400">{state.bridge.lastError}</span>}
          </div>
          <div className="divide-y divide-neutral-800">
            {(state?.tasks ?? []).length === 0 ? (
              <div className="py-6 text-sm text-neutral-500">No Flow tasks yet.</div>
            ) : (
              state!.tasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{task.modelName}</div>
                    <div className="truncate text-xs text-neutral-500">{task.id}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={task.status === "failed" ? "text-red-400" : task.status === "complete" ? "text-emerald-400" : "text-amber-400"}>
                      {task.status}
                    </span>
                    {task.outputUrl && (
                      <a className="text-xs text-blue-400 hover:text-blue-300" href={task.outputUrl} target="_blank">
                        Open
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );

  async function handleGenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setTaskMessage("Submitting to Flow");

    try {
      const refs = splitLines(referenceImages);
      const extras = splitLines(extraRefs);
      const dynamicInputs: Record<string, string | string[]> = {};
      const mediaRefs: Record<string, string | string[]> = {};
      const images: string[] = [];
      const videos: string[] = [];

      if (prompt.trim()) dynamicInputs.prompt = prompt.trim();
      if (flowMode === "reference-video") {
        dynamicInputs.referenceImages = refs;
        mediaRefs.referenceImages = refs;
        images.push(...refs);
      } else if (flowMode === "start-image-video") {
        dynamicInputs.startImage = startImage.trim();
        mediaRefs.startImage = startImage.trim();
        images.push(startImage.trim());
      } else if (flowMode === "compose-start-video") {
        dynamicInputs.startImage = startImage.trim();
        dynamicInputs.extraRefs = extras;
        if (seedPrompt.trim()) dynamicInputs.seedPrompt = seedPrompt.trim();
        mediaRefs.startImage = startImage.trim();
        mediaRefs.extraRefs = extras;
        images.push(startImage.trim(), ...extras);
      } else if (flowMode === "start-end-frame") {
        dynamicInputs.startImage = startImage.trim();
        dynamicInputs.endImage = endImage.trim();
        mediaRefs.startImage = startImage.trim();
        mediaRefs.endImage = endImage.trim();
        images.push(startImage.trim(), endImage.trim());
      } else {
        dynamicInputs.video = videoInput.trim();
        mediaRefs.video = videoInput.trim();
        videos.push(videoInput.trim());
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          selectedModel: {
            provider: "flow",
            modelId: selectedModel.id,
            displayName: selectedModel.name,
          },
          images: images.filter(Boolean),
          videos: videos.filter(Boolean),
          dynamicInputs,
          mediaRefs,
          parameters: {
            aspectRatio,
            resolution,
            seedPrompt: seedPrompt.trim() || undefined,
          },
          workflowId: "flowboard",
          workflowName: "Flowboard",
        }),
      });
      const submit = await response.json();
      if (!response.ok || !submit.success) {
        throw new Error(submit.error || "Flow submit failed");
      }
      if (!submit.polling || !submit.taskId) {
        const finalUrl = submit.videoUrl || submit.video;
        if (!finalUrl) throw new Error("Flow returned no task or video URL");
        publishResult(finalUrl, `flowboard_${Date.now()}`);
        return;
      }

      const finalUrl = await pollTask(submit.taskId);
      publishResult(finalUrl, submit.taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Flow generation failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function pollTask(taskId: string): Promise<string> {
    for (;;) {
      await sleep(10_000);
      setTaskMessage(`Polling ${taskId}`);
      const response = await fetch("/api/generate/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          provider: "flow",
          modelId: selectedModel.id,
          modelName: selectedModel.name,
          mediaType: "video",
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Flow polling failed");
      }
      if (!result.polling) {
        const finalUrl = result.videoUrl || result.video;
        if (!finalUrl) throw new Error("Flow completed without a video URL");
        return finalUrl;
      }
    }
  }

  function publishResult(videoUrl: string, taskId: string) {
    const payload = {
      id: taskId,
      videoUrl,
      modelId: selectedModel.id,
      modelName: selectedModel.name,
      prompt,
      completedAt: Date.now(),
    };
    localStorage.setItem(FLOWBOARD_RESULT_KEY, JSON.stringify(payload));
    setTaskMessage("Complete. Sent to Banana canvas.");
  }
}

function getBridgeWarning(
  state: FlowStatusResponse | null,
  connectedPeer?: FlowStatusPeer
): { title: string; body: string } | null {
  if (!state) return null;
  if (connectedPeer && !state.bridge.connected) {
    return {
      title: "Flow extension is connected to another Banana server",
      body: `This window is using ${state.server?.origin ?? "the current server"}, but the extension is connected on ${connectedPeer.origin}. Use that URL or stop the duplicate server process.`,
    };
  }
  if (!state.bridge.attached) {
    return {
      title: "Flow bridge is not attached on this server",
      body: "Start Banana with npm run dev so server.js attaches /flow-bridge. Running Next directly will not expose the extension WebSocket.",
    };
  }
  if (!state.bridge.connected) {
    return {
      title: "Flow extension is offline",
      body: "Load tools/flow-extension in the same GPM profile, then open or refresh https://labs.google/fx/tools/flow.",
    };
  }
  if (!state.bridge.flowKeyPresent) {
    return {
      title: "Flow token has not been captured",
      body: "Open or refresh Google Flow in the GPM profile so the extension can capture the session token.",
    };
  }
  return null;
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/50 p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 break-all text-sm font-medium">{value}</div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs uppercase tracking-wide text-neutral-500">{label}</span>
      <input
        className="rounded border border-neutral-700 bg-neutral-950 px-3 py-2"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function UrlListField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs uppercase tracking-wide text-neutral-500">{label}</span>
      <textarea
        className="min-h-20 rounded border border-neutral-700 bg-neutral-950 px-3 py-2"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
