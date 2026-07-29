'use client';

import Image from 'next/image';
import Link from 'next/link';

export function LandingHeader() {
  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-md text-white">
      <div className="container flex h-16 max-w-7xl items-center justify-between mx-auto px-6 md:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="relative h-8 w-8 overflow-hidden rounded-lg bg-slate-900 border border-slate-800 p-1 transition-all duration-300 group-hover:scale-105 group-hover:border-emerald-500/30">
              <Image
                src="/hopwhistle-mark.svg"
                alt="Hopwhistle Logo"
                fill
                className="object-contain p-1"
                priority
              />
            </div>
            <span className="font-semibold tracking-tight text-white text-lg transition-colors group-hover:text-emerald-400">
              Hopwhistle
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            <button
              onClick={() => scrollToSection('features')}
              className="text-sm font-medium text-slate-400 hover:text-white transition-colors duration-200"
            >
              Features
            </button>
            <button
              onClick={() => scrollToSection('ai-voice')}
              className="text-sm font-medium text-slate-400 hover:text-white transition-colors duration-200"
            >
              AI Voice
            </button>
            <button
              onClick={() => scrollToSection('routing')}
              className="text-sm font-medium text-slate-400 hover:text-white transition-colors duration-200"
            >
              Call Routing
            </button>
            <button
              onClick={() => scrollToSection('use-cases')}
              className="text-sm font-medium text-slate-400 hover:text-white transition-colors duration-200"
            >
              Use Cases
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm font-medium text-slate-300 hover:text-white transition-colors duration-200 px-3 py-1.5 rounded-lg hover:bg-slate-900"
          >
            Sign In
          </Link>
          <a
            href="mailto:jimmy@leadzer.io"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-emerald-500 px-4 text-xs font-semibold text-slate-950 shadow-sm shadow-emerald-500/20 transition-all duration-200 hover:bg-emerald-400 hover:shadow-emerald-400/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-95"
          >
            Request Access
          </a>
        </div>
      </div>
    </header>
  );
}
