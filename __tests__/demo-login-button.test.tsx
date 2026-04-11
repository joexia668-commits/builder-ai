import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { DemoLoginButton } from "@/components/layout/demo-login-button";

const mockSignIn = jest.fn();
jest.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}));

describe("DemoLoginButton", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders a button with demo text", () => {
    render(<DemoLoginButton />);
    expect(screen.getByRole("button", { name: /查看演示项目/i })).toBeInTheDocument();
  });

  it('calls signIn("demo") with callbackUrl "/" on click', () => {
    render(<DemoLoginButton />);
    fireEvent.click(screen.getByRole("button", { name: /查看演示项目/i }));
    expect(mockSignIn).toHaveBeenCalledWith("demo", { callbackUrl: "/" });
  });
});
