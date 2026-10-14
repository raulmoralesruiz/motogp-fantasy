import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma carga su query engine en runtime: no debe bundlearse.
  serverExternalPackages: ["@prisma/client"],
  // Producción (Docker, T-02): empaqueta un servidor mínimo en .next/standalone.
  output: "standalone",
};

export default nextConfig;
