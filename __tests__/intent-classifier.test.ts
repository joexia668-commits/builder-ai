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

    it("detects 黄色 (specific color word)", () => {
      expect(classifyIntent("所有按键底色换成黄色", true)).toBe("style_change");
    });

    it("detects 底色 (color suffix word)", () => {
      expect(classifyIntent("底色改一下", true)).toBe("style_change");
    });

    it("detects 红色", () => {
      expect(classifyIntent("把标题改成红色", true)).toBe("style_change");
    });

    it("detects 蓝色", () => {
      expect(classifyIntent("背景换成蓝色", true)).toBe("style_change");
    });

    it("detects hex color value", () => {
      expect(classifyIntent("把主色换成 #ff6600", true)).toBe("style_change");
    });

    it("detects rgb() color value", () => {
      expect(classifyIntent("color should be rgb(255,0,0)", true)).toBe("style_change");
    });

    it("detects 圆角", () => {
      expect(classifyIntent("给按钮加圆角", true)).toBe("style_change");
    });

    it("detects 阴影", () => {
      expect(classifyIntent("卡片加个阴影效果", true)).toBe("style_change");
    });

    it("detects 加粗", () => {
      expect(classifyIntent("标题文字加粗", true)).toBe("style_change");
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

    it("no regression: 纯功能请求仍为 feature_add", () => {
      expect(classifyIntent("添加用户登录注册功能", true)).toBe("feature_add");
    });

    it("no regression: bug_fix 优先级高于颜色词", () => {
      // prompt contains both a bug keyword and a color word
      expect(classifyIntent("修复黄色按钮点击报错", true)).toBe("bug_fix");
    });
  });

  describe("keyword priority", () => {
    it("bug_fix takes priority over style keywords (修复样式错误)", () => {
      expect(classifyIntent("修复样式错误", true)).toBe("bug_fix");
    });
  });
});
