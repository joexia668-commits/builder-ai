import React from "react";
import { render, screen } from "@testing-library/react";
import { AgentStatusBar } from "@/components/agent/agent-status-bar";
import type { AgentRole, AgentState } from "@/lib/types";

// Mock ThinkingIndicator
jest.mock("@/components/agent/thinking-indicator", () => ({
  ThinkingIndicator: ({ color }: { color?: string }) => (
    <div data-testid="thinking-indicator" data-color={color} />
  ),
}));

const makeStates = (
  overrides: Partial<Record<AgentRole, Partial<AgentState>>> = {}
): Record<AgentRole, AgentState> => ({
  pm: { role: "pm", status: "idle", output: "", ...overrides.pm },
  decomposer: { role: "decomposer", status: "idle", output: "", ...overrides.decomposer },
  architect: { role: "architect", status: "idle", output: "", ...overrides.architect },
  engineer: { role: "engineer", status: "idle", output: "", ...overrides.engineer },
});

describe("AgentStatusBar", () => {
  // UT-15: idle agents have opacity-50 when isGenerating=true
  it("UT-15: isGenerating=true 时 idle 状态 agent 降低透明度（opacity-50）", () => {
    const { container } = render(
      <AgentStatusBar agentStates={makeStates()} isGenerating={true} />
    );
    const cards = container.querySelectorAll(".opacity-50");
    // All 4 agents are idle, so all 4 should have opacity-50
    expect(cards.length).toBe(4);
  });

  it("isGenerating=false 时 idle agent 不添加 opacity-50", () => {
    const { container } = render(
      <AgentStatusBar agentStates={makeStates()} isGenerating={false} />
    );
    const opaqueCards = container.querySelectorAll(".opacity-50");
    expect(opaqueCards.length).toBe(0);
  });

  // UT-16: thinking/streaming agents show highlighted border + bg with theme color
  // Note: jsdom normalizes hex to rgb() in computed styles
  it("UT-16: thinking 状态 agent 显示高亮边框（border-2）和主题色背景", () => {
    const states = makeStates({ pm: { status: "thinking" } });
    const { container } = render(
      <AgentStatusBar agentStates={states} isGenerating={true} />
    );
    const pmCard = container.querySelector(".border-2") as HTMLElement;
    expect(pmCard).not.toBeNull();
    // PM color #6366f1 → rgb(99, 102, 241) in jsdom
    expect(pmCard.style.borderColor).toBe("rgb(99, 102, 241)");
    expect(pmCard.style.backgroundColor).toBe("rgb(99, 102, 241)");
  });

  it("UT-16: streaming 状态 agent 显示高亮边框（border-2）和主题色背景", () => {
    const states = makeStates({ architect: { status: "streaming" } });
    const { container } = render(
      <AgentStatusBar agentStates={states} isGenerating={true} />
    );
    const activeCard = container.querySelector(".border-2") as HTMLElement;
    expect(activeCard).not.toBeNull();
    // Architect color #f59e0b → rgb(245, 158, 11) in jsdom
    expect(activeCard.style.borderColor).toBe("rgb(245, 158, 11)");
    expect(activeCard.style.backgroundColor).toBe("rgb(245, 158, 11)");
  });

  // UT-17: done agents show ✓ and green styles
  it("UT-17: done 状态 agent 显示 ✓ 标志", () => {
    const states = makeStates({ pm: { status: "done" } });
    render(<AgentStatusBar agentStates={states} isGenerating={false} />);
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("UT-17: done 状态 agent 使用绿色样式（bg-emerald-50）", () => {
    const states = makeStates({ pm: { status: "done" } });
    const { container } = render(
      <AgentStatusBar agentStates={states} isGenerating={false} />
    );
    const doneCard = container.querySelector(".bg-emerald-50");
    expect(doneCard).not.toBeNull();
  });

  // UT-18: arrows → between agents
  it("UT-18: agent 之间有箭头 → 连线", () => {
    render(<AgentStatusBar agentStates={makeStates()} isGenerating={false} />);
    const arrows = screen.getAllByText("→");
    // 3 agents → 2 arrows
    expect(arrows).toHaveLength(2);
  });

  it("显示三个 agent 名称（Product Manager、System Architect、Full-Stack Engineer）", () => {
    render(<AgentStatusBar agentStates={makeStates()} isGenerating={false} />);
    expect(screen.getByText("Product Manager")).toBeInTheDocument();
    expect(screen.getByText("System Architect")).toBeInTheDocument();
    expect(screen.getByText("Full-Stack Engineer")).toBeInTheDocument();
  });

  it("active agent 状态显示 ThinkingIndicator", () => {
    const states = makeStates({ pm: { status: "thinking" } });
    render(<AgentStatusBar agentStates={states} isGenerating={true} />);
    expect(screen.getByTestId("thinking-indicator")).toBeInTheDocument();
  });

  it("所有 agent done 时无 opacity-50", () => {
    const states = makeStates({
      pm: { status: "done" },
      architect: { status: "done" },
      engineer: { status: "done" },
    });
    const { container } = render(
      <AgentStatusBar agentStates={states} isGenerating={false} />
    );
    expect(container.querySelectorAll(".opacity-50").length).toBe(0);
  });
});
