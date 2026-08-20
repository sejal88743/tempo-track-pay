// Lazy face-api.js wrapper — dynamic import so it never runs on SSR.
// Models loaded from CDN on first use.

const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";

let faceapiModule: typeof import("@vladmandic/face-api") | null = null;
let loadedPromise: Promise<void> | null = null;

async function getFaceApi() {
  if (!faceapiModule) {
    faceapiModule = await import("@vladmandic/face-api");
  }
  return faceapiModule;
}

export function loadModels(): Promise<void> {
  if (!loadedPromise) {
    loadedPromise = getFaceApi().then(async (fa) => {
      await Promise.all([
        fa.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        fa.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        fa.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      // Warm the WebGL kernels once so the first real scan is instant.
      try {
        const c = document.createElement("canvas");
        c.width = 320;
        c.height = 320;
        c.getContext("2d")?.fillRect(0, 0, 320, 320);
        await fa
          .detectSingleFace(
            c,
            new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }),
          )
          .withFaceLandmarks(true)
          .withFaceDescriptor();
      } catch {
        /* warmup is best-effort */
      }
    });
  }
  return loadedPromise;
}

/**
 * Grab the current video frame into a canvas and normalise brightness/contrast.
 * This makes detection behave the same across devices with very different
 * camera quality / exposure.
 */
function frameToCanvas(video: HTMLVideoElement): HTMLCanvasElement | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  // Downscale very large frames — face-api works better on ~640px input
  const scale = Math.min(1, 720 / Math.max(vw, vh));
  const c = document.createElement("canvas");
  c.width = Math.round(vw * scale);
  c.height = Math.round(vh * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, c.width, c.height);
  // Simple auto-levels on luminance → consistent input across cameras
  try {
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    let min = 255;
    let max = 0;
    for (let i = 0; i < d.length; i += 16) {
      const l = (d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114) | 0;
      if (l < min) min = l;
      if (l > max) max = l;
    }
    const range = max - min;
    if (range > 20 && range < 235) {
      const f = 255 / range;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.min(255, Math.max(0, (d[i]! - min) * f));
        d[i + 1] = Math.min(255, Math.max(0, (d[i + 1]! - min) * f));
        d[i + 2] = Math.min(255, Math.max(0, (d[i + 2]! - min) * f));
      }
      ctx.putImageData(img, 0, 0);
    }
  } catch {
    /* tainted canvas etc — use raw frame */
  }
  return c;
}

/**
 * Detect + describe a face. Tries multiple detector scales/thresholds so a
 * change of device (different resolution / lens / lighting) does not simply
 * report "face detect nahi hua".
 * The descriptor is computed from the aligned face crop only, so the
 * background has no effect on matching.
 */
const DETECT_ATTEMPTS: { inputSize: number; scoreThreshold: number }[] = [
  { inputSize: 320, scoreThreshold: 0.35 },
  { inputSize: 416, scoreThreshold: 0.3 },
  { inputSize: 512, scoreThreshold: 0.25 },
  { inputSize: 608, scoreThreshold: 0.2 },
];
// Remember which detector setting worked on this device → next captures are instant.
let bestAttemptIndex = 0;

export async function captureDescriptor(video: HTMLVideoElement): Promise<Float32Array | null> {
  const fa = await getFaceApi();
  await loadModels();
  const input: HTMLCanvasElement | HTMLVideoElement = frameToCanvas(video) ?? video;
  const order = [
    DETECT_ATTEMPTS[bestAttemptIndex]!,
    ...DETECT_ATTEMPTS.filter((_, i) => i !== bestAttemptIndex),
  ];
  for (const opt of order) {
    const det = await fa
      .detectSingleFace(input as HTMLCanvasElement, new fa.TinyFaceDetectorOptions(opt))
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    if (det?.descriptor) {
      bestAttemptIndex = DETECT_ATTEMPTS.indexOf(opt);
      return det.descriptor;
    }
  }
  return null;
}

/** Average several samples → far more stable across devices/lighting. */
export function averageDescriptors(list: Float32Array[]): Float32Array {
  const len = list[0]!.length;
  const out = new Float32Array(len);
  for (const d of list) for (let i = 0; i < len; i++) out[i]! += d[i]!;
  for (let i = 0; i < len; i++) out[i]! /= list.length;
  return out;
}

/**
 * Grab `count` good samples over time. Returns null if too few faces detected.
 */
