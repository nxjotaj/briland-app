import type { Metadata } from "next";
import "./globals.css";

export const metadata:Metadata={ title:{default:"Briland | Peças e acessórios automotivos",template:"%s | Briland"},description:"Catálogo digital Briland de peças e acessórios automotivos.",icons:{icon:"/favicon.ico"} };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="pt-BR"><body>{children}</body></html>; }
