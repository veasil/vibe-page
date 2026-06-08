/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // 把 .mjs lib 模块与 prompts/ 一并纳入服务端打包追踪，确保 fs 读得到
    outputFileTracingIncludes: {
      "/api/generate": ["./prompts/**", "./demo/sample-llm-output.html", "./lib/**"],
    },
  },
};
export default nextConfig;
