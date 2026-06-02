import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import { SiteHeader } from "@/components/SiteHeader";
import { Footer } from "@/components/Footer";
import { asset } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://unliftedq.github.io/kman"),
  title: {
    default: "kman: multi-agent management tool",
    template: "%s · kman",
  },
  description:
    "kman sits above existing agent runtimes and gives each named agent its own isolated directory: soul prompt, skills, hooks, MCP servers, and permissions. One CLI dispatches them all.",
  icons: { icon: asset("/favicon.png") },
  openGraph: {
    title: "kman: multi-agent management tool",
    description:
      "A small society of named, well-tailored agents you can dispatch on a mission. One CLI, per-agent isolation, backend-agnostic.",
    images: ["/banner.png"],
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-[100dvh] font-sans">
        <Providers>
          <div className="flex min-h-[100dvh] flex-col">
            <SiteHeader />
            <div className="flex-1">{children}</div>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
