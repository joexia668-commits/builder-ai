import { buildAutoFixContext } from "@/lib/agent-context";

describe("buildAutoFixContext", () => {
  it("AF-01: includes error section in output", () => {
    const ctx = buildAutoFixContext(
      "错误 1 (编译): SyntaxError at /App.jsx:10",
      { "/App.jsx": "export default function App() { return <div> }" }
    );
    expect(ctx).toContain("自动修复模式");
    expect(ctx).toContain("SyntaxError");
    expect(ctx).toContain("// === FILE: /App.jsx ===");
  });

  it("AF-02: includes all file sources", () => {
    const ctx = buildAutoFixContext(
      "错误 1: Error",
      {
        "/App.jsx": "code1",
        "/components/Board.jsx": "code2",
      }
    );
    expect(ctx).toContain("// === FILE: /App.jsx ===");
    expect(ctx).toContain("// === FILE: /components/Board.jsx ===");
  });

  it("AF-03: includes fix constraints", () => {
    const ctx = buildAutoFixContext("错误 1: x", { "/App.jsx": "code" });
    expect(ctx).toContain("只修改导致上述错误的文件");
    expect(ctx).toContain("不要重构");
  });
});
