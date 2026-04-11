import { authOptions } from "@/lib/auth";
import type { OAuthConfig } from "next-auth/providers/oauth";

jest.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: jest.fn(() => ({})),
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {},
}));
jest.mock("@/lib/resend", () => ({
  resend: { emails: { send: jest.fn() } },
}));
jest.mock("@/lib/demo-bootstrap", () => ({
  ensureDemoViewer: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/app/api/auth/guest/guest-service", () => ({
  findGuestUser: jest.fn(),
}));
jest.mock("next-auth/providers/email", () => {
  return jest.fn((opts: unknown) => ({ id: "email", type: "email", ...((opts as object) ?? {}) }));
});

describe("authOptions providers", () => {
  it("GitHub provider has login param to force account selection", () => {
    const github = authOptions.providers.find(
      (p) => (p as OAuthConfig<unknown>).id === "github"
    ) as OAuthConfig<unknown> & { options?: { authorization?: { params?: { login?: string } } } } | undefined;
    expect(github).toBeDefined();
    // next-auth v4 stores custom authorization params under options.authorization.params
    expect(
      github?.options?.authorization?.params?.login
    ).toBe("");
  });

  it("includes an email provider", () => {
    const email = authOptions.providers.find(
      (p) => (p as { id?: string }).id === "email"
    );
    expect(email).toBeDefined();
  });

  it("includes a demo credentials provider", () => {
    // next-auth v4 CredentialsProvider stores custom id in options.id
    const demo = authOptions.providers.find(
      (p) => (p as { options?: { id?: string } }).options?.id === "demo"
    );
    expect(demo).toBeDefined();
  });

  it("still includes the guest credentials provider", () => {
    // next-auth v4 CredentialsProvider stores custom id in options.id
    const guest = authOptions.providers.find(
      (p) => (p as { options?: { id?: string } }).options?.id === "credentials"
    );
    expect(guest).toBeDefined();
  });
});
