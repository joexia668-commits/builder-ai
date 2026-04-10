import type { ScaffoldFile } from "@/lib/types";

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

export async function runLayerWithFallback(
  layerFiles: readonly ScaffoldFile[],
  requestFn: (files: readonly ScaffoldFile[]) => Promise<Record<string, string>>,
  signal?: AbortSignal
): Promise<LayerResult> {
  // Step 1: attempt full-layer request with retries
  try {
    const files = await retryWithBackoff(() => requestFn(layerFiles), 3, 100, signal);
    return { files, failed: [] };
  } catch {
    // Full-layer failed → fallback to per-file
  }

  // Step 2: per-file fallback with circuit breaker
  const result: LayerResult = { files: {}, failed: [] };
  let consecutiveFailures = 0;

  for (const file of layerFiles) {
    if (consecutiveFailures >= 3) {
      result.failed.push(file.path);
      continue;
    }
    try {
      const files = await retryWithBackoff(() => requestFn([file]), 3, 100, signal);
      Object.assign(result.files, files);
      consecutiveFailures = 0;
    } catch {
      result.failed.push(file.path);
      consecutiveFailures++;
    }
  }

  return result;
}
