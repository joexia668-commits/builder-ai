import { getToken } from "next-auth/jwt";
import { type NextRequest } from "next/server";
import { extractReactCode } from "@/lib/extract-code";
import { getSystemPrompt } from "@/lib/generate-prompts";
import { createProvider, resolveModelId, isRateLimitError } from "@/lib/ai-providers";
import { isValidModelId } from "@/lib/model-registry";
import type { AgentRole } from "@/lib/types";

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
  const { agent, prompt, context, projectId, modelId } = body as {
    projectId: string;
    prompt: string;
    agent: AgentRole;
    context?: string;
    modelId?: string;
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
      ? `用户需求：${prompt}`
      : agent === "architect"
        ? `PM 的产品需求文档：\n\n${context}\n\n请基于以上 PRD 设计 React 技术实现方案。`
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

        try {
          await provider.streamCompletion(messages, onChunk);
        } catch (err) {
          // Gemini rate-limit exhausted — silently fallback to Groq if available
          if (isRateLimitError(err) && process.env.GROQ_API_KEY) {
            fullContent = "";
            const groqProvider = createProvider("llama-3.3-70b");
            await groqProvider.streamCompletion(messages, onChunk);
          } else {
            throw err;
          }
        }

        if (agent === "engineer") {
          const finalCode = extractReactCode(fullContent);
          if (finalCode === null) {
            send(controller, { type: "error", error: "生成的代码不完整，请重试" });
          } else {
            send(controller, { type: "code_complete", code: finalCode });
          }
        }

        send(controller, { type: "done" });
      } catch (err) {
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
