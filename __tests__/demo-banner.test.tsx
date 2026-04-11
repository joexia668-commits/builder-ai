import React from "react";
import { render, screen } from "@testing-library/react";
import { DemoBanner } from "@/components/layout/demo-banner";

describe("DemoBanner", () => {
  it("renders the read-only warning message", () => {
    render(<DemoBanner />);
    expect(screen.getByText(/演示模式/i)).toBeInTheDocument();
    expect(screen.getByText(/无法编辑/i)).toBeInTheDocument();
  });
});
