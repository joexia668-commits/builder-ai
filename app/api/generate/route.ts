import { getToken } from "next-auth/jwt";
import { type NextRequest } from "next/server";
import { extractReactCode } from "@/lib/extract-code";
import { getSystemPrompt } from "@/lib/generate-prompts";
import { createProvider, resolveModelId, isRateLimitError } from "@/lib/ai-providers";
import { isValidModelId } from "@/lib/model-registry";
import type { AgentRole, CompletionOptions } from "@/lib/types";

export const runtime = "edge";
export const maxDuration = 300;

function send(controller: ReadableStreamDefaultController, data: object) {
  controller.enqueue(
    new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
  );
}

export async function POST(req: NextRequest) {
  const token = await getToken({ req });
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const { agent, prompt, context, projectId, modelId, targetFiles } =
    body as {
      projectId: string;
      prompt: string;
      agent: AgentRole;
      context?: string;
      modelId?: string;
      targetFiles?: Array<{
        path: string;
        description: string;
        exports: string[];
        deps: string[];
        hints: string;
      }>;
    };

  // Validate modelId if provided
  if (modelId !== undefined && modelId !== null && !isValidModelId(modelId)) {
    return new Response(
      JSON.stringify({ error: `Unknown modelId: ${modelId}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const resolvedModelId = resolveModelId(modelId);
  const provider = createProvider(resolvedModelId);

  const userContent =
    agent === "pm"
      ? context
        ? `用户需求：${prompt}\n\n${context}`
        : `用户需求：${prompt}`
      : agent === "architect"
        ? `PM 的产品需求文档：\n\n${context}\n\n请基于以上 PRD 设计多文件 React 项目的文件结构和技术方案。`
        : `请根据以下完整背景信息，生成完整可运行的 React 组件代码：\n\n${context}`;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        send(controller, { type: "thinking", content: `${agent} 正在分析...` });

        let fullContent = "";

        const messages: Parameters<typeof provider.streamCompletion>[0] = [
          { role: "system", content: getSystemPrompt(agent, projectId) },
          { role: "user", content: userContent },
        ];

        const onChunk = (text: string) => {
          fullContent += text;
          send(controller, { type: "chunk", content: text });
        };

        // PM outputs bare JSON — enable JSON mode. Architect uses two-phase <thinking>/<output>
        // format, so JSON mode must be OFF to allow the thinking block to appear.
        const completionOptions: CompletionOptions =
          agent === "pm" ? { jsonMode: true } : {};

        try {
          await provider.streamCompletion(messages, onChunk, completionOptions);
        } catch (err) {
          const isMaxTokens = err instanceof Error && err.message === "max_tokens_exceeded";
          if (isMaxTokens && agent === "engineer") {
            // Token budget exhausted — retry with an explicit conciseness instruction.
            fullContent = "";
            send(controller, { type: "reset" });
            const retryMessages: Parameters<typeof provider.streamCompletion>[0] = [
              messages[0],
              {
                role: "user",
                content: `${messages[1].content}\n\n⚠️ 严格控制：代码必须在 280 行以内完成，不写任何注释，变量名可缩短。`,
              },
            ];
            await provider.streamCompletion(retryMessages, onChunk, completionOptions);
          } else if (isRateLimitError(err) && process.env.GROQ_API_KEY) {
            // Gemini rate-limit exhausted — silently fallback to Groq if available.
            // Reset fullContent and notify the client to discard partial chunks so
            // both sides stay in sync before Groq re-generates from scratch.
            fullContent = "";
            send(controller, { type: "reset" });
            const groqProvider = createProvider("llama-3.3-70b");
            await groqProvider.streamCompletion(messages, onChunk, completionOptions);
          } else {
            throw err;
          }
        }

        if (agent === "engineer") {
          if (targetFiles && targetFiles.length > 0) {
            const { extractMultiFileCode } = await import("@/lib/extract-code");
            const expectedPaths = targetFiles.map((f) => f.path);
            const filesResult = extractMultiFileCode(fullContent, expectedPaths);
            if (filesResult === null) {
              send(controller, { type: "error", error: "生成的代码不完整，请重试" });
            } else {
              send(controller, { type: "files_complete", files: filesResult });
            }
          } else {
            const finalCode = extractReactCode(fullContent);
            if (finalCode === null) {
              send(controller, { type: "error", error: "生成的代码不完整，请重试" });
            } else {
              send(controller, { type: "code_complete", code: finalCode });
            }
          }
        }

        send(controller, { type: "done" });
      } catch (err) {
        console.error(`[generate] agent=${agent} model=${resolvedModelId} error:`, err);
        send(controller, {
          type: "error",
          error: err instanceof Error ? err.message : "Generation failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
