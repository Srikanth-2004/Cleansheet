import type { Metadata, Viewport } from 'next';
import {
  Noto_Sans_Devanagari,
  Noto_Sans_Kannada,
  Space_Grotesk,
} from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-devanagari',
  display: 'swap',
});

const notoKannada = Noto_Sans_Kannada({
  subsets: ['kannada'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-kannada',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'CleanSheet | Academy Fee Collection',
  description:
    'Voice-guided football academy fee collection with Raz (Sarvam AI) and Cashfree Sandbox.',
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#17131E',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${notoDevanagari.variable} ${notoKannada.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