export async function captureStableDescriptor(
  video: HTMLVideoElement,
  count = 5,
  onProgress?: (done: number, total: number) => void,
): Promise<Float32Array | null> {
  const samples: Float32Array[] = [];
  const maxTries = count * 3;
  for (let i = 0; i < maxTries && samples.length < count; i++) {
    const d = await captureDescriptor(video);
    if (d) {
      samples.push(d);
      onProgress?.(samples.length, count);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  if (samples.length < Math.min(3, count)) return null;
  // Drop outlier samples (blur / motion) before averaging
  if (samples.length >= 4) {
    const mean = averageDescriptors(samples);
    const scored = samples.map((s) => ({ s, d: distance(s, mean) })).sort((a, b) => a.d - b.d);
    const keep = scored.slice(0, Math.max(3, Math.ceil(scored.length * 0.7))).map((x) => x.s);
    return averageDescriptors(keep);
  }
  return averageDescriptors(samples);
}

export function distance(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] as number) - (b[i] as number);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function matchDescriptor(
  desc: Float32Array,
  candidates: { id: string; descriptor: number[] }[],
  threshold = 0.55,
): { id: string; distance: number } | null {
  let best: { id: string; distance: number } | null = null;
  for (const c of candidates) {
    if (!c.descriptor || c.descriptor.length !== desc.length) continue;
    const d = distance(desc, c.descriptor);
    if (d < threshold && (!best || d < best.distance)) best = { id: c.id, distance: d };
  }
  return best;
}

export type StrictMatch =
  | { ok: true; id: string; distance: number; margin: number }
  | { ok: false; reason: "no-face-data" | "too-far" | "ambiguous"; distance?: number };

/**
 * Perfect-match mode: requires a tight distance AND a clear gap to the
 * runner-up, so one worker can never be marked as another.
 */
export function matchDescriptorStrict(
  desc: Float32Array,
  candidates: { id: string; descriptor: number[] }[],
  opts: { threshold?: number; margin?: number } = {},
): StrictMatch {
  const threshold = opts.threshold ?? 0.44;
  const margin = opts.margin ?? 0.1;
  const scored = candidates
    .filter((c) => Array.isArray(c.descriptor) && c.descriptor.length === desc.length)
    .map((c) => ({ id: c.id, d: distance(desc, c.descriptor) }))
    .sort((a, b) => a.d - b.d);
  if (!scored.length) return { ok: false, reason: "no-face-data" };
  const best = scored[0]!;
  if (best.d > threshold) return { ok: false, reason: "too-far", distance: best.d };
  const second = scored[1];
  const gap = second ? second.d - best.d : Number.POSITIVE_INFINITY;
  if (gap < margin) return { ok: false, reason: "ambiguous", distance: best.d };
  return { ok: true, id: best.id, distance: best.d, margin: gap };
}

// ── WebAuthn helpers ──────────────────────────────────────────────────────────

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function fromB64url(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export async function enrollFingerprint(employeeId: string, employeeName: string): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Transport Staff", id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(employeeId),
        name: employeeId,
        displayName: employeeName,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Enrollment cancelled");
  return b64url(cred.rawId);
}

export async function identifyByFingerprint(allCredentialIds: string[]): Promise<string | null> {
  if (!allCredentialIds.length) return null;
  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: allCredentialIds.map((id) => ({
          type: "public-key" as const,
          id: fromB64url(id),
          transports: ["internal"] as AuthenticatorTransport[],
        })),
        userVerification: "required",
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;
    if (!assertion) return null;
    return b64url(assertion.rawId);
  } catch {
    return null;
  }
}

// ── Fast live identify ────────────────────────────────────────────────────────
// Instead of two full multi-sample rounds, we stream samples and stop the very
// moment two consecutive samples agree on the same worker with a strict match.
// Typical case: 2 samples (~0.5s) instead of 9.

export type LiveIdentifyResult =
  | { ok: true; id: string; distance: number; margin: number }
  | { ok: false; reason: "no-face" | "no-face-data" | "too-far" | "ambiguous"; distance?: number };

export async function identifyLive(
  video: HTMLVideoElement,
  candidates: { id: string; descriptor: number[] }[],
  opts: {
    maxSamples?: number;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<LiveIdentifyResult> {
  const maxSamples = opts.maxSamples ?? 8;
  if (!candidates.length) return { ok: false, reason: "no-face-data" };

  let agreeId: string | null = null;
  let agreeCount = 0;
  let best: { id: string; distance: number; margin: number } | null = null;
  let lastFail: LiveIdentifyResult | null = null;
  let faces = 0;

  for (let i = 0; i < maxSamples; i++) {
    const d = await captureDescriptor(video);
    if (!d) continue;
    faces++;
    opts.onProgress?.(faces, 2);
    const m = matchDescriptorStrict(d, candidates);
    if (!m.ok) {
      lastFail = { ok: false, reason: m.reason, distance: m.distance };
      agreeId = null;
      agreeCount = 0;
      continue;
    }
    if (m.id === agreeId) agreeCount++;
    else {
      agreeId = m.id;
      agreeCount = 1;
    }
    if (!best || m.distance < best.distance) {
      best = { id: m.id, distance: m.distance, margin: m.margin };
    }
    // Two consecutive agreeing strict matches → confident, return immediately.
    if (agreeCount >= 2 && best && best.id === agreeId) {
      return { ok: true, id: best.id, distance: best.distance, margin: best.margin };
    }
    // Extremely tight single match → accept right away (registered face, good light).
    if (m.distance <= 0.38 && m.margin >= 0.1) {
      return { ok: true, id: m.id, distance: m.distance, margin: m.margin };
    }
  }

  if (!faces) return { ok: false, reason: "no-face" };
  return lastFail ?? { ok: false, reason: "too-far", distance: best?.distance };
}
