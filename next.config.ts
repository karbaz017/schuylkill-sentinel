import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker/Vultr image.
  output: "standalone",
  // schema.sql is read at runtime to bootstrap Tiger Data; make sure it ships with the API routes.
  outputFileTracingIncludes: { "/api/**": ["./db/schema.sql"] },
  poweredByHeader: false,
  // Lint runs in `npm run lint` / CI; don't let it fail a container build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
