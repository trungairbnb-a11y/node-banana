export interface ReformatOptions {
  width: number;
  height: number;
  mode: "contain" | "cover" | "stretch";
  background: string;
}

export interface CropOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

export interface ColorCorrectionOptions {
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: number;
  gain?: number;
  gamma?: number;
  blackPoint?: number;
  whitePoint?: number;
  redGain?: number;
  greenGain?: number;
  blueGain?: number;
}

export interface CompositorOptions {
  blendMode: GlobalCompositeOperation;
  opacity: number;
}

export type ActionDirectorMapMode = "pose" | "depth" | "canny" | "normal" | "shaded" | "alpha";

export interface ActionDirectorImageOutputs {
  pose: string;
  depth: string;
  canny: string;
  normal: string;
  shaded: string;
  alpha: string;
}

export interface ActionDirectorVideoOutputs {
  poseVideo: string;
  depthVideo: string;
  cannyVideo: string;
  normalVideo: string;
  shadedVideo: string;
  alphaVideo: string;
}

function assertBrowserApi(name: string, value: unknown): void {
  if (!value) {
    throw new Error(`${name} is not available in this browser context`);
  }
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  assertBrowserApi("Image", typeof Image !== "undefined" ? Image : undefined);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = src;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create 2D canvas context");
  return ctx;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export async function blurImage(source: string, radius: number): Promise<string> {
  const image = await loadImage(source);
  const canvas = createCanvas(image.naturalWidth, image.naturalHeight);
  const ctx = get2d(canvas);
  ctx.filter = `blur(${Math.max(0, radius)}px)`;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasToPng(canvas);
}

export async function reformatImage(source: string, options: ReformatOptions): Promise<string> {
  const image = await loadImage(source);
  const canvas = createCanvas(options.width, options.height);
  const ctx = get2d(canvas);
  ctx.fillStyle = options.background || "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (options.mode === "stretch") {
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvasToPng(canvas);
  }

  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = canvas.width / canvas.height;
  const contain = options.mode === "contain";
  const useWidth = contain ? sourceRatio > targetRatio : sourceRatio < targetRatio;
  const drawWidth = useWidth ? canvas.width : canvas.height * sourceRatio;
  const drawHeight = useWidth ? canvas.width / sourceRatio : canvas.height;
  const x = (canvas.width - drawWidth) / 2;
  const y = (canvas.height - drawHeight) / 2;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
  return canvasToPng(canvas);
}

export async function cropImage(source: string, options: CropOptions): Promise<string> {
  const image = await loadImage(source);
  const x = Math.max(0, Math.min(100, options.x)) / 100;
  const y = Math.max(0, Math.min(100, options.y)) / 100;
  const width = Math.max(1, Math.min(100, options.width)) / 100;
  const height = Math.max(1, Math.min(100, options.height)) / 100;
  const sx = Math.round(image.naturalWidth * x);
  const sy = Math.round(image.naturalHeight * y);
  const sw = Math.max(1, Math.min(image.naturalWidth - sx, Math.round(image.naturalWidth * width)));
  const sh = Math.max(1, Math.min(image.naturalHeight - sy, Math.round(image.naturalHeight * height)));
  const canvas = createCanvas(sw, sh);
  const ctx = get2d(canvas);
  ctx.save();
  ctx.translate(options.flipHorizontal ? canvas.width : 0, options.flipVertical ? canvas.height : 0);
  ctx.scale(options.flipHorizontal ? -1 : 1, options.flipVertical ? -1 : 1);
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  return canvasToPng(canvas);
}

