import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["exceljs", "pdf-lib", "jszip", "@pdf-lib/fontkit"],
  outputFileTracingIncludes: {
    "/api/activities/*/export": ["./public/fonts/NotoSansSC-Regular.ttf"],
  },
};
export default nextConfig;
