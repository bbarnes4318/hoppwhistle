'use client';

import Image from 'next/image';
import Link from 'next/link';

export function Footer() {
  const currentYear = new Date().getFullYear();

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <footer className="bg-[#070913] text-slate-400 border-t border-slate-900 py-16">
      <div className="container max-w-7xl mx-auto px-6 md:px-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12 pb-12 border-b border-slate-900">
          {/* Brand Col */}
          <div className="md:col-span-5 space-y-4">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="relative h-7 w-7 overflow-hidden rounded bg-slate-900 border border-slate-800 p-0.5">
                <Image
                  src="/hopwhistle-mark.svg"
                  alt="Hopwhistle Logo"
                  fill
                  className="object-contain p-0.5"
                />
              </div>
              <span className="font-bold text-white tracking-tight text-sm">Hopwhistle</span>
            </Link>
            <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
              Production-grade telephony, real-time call tracking, and AI voice routing engineered
              for performance marketing networks and enterprise operators.
            </p>
          </div>

          {/* Links Col 1: Product */}
          <div className="md:col-span-3 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Platform
            </h4>
            <ul className="space-y-2 text-xs">
              <li>
                <button
                  onClick={() => scrollToSection('features')}
                  className="hover:text-white transition-colors"
                >
                  Features
                </button>
              </li>
              <li>
                <button
                  onClick={() => scrollToSection('ai-voice')}
                  className="hover:text-white transition-colors"
                >
                  AI Voice Engine
                </button>
              </li>
              <li>
                <button
                  onClick={() => scrollToSection('routing')}
                  className="hover:text-white transition-colors"
                >
                  Routing Solutions
                </button>
              </li>
              <li>
                <button
                  onClick={() => scrollToSection('use-cases')}
                  className="hover:text-white transition-colors"
                >
                  Use Cases
                </button>
              </li>
            </ul>
          </div>

          {/* Links Col 2: Legal */}
          <div className="md:col-span-4 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Compliance & Legal
            </h4>
            <ul className="space-y-2 text-xs">
              <li>
                <Link href="/legal/privacy" className="hover:text-white transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/legal/terms" className="hover:text-white transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/legal/data-retention" className="hover:text-white transition-colors">
                  Data Retention Policy
                </Link>
              </li>
              <li>
                <Link href="/legal/call-recording" className="hover:text-white transition-colors">
                  Call Recording Compliance
                </Link>
              </li>
              <li>
                <Link href="/legal/dpa" className="hover:text-white transition-colors">
                  Data Processing Agreement (DPA)
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Footer bottom */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-600">
          <span>&copy; {currentYear} Hopwhistle. All rights reserved.</span>
          <div className="flex gap-4">
            <span>Built for scale.</span>
            <span>Hetzner Cloud Infrastructure.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
