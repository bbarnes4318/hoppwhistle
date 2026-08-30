import type { Metadata } from 'next';

import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { CustomerIntakeProvider } from '@/contexts/customer-intake-context';
import { fontVariables } from '@/lib/fonts';

export const metadata: Metadata = {
  title: 'Hopwhistle',
  description: 'Production-grade telephony platform',
  icons: {
    icon: '/hopwhistle.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  /*
   * <html> still carries `dark`, and the ThemeProvider is still forced to dark.
   * That is deliberate for this step: 34 of the 68 pages hardcode dark
   * utilities (text-white, bg-slate-900, border-white/10), so flipping the
   * default to light before those pages are converted would render them
   * unreadable. globals.css defines light at :root and dark under
   * [data-theme='dark'] / .dark, so the token system is already light-first —
   * removing this class in prompt 3 is what switches the app over.
   */
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${fontVariables} bg-background text-foreground font-sans`}>
        <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark">
          <CustomerIntakeProvider>{children}</CustomerIntakeProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
