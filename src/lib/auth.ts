import { AuthOptions, getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import { organizations, users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { normalizeEmail } from "@/lib/validation";
import { getClientIp, headersFromReq, loginAccountLimiter, loginIpLimiter } from "@/lib/rate-limit";
import { consumeTwoFactorChallenge, isTwoFactorEnabled } from "@/lib/data/two-factor";
import { AUTH_FAILURE_MESSAGES } from "@/lib/auth-failures";

// -----------------------------------------------------------------------
// AUTH ARCHITECTURE
// - Credentials login (email + password). Passwords hashed with bcrypt.
// - JWT session strategy so the app can scale statelessly across instances.
// - Session carries: userId, role, organizationId (tenant key) — every
//   server action / API route derives its tenant scope from this, never
//   from client-supplied input, to prevent cross-tenant access.
// - SESSION BINDING (M-1): the JWT also carries a passwordVersion equal to
//   the user's passwordHash at sign-in. Every session touch re-reads the
//   current hash and rejects the session when it no longer matches, so a
//   password change/reset instantly invalidates all previously issued JWTs
//   (including stolen ones). No schema change: the existing passwordHash
//   column is the version marker.
// -----------------------------------------------------------------------

/**
 * Pure login-gating decision (unit-testable): does this account need to be
 * blocked until it verifies its email?
 *
 * - Verified accounts: never blocked.
 * - Demo/fictional organizations (isDemo) and platform super-admins (no
 *   organization): never blocked, so seeded demo logins keep working.
 * - Everyone else without a verification stamp: blocked.
 */
export function shouldBlockUnverifiedLogin(
  emailVerifiedAt: string | null | undefined,
  organization: { isDemo?: boolean | null } | null
): boolean {
  if (emailVerifiedAt) return false;
  if (!organization) return false; // SUPER_ADMIN and BUYER (no org) are not blocked
  if (organization.isDemo) return false;
  return true;
}

export async function findUserByEmail(email: unknown) {  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`)
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Signals `authorize` is permitted to surface to the browser. next-auth v4
 * converts a rejection into a redirect whose `?error=<error.message>` is read
 * back by the client (`next-auth/core/routes/callback.js` →
 * `next-auth/react/index.js`), so EVERYTHING thrown here is delivered to the
 * browser verbatim. This allow-list therefore contains only messages the
 * pages can safely render: the two control codes plus the keys of
 * AUTH_FAILURE_MESSAGES (lib/auth-failures.ts) — referenced via
 * `Object.keys`, so the allow-list cannot drift from the translations.
 * Anything else is an unexpected failure whose text may carry
 * database/driver detail.
 */
const CONTROLLED_AUTH_ERRORS: ReadonlySet<string> = new Set([
  "EMAIL_NOT_VERIFIED",
  "TWO_FACTOR_REQUIRED",
  ...Object.keys(AUTH_FAILURE_MESSAGES),
]);

/**
 * Wrap the credentials `authorize` so an unexpected database/authentication
 * failure is logged server-side in full and re-thrown as a generic sentinel
 * before next-auth can echo the raw message into the browser.
 *
 * Sign-in still fails in every one of those cases — nothing is bypassed,
 * no invalid password is accepted, no check is relaxed. Only the leakage
 * channel (raw SQL/driver text in `res.error` and the redirect URL) is
 * removed, which is what requirement "never expose sensitive database
 * details to the browser" needs.
 */
function withAuthErrorGuard(authorize: (credentials: any, req?: any) => Promise<any>) {
  return (credentials: any, req?: any) =>
    authorize(credentials, req).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (CONTROLLED_AUTH_ERRORS.has(message)) throw error;
      console.error("[auth] credentials authorize failed unexpectedly:", {
        name: error instanceof Error ? error.name : undefined,
        message,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new Error("SERVICE_UNAVAILABLE");
    });
}

export const authOptions: AuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 }, // 8h session
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // Set only after /api/auth/two-factor/verify has marked the challenge
        // verified. Consumed atomically below, so it can mint one session max.
        twoFactorChallengeId: { label: "Two-factor challenge", type: "text" },
      },
      authorize: withAuthErrorGuard(async (credentials, req) => {
        if (!credentials?.password) return null;

        const normalizedEmail = normalizeEmail(credentials.email);
        if (!normalizedEmail) return null;

        // Brute-force / credential-stuffing throttle (H-2). Per-account key
        // is the effective one: it survives attacker IP rotation, while the
        // per-IP key blunts spray from a single source. The login page maps
        // every failure to the same generic message, so throttling reveals
        // nothing about account existence.
        const ip = getClientIp(headersFromReq(req));
        const accountCheck = await loginAccountLimiter.check(`login:account:${normalizedEmail}`);
        const ipCheck = await loginIpLimiter.check(`login:ip:${ip}`);
        if (!accountCheck.allowed || !ipCheck.allowed) {
          throw new Error("Too many sign-in attempts. Please try again later.");
        }

        const user = await findUserByEmail(normalizedEmail);
        if (!user || !user.isActive) return null;

        const valid = await bcrypt.compare(String(credentials.password), user.passwordHash);
        if (!valid) return null;

        // Email ownership gate (Email 7A): correct password but unverified
        // address → distinct code (not the generic failure) so the login
        // page can say "Please verify your email before continuing." This
        // reveals nothing new: the attacker already knew the password.
        // Demo organizations and the platform super-admin are exempt so
        // seeded/fictional logins keep working.
        let orgForGate: { isDemo?: boolean | null } | null = null;
        if (user.organizationId) {
          const orgRows = await db
            .select({ isDemo: organizations.isDemo })
            .from(organizations)
            .where(eq(organizations.id, user.organizationId))
            .limit(1);
          orgForGate = orgRows[0] ?? null;
        }
        if (shouldBlockUnverifiedLogin(user.emailVerifiedAt, orgForGate)) {
          throw new Error("EMAIL_NOT_VERIFIED");
        }

        // Second factor gate: when 2FA is enabled the caller must present a
        // challenge that /verify already marked verified, and this single
        // consume proves it is fresh, bound to this user, unexpired and used
        // exactly once. Anything else → sign-in fails outright. The gate runs
        // only after the password checked out, so it leaks nothing new.
        if (await isTwoFactorEnabled(user.id)) {
          const challengeId =
            typeof credentials.twoFactorChallengeId === "string" ? credentials.twoFactorChallengeId : "";
          const consumed = challengeId ? await consumeTwoFactorChallenge(challengeId, user.id) : false;
          if (!consumed) {
            throw new Error("TWO_FACTOR_REQUIRED");
          }
        }

        // Success clears accumulated failures so legitimate typos followed by
        // the right password are never locked out.
        void loginAccountLimiter.reset(`login:account:${normalizedEmail}`);

        await db.update(users).set({ lastLoginAt: new Date().toISOString() }).where(eq(users.id, user.id));

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
          // M-1: bind this session to the current password. Any later
          // password change/reset alters passwordHash and orphan sessions
          // carrying the old value are rejected by the jwt callback.
          passwordVersion: user.passwordHash,
        } as any;
      }),
    }),
  ],
  callbacks: {
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) {
        return new URL(url, baseUrl).toString();
      }

      try {
        if (new URL(url).origin === baseUrl) return url;
      } catch {
        // no-op: fall back to same-origin root for safety
      }

      return `${baseUrl}/`;
    },
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role;
        token.organizationId = (user as any).organizationId;
        token.id = (user as any).id;
        token.passwordVersion = (user as any).passwordVersion ?? null;
      }
      // M-1: re-validate the password binding on every session touch. A
      // revoked marker destroys the session: the session callback below
      // maps it to null, so pages redirect to /login and APIs answer 401.
      // On DB failure we fail OPEN (keep the session) so a database blip
      // cannot log every user out; the security property holds whenever
      // the database is reachable.
      try {
        const tokenId = (token as any)?.id;
        const rows =
          typeof tokenId === "string" && tokenId
            ? await db
                .select({ passwordHash: users.passwordHash, isActive: users.isActive })
                .from(users)
                .where(eq(users.id, tokenId))
                .limit(1)
            : [];
        const current = rows[0] ?? null;
        if (shouldRevokeSession((token as any)?.passwordVersion, current)) {
          return { revoked: true } as any;
        }
      } catch (error) {
        console.error("[auth] session password check failed; keeping session (fail-open).", {
          userId: (token as any)?.id ?? null,
        });
      }
      return token;
    },
    async session({ session, token }) {
      if ((token as any)?.revoked) return null as any;
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

export const ROLE_HIERARCHY = ["BUYER", "SALES_AGENT", "MANAGER", "BUSINESS_ADMIN", "SUPER_ADMIN"] as const;
export type Role = (typeof ROLE_HIERARCHY)[number];

export function hasAtLeastRole(role: Role, minRole: Role) {
  return ROLE_HIERARCHY.indexOf(role) >= ROLE_HIERARCHY.indexOf(minRole);
}

/**
 * Pure session-revocation decision for M-1 (unit-testable; the jwt callback
 * below is a thin wrapper around it plus a user lookup).
 *
 * A session is revoked when it carries no password binding (minted before
 * this protection existed), when the account is gone/deactivated, or when
 * the stored password hash no longer equals the version bound at sign-in
 * (i.e. the password was changed or reset since).
 */
export function shouldRevokeSession(
  tokenPasswordVersion: unknown,
  current: { passwordHash: string; isActive: boolean } | null
): boolean {
  if (typeof tokenPasswordVersion !== "string" || !tokenPasswordVersion) return true;
  if (!current || !current.isActive) return true;
  return current.passwordHash !== tokenPasswordVersion;
}
