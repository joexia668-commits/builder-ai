/**
 * Check whether extracted code is structurally complete:
 *   1. Contains `export default` (present naturally or appended by caller)
 *   2. Curly braces are balanced — open count === close count
 *
 * Returns false when the LLM output was truncated mid-generation.
 */
function isCodeComplete(code: string): boolean {
  if (!code.includes("export default")) return false;

  let depth = 0;
  for (const ch of code) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth === 0;
}

/**
 * Extract React component code from LLM output.
 *
 * Three-layer extraction strategy (priority descending):
 *   1. Markdown fence — precise capture of fenced content
 *   2. Head location  — start from `import ` or `export default`
 *   3. Tail truncation — strip explanation text after last `}`
 *
 * If no `export default` remains after extraction, one is appended.
 * Returns null if the extracted code fails the completeness check
 * (unbalanced braces — indicates the LLM output was truncated).
 */
export function extractReactCode(raw: string): string | null {
  // Layer 0: annotated fence (```jsx filename=App.jsx or similar) — highest priority
  // Requires a non-newline annotation token after the language tag (e.g., filename=, title=)
  const annotatedFenceMatch = raw.match(/```(?:jsx?|tsx?) [^\n]+\n([\s\S]*?)```/);
  if (annotatedFenceMatch?.[1]) {
    const candidate = annotatedFenceMatch[1].trim();
    if (isCodeComplete(candidate)) return candidate;
    // Truncated inside annotated fence — fall through to other layers
  }

  // Layer 1: fence match (jsx/js/tsx/ts or bare fence)
  const fenceMatch =
    raw.match(/```(?:jsx?|tsx?)\n([\s\S]*?)```/) ??
    raw.match(/```\n([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    const candidate = fenceMatch[1].trim();
    if (isCodeComplete(candidate)) return candidate;
    // Truncated inside fence — fall through to head/tail extraction
  }

  // Layer 2: head location
  let code = raw;
  const importIdx = code.indexOf('import ');
  const exportIdx = code.indexOf('export default');
  if (importIdx >= 0) {
    code = code.substring(importIdx);
  } else if (exportIdx >= 0) {
    code = code.substring(exportIdx);
  }

  // Layer 3: tail truncation — strip everything after last `}`
  const lastBrace = code.lastIndexOf('}');
  if (lastBrace >= 0) {
    code = code.substring(0, lastBrace + 1);
  }

  // Ensure export default exists
  if (!code.includes('export default')) {
    code += '\nexport default App;';
  }

  const trimmed = code.trim();
  return isCodeComplete(trimmed) ? trimmed : null;
}
