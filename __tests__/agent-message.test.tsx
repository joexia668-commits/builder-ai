import React from "react";
import { render, screen } from "@testing-library/react";
import { AgentMessage } from "@/components/agent/agent-message";
import type { ProjectMessage } from "@/lib/types";

// Mock ThinkingIndicator to simplify testing
jest.mock("@/components/agent/thinking-indicator", () => ({
  ThinkingIndicator: ({ color }: { color?: string }) => (
    <div data-testid="thinking-indicator" data-color={color} />
  ),
}));

const userMessage: ProjectMessage = {
  id: "1",
  projectId: "p1",
  role: "user",
  content: "帮我做一个 TODO 应用",
  createdAt: new Date(),
};

const pmMessage: ProjectMessage = {
  id: "2",
  projectId: "p1",
  role: "pm",
  content: "这是 PM 的需求文档...",
  createdAt: new Date(),
};

const archMessage: ProjectMessage = {
  id: "3",
  projectId: "p1",
  role: "architect",
  content: "这是架构师的技术方案...",
  createdAt: new Date(),
};

const engineerMessage: ProjectMessage = {
  id: "4",
  projectId: "p1",
  role: "engineer",
  content: "export default function App() {}",
  createdAt: new Date(),
};

describe("AgentMessage", () => {
  // UT-10: user messages are right-aligned
  it("UT-10: 用户消息靠右对齐（justify-end）", () => {
    const { container } = render(<AgentMessage message={userMessage} />);
    const outerDiv = container.firstChild as HTMLElement;
    expect(outerDiv.className).toContain("justify-end");
  });

  // UT-11: PM messages have indigo border (#6366f1)
  // Note: jsdom normalizes hex colors to rgb() in style attributes
  it("UT-11: PM 消息气泡带有 indigo 颜色左边框 (#6366f1 → rgb(99,102,241))", () => {
    const { container } = render(<AgentMessage message={pmMessage} />);
    // jsdom renders style="border-left-color: rgb(99, 102, 241);" (kebab-case, rgb format)
    const bubble = container.querySelector("[style*='border-left-color']") as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(bubble.style.borderLeftColor).toBe("rgb(99, 102, 241)");
  });

  // UT-12: Architect messages have amber border (#f59e0b)
  it("UT-12: Architect 消息气泡带有 amber 颜色左边框 (#f59e0b → rgb(245,158,11))", () => {
    const { container } = render(<AgentMessage message={archMessage} />);
    const bubble = container.querySelector("[style*='border-left-color']") as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(bubble.style.borderLeftColor).toBe("rgb(245, 158, 11)");
  });

  // UT-13: isThinking=true shows ThinkingIndicator, not content
  it("UT-13: isThinking=true 时显示 ThinkingIndicator，不显示消息内容", () => {
    render(<AgentMessage message={pmMessage} isThinking={true} />);
    expect(screen.getByTestId("thinking-indicator")).toBeInTheDocument();
    expect(screen.queryByText(pmMessage.content)).not.toBeInTheDocument();
  });

  // UT-14: isStreaming=true shows cursor animation
  it("UT-14: isStreaming=true 时显示光标动画元素（animate-pulse）", () => {
    const { container } = render(
      <AgentMessage message={pmMessage} isStreaming={true} />
    );
    const cursor = container.querySelector(".animate-pulse");
    expect(cursor).not.toBeNull();
  });

  it("isThinking=true 时在标题区显示「正在思考...」文字", () => {
    render(<AgentMessage message={pmMessage} isThinking={true} />);
    expect(screen.getByText("正在思考...")).toBeInTheDocument();
  });

  it("isStreaming=true 且 isThinking=false 时在标题区显示「生成中」", () => {
    render(<AgentMessage message={pmMessage} isStreaming={true} isThinking={false} />);
    expect(screen.getByText("生成中")).toBeInTheDocument();
  });

  it("非 thinking 状态时显示消息内容", () => {
    render(<AgentMessage message={pmMessage} />);
    expect(screen.getByText(pmMessage.content)).toBeInTheDocument();
  });

  it("PM avatar 边框使用 indigo 颜色 (#6366f1 → rgb(99,102,241))", () => {
    const { container } = render(<AgentMessage message={pmMessage} />);
    // Avatar has style={{ borderColor: agent.color }}
    const avatar = container.querySelector("[style*='border-color']") as HTMLElement;
    expect(avatar).not.toBeNull();
    expect(avatar.style.borderColor).toBe("rgb(99, 102, 241)");
  });

  it("engineer 消息带有 emerald 颜色左边框 (#10b981 → rgb(16,185,129))", () => {
    const { container } = render(<AgentMessage message={engineerMessage} />);
    const bubble = container.querySelector("[style*='border-left-color']") as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(bubble.style.borderLeftColor).toBe("rgb(16, 185, 129)");
  });
});
