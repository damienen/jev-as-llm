import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

const description =
  "TypeSafe's Jev is a judgment model that was never trained to write. This page makes it chat anyway, one word at a time, and shows you the other words it considered.";

export const metadata: Metadata = {
  metadataBase: new URL("https://jev-as-llm.vercel.app"),
  title: "Jev as LLM",
  description,
  openGraph: { title: "Jev as LLM", description, url: "/", siteName: "Jev as LLM", type: "website" },
  twitter: { card: "summary_large_image", title: "Jev as LLM", description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        {children}
        {/* Cookieless page-view counts, served from this site's own /_vercel/insights path. */}
        <Analytics />
      </body>
    </html>
  );
}
