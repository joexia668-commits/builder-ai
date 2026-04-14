import { deriveArchFromFiles } from "@/lib/agent-context";

const TODO_APP_FILES: Record<string, string> = {
  "/App.js": `import React, { useState, createContext } from 'react';
import { TodoList } from '/components/TodoList.js';
import { useTodos } from '/hooks/useTodos.js';
export default function App() { return <div><TodoList /></div>; }`,

  "/components/TodoList.js": `import React from 'react';
import { TodoItem } from '/components/TodoItem.js';
import { filterByStatus } from '/utils/filters.js';
export default function TodoList({ items }) { return <ul>{items.map(i => <TodoItem key={i.id} item={i} />)}</ul>; }
export { TodoList };`,

  "/components/TodoItem.js": `import React from 'react';
export function TodoItem({ item }) { return <li>{item.text}</li>; }
export default TodoItem;`,

  "/hooks/useTodos.js": `import { useState, useEffect } from 'react';
import { supabase } from '/supabaseClient.js';
export function useTodos() { const [todos, setTodos] = useState([]); return { todos, setTodos }; }
export default useTodos;`,

  "/utils/filters.js": `export function filterByStatus(items, status) { return items.filter(i => i.status === status); }
export function filterByDate(items, date) { return items.filter(i => i.date === date); }`,
};

describe("deriveArchFromFiles", () => {
  it("returns empty string for empty file set", () => {
    expect(deriveArchFromFiles({})).toBe("");
  });

  it("includes file count in header", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toContain("5 个文件");
  });

  it("lists each file with line count", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toContain("/App.js");
    expect(result).toContain("/components/TodoList.js");
    expect(result).toContain("/hooks/useTodos.js");
    expect(result).toMatch(/\/App\.js \(\d+ lines\)/);
  });

  it("extracts default exports", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toMatch(/\/App\.js.*App.*default/);
  });

  it("extracts named exports", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toContain("filterByStatus");
    expect(result).toContain("filterByDate");
  });

  it("builds import dependency graph for local files only", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toMatch(/\/App\.js.*→.*\/components\/TodoList\.js/);
    expect(result).toMatch(/\/App\.js.*→.*\/hooks\/useTodos\.js/);
  });

  it("excludes npm packages from dependency graph", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).not.toMatch(/→.*\breact\b/);
  });

  it("detects useState and createContext as state management", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toContain("useState");
    expect(result).toContain("createContext");
  });

  it("detects Supabase persistence", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toContain("Supabase");
  });

  it("detects localStorage persistence", () => {
    const files: Record<string, string> = {
      "/App.js": `import React from 'react';
export default function App() { localStorage.setItem('key', 'val'); return <div/>; }`,
    };
    const result = deriveArchFromFiles(files);
    expect(result).toContain("localStorage");
  });

  it("includes incremental instruction header", () => {
    const result = deriveArchFromFiles(TODO_APP_FILES);
    expect(result).toContain("从代码实时分析");
    expect(result).toContain("增量修改");
  });
});
