import { PrismaAdapter } from "@auth/prisma-adapter";
import { NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { findGuestUser } from "@/app/api/auth/guest/guest-service";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID!,
      clientSecret: process.env.GITHUB_SECRET!,
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

        // Restore existing guest session by id
        if (credentials.guestId) {
          const user = await findGuestUser(credentials.guestId);
          if (user) {
            return { id: user.id, name: user.name ?? "Guest", email: null };
          }
          return null;
        }

        // New guest: the DB record is created by /api/auth/guest before signIn is called.
        // We receive the guestId back from that endpoint and sign in by id.
        return null;
      },
    }),
  ],
  // JWT strategy required for CredentialsProvider.
  // GitHub OAuth users/accounts are still persisted via PrismaAdapter.
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
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
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}
