import type { Metadata } from "next";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/500.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "Relay Studio · Content operations",
  description:
    "Turn product context into credible content. Four agents, one traceable editorial workflow.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
