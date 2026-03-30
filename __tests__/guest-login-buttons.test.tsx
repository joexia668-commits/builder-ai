/**
 * TDD tests for GuestLoginButtons component
 *
 * Tests:
 * - Shows "Try as Guest" button always
 * - Shows "Continue as Guest" button only when guestId in localStorage
 * - Writes guestId to localStorage on successful guest login
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GuestLoginButtons } from "@/components/layout/guest-login-buttons";

// Mock next-auth/react
const mockSignIn = jest.fn();
jest.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}));

const STORAGE_KEY = "builder_ai_guest_id";

describe("GuestLoginButtons", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('renders "Try as Guest" button', () => {
    render(<GuestLoginButtons />);
    expect(
      screen.getByRole("button", { name: /try as guest/i })
    ).toBeInTheDocument();
  });

  it('does NOT show "Continue as Guest" when no guestId in localStorage', () => {
    render(<GuestLoginButtons />);
    expect(
      screen.queryByRole("button", { name: /continue as guest/i })
    ).not.toBeInTheDocument();
  });

  it('shows "Continue as Guest" button when guestId exists in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, "guest_abc123");
    render(<GuestLoginButtons />);
    expect(
      screen.getByRole("button", { name: /continue as guest/i })
    ).toBeInTheDocument();
  });

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
    mockSignIn.mockResolvedValue({ ok: true, error: null, url: null });
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

  it('calls signIn with guestId on "Continue as Guest" click', async () => {
    localStorage.setItem(STORAGE_KEY, "guest_existing456");
    mockSignIn.mockResolvedValue({ ok: true, error: null });
    render(<GuestLoginButtons />);

    fireEvent.click(screen.getByRole("button", { name: /continue as guest/i }));

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith(
        "credentials",
        expect.objectContaining({ guestId: "guest_existing456" })
      );
    });
  });
});
