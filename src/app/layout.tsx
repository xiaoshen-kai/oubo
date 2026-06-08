import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GEO 内容生成工具",
  description: "多客户 GEO 内容生成 MVP"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
