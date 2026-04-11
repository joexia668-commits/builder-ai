import type {
  ScaffoldFile,
  RequestMeta,
  RequestResult,
  AttemptInfo,
  AttemptReason,
} from "@/lib/types";

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 100,
  signal?: AbortSignal
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error("Aborted");
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, baseDelayMs * Math.pow(2, attempt));
          signal?.addEventListener(
            "abort",
            () => { clearTimeout(timer); reject(new Error("Aborted")); },
            { once: true }
          );
        });
      }
    }
  }
  throw lastError;
}

export interface LayerResult {
  files: Record<string, string>;
  failed: string[];
}

const MAX_LAYER_ATTEMPTS = 2;
const MAX_PER_FILE_ATTEMPTS = 2;
const CIRCUIT_BREAKER_THRESHOLD = 3;

export async function runLayerWithFallback(
  layerFiles: readonly ScaffoldFile[],
  requestFn: (
    files: readonly ScaffoldFile[],
    meta: RequestMeta
  ) => Promise<RequestResult>,
  signal?: AbortSignal,
  onAttempt?: (info: AttemptInfo) => void
): Promise<LayerResult> {
  const accumulated: Record<string, string> = {};
  const pathsInLayer = layerFiles.map((f) => f.path);
  let remaining: readonly ScaffoldFile[] = layerFiles;
  let priorFailed: readonly string[] = [];

  // Phase 1: full-layer (subset) attempts
  for (let attempt = 1; attempt <= MAX_LAYER_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error("Aborted");
    if (remaining.length === 0) break;

    const reason: AttemptReason = attempt === 1 ? "initial" : "parse_failed";
    onAttempt?.({
      attempt,
      maxAttempts: MAX_LAYER_ATTEMPTS,
      reason,
      failedSubset: remaining.map((f) => f.path),
      phase: "layer",
    });

    let result: RequestResult;
    try {
      result = await requestFn(remaining, { attempt, priorFailed });
    } catch (err) {
      if (signal?.aborted) throw err;
      // Treat thrown errors as "all requested files failed this attempt"
      result = { files: {}, failed: remaining.map((f) => f.path) };
    }

    Object.assign(accumulated, result.files);
    const stillMissing = pathsInLayer.filter((p) => !(p in accumulated));
    remaining = layerFiles.filter((f) => stillMissing.includes(f.path));
    priorFailed = result.failed;
  }

  if (remaining.length === 0) {
    return { files: accumulated, failed: [] };
  }

  // Phase 2: per-file fallback with circuit breaker
  const failedFinal: string[] = [];
  let consecutiveFailures = 0;

  for (const file of remaining) {
    if (signal?.aborted) throw new Error("Aborted");
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      failedFinal.push(file.path);
      continue;
    }

    let succeeded = false;
    for (let attempt = 1; attempt <= MAX_PER_FILE_ATTEMPTS; attempt++) {
      if (signal?.aborted) throw new Error("Aborted");
      onAttempt?.({
        attempt,
        maxAttempts: MAX_PER_FILE_ATTEMPTS,
        reason: "per_file_fallback",
        failedSubset: [file.path],
        phase: "per_file",
      });

      let result: RequestResult;
      try {
        result = await requestFn([file], {
          attempt,
          priorFailed: [file.path],
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        result = { files: {}, failed: [file.path] };
      }

      if (file.path in result.files) {
        accumulated[file.path] = result.files[file.path];
        succeeded = true;
        consecutiveFailures = 0;
        break;
      }
    }

    if (!succeeded) {
      failedFinal.push(file.path);
      consecutiveFailures++;
    }
  }

  return { files: accumulated, failed: failedFinal };
}
