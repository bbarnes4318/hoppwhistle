import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { CustomerIntakeProvider } from '@/contexts/customer-intake-context';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Hopwhistle',
  description: 'Production-grade telephony platform',
  icons: {
    icon: '/hopwhistle.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.className} bg-slate-950 text-slate-200`}>
        <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark">
          <CustomerIntakeProvider>{children}</CustomerIntakeProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
