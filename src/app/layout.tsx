import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MusicBridge",
  description: "轻松同步你喜欢的音乐到网易云音乐云盘",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh">
      <body className="antialiased">{children}</body>
    </html>
  );
}
