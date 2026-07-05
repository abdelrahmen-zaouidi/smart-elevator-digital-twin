/**
 * Auth.js (NextAuth v5) configuration — per-user authentication for ElevatorOS.
 *
 * Credentials provider backed by the dashboard_users table (migration 010,
 * bcrypt via src/server/userStore.js). JWT session strategy (no extra service):
 * the session carries { user_id, username, role } so server routes can enforce
 * RBAC without a DB round-trip.
 *
 * The HTTP Basic-Auth middleware (middleware.ts) remains as an OUTER
 * demo-tunnel gate; this session layer is the per-user identity used by
 * /api/commands for role enforcement + audit attribution.
 *
 * Requires AUTH_SECRET (or NEXTAUTH_SECRET) in the environment.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyCredentials } from "./src/server/userStore.js";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/" },
  providers: [
    Credentials({
      name: "ElevatorOS",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const user = await verifyCredentials(credentials?.username, credentials?.password);
        if (!user) return null;
        return { id: user.id, name: user.username, role: user.role };
      },
    }),
  ],
  callbacks: {
    // Persist identity + role into the JWT at sign-in.
    jwt({ token, user }) {
      if (user) {
        token.user_id = user.id;
        token.username = user.name;
        token.role = user.role;
      }
      return token;
    },
    // Expose them on the session object read by the server + client.
    session({ session, token }) {
      session.user = session.user || {};
      session.user.id = token.user_id;
      session.user.username = token.username;
      session.user.role = token.role;
      return session;
    },
  },
});
