'use client';

import { FileText, Shield, Scale } from 'lucide-react';
import Link from 'next/link';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t bg-background">
      <div className="container mx-auto px-6 py-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-sm text-muted-foreground">
            © {currentYear} Hopwhistle. All rights reserved.
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <Link
              href="/legal/privacy"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Shield className="h-4 w-4" />
              Privacy Policy
            </Link>
            <Link
              href="/legal/terms"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <FileText className="h-4 w-4" />
              Terms of Service
            </Link>
            <Link
              href="/legal/data-retention"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <FileText className="h-4 w-4" />
              Data Retention
            </Link>
            <Link
              href="/legal/call-recording"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <FileText className="h-4 w-4" />
              Call Recording
            </Link>
            <Link
              href="/legal/dpa"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Scale className="h-4 w-4" />
              DPA
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

