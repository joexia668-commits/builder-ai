export interface CollectedError {
  readonly source: "vite" | "runtime";
  readonly message: string;
}

const MAX_ERRORS = 5;
const MAX_MESSAGE_LENGTH = 300;

const NOISE_PATTERNS = [
  /ResizeObserver/i,
  /supabase\.co/i,
  /Failed to fetch/i,
  /net::ERR_/i,
  /Loading chunk/i,
  /dynamically imported module/i,
];

function isNoise(message: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(message));
}

function truncate(message: string): string {
  if (message.length <= MAX_MESSAGE_LENGTH) return message;
  return message.slice(0, MAX_MESSAGE_LENGTH) + "...";
}

export function createErrorCollector() {
  let errors: CollectedError[] = [];
  const seenMessages = new Set<string>();

  return {
    collect(error: CollectedError): void {
      if (isNoise(error.message)) return;
      if (seenMessages.has(error.message)) return;
      if (errors.length >= MAX_ERRORS) return;

      seenMessages.add(error.message);
      errors.push({ source: error.source, message: truncate(error.message) });
    },

    getErrors(): readonly CollectedError[] {
      return errors;
    },

    hasErrors(): boolean {
      return errors.length > 0;
    },

    reset(): void {
      errors = [];
      seenMessages.clear();
    },

    /**
     * Formats collected errors into a string suitable for LLM context.
     */
    formatForContext(): string {
      return errors
        .map((e, i) => {
          const label = e.source === "vite" ? "编译" : "运行时";
          return `错误 ${i + 1} (${label}): ${e.message}`;
        })
        .join("\n");
    },
  };
}

export type ErrorCollector = ReturnType<typeof createErrorCollector>;
