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
