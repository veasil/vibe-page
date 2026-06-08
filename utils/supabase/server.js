import { createServerClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// 新版用 publishable key；兼容老 anon key 命名
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 是否已配置 Supabase（未配置则上层走 mock）
export const supabaseConfigured = () => !!(supabaseUrl && supabaseKey);

// cookieStore = await cookies()
export const createClient = (cookieStore) =>
  createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // 在 Server Component 调用 setAll 会抛错；有 middleware 刷新会话即可忽略
        }
      },
    },
  });
