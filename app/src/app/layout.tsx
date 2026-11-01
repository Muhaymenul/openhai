import type { Metadata } from "next";
import { headers } from "next/headers";
import { PwaSetup } from "@/components/pwa/PwaSetup";
import "./globals.css";

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  title: "教研阅记 · PaperFlow × Papernook",
  description: "本地论文阅读、中文批注、研究笔记与可追溯知识图谱。",
  icons: {
    icon: [{ url: "/icon.svg?v=papernook-1", type: "image/svg+xml" }],
    shortcut: "/icon.svg?v=papernook-1",
    apple: "/apple-icon.png?v=papernook-1",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var t=localStorage.getItem("papernook:theme");var v=t==="light"||t==="dark"?t:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=v;document.documentElement.style.colorScheme=v}catch(e){}})()',
          }}
        />
      </head>
      <body>
        {process.env.RESEARCH_LOCAL_MODE !== "1" && <PwaSetup />}
        {children}
      </body>
    </html>
  );
}
