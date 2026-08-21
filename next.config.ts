import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Self-contained server output: lets the Docker image run with just node +
  // .next/standalone (no node_modules copy needed at runtime).
  output: 'standalone',
};

export default nextConfig;
