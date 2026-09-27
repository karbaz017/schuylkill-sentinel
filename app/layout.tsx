import type { Metadata, Viewport } from "next";
// Self-hosted fonts: builds never depend on reaching Google Fonts (flaky venue Wi-Fi, Docker builds).
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

const name = process.env.NEXT_PUBLIC_APP_NAME || "Schuylkill Sentinel";
const description = "Know before you go: live sewage-overflow and river-safety risk for Philly's waterfronts.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: `${name}: is the river safe today?`,
  description,
  openGraph: { title: name, description, type: "website" },
  twitter: { card: "summary_large_image", title: name, description },
};

export const viewport: Viewport = {
  themeColor: "#030811",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
