import type { ErrorCode } from "@/lib/types";

interface ErrorDisplay {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
  readonly action?: { label: string; type: "new_project" };
}

export const ERROR_DISPLAY: Record<ErrorCode, ErrorDisplay> = {
  rate_limited: {
    icon: "⏳",
    title: "请求太频繁",
    description: "AI 服务达到频率限制，请等待约 30 秒后再试",
  },
  context_overflow: {
    icon: "📦",
    title: "对话内容过长",
    description: "当前对话上下文已超出模型限制，建议新建项目重新开始",
    action: { label: "新建项目", type: "new_project" },
  },
  provider_unavailable: {
    icon: "🔌",
    title: "AI 服务暂时不可用",
    description: "无法连接到 AI 提供商，请检查网络或稍后重试",
  },
  generation_timeout: {
    icon: "⌛",
    title: "生成超时",
    description: "本次生成耗时过长，请重新发送请求",
  },
  parse_failed: {
    icon: "⚠️",
    title: "结果解析失败",
    description: "AI 输出格式异常，已自动重试仍失败，请重新描述需求",
  },
  unknown: {
    icon: "❌",
    title: "生成失败",
    description: "发生未知错误，请重试",
  },
};

/**
 * Infers a typed ErrorCode from an unknown caught error.
 * Checks for an explicit `errorCode` property first (set by internal throwers),
 * then falls back to message-string matching.
 */
export function inferErrorCode(err: unknown): ErrorCode {
  if (err !== null && typeof err === "object" && "errorCode" in err) {
    return (err as { errorCode: ErrorCode }).errorCode;
  }
  if (!(err instanceof Error)) return "unknown";
  const msg = err.message.toLowerCase();
  if (msg.includes("429") || msg.includes("rate limit")) return "rate_limited";
  if (msg.includes("context length") || msg.includes("too long")) return "context_overflow";
  if (msg.includes("timeout") || msg.includes("timed out")) return "generation_timeout";
  if (
    msg.includes("api key") ||
    msg.includes("unauthorized") ||
    /5\d\d/.test(msg)
  )
    return "provider_unavailable";
  return "unknown";
}
