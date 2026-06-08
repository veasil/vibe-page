import { redirect } from "next/navigation";

// 根路径 → 静态落地页（门面，不走 LLM）
export default function Home() {
  redirect("/landing.html");
}
