# Version Management Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add parent version tracking, iteration context snapshots, and changed files recording to the existing version system.

**Architecture:** Three optional fields added to Version model (`parentVersionId`, `changedFiles`, `iterationSnapshot`). `computeChangedFiles()` calculates file diffs. Restore API writes parent link and syncs iteration context. Timeline UI marks restored versions.

**Tech Stack:** Prisma 5.x, Next.js 14 API Routes, React 18, TypeScript 5, Tailwind 3

---

### Task 1: Prisma Schema + TypeScript Types

**Files:**
- Modify: `prisma/schema.prisma:76-88`
- Modify: `lib/types.ts:60-68`

- [ ] **Step 1: Add fields to Prisma schema**

In `prisma/schema.prisma`, replace the `Version` model (lines 76-88) with:

```prisma
model Version {
  id            String   @id @default(cuid())
  projectId     String
  versionNumber Int
  code          String
  files         Json?
  description   String?
  agentMessages Json?
  createdAt     DateTime @default(now())
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  parentVersionId   String?
  parentVersion     Version?  @relation("VersionLineage", fields: [parentVersionId], references: [id])
  childVersions     Version[] @relation("VersionLineage")
  changedFiles      Json?
  iterationSnapshot Json?

  @@unique([projectId, versionNumber])
}
```

- [ ] **Step 2: Add ChangedFiles type and update ProjectVersion in types.ts**

In `lib/types.ts`, add the `ChangedFiles` interface after the existing `ProjectVersion` interface (after line 68):

```typescript
export interface ChangedFiles {
  readonly added: Record<string, string>;
  readonly modified: Record<string, string>;
  readonly removed: readonly string[];
}
```

Then update `ProjectVersion` (lines 60-68) to:

```typescript
export interface ProjectVersion {
  id: string;
  projectId: string;
  versionNumber: number;
  code: string;
  description?: string | null;
  agentMessages?: unknown;
  createdAt: Date;
  parentVersionId?: string | null;
  changedFiles?: ChangedFiles | null;
  iterationSnapshot?: IterationContext | null;
}
```

- [ ] **Step 3: Push schema to database**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 4: Verify existing tests still pass**

