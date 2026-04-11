/**
 * TDD tests for GuestLoginButtons component
 *
 * Tests:
 * - No localStorage: only "Try as Guest" shown
 * - Has localStorage: only "Continue as Guest" shown (no "Try as Guest")
 * - Writes guestId to localStorage on successful new guest login
 * - Restore success: calls signIn with redirect:false, then router.push
 * - Restore failure: clears localStorage, shows expired banner, shows "Try as Guest"
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GuestLoginButtons } from "@/components/layout/guest-login-buttons";

const mockSignIn = jest.fn();
jest.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}));

const mockRouterPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

const STORAGE_KEY = "builder_ai_guest_id";

describe("GuestLoginButtons", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  describe("no saved guest session", () => {
    it('renders "Try as Guest" button', () => {
      render(<GuestLoginButtons />);
      expect(
        screen.getByRole("button", { name: /try as guest/i })
      ).toBeInTheDocument();
    });

    it('does NOT show "Continue as Guest"', () => {
      render(<GuestLoginButtons />);
      expect(
        screen.queryByRole("button", { name: /continue as guest/i })
      ).not.toBeInTheDocument();
    });
  });

  describe("saved guest session exists", () => {
    beforeEach(() => {
      localStorage.setItem(STORAGE_KEY, "guest_abc123");
    });

    it('shows "Continue as Guest" button', () => {
      render(<GuestLoginButtons />);
      expect(
        screen.getByRole("button", { name: /continue as guest/i })
      ).toBeInTheDocument();
    });

    it('does NOT show "Try as Guest"', () => {
      render(<GuestLoginButtons />);
      expect(
        screen.queryByRole("button", { name: /try as guest/i })
      ).not.toBeInTheDocument();
    });
  });

  describe("new guest flow", () => {
    it('calls /api/auth/guest then signIn with returned guestId on "Try as Guest" click', async () => {
      mockSignIn.mockResolvedValue({ ok: true, error: null });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ userId: "guest_new123" }),
      } as unknown as Response);

      render(<GuestLoginButtons />);
      fireEvent.click(screen.getByRole("button", { name: /try as guest/i }));

      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalledWith(
          "credentials",
          expect.objectContaining({ guestId: "guest_new123" })
        );
      });
    });

    it("writes guestId to localStorage after successful guest login", async () => {
      mockSignIn.mockResolvedValue({ ok: true, error: null });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ userId: "guest_new123" }),
      } as unknown as Response);

      render(<GuestLoginButtons />);
      fireEvent.click(screen.getByRole("button", { name: /try as guest/i }));

      await waitFor(() => {
        expect(localStorage.getItem(STORAGE_KEY)).toBe("guest_new123");
      });
    });
  });

  describe("restore guest flow", () => {
    beforeEach(() => {
      localStorage.setItem(STORAGE_KEY, "guest_existing456");
    });

    it('calls signIn with redirect:false on "Continue as Guest" click', async () => {
      mockSignIn.mockResolvedValue({ ok: true, error: null });
      render(<GuestLoginButtons />);

      fireEvent.click(screen.getByRole("button", { name: /continue as guest/i }));

      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalledWith(
          "credentials",
          expect.objectContaining({ guestId: "guest_existing456", redirect: false })
        );
      });
    });

    it("navigates to / on successful restore", async () => {
      mockSignIn.mockResolvedValue({ ok: true, error: null });
      render(<GuestLoginButtons />);

      fireEvent.click(screen.getByRole("button", { name: /continue as guest/i }));

      await waitFor(() => {
        expect(mockRouterPush).toHaveBeenCalledWith("/");
      });
    });

    it("shows expired session banner when restore fails", async () => {
      mockSignIn.mockResolvedValue({ ok: false, error: "CredentialsSignin" });
      render(<GuestLoginButtons />);

      fireEvent.click(screen.getByRole("button", { name: /continue as guest/i }));

      await waitFor(() => {
        expect(screen.getByText(/访客会话已过期/)).toBeInTheDocument();
      });
    });

    it("clears localStorage when restore fails", async () => {
      mockSignIn.mockResolvedValue({ ok: false, error: "CredentialsSignin" });
      render(<GuestLoginButtons />);

      fireEvent.click(screen.getByRole("button", { name: /continue as guest/i }));

      await waitFor(() => {
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      });
    });

    it('shows "Try as Guest" after expired session', async () => {
      mockSignIn.mockResolvedValue({ ok: false, error: "CredentialsSignin" });
      render(<GuestLoginButtons />);

      fireEvent.click(screen.getByRole("button", { name: /continue as guest/i }));

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /try as guest/i })
        ).toBeInTheDocument();
      });
    });

    it('hides "Continue as Guest" after expired session', async () => {
      mockSignIn.mockResolvedValue({ ok: false, error: "CredentialsSignin" });
      render(<GuestLoginButtons />);

      fireEvent.click(screen.getByRole("button", { name: /continue as guest/i }));

      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: /continue as guest/i })
        ).not.toBeInTheDocument();
      });
    });
  });
});
