import type { Metadata } from 'next';

import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { CustomerIntakeProvider } from '@/contexts/customer-intake-context';
import { AuthSessionProvider } from '@/hooks/use-auth';
import { PlatformContextProvider } from '@/hooks/use-platform-context';
import { fontVariables } from '@/lib/fonts';

export const metadata: Metadata = {
  title: 'NetEnroll',
  description: 'Agency portal for pay-per-application call delivery',
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
          {/*
            One answer to "are you NetEnroll staff, and which agency are you
            inside" for the whole tree. It was a per-component fetch, which is
            how the layout and the page it wraps came to disagree about whether
            /delivery needed an agency. See use-platform-context.
          */}
          <AuthSessionProvider>
            <PlatformContextProvider>
              <CustomerIntakeProvider>{children}</CustomerIntakeProvider>
            </PlatformContextProvider>
          </AuthSessionProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
