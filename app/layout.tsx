import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dresplace",
  description: "Lên lịch, ghi chú và quản lý tệp trong một nơi",
  manifest: "/manifest.json",
  themeColor: "#22c55e",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Dresplace",
  },
};

const noFlashScript = `(function(){try{var d=document.documentElement,s=localStorage.getItem('app-theme-store'),t='dark',a='#34d399';if(s){var j=JSON.parse(s);if(j&&j.state){if(j.state.theme)t=j.state.theme;if(typeof j.state.accent==='string')a=j.state.accent;}}d.dataset.theme=t;if(t==='custom')d.style.setProperty('--accent',a);}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}