Run: `npm test -- --testPathPatterns="versions-api|version-files|version-timeline"`
Expected: All existing tests pass (no regressions from schema change — mocks don't hit real DB).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma lib/types.ts
git commit -m "feat: add parentVersionId, changedFiles, iterationSnapshot to Version schema"
```

---

### Task 2: computeChangedFiles Function + Tests

**Files:**
- Modify: `lib/version-files.ts`
- Modify: `__tests__/version-files.test.ts`

- [ ] **Step 1: Write failing tests for computeChangedFiles**

Add these tests to `__tests__/version-files.test.ts`:

```typescript
import { getVersionFiles, computeChangedFiles } from "@/lib/version-files";

// ... existing getVersionFiles tests ...

describe("computeChangedFiles", () => {
  it("treats all files as added when prevFiles is null", () => {
    const newFiles = { "/App.js": "app code", "/utils.js": "util code" };
    const result = computeChangedFiles(null, newFiles);
    expect(result.added).toEqual(newFiles);
    expect(result.modified).toEqual({});
    expect(result.removed).toEqual([]);
  });

  it("detects added files", () => {
    const prev = { "/App.js": "app" };
    const next = { "/App.js": "app", "/Header.js": "header" };
    const result = computeChangedFiles(prev, next);
    expect(result.added).toEqual({ "/Header.js": "header" });
    expect(result.modified).toEqual({});
    expect(result.removed).toEqual([]);
  });

  it("detects modified files", () => {
    const prev = { "/App.js": "old code" };
    const next = { "/App.js": "new code" };
    const result = computeChangedFiles(prev, next);
    expect(result.added).toEqual({});
    expect(result.modified).toEqual({ "/App.js": "new code" });
    expect(result.removed).toEqual([]);
  });

  it("detects removed files", () => {
    const prev = { "/App.js": "app", "/Old.js": "old" };
    const next = { "/App.js": "app" };
    const result = computeChangedFiles(prev, next);
    expect(result.added).toEqual({});
    expect(result.modified).toEqual({});
    expect(result.removed).toEqual(["/Old.js"]);
  });

  it("handles mixed add/modify/remove", () => {
    const prev = { "/App.js": "v1", "/Remove.js": "remove me" };
    const next = { "/App.js": "v2", "/New.js": "new file" };
    const result = computeChangedFiles(prev, next);
    expect(result.added).toEqual({ "/New.js": "new file" });
    expect(result.modified).toEqual({ "/App.js": "v2" });
    expect(result.removed).toEqual(["/Remove.js"]);
  });

  it("returns empty diff when files are identical", () => {
    const files = { "/App.js": "same", "/utils.js": "same" };
    const result = computeChangedFiles(files, files);
    expect(result.added).toEqual({});
    expect(result.modified).toEqual({});
    expect(result.removed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="version-files"`
Expected: FAIL — `computeChangedFiles` is not exported from `@/lib/version-files`

- [ ] **Step 3: Implement computeChangedFiles**

In `lib/version-files.ts`, add:

```typescript
import type { ChangedFiles } from "@/lib/types";

/**
 * Compute file-level diff between two version snapshots.
 * Stores full content of added/modified files (not line-level diff),
 * because LLM-generated code typically rewrites entire files.
 */
export function computeChangedFiles(
  prevFiles: Record<string, string> | null,
  newFiles: Record<string, string>
): ChangedFiles {
  const prev = prevFiles ?? {};
  const added: Record<string, string> = {};
  const modified: Record<string, string> = {};
  const removed: string[] = [];

  for (const [path, content] of Object.entries(newFiles)) {
    if (!(path in prev)) {
      added[path] = content;
    } else if (prev[path] !== content) {
      modified[path] = content;
    }
  }

  for (const path of Object.keys(prev)) {
    if (!(path in newFiles)) {
      removed.push(path);
    }
  }

  return { added, modified, removed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="version-files"`
Expected: All 10 tests pass (4 existing + 6 new)

- [ ] **Step 5: Commit**

```bash
git add lib/version-files.ts __tests__/version-files.test.ts
git commit -m "feat: add computeChangedFiles function with tests"
```

---

### Task 3: POST /api/versions — Accept New Fields

**Files:**
- Modify: `app/api/versions/route.ts:33-86`
- Modify: `__tests__/versions-api.test.ts`

- [ ] **Step 1: Write failing test for changedFiles and iterationSnapshot**

Add this test to `__tests__/versions-api.test.ts` in the `POST /api/versions` describe block:

```typescript
  it("API-02g: stores changedFiles and iterationSnapshot when provided", async () => {
    mockSession.mockResolvedValue(session);
    mockProjectFindFirst.mockResolvedValue(mockProject);
    mockVersionFindFirst.mockResolvedValue(null);
    const changedFiles = {
      added: { "/New.js": "new" },
      modified: { "/App.js": "updated" },
      removed: ["/Old.js"],
    };
    const iterationSnapshot = {
      rounds: [{ userPrompt: "test", intent: "new_project", pmSummary: null, timestamp: "2026-04-15T00:00:00Z" }],
    };
    mockVersionCreate.mockResolvedValue({
      id: "v1",
      projectId: "proj-1",
      versionNumber: 1,
      code: "app code",
      files: { "/App.js": "app code" },
      changedFiles,
      iterationSnapshot,
      description: "test",
      createdAt: new Date(),
    });
    mockProjectUpdate.mockResolvedValue({});

    const res = await POST(
      makePostRequest({
        projectId: "proj-1",
        files: { "/App.js": "app code" },
        description: "test",
        changedFiles,
        iterationSnapshot,
      })
    );
    expect(res.status).toBe(201);

    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changedFiles,
          iterationSnapshot,
        }),
      })
    );
  });

  it("API-02h: omitted changedFiles and iterationSnapshot default to undefined (backward compat)", async () => {
    mockSession.mockResolvedValue(session);
    mockProjectFindFirst.mockResolvedValue(mockProject);
    mockVersionFindFirst.mockResolvedValue(null);
    mockVersionCreate.mockResolvedValue({
      id: "v1",
      projectId: "proj-1",
      versionNumber: 1,
      code: "code",
      description: "no extras",
      createdAt: new Date(),
    });
    mockProjectUpdate.mockResolvedValue({});

    const res = await POST(makePostRequest({ projectId: "proj-1", code: "code", description: "no extras" }));
    expect(res.status).toBe(201);

    const createCall = mockVersionCreate.mock.calls[0][0];
    expect(createCall.data.changedFiles).toBeUndefined();
    expect(createCall.data.iterationSnapshot).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="versions-api"`
Expected: FAIL — `changedFiles` and `iterationSnapshot` not passed through to Prisma create

- [ ] **Step 3: Update POST handler to accept new fields**

In `app/api/versions/route.ts`, update the POST function. Replace lines 39-44:

```typescript
  const body = await req.json();
  const { projectId, code, files, description, changedFiles, iterationSnapshot } = body as {
    projectId?: string;
    code?: string;
    files?: Record<string, string>;
    description?: string;
    changedFiles?: unknown;
    iterationSnapshot?: unknown;
  };
```

And replace the `prisma.version.create` call (lines 69-77):

```typescript
  const version = await prisma.version.create({
    data: {
      projectId,
      code: effectiveCode,
      ...(files ? { files } : {}),
      description,
      versionNumber,
      ...(changedFiles ? { changedFiles } : {}),
      ...(iterationSnapshot ? { iterationSnapshot } : {}),
    },
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="versions-api"`
Expected: All tests pass (existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add app/api/versions/route.ts __tests__/versions-api.test.ts
git commit -m "feat: POST /api/versions accepts changedFiles and iterationSnapshot"
```

---

### Task 4: Restore API — Parent Tracking + Context Sync

**Files:**
- Modify: `app/api/versions/[id]/restore/route.ts`
- Modify: `__tests__/versions-api.test.ts`

- [ ] **Step 1: Write failing tests for restore enhancements**

Add these tests to `__tests__/versions-api.test.ts` in the `POST /api/versions/[id]/restore` describe block:

```typescript
  it("API-03g: restored version has parentVersionId pointing to source", async () => {
    mockSession.mockResolvedValue(session);
    const sourceVersion = {
      id: "v2",
      projectId: "proj-1",
      versionNumber: 2,
      code: "v2-code",
      files: null,
      iterationSnapshot: { rounds: [{ userPrompt: "test", intent: "new_project", pmSummary: null, timestamp: "2026-04-15T00:00:00Z" }] },
    };
    mockVersionFindFirst
      .mockResolvedValueOnce(sourceVersion)
      .mockResolvedValueOnce({ versionNumber: 4 });
    mockVersionCreate.mockResolvedValue({
      id: "v5",
      projectId: "proj-1",
      versionNumber: 5,
      code: "v2-code",
      parentVersionId: "v2",
      description: "从 v2 恢复",
      createdAt: new Date(),
    });
    mockProjectUpdate.mockResolvedValue({});

    await RESTORE(makeRestoreRequest("v2"), { params: { id: "v2" } });

    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parentVersionId: "v2",
        }),
      })
    );
  });

  it("API-03h: restore copies iterationSnapshot from source and syncs Project.iterationContext", async () => {
    mockSession.mockResolvedValue(session);
    const snapshot = { rounds: [{ userPrompt: "hello", intent: "new_project", pmSummary: null, timestamp: "2026-04-15T00:00:00Z" }] };
    const sourceVersion = {
      id: "v2",
      projectId: "proj-1",
      versionNumber: 2,
      code: "v2-code",
      files: null,
      iterationSnapshot: snapshot,
    };
    mockVersionFindFirst
      .mockResolvedValueOnce(sourceVersion)
      .mockResolvedValueOnce({ versionNumber: 3 });
    mockVersionCreate.mockResolvedValue({
      id: "v4",
      projectId: "proj-1",
      versionNumber: 4,
      code: "v2-code",
      parentVersionId: "v2",
      iterationSnapshot: snapshot,
      description: "从 v2 恢复",
      createdAt: new Date(),
    });
    mockProjectUpdate.mockResolvedValue({});

    await RESTORE(makeRestoreRequest("v2"), { params: { id: "v2" } });

    // Version created with snapshot
    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          iterationSnapshot: snapshot,
        }),
      })
    );
    // Project.iterationContext synced
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "proj-1" },
        data: expect.objectContaining({
          iterationContext: snapshot,
        }),
      })
    );
  });

  it("API-03i: restore with null iterationSnapshot does not update Project.iterationContext", async () => {
    mockSession.mockResolvedValue(session);
    const sourceVersion = {
      id: "v1",
      projectId: "proj-1",
      versionNumber: 1,
      code: "v1-code",
      files: null,
      iterationSnapshot: null,
    };
    mockVersionFindFirst
      .mockResolvedValueOnce(sourceVersion)
      .mockResolvedValueOnce({ versionNumber: 2 });
    mockVersionCreate.mockResolvedValue({
      id: "v3",
      projectId: "proj-1",
      versionNumber: 3,
      code: "v1-code",
      parentVersionId: "v1",
      description: "从 v1 恢复",
      createdAt: new Date(),
    });
    mockProjectUpdate.mockResolvedValue({});

    await RESTORE(makeRestoreRequest("v1"), { params: { id: "v1" } });

    // Project.iterationContext NOT updated (degraded — old version has no snapshot)
    if (mockProjectUpdate.mock.calls.length > 0) {
      const updateData = mockProjectUpdate.mock.calls[0][0].data;
      expect(updateData.iterationContext).toBeUndefined();
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="versions-api"`
Expected: FAIL — restore route doesn't pass `parentVersionId`, `iterationSnapshot`, or call `prisma.project.update`

- [ ] **Step 3: Update restore route**

Replace the entire `app/api/versions/[id]/restore/route.ts`:

```typescript
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.isDemo) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sourceVersion = await prisma.version.findFirst({
    where: { id: params.id, project: { userId: session.user.id } },
  });
  if (!sourceVersion) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const lastVersion = await prisma.version.findFirst({
    where: { projectId: sourceVersion.projectId },
    orderBy: { versionNumber: "desc" },
  });
  const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

  const sourceSnapshot = sourceVersion.iterationSnapshot as Record<string, unknown> | null;

  const newVersion = await prisma.version.create({
    data: {
      projectId: sourceVersion.projectId,
      code: sourceVersion.code,
      ...(sourceVersion.files ? { files: sourceVersion.files as Record<string, string> } : {}),
      description: `从 v${sourceVersion.versionNumber} 恢复`,
      versionNumber,
      parentVersionId: sourceVersion.id,
      ...(sourceSnapshot ? { iterationSnapshot: sourceSnapshot } : {}),
    },
  });

  // Sync Project.iterationContext if source had a snapshot (degraded: skip if null)
  await prisma.project.update({
    where: { id: sourceVersion.projectId },
    data: {
      updatedAt: new Date(),
      ...(sourceSnapshot ? { iterationContext: sourceSnapshot } : {}),
    },
  });

  return NextResponse.json(newVersion, { status: 201 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="versions-api"`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add app/api/versions/[id]/restore/route.ts __tests__/versions-api.test.ts
git commit -m "feat: restore API writes parentVersionId, copies iterationSnapshot, syncs Project context"
```

---

### Task 5: Chat Area — Pass changedFiles + iterationSnapshot on Version Creation

**Files:**
- Modify: `components/workspace/chat-area.tsx` (4 version creation points)

The `currentFiles` prop in ChatArea represents the previous version's files. The new files are the ones being saved. At each of the 4 version creation points, add `changedFiles` and `iterationSnapshot` to the POST body.

- [ ] **Step 1: Add import for computeChangedFiles**

At the top of `components/workspace/chat-area.tsx`, add to the imports:

```typescript
import { getVersionFiles, computeChangedFiles } from "@/lib/version-files";
```

Note: `getVersionFiles` may already be imported. If not, add it. The key addition is `computeChangedFiles`.

- [ ] **Step 2: Update direct multi-file version creation (line ~596)**

Replace the POST body at the first version creation point (direct path, multi-file, around line 596-603):

```typescript
          const res = await fetchAPI("/api/versions", {
            method: "POST",
            body: JSON.stringify({
              projectId: project.id,
              files: mergedFiles,
              description: prompt.slice(0, 80),
              changedFiles: computeChangedFiles(currentFiles, mergedFiles),
              iterationSnapshot: iterationContext ?? undefined,
            }),
          });
```

- [ ] **Step 3: Update direct single-file version creation (line ~607)**

Replace the POST body at the second version creation point (direct path, single-file, around line 607-614):

```typescript
          const res = await fetchAPI("/api/versions", {
            method: "POST",
            body: JSON.stringify({
              projectId: project.id,
              code: directCode,
              description: prompt.slice(0, 80),
              changedFiles: computeChangedFiles(currentFiles, { "/App.js": directCode }),
              iterationSnapshot: iterationContext ?? undefined,
            }),
          });
```

- [ ] **Step 4: Update full pipeline multi-file version creation (line ~1053)**

Replace the POST body at the third version creation point (full pipeline, multi-file, around line 1053-1060):

```typescript
              const res = await fetchAPI("/api/versions", {
                method: "POST",
                body: JSON.stringify({
                  projectId: project.id,
                  files: finalFiles,
                  description: prompt.slice(0, 80),
                  changedFiles: computeChangedFiles(currentFiles, finalFiles),
                  iterationSnapshot: iterationContext ?? undefined,
                }),
              });
```

- [ ] **Step 5: Update legacy single-file version creation (line ~1174)**

Replace the POST body at the fourth version creation point (legacy single-file, around line 1174-1181):

```typescript
        const res = await fetchAPI("/api/versions", {
          method: "POST",
          body: JSON.stringify({
            projectId: project.id,
            code: lastCode,
            description: prompt.slice(0, 80),
            changedFiles: computeChangedFiles(currentFiles, { "/App.js": lastCode }),
            iterationSnapshot: iterationContext ?? undefined,
          }),
        });
```

- [ ] **Step 6: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds (no type errors)

- [ ] **Step 7: Commit**

```bash
git add components/workspace/chat-area.tsx
git commit -m "feat: pass changedFiles and iterationSnapshot on version creation"
```

---

### Task 6: Workspace — Sync iterationContext on Restore

**Files:**
- Modify: `components/workspace/workspace.tsx:61-67`

- [ ] **Step 1: Update handleRestoreVersion to sync iterationContext**

In `components/workspace/workspace.tsx`, replace the `handleRestoreVersion` function (lines 61-67):

```typescript
  function handleRestoreVersion(newVersion: ProjectVersion) {
    setCurrentFiles(
      getVersionFiles(newVersion as { code: string; files?: Record<string, string> | null })
    );
    setVersions((prev) => [...prev, newVersion]);
    setPreviewingVersion(null);
    // Sync iterationContext if the restored version carried a snapshot
    if (newVersion.iterationSnapshot) {
      setIterationContext(newVersion.iterationSnapshot);
    }
  }
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add components/workspace/workspace.tsx
git commit -m "feat: sync iterationContext on version restore"
```

---

### Task 7: Timeline UI — Mark Restored Versions

**Files:**
- Modify: `components/timeline/version-timeline.tsx`
- Modify: `__tests__/version-timeline.test.tsx`

- [ ] **Step 1: Write failing tests for restore markers**

Add these tests to `__tests__/version-timeline.test.tsx`:

```typescript
  // VT-11: Restored version shows restore label
  it("VT-11: restored version shows '← vN' label when parentVersionId is set", () => {
    const v4 = makeVersion(4, { parentVersionId: "v2", description: "从 v2 恢复" });
    const versionsWithRestore = [v1, v2, v3, v4];
    render(
      <VersionTimeline
        versions={versionsWithRestore}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    expect(screen.getByText("← v2")).toBeInTheDocument();
  });

  it("VT-11b: normal version does not show restore label", () => {
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    expect(screen.queryByText(/← v/)).not.toBeInTheDocument();
  });

  // VT-12: Restored version node has distinct visual style
  it("VT-12: restored version node has rotate-180 icon indicator", () => {
    const v4 = makeVersion(4, { parentVersionId: "v2", description: "从 v2 恢复" });
    const versionsWithRestore = [v1, v2, v3, v4];
    const { container } = render(
      <VersionTimeline
        versions={versionsWithRestore}
        previewingVersion={null}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    // v4 node should have the restore indicator
    const v4Node = screen.getByTestId("version-node-v4");
    expect(v4Node.querySelector("[data-restore-icon]")).toBeInTheDocument();
  });
```

Update the `makeVersion` helper to support `parentVersionId`:

```typescript
const makeVersion = (n: number, overrides: Partial<ProjectVersion> = {}): ProjectVersion => ({
  id: `v${n}`,
  projectId: "proj-1",
  versionNumber: n,
  code: `code-v${n}`,
  description: `描述版本${n}`,
  agentMessages: null,
  createdAt: new Date("2026-03-29T10:00:00Z"),
  parentVersionId: null,
  changedFiles: null,
  iterationSnapshot: null,
  ...overrides,
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="version-timeline"`
Expected: FAIL — no `← v2` text rendered, no `[data-restore-icon]` attribute

- [ ] **Step 3: Update VersionTimeline to show restore markers**

In `components/timeline/version-timeline.tsx`, update the version node rendering inside the `versions.map` callback (around line 100-134). Find the version's parent version number for the label, and add the restore indicator:

Replace the content inside `versions.map((version, index) => { ... })` (the return block starting at line 100):

```typescript
            return (
              <div key={version.id} className={cn("flex items-start gap-2", isGenerating && "opacity-40")}>
                <button
                  data-testid={`version-node-v${version.versionNumber}`}
                  onClick={() => !isGenerating && handleNodeClick(version)}
                  disabled={isGenerating}
                  className="flex flex-col items-center gap-1 group max-w-[60px]"
                >
                  {version.parentVersionId ? (
                    <span data-restore-icon className="text-[10px] mt-0.5 rotate-180 text-amber-500">↑</span>
                  ) : (
                    <div
                      className={cn(
                        "rounded-full border-2 transition-all mt-0.5",
                        isLast && !isPreviewing
                          ? "w-3 h-3 bg-indigo-500 border-indigo-500"
                          : isPreviewing
                          ? "w-3 h-3 bg-amber-400 border-amber-400"
                          : "w-2.5 h-2.5 bg-white border-gray-300 group-hover:border-indigo-400"
                      )}
                    />
                  )}
                  <span className="text-[10px] text-gray-500 font-medium">
                    v{version.versionNumber}
                  </span>
                  {version.parentVersionId ? (
                    <span className="text-[9px] text-amber-500 font-medium">
                      ← v{versions.find(v => v.id === version.parentVersionId)?.versionNumber ?? "?"}
                    </span>
                  ) : version.description ? (
                    <span className="text-[9px] text-gray-400 truncate w-full text-center leading-tight">
                      {version.description}
                    </span>
                  ) : null}
                  <span className="text-[9px] text-gray-300">
                    {mounted ? formatTime(version.createdAt) : "--:--"}
                  </span>
                </button>

                {!isLast && (
                  <div className="w-6 h-px bg-gray-200 mt-2 self-start" />
                )}
              </div>
            );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="version-timeline"`
Expected: All tests pass (existing + 3 new)

- [ ] **Step 5: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add components/timeline/version-timeline.tsx __tests__/version-timeline.test.tsx
git commit -m "feat: timeline UI marks restored versions with arrow icon and source label"
```

---

### Task 8: Preview Banner — Show changedFiles Summary

**Files:**
- Modify: `components/timeline/version-timeline.tsx`
- Modify: `__tests__/version-timeline.test.tsx`

- [ ] **Step 1: Write failing test for changedFiles summary in banner**

Add this test to `__tests__/version-timeline.test.tsx`:

```typescript
  // VT-13: Preview banner shows changedFiles summary
  it("VT-13: preview banner shows changed files count when changedFiles is present", () => {
    const v2WithChanges = makeVersion(2, {
      changedFiles: {
        added: { "/New.js": "new" },
        modified: { "/App.js": "updated" },
        removed: ["/Old.js"],
      },
    });
    render(
      <VersionTimeline
        versions={[v1, v2WithChanges, v3]}
        previewingVersion={v2WithChanges}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    // Should show summary like "修改了 3 个文件"
    expect(screen.getByText(/修改了 3 个文件/)).toBeInTheDocument();
  });

  it("VT-13b: preview banner does not show file count when changedFiles is null", () => {
    render(
      <VersionTimeline
        versions={versions}
        previewingVersion={v2}
        onPreviewVersion={jest.fn()}
        onRestoreVersion={jest.fn()}
      />
    );
    expect(screen.queryByText(/修改了/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="version-timeline"`
Expected: FAIL — banner doesn't show file count

- [ ] **Step 3: Add changedFiles summary to preview banner**

In `components/timeline/version-timeline.tsx`, update the preview banner section (around line 69-91). Add the file count after the description text. Import `ChangedFiles` type:

Add to the import at the top:

```typescript
import type { ProjectVersion, ChangedFiles } from "@/lib/types";
```

In the banner `<span className="text-amber-700">` block, after the description text, add:

```typescript
          <span className="text-amber-700">
            正在预览 v{previewingVersion.versionNumber}
            {previewingVersion.description
              ? ` — ${previewingVersion.description}`
              : ""}
            {(() => {
              const cf = previewingVersion.changedFiles as ChangedFiles | null | undefined;
              if (!cf) return null;
              const count = Object.keys(cf.added).length + Object.keys(cf.modified).length + cf.removed.length;
              return count > 0 ? ` (修改了 ${count} 个文件)` : null;
            })()}
          </span>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPatterns="version-timeline"`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add components/timeline/version-timeline.tsx __tests__/version-timeline.test.tsx
git commit -m "feat: preview banner shows changedFiles count summary"
```

---

### Task 9: Full Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No lint errors

- [ ] **Step 4: Push schema to database**

Run: `npx prisma db push`
Expected: Schema in sync

- [ ] **Step 5: Manual smoke test**

Start dev server: `npm run dev`

Test sequence:
1. Create a new project → generate code → verify v1 is created
2. Send a follow-up prompt → verify v2 is created
3. Click v1 in timeline → verify preview banner shows
4. Click "恢复此版本" → verify v3 is created with "← v1" label and restore icon
5. Send another prompt → verify v4 is generated using v1's context (not v2's)

- [ ] **Step 6: Commit any remaining fixes**

If any fixes were needed during smoke testing:

```bash
git add -A
git commit -m "fix: address integration issues from smoke testing"
```