export async function colorCorrectImage(
  source: string,
  options: ColorCorrectionOptions
): Promise<string> {
  const image = await loadImage(source);
  const canvas = createCanvas(image.naturalWidth, image.naturalHeight);
  const ctx = get2d(canvas);
  ctx.filter = [
    `brightness(${Math.max(0, options.brightness)}%)`,
    `contrast(${Math.max(0, options.contrast)}%)`,
    `saturate(${Math.max(0, options.saturation)}%)`,
    `grayscale(${Math.max(0, Math.min(100, options.grayscale))}%)`,
  ].join(" ");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const needsLevels =
    options.gain !== undefined ||
    options.gamma !== undefined ||
    options.blackPoint !== undefined ||
    options.whitePoint !== undefined ||
    options.redGain !== undefined ||
    options.greenGain !== undefined ||
    options.blueGain !== undefined;
  if (needsLevels) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    const gain = options.gain ?? 1;
    const gamma = Math.max(0.01, options.gamma ?? 1);
    const black = Math.max(0, Math.min(254, options.blackPoint ?? 0));
    const white = Math.max(black + 1, Math.min(255, options.whitePoint ?? 255));
    const scale = 255 / (white - black);
    const gains = [options.redGain ?? 1, options.greenGain ?? 1, options.blueGain ?? 1];
    for (let i = 0; i < pixels.length; i += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const leveled = Math.max(0, Math.min(255, (pixels[i + channel] - black) * scale));
        const gammaAdjusted = 255 * Math.pow(leveled / 255, 1 / gamma);
        pixels[i + channel] = clampByte(gammaAdjusted * gain * gains[channel]);
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }
  return canvasToPng(canvas);
}

export async function compositeImages(
  base: string,
  overlay: string,
  options: CompositorOptions
): Promise<string> {
  const [baseImage, overlayImage] = await Promise.all([loadImage(base), loadImage(overlay)]);
  const canvas = createCanvas(baseImage.naturalWidth, baseImage.naturalHeight);
  const ctx = get2d(canvas);
  ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = Math.max(0, Math.min(1, options.opacity));
  ctx.globalCompositeOperation = options.blendMode || "source-over";
  ctx.drawImage(overlayImage, 0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return canvasToPng(canvas);
}

export async function actionMapImage(source: string, mode: string): Promise<string> {
  const image = await loadImage(source);
  const canvas = createCanvas(image.naturalWidth, image.naturalHeight);
  const ctx = get2d(canvas);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const width = canvas.width;
  const height = canvas.height;
  const gray = new Uint8ClampedArray(width * height);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    gray[i / 4] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }

  const sample = (x: number, y: number) => {
    const cx = Math.max(0, Math.min(width - 1, x));
    const cy = Math.max(0, Math.min(height - 1, y));
    return gray[cy * width + cx];
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const out = idx * 4;
      const gx =
        -sample(x - 1, y - 1) - 2 * sample(x - 1, y) - sample(x - 1, y + 1) +
        sample(x + 1, y - 1) + 2 * sample(x + 1, y) + sample(x + 1, y + 1);
      const gy =
        -sample(x - 1, y - 1) - 2 * sample(x, y - 1) - sample(x + 1, y - 1) +
        sample(x - 1, y + 1) + 2 * sample(x, y + 1) + sample(x + 1, y + 1);
      const magnitude = Math.min(255, Math.hypot(gx, gy));
      const edge = magnitude > 42 ? 255 : 0;
      const shade = clampByte(128 + (gx - gy) * 0.25);
      const luminance = gray[idx];

      if (mode === "depth") {
        data[out] = data[out + 1] = data[out + 2] = clampByte(255 - luminance * 0.65 + (y / Math.max(1, height)) * 90);
      } else if (mode === "normal") {
        data[out] = clampByte(128 + gx * 0.35);
        data[out + 1] = clampByte(128 + gy * 0.35);
        data[out + 2] = 255;
      } else if (mode === "shaded") {
        data[out] = data[out + 1] = data[out + 2] = shade;
      } else if (mode === "alpha") {
        data[out] = data[out + 1] = data[out + 2] = 255;
        data[out + 3] = clampByte(luminance);
      } else if (mode === "pose") {
        data[out] = edge;
        data[out + 1] = edge ? 210 : 0;
        data[out + 2] = edge ? 80 : 0;
      } else {
        data[out] = data[out + 1] = data[out + 2] = edge;
      }
  }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvasToPng(canvas);
}

function drawActionDirectorFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: ActionDirectorMapMode,
  frame = 0,
  frameCount = 48
): void {
  const t = frameCount > 1 ? frame / (frameCount - 1) : 0;
  const sway = Math.sin(t * Math.PI * 2) * width * 0.035;
  const cx = width / 2 + sway;
  const cy = height * 0.5;
  const scale = Math.min(width, height) / 360;
  const line = Math.max(2, scale * 3);
  const joint = Math.max(3, scale * 5);
  const alphaMode = mode === "alpha";

  ctx.clearRect(0, 0, width, height);
  if (!alphaMode) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    if (mode === "normal") {
      gradient.addColorStop(0, "#1d2f66");
      gradient.addColorStop(0.5, "#16816f");
      gradient.addColorStop(1, "#6b2b74");
    } else if (mode === "depth") {
      gradient.addColorStop(0, "#050505");
      gradient.addColorStop(1, "#d8d8d8");
    } else if (mode === "shaded") {
      gradient.addColorStop(0, "#111111");
      gradient.addColorStop(1, "#555555");
    } else {
      gradient.addColorStop(0, "#050505");
      gradient.addColorStop(1, "#171717");
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  const padX = width * 0.14;
  const padY = height * 0.1;
  if (!alphaMode) {
    ctx.save();
    ctx.strokeStyle = mode === "canny" ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.08)";
    ctx.lineWidth = Math.max(1, scale);
    for (let i = 0; i <= 8; i += 1) {
      const y = height - padY - i * height * 0.055;
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(width - padX, y);
      ctx.stroke();
    }
    for (let i = -4; i <= 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(cx + i * width * 0.08, height - padY);
      ctx.lineTo(cx + i * width * 0.025, height * 0.52);
      ctx.stroke();
    }
    ctx.restore();
  }

  const points = {
    head: [cx, cy - 110 * scale],
    neck: [cx, cy - 82 * scale],
    chest: [cx, cy - 45 * scale],
    pelvis: [cx, cy + 35 * scale],
    leftHand: [cx - 92 * scale, cy - 54 * scale],
    rightHand: [cx + 92 * scale, cy - 54 * scale],
    leftElbow: [cx - 50 * scale, cy - 60 * scale],
    rightElbow: [cx + 50 * scale, cy - 60 * scale],
    leftKnee: [cx - 30 * scale, cy + 102 * scale],
    rightKnee: [cx + 34 * scale, cy + 102 * scale],
    leftFoot: [cx - 48 * scale, cy + 165 * scale],
    rightFoot: [cx + 52 * scale, cy + 165 * scale],
  } satisfies Record<string, [number, number]>;

  const color = (() => {
    if (alphaMode) return "#ffffff";
    if (mode === "depth") return "#f7f7f7";
    if (mode === "canny") return "#ffffff";
    if (mode === "normal") return "#00e4ff";
    if (mode === "shaded") return "#d2d2d2";
    return "#00f090";
  })();

  const stroke = (from: [number, number], to: [number, number], strokeStyle = color) => {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = line;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
  };

  stroke(points.head, points.neck, mode === "pose" ? "#2468ff" : color);
  stroke(points.neck, points.chest);
  stroke(points.chest, points.pelvis);
  stroke(points.neck, points.leftElbow);
  stroke(points.leftElbow, points.leftHand, mode === "pose" ? "#00e4ff" : color);
  stroke(points.neck, points.rightElbow);
  stroke(points.rightElbow, points.rightHand, mode === "pose" ? "#00e4ff" : color);
  stroke(points.pelvis, points.leftKnee);
  stroke(points.leftKnee, points.leftFoot, mode === "pose" ? "#2468ff" : color);
  stroke(points.pelvis, points.rightKnee);
  stroke(points.rightKnee, points.rightFoot, mode === "pose" ? "#2468ff" : color);

  ctx.fillStyle = color;
  Object.entries(points).forEach(([name, [x, y]]) => {
    ctx.beginPath();
    ctx.arc(x, y, name === "head" ? joint * 1.8 : joint, 0, Math.PI * 2);
    ctx.fillStyle = mode === "pose" && (name.includes("Hand") || name.includes("Elbow")) ? "#ff2b2b" : color;
    ctx.fill();
  });
}

