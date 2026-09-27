import type { Metadata } from 'next';

import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { CustomerIntakeProvider } from '@/contexts/customer-intake-context';
import { AuthSessionProvider } from '@/hooks/use-auth';
import { PlatformContextProvider } from '@/hooks/use-platform-context';
import { fontVariables } from '@/lib/fonts';
import { brandForRequest, brandMetadata } from '@/lib/server/public-brand';

/**
 * The document's title, application name and icons follow the brand that owns
 * the host the request came in on: a white-label agency's own domain is titled
 * and badged as that agency from the first byte, sign-in page included, and
 * agents.netenroll.com (or any host no agency owns) is NetEnroll. Once signed
 * in, <BrandThemeSync> re-points the icons at the session's brand.
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    ...brandMetadata(await brandForRequest()),
    description: 'Agency portal for pay-per-application call delivery',
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  /*
   * The document is light. globals.css carries the light palette at :root and
   * nothing here overrides it: no `dark` class on <html>, no forced theme on
   * the provider. The one dark screen — the admin live board — opts in by
   * wrapping itself in <ThemeScope theme="dark">, which is what [data-theme]
   * in globals.css answers to. Nothing else in the tree is ever dark.
   *
   * The provider stays because a handful of components still call useTheme().
   * It is pinned to light and does not read the OS preference: an agency
   * principal's statement does not change colour because their laptop did.
   */
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${fontVariables} bg-background text-foreground font-sans`}>
        <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light" enableSystem={false}>
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
