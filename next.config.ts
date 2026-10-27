
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    agentFeedback: true,
  },
};

export default nextConfig;
