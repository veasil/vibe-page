import { updateSession } from "@/utils/supabase/middleware";

export async function middleware(request) {
  return await updateSession(request);
}

export const config = {
  // 跳过静态资源；其余请求都刷新会话
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:css|js|png|webp|svg|ico|map)$).*)",
  ],
};
