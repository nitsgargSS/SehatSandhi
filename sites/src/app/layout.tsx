import '@/site/site.css';

import { Lato, Noto_Sans_Devanagari, Noto_Serif_Devanagari, Playfair_Display } from 'next/font/google';

import { TEXT_SIZE_BOOT } from '@/site/textsize';

// Root of every clinic site. Fonts: Sehatsandhi's "Elegant" pair (Playfair
// Display headings, Lato text) with Noto Serif / Sans Devanagari for Hindi.

const playfair = Playfair_Display({ weight: ['600', '700'], subsets: ['latin'], display: 'swap', variable: '--font-playfair' });
const lato = Lato({ weight: ['400', '700'], subsets: ['latin'], display: 'swap', variable: '--font-lato' });
const serifHi = Noto_Serif_Devanagari({ weight: ['500', '700'], subsets: ['devanagari'], display: 'swap', variable: '--font-serif-hi' });
const sansHi = Noto_Sans_Devanagari({ weight: ['400', '600', '700'], subsets: ['devanagari'], display: 'swap', variable: '--font-sans-hi' });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${lato.variable} ${serifHi.variable} ${sansHi.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEXT_SIZE_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
