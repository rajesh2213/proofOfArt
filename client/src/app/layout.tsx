import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "../contexts/ThemeContext";
import { LoaderProvider } from "../contexts/LoaderContext";
import { UIProvider } from "../contexts/UIContext";
import { AuthProvider } from "../contexts/AuthContext";
import GlobalLoader from "../components/DrawingLoader/GlobalLoader";
import PersistentPaintDrip from "../components/PaintDrip/PersistentPaintDrip";
import HeaderWrapper from "../components/Header/HeaderWrapper";
import ZoomBlocker from "./ZoomBlocker";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const wetPaint = localFont({
  src: "../../public/fonts/WetPaint-8Mz0.ttf",
  variable: "--font-wet-paint",
  display: "swap",
});

const paintDrops = localFont({
  src: "../../public/fonts/PaintDropsRegular-0WaJo.ttf",
  variable: "--font-paint-drops",
  display: "swap",
});

const paintPeelInitials = localFont({
  src: "../../public/fonts/PaintPeelInitials-q38q.ttf",
  variable: "--font-paint-peel",
  display: "swap",
});

const meltPaint = localFont({
  src: "../../public/fonts/MeltedPersonalUseBold-2OG4w.ttf",
  variable: "--font-melt-paint",
  display: "swap",
})

const waniyePaint = localFont({
  src: "../../public/fonts/Waniye-e9gpO.otf",
  variable: "--font-waniye-paint",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Proof of Art - AI Art Authentication",
  description:
    "Upload and analyze images with our AI-powered detection system. Verify artwork authenticity with cutting-edge technology.",
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />

        <link
          rel="preload"
          href="/videos/paint_drip_reveal.webm"
          as="video"
          type="video/webm"
        />
        <link rel="preload" href="/images/5177180.jpg" as="image" />
        <link
          rel="preload"
          href="/spritesheets/paint_drip_spritesheets/sheet_1.webp"
          as="image"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/spritesheets/paint_drip_spritesheets/sheet_2.webp"
          as="image"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/spritesheets/paint_drip_spritesheets/sheet_3.webp"
          as="image"
          crossOrigin="anonymous"
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} ${wetPaint.variable} ${paintDrops.variable} ${paintPeelInitials.variable} ${meltPaint.variable} ${waniyePaint.variable} antialiased h-full overflow-y-auto`}      >
        <ThemeProvider>
          <AuthProvider>
            <LoaderProvider>
              <UIProvider>
                <GlobalLoader />
                <PersistentPaintDrip />
                <HeaderWrapper />
                <ZoomBlocker>{children}</ZoomBlocker>
              </UIProvider>
            </LoaderProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
