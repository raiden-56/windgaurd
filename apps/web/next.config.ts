import type { NextConfig } from "next";

const API_URL = process.env.API_URL || "http://localhost:4000";

/**
 * PAGES_BUILD=1 produces the static GitHub Pages site: the app is exported as plain files
 * under PAGES_BASE_PATH and the API runs in the browser (apps/demo builds public/demo/).
 */
const PAGES = process.env.PAGES_BUILD === "1";
const BASE_PATH = PAGES ? (process.env.PAGES_BASE_PATH ?? "/windgaurd") : "";

const serverConfig: NextConfig = {
  // All /api calls are proxied to the NestJS backend so session cookies stay first-party.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

const pagesConfig: NextConfig = {
  output: "export",
  basePath: BASE_PATH,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_DEMO: "1", NEXT_PUBLIC_BASE_PATH: BASE_PATH },
};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(PAGES ? pagesConfig : serverConfig),
};

export default nextConfig;
