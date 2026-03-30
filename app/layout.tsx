import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/components/layout/session-provider";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "BuilderAI — AI Agent Code Generator",
  description:
    "Multi-agent AI platform that generates web applications from natural language",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">
        <SessionProvider>
          {children}
          <Toaster />
        </SessionProvider>
      </body>
    </html>
  );
}
