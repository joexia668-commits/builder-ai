import { checkUndefinedLucideIcons, applyLucideIconFixes } from "@/lib/extract-code";

describe("checkUndefinedLucideIcons", () => {
  it("returns empty array when all icons are valid", () => {
    const files = {
      "/App.js": `import { Home, Search } from "lucide-react";\nexport default function App() { return <Home />; }`,
    };
    expect(checkUndefinedLucideIcons(files)).toEqual([]);
  });

  it("returns empty for valid Icon-suffixed names (lucide-react exports both)", () => {
    const files = {
      "/App.js": `import { HomeIcon, SearchIcon } from "lucide-react";`,
    };
    // HomeIcon and SearchIcon are valid lucide-react exports
    expect(checkUndefinedLucideIcons(files)).toEqual([]);
  });

  it("detects Outline suffix and maps to correct name", () => {
    const files = {
      "/Nav.js": `import { HomeOutline } from "lucide-react";`,
    };
    const fixes = checkUndefinedLucideIcons(files);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].original).toBe("HomeOutline");
    expect(fixes[0].replacement).toBe("Home");
  });

  it("detects Solid suffix and maps to correct name", () => {
    const files = {
      "/Nav.js": `import { HomeSolid } from "lucide-react";`,
    };
    const fixes = checkUndefinedLucideIcons(files);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].original).toBe("HomeSolid");
    expect(fixes[0].replacement).toBe("Home");
  });

  it("uses Levenshtein match for close misspellings", () => {
    const files = {
      "/App.js": `import { Calculater } from "lucide-react";`,
    };
    const fixes = checkUndefinedLucideIcons(files);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].original).toBe("Calculater");
    expect(fixes[0].replacement).toBe("Calculator");
  });

  it("falls back to CircleAlert when no close match", () => {
    const files = {
      "/App.js": `import { Xyzzyplugh } from "lucide-react";`,
    };
    expect(checkUndefinedLucideIcons(files)).toEqual([
      { filePath: "/App.js", original: "Xyzzyplugh", replacement: "CircleAlert" },
    ]);
  });

  it("skips files without lucide-react imports", () => {
    const files = {
      "/App.js": `import React from "react";\nconst HomeOutline = () => <div />;`,
    };
    expect(checkUndefinedLucideIcons(files)).toEqual([]);
  });

  it("handles multiple invalid icons in one import", () => {
    const files = {
      "/App.js": `import { HomeOutline, SearchFilled, Calculator } from "lucide-react";`,
    };
    const fixes = checkUndefinedLucideIcons(files);
    // Calculator is valid, only HomeOutline and SearchFilled need fixing
    expect(fixes).toHaveLength(2);
    expect(fixes.map(f => f.original)).toEqual(["HomeOutline", "SearchFilled"]);
  });

  it("handles multiple files", () => {
    const files = {
      "/App.js": `import { HomeOutline } from "lucide-react";`,
      "/Nav.js": `import { SearchFilled } from "lucide-react";`,
    };
    const fixes = checkUndefinedLucideIcons(files);
    expect(fixes).toHaveLength(2);
    expect(fixes[0].filePath).toBe("/App.js");
    expect(fixes[1].filePath).toBe("/Nav.js");
  });
});

describe("applyLucideIconFixes", () => {
  it("replaces icon name in import and JSX", () => {
    const files = {
      "/App.js": `import { HomeOutline } from "lucide-react";\nexport default function App() { return <HomeOutline size={24} />; }`,
    };
    const fixes = [{ filePath: "/App.js", original: "HomeOutline", replacement: "Home" }];
    applyLucideIconFixes(files, fixes);
    expect(files["/App.js"]).toContain(`import { Home } from "lucide-react"`);
    expect(files["/App.js"]).toContain(`<Home size={24} />`);
    expect(files["/App.js"]).not.toContain("HomeOutline");
  });

  it("replaces multiple icons in one file", () => {
    const files = {
      "/App.js": `import { HomeOutline, SearchFilled } from "lucide-react";\n<HomeOutline /><SearchFilled />`,
    };
    const fixes = [
      { filePath: "/App.js", original: "HomeOutline", replacement: "Home" },
      { filePath: "/App.js", original: "SearchFilled", replacement: "Search" },
    ];
    applyLucideIconFixes(files, fixes);
    expect(files["/App.js"]).toContain("{ Home, Search }");
    expect(files["/App.js"]).toContain("<Home />");
    expect(files["/App.js"]).toContain("<Search />");
  });

  it("does not touch unrelated code", () => {
    const files = {
      "/App.js": `import { HomeOutline } from "lucide-react";\nconst homeAddress = "123 Main St";`,
    };
    const fixes = [{ filePath: "/App.js", original: "HomeOutline", replacement: "Home" }];
    applyLucideIconFixes(files, fixes);
    expect(files["/App.js"]).toContain('homeAddress = "123 Main St"');
  });

  it("handles empty fixes array (no-op)", () => {
    const files = { "/App.js": `import { Home } from "lucide-react";` };
    const original = files["/App.js"];
    applyLucideIconFixes(files, []);
    expect(files["/App.js"]).toBe(original);
  });
});
