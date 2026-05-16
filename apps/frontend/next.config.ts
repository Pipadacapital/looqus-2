import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // gRPC packages use dynamic requires + fs that Next's bundler can't trace.
  // Mark them external so they're loaded as Node modules at runtime instead
  // of being bundled (which produces TypeError: Cannot read properties of
  // null (reading 'readFileSync') at module evaluation time).
  serverExternalPackages: ["@grpc/grpc-js", "@grpc/proto-loader"],
};

export default nextConfig;
