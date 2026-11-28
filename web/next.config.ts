import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // Serve the presentation without the application shell or authentication providers.
  async rewrites() {
    return [{ source: "/slide", destination: "/moneylai-deck.html" }];
  },
  serverExternalPackages: ["exceljs", "pdf-lib", "jszip", "@pdf-lib/fontkit"],
  outputFileTracingIncludes: {
    "/api/activities/*/export": ["./public/fonts/NotoSansSC-Regular.ttf"],
  },
};
export default nextConfig;