export function renderActionDirectorSyntheticFrame(
  width: number,
  height: number,
  mode: ActionDirectorMapMode,
  frame = 0,
  frameCount = 48
): string {
  const canvas = createCanvas(width, height);
  const ctx = get2d(canvas);
  drawActionDirectorFrame(ctx, canvas.width, canvas.height, mode, frame, frameCount);
  return canvasToPng(canvas);
}

export async function renderActionDirectorImageOutputs(
  source: string | null,
  width: number,
  height: number
): Promise<ActionDirectorImageOutputs> {
  if (source) {
    const [pose, depth, canny, normal, shaded, alpha] = await Promise.all([
      actionMapImage(source, "pose"),
      actionMapImage(source, "depth"),
      actionMapImage(source, "canny"),
      actionMapImage(source, "normal"),
      actionMapImage(source, "shaded"),
      actionMapImage(source, "alpha"),
    ]);
    return { pose, depth, canny, normal, shaded, alpha };
  }
  const w = Math.max(1, Math.round(width || 512));
  const h = Math.max(1, Math.round(height || 512));
  return {
    pose: renderActionDirectorSyntheticFrame(w, h, "pose"),
    depth: renderActionDirectorSyntheticFrame(w, h, "depth"),
    canny: renderActionDirectorSyntheticFrame(w, h, "canny"),
    normal: renderActionDirectorSyntheticFrame(w, h, "normal"),
    shaded: renderActionDirectorSyntheticFrame(w, h, "shaded"),
    alpha: renderActionDirectorSyntheticFrame(w, h, "alpha"),
  };
}

async function recordActionDirectorMap(
  width: number,
  height: number,
  frameCount: number,
  fps: number,
  mode: ActionDirectorMapMode
): Promise<string> {
  assertBrowserApi("MediaRecorder", typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined);
  const canvas = createCanvas(width, height);
  const ctx = get2d(canvas);
  const stream = canvas.captureStream(Math.max(1, fps));
  const chunks: BlobPart[] = [];
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
      ? "video/webm;codecs=vp8"
      : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType });
  const done = new Promise<string>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error("Action Director video recording failed"));
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      blobToDataUrl(new Blob(chunks, { type: mimeType })).then(resolve, reject);
    };
  });
  recorder.start();
  const frameDelay = 1000 / Math.max(1, fps);
  for (let frame = 0; frame < Math.max(1, frameCount); frame += 1) {
    drawActionDirectorFrame(ctx, canvas.width, canvas.height, mode, frame, frameCount);
    await new Promise((resolve) => setTimeout(resolve, frameDelay));
  }
  recorder.stop();
  return done;
}

export async function bakeActionDirectorVideoOutputs(
  width: number,
  height: number,
  frameCount: number,
  fps: number
): Promise<ActionDirectorVideoOutputs> {
  const w = Math.max(1, Math.round(width || 512));
  const h = Math.max(1, Math.round(height || 512));
  const frames = Math.max(1, Math.min(180, Math.round(frameCount || 48)));
  const rate = Math.max(1, Math.min(60, Math.round(fps || 24)));
  const [poseVideo, depthVideo, cannyVideo, normalVideo, shadedVideo, alphaVideo] = await Promise.all([
    recordActionDirectorMap(w, h, frames, rate, "pose"),
    recordActionDirectorMap(w, h, frames, rate, "depth"),
    recordActionDirectorMap(w, h, frames, rate, "canny"),
    recordActionDirectorMap(w, h, frames, rate, "normal"),
    recordActionDirectorMap(w, h, frames, rate, "shaded"),
    recordActionDirectorMap(w, h, frames, rate, "alpha"),
  ]);
  return { poseVideo, depthVideo, cannyVideo, normalVideo, shadedVideo, alphaVideo };
}

