import { AuthOptions, getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

// -----------------------------------------------------------------------
// AUTH ARCHITECTURE
// - Credentials login (email + password). Passwords hashed with bcrypt.
// - JWT session strategy so the app can scale statelessly across instances.
// - Session carries: userId, role, organizationId (tenant key) — every
//   server action / API route derives its tenant scope from this, never
//   from client-supplied input, to prevent cross-tenant access.
// -----------------------------------------------------------------------

export const authOptions: AuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 }, // 8h session
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const found = await db
          .select()
          .from(users)
          .where(eq(users.email, credentials.email.toLowerCase().trim()))
          .limit(1);

        const user = found[0];
        if (!user || !user.isActive) return null;

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;

        await db.update(users).set({ lastLoginAt: new Date().toISOString() }).where(eq(users.id, user.id));

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.organizationId = (user as any).organizationId;
        token.id = (user as any).id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).organizationId = token.organizationId;
      }
      return session;
    },
  },
};

export async function getCurrentSession() {
  return getServerSession(authOptions);
}

export const ROLE_HIERARCHY = ["SALES_AGENT", "MANAGER", "BUSINESS_ADMIN", "SUPER_ADMIN"] as const;
export type Role = (typeof ROLE_HIERARCHY)[number];

export function hasAtLeastRole(role: Role, minRole: Role) {
  return ROLE_HIERARCHY.indexOf(role) >= ROLE_HIERARCHY.indexOf(minRole);
}
