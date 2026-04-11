import { render, screen } from "@testing-library/react";
import { EmailLoginForm } from "@/components/layout/email-login-form";

jest.mock("next-auth/react", () => ({
  signIn: jest.fn(),
}));

describe("EmailLoginForm — unavailable state", () => {
  it("renders the input as disabled", () => {
    render(<EmailLoginForm />);
    const input = screen.getByRole("textbox", { name: /邮箱/i });
    expect(input).toBeDisabled();
  });

  it("shows unavailable placeholder text", () => {
    render(<EmailLoginForm />);
    const input = screen.getByRole("textbox", { name: /邮箱/i });
    expect(input).toHaveAttribute("placeholder", "邮箱登录暂不可用");
  });

  it("renders the submit button as disabled", () => {
    render(<EmailLoginForm />);
    const button = screen.getByRole("button", { name: "发送登录链接" });
    expect(button).toBeDisabled();
  });

  it("shows the hint text", () => {
    render(<EmailLoginForm />);
    expect(screen.getByText(/域名验证后即可开放使用/)).toBeInTheDocument();
  });
});
