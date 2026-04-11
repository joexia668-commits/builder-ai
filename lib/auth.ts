import { PrismaAdapter } from "@auth/prisma-adapter";
import { NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import EmailProvider from "next-auth/providers/email";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { resend } from "@/lib/resend";
import { ensureDemoViewer } from "@/lib/demo-bootstrap";
import { findGuestUser } from "@/app/api/auth/guest/guest-service";

// Ensure demo viewer account exists on cold start
ensureDemoViewer().catch(console.error);

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
    }),
    EmailProvider({
      from: process.env.EMAIL_FROM!,
      sendVerificationRequest: async ({ identifier, url, provider }) => {
        try {
          await resend.emails.send({
            from: provider.from,
            to: identifier,
            subject: "登录 BuilderAI",
            html: `<p>点击下方链接登录 BuilderAI（链接 10 分钟内有效）：</p><p><a href="${url}">立即登录</a></p>`,
            text: `登录链接：${url}`,
          });
        } catch (error) {
          console.error("[auth] Failed to send verification email to", identifier, error);
          throw new Error("Failed to send verification email");
        }
      },
    }),
    CredentialsProvider({
      id: "demo",
      name: "Demo",
      credentials: {},
      async authorize() {
        const id = process.env.DEMO_VIEWER_ID;
        if (!id) return null;
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user?.isDemoViewer) return null;
        return { id: user.id, name: "Demo Viewer", email: null, isDemo: true };
      },
    }),
    CredentialsProvider({
      id: "credentials",
      name: "Guest",
      credentials: {
        guest: { type: "text" },
        guestId: { type: "text" },
      },
      async authorize(credentials) {
        if (!credentials) return null;
        if (credentials.guestId) {
          const user = await findGuestUser(credentials.guestId);
          if (user) {
            return { id: user.id, name: user.name ?? "Guest", email: null };
          }
        }
        return null;
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.isDemo = (user as { isDemo?: boolean }).isDemo ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id;
        session.user.isDemo = token.isDemo ?? false;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      isDemo: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    isDemo?: boolean;
  }
}
