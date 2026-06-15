import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Shared elevator domain logic lives in /packages/shared (consumed via the
  // @smart-elevator/shared workspace dependency). Next must transpile it since
  // it ships untranspiled ESM...
  transpilePackages: ["@smart-elevator/shared"],
  turbopack: {
    // ...and Turbopack must treat the monorepo root as the resolution root so
    // it will follow the link into the sibling /packages/shared directory.
    root: path.resolve(__dirname, "..", ".."),
  },
}

export default nextConfig
