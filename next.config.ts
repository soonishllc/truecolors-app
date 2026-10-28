import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "ffmpeg-static", "@electric-sql/pglite"],
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
