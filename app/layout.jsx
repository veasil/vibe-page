export const metadata = {
  title: "协商真实 · 幻觉导航网",
  description: "一个永远停在 13 年前的中文互联网",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
