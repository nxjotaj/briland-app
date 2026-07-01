import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Briland Admin",
  description: "Painel administrativo web Briland"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
