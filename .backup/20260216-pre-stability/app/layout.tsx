import type { Metadata } from "next";
import "./globals.css";
import Header from "./components/Header";

export const metadata: Metadata = {
  title: "Russian Raspev",
  description: "Культурная платформа с интерактивным звучанием и обучением",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="antialiased">
  <Header />
        {children}
      </body>
    </html>
  );
}
