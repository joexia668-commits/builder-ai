import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EmailLoginForm } from "@/components/layout/email-login-form";

const mockSignIn = jest.fn();
jest.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}));

describe("EmailLoginForm", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders an email input and submit button", () => {
    render(<EmailLoginForm />);
    expect(screen.getByRole("textbox", { name: /邮箱/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /发送登录链接/i })).toBeInTheDocument();
  });

  it("calls signIn with the entered email on submit", async () => {
    mockSignIn.mockResolvedValue({ ok: true });
    render(<EmailLoginForm />);
    fireEvent.change(screen.getByRole("textbox", { name: /邮箱/i }), {
      target: { value: "user@qq.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送登录链接/i }));
    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith("email", {
        email: "user@qq.com",
        callbackUrl: "/",
      });
    });
  });

  it("disables the button while submitting", async () => {
    mockSignIn.mockReturnValue(new Promise(() => {}));
    render(<EmailLoginForm />);
    fireEvent.change(screen.getByRole("textbox", { name: /邮箱/i }), {
      target: { value: "user@163.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送登录链接/i }));
    expect(screen.getByRole("button", { name: /发送登录链接/i })).toBeDisabled();
  });
});