export async function extractVideoFrame(
  source: string,
  timeSeconds: number,
  frameIndex: number,
  fps: number
): Promise<string> {
  assertBrowserApi("HTMLVideoElement", typeof document !== "undefined" ? document : undefined);
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "auto";

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Failed to load video metadata"));
    video.src = source;
  });

  const targetTime = timeSeconds > 0 ? timeSeconds : frameIndex / Math.max(1, fps);
  video.currentTime = Math.min(Math.max(0, targetTime), Number.isFinite(video.duration) ? video.duration : targetTime);
  await new Promise<void>((resolve, reject) => {
    video.onseeked = () => resolve();
    video.onerror = () => reject(new Error("Failed to seek video"));
  });

  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const canvas = createCanvas(width, height);
  get2d(canvas).drawImage(video, 0, 0, width, height);
  video.src = "";
  return canvasToPng(canvas);
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const channelCount = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * channelCount * 2 + 44;
  const arrayBuffer = new ArrayBuffer(length);
  const view = new DataView(arrayBuffer);
  let offset = 0;

  const writeString = (value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset, value.charCodeAt(i));
      offset += 1;
    }
  };

  writeString("RIFF");
  view.setUint32(offset, length - 8, true); offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, channelCount, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * channelCount * 2, true); offset += 4;
  view.setUint16(offset, channelCount * 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeString("data");
  view.setUint32(offset, length - 44, true); offset += 4;

  for (let i = 0; i < buffer.length; i += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to encode blob"));
    reader.readAsDataURL(blob);
  });
}

export async function equalizeAudio(
  source: string,
  options: {
    bass: number;
    mid: number;
    treble: number;
    gain: number;
    bypass: boolean;
    preset?: string;
    tone?: string;
    distance?: number;
    reverbWet?: number;
    pan?: number;
    outputFormat?: string;
  }
): Promise<string> {
  if (options.bypass) return source;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  assertBrowserApi("AudioContext", AudioContextCtor);
  const response = await fetch(source);
  const bytes = await response.arrayBuffer();
  const context = new AudioContextCtor();
  const decoded = await context.decodeAudioData(bytes.slice(0));
  await context.close();

  const offline = new OfflineAudioContext(decoded.numberOfChannels, decoded.length, decoded.sampleRate);
  const input = offline.createBufferSource();
  input.buffer = decoded;

  const preset = options.preset ?? "custom";
  const tone = options.tone ?? "neutral";
  const presetGain = preset === "phone" ? 0.7 : preset === "farRoom" ? 0.85 : 1;
  const toneTilt = tone === "warm" ? -2 : tone === "cold" ? 2 : tone === "muffled" ? -6 : 0;

  const bass = offline.createBiquadFilter();
  bass.type = "lowshelf";
  bass.frequency.value = 180;
  bass.gain.value = options.bass + (tone === "warm" ? 2 : 0);

  const mid = offline.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = 1000;
  mid.Q.value = 1;
  mid.gain.value = options.mid;

  const treble = offline.createBiquadFilter();
  treble.type = "highshelf";
  treble.frequency.value = 4200;
  treble.gain.value = options.treble + toneTilt;

  const gain = offline.createGain();
  gain.gain.value = Math.max(0, options.gain * presetGain * Math.max(0.1, 1 - (options.distance ?? 0) * 0.45));

  const pan = offline.createStereoPanner?.();
  const wet = offline.createGain();
  const dry = offline.createGain();
  wet.gain.value = Math.max(0, Math.min(1, options.reverbWet ?? 0));
  dry.gain.value = 1 - wet.gain.value * 0.35;

  if (pan) pan.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0));

  const delay = offline.createDelay();
  delay.delayTime.value = preset === "hall" ? 0.16 : preset === "smallRoom" ? 0.06 : preset === "anotherRoom" ? 0.1 : 0.03;
  const feedback = offline.createGain();
  feedback.gain.value = preset === "hall" ? 0.35 : 0.16;

  const output = pan ?? offline.destination;
  input.connect(bass).connect(mid).connect(treble).connect(gain);
  gain.connect(dry).connect(output);
  gain.connect(delay).connect(wet).connect(output);
  delay.connect(feedback).connect(delay);
  if (pan) pan.connect(offline.destination);
  input.start(0);
  const rendered = await offline.startRendering();
  return blobToDataUrl(audioBufferToWav(rendered));
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
