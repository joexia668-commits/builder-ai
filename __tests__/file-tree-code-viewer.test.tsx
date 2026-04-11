import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTreeCodeViewer } from "@/components/preview/file-tree-code-viewer";

// Mock Monaco — it requires a browser environment
jest.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({ value, language }: { value: string; language: string }) => (
    <div data-testid="monaco-editor" data-language={language}>
      {value}
    </div>
  ),
}));

const FILES = {
  "/App.js": "export default function App() {}",
  "/components/Button.js": "export function Button() {}",
  "/components/Header.js": "export function Header() {}",
};

describe("FileTreeCodeViewer", () => {
  it("renders file names in the tree", () => {
    render(<FileTreeCodeViewer files={FILES} />);
    expect(screen.getByText("App.js")).toBeInTheDocument();
    expect(screen.getByText("Button.js")).toBeInTheDocument();
    expect(screen.getByText("Header.js")).toBeInTheDocument();
  });

  it("renders directory names in the tree", () => {
    render(<FileTreeCodeViewer files={FILES} />);
    expect(screen.getByText("components")).toBeInTheDocument();
  });

  it("shows Monaco editor on mount with first file (App.js)", () => {
    render(<FileTreeCodeViewer files={FILES} />);
    const editor = screen.getByTestId("monaco-editor");
    expect(editor).toHaveTextContent("export default function App()");
  });

  it("clicking a file updates Monaco content", () => {
    render(<FileTreeCodeViewer files={FILES} />);
    fireEvent.click(screen.getByText("Button.js"));
    const editor = screen.getByTestId("monaco-editor");
    expect(editor).toHaveTextContent("export function Button()");
  });

  it("clicking a directory toggles collapse (hides children)", () => {
    render(<FileTreeCodeViewer files={FILES} />);
    // Initially expanded — Button.js is visible
    expect(screen.getByText("Button.js")).toBeInTheDocument();
    // Click the directory to collapse
    fireEvent.click(screen.getByText("components"));
    expect(screen.queryByText("Button.js")).not.toBeInTheDocument();
    // Click again to expand
    fireEvent.click(screen.getByText("components"));
    expect(screen.getByText("Button.js")).toBeInTheDocument();
  });

  it("shows placeholder when files is empty", () => {
    render(<FileTreeCodeViewer files={{}} />);
    expect(screen.getByText(/选择文件/)).toBeInTheDocument();
  });

  it("infers typescript language for .tsx files", () => {
    render(<FileTreeCodeViewer files={{ "/App.tsx": "const x = 1" }} />);
    const editor = screen.getByTestId("monaco-editor");
    expect(editor).toHaveAttribute("data-language", "typescript");
  });

  it("infers css language for .css files", () => {
    render(<FileTreeCodeViewer files={{ "/styles.css": "body {}" }} />);
    fireEvent.click(screen.getByText("styles.css"));
    const editor = screen.getByTestId("monaco-editor");
    expect(editor).toHaveAttribute("data-language", "css");
  });

  it("falls back to plaintext for unknown extensions", () => {
    render(<FileTreeCodeViewer files={{ "/README.md": "# hello" }} />);
    const editor = screen.getByTestId("monaco-editor");
    expect(editor).toHaveAttribute("data-language", "plaintext");
  });
});
