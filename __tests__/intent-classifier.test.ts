import { classifyIntent } from "@/lib/intent-classifier";

describe("classifyIntent", () => {
  describe("no existing code", () => {
    it("returns new_project when hasExistingCode is false", () => {
      expect(classifyIntent("做一个计算器", false)).toBe("new_project");
    });

    it("returns new_project even with bug keywords when no code exists", () => {
      expect(classifyIntent("修复bug", false)).toBe("new_project");
    });
  });

  describe("bug_fix detection", () => {
    it("detects 没有反应", () => {
      expect(classifyIntent("按钮点击没有反应", true)).toBe("bug_fix");
    });

    it("detects 报错", () => {
      expect(classifyIntent("控制台报错了", true)).toBe("bug_fix");
    });

    it("detects 修复", () => {
      expect(classifyIntent("修复一下列表", true)).toBe("bug_fix");
    });

    it("detects 不工作", () => {
      expect(classifyIntent("搜索不工作", true)).toBe("bug_fix");
    });

    it("detects English 'bug'", () => {
      expect(classifyIntent("there's a bug in the form", true)).toBe("bug_fix");
    });

    it("detects 错误", () => {
      expect(classifyIntent("点击出现错误", true)).toBe("bug_fix");
    });
  });

  describe("style_change detection", () => {
    it("detects 颜色", () => {
      expect(classifyIntent("改一下颜色", true)).toBe("style_change");
    });

    it("detects 深色", () => {
      expect(classifyIntent("添加深色模式", true)).toBe("style_change");
    });

    it("detects UI", () => {
      expect(classifyIntent("调整一下UI布局", true)).toBe("style_change");
    });

    it("detects 样式", () => {
      expect(classifyIntent("修改样式", true)).toBe("style_change");
    });

    it("detects 'dark mode' (multi-word English keyword)", () => {
      expect(classifyIntent("switch to dark mode", true)).toBe("style_change");
    });
  });

  describe("new_project override", () => {
    it("detects 重新做", () => {
      expect(classifyIntent("重新做一个计算器", true)).toBe("new_project");
    });

    it("detects 全新", () => {
      expect(classifyIntent("做一个全新的应用", true)).toBe("new_project");
    });

    it("detects 'start over' (English)", () => {
      expect(classifyIntent("let's start over", true)).toBe("new_project");
    });
  });

  describe("feature_add (default)", () => {
    it("returns feature_add for generic feature requests", () => {
      expect(classifyIntent("增加一个搜索框", true)).toBe("feature_add");
    });

    it("returns feature_add when prompt has no matching keywords", () => {
      expect(classifyIntent("添加用户登录功能", true)).toBe("feature_add");
    });
  });

  describe("keyword priority", () => {
    it("bug_fix takes priority over style keywords (修复样式错误)", () => {
      expect(classifyIntent("修复样式错误", true)).toBe("bug_fix");
    });
  });
});
