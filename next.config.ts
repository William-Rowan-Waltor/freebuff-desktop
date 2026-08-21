import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // NOTE: output: 'standalone' is intentionally omitted here — Vercel
  // deploys its own serverless runtime and chokes on the missing
  // next-server.js.nft.json when standalone is set.
  // For Electron builds, standalone is set via the electron:build script.
};

export default nextConfig;
