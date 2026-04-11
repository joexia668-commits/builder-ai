import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

const FORBIDDEN = [
  "new Date(",
  "Date.now(",
  ".toLocaleDateString(",
  ".toLocaleTimeString(",
];

// Contexts where these calls are safe (inside hooks, event handlers, or helper functions)
const SAFE_CONTEXTS = [
  /useEffect\s*\(/,
  /useMemo\s*\(/,
  /useCallback\s*\(/,
  /useState\s*\(/,
  /onClick\s*[=:]/,
  /onSubmit\s*[=:]/,
  /onChange\s*[=:]/,
  /async function handle/,
  /function handle/,
  /async function /,   // any async function body is safe
  /function \w+\s*\(/,  // any named function definition (utility/helper) is safe
  /=> \{/,   // arrow function body — conservative false-negative allowance
];

describe("no-hydration-timebombs", () => {
  it("no bare date/locale calls at render level in components", async () => {
    const files = await glob("components/**/*.tsx");
    const violations: string[] = [];

    for (const file of files) {
      const src = fs.readFileSync(path.resolve(file), "utf-8");
      const lines = src.split("\n");

      lines.forEach((line, i) => {
        const lineNum = i + 1;
        const trimmed = line.trim();
        // Skip comments and imports
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("import")) return;

        for (const pattern of FORBIDDEN) {
          if (!line.includes(pattern)) continue;
          // Check surrounding context — look back up to 200 lines for a safe context
          const context = lines.slice(Math.max(0, i - 200), i + 1).join("\n");
          const isSafe = SAFE_CONTEXTS.some((re) => re.test(context));
          if (!isSafe) {
            violations.push(`${file}:${lineNum}: ${trimmed}`);
          }
        }
      });
    }

    if (violations.length > 0) {
      throw new Error(
        `Hydration time bombs found (bare Date/locale calls outside hooks/handlers):\n${violations.join("\n")}\n\nWrap in useMounted() + useEffect, or move inside a hook/event handler.`
      );
    }
  });
});
