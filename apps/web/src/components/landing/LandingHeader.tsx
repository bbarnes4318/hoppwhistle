import Image from 'next/image';
import Link from 'next/link';

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 max-w-screen-2xl items-center justify-between mx-auto px-4 md:px-8">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <div className="relative h-8 w-8 overflow-hidden rounded-sm bg-black/20 p-1">
              <Image
                src="/hopwhistle.png"
                alt="Hopwhistle Logo"
                fill
                className="object-contain"
                priority
              />
            </div>
            <span className="hidden font-bold tracking-tight text-foreground sm:inline-block">
              Hopwhistle
            </span>
          </Link>
        </div>

        <nav className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign In
          </Link>
          <a
            href="mailto:jimmy@leadzer.io"
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            Request Access
          </a>
        </nav>
      </div>
    </header>
  );
}
