"use client";

// Thin client wrapper so the App-Router root layout (a server component) can
// still provide the Auth.js session context to client components (useSession).
import { SessionProvider } from "next-auth/react";

export default function AuthSessionProvider({ children }) {
  return <SessionProvider>{children}</SessionProvider>;
}
