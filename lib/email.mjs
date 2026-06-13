// lib/email.mjs — Resend 邮件发送封装
// 用途：应用层自定义邮件（通知、报告等）
// Supabase 的登录邮件走 SMTP 配置，不走这里
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// 默认发件人：未验证自定义域名时用 Resend 测试地址（只能发到自己的邮箱）
// 验证了自己的域名后改成 noreply@你的域名
const FROM = process.env.EMAIL_FROM || "onboarding@resend.dev";

/**
 * 发送邮件
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 */
export async function sendEmail({ to, subject, html, text }) {
  const { data, error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
    ...(text ? { text } : {}),
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
  return data;
}
