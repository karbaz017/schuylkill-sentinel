import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const grotesk = Space_Grotesk({ variable: "--font-grotesk", subsets: ["latin"], weight: ["500", "600", "700"] });
const mono = JetBrains_Mono({ variable: "--font-mono-jb", subsets: ["latin"], weight: ["400", "500"] });

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
      <body className={`${inter.variable} ${grotesk.variable} ${mono.variable} antialiased`}>{children}</body>
    </html>
  );
}
