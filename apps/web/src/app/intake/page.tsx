'use client';

import { useEffect } from 'react';
import Script from 'next/script';

import { CustomerIntakeForm } from '@/components/call-center/CustomerIntakeForm';

export default function IntakePage(): JSX.Element {
  // Initialize TrustedForm on page load
  useEffect(() => {
    // TrustedForm will automatically inject a hidden input field with the certificate URL
    // The field name is 'xxTrustedFormCertUrl'
    console.log('[IntakePage] TrustedForm script loading...');
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* TrustedForm Script */}
      <Script
        id="trustedform-script"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              var tf = document.createElement('script');
              tf.type = 'text/javascript';
              tf.async = true;
              tf.src = ("https:" == document.location.protocol ? 'https' : 'http') +
                '://api.trustedform.com/trustedform.js?field=xxTrustedFormCertUrl&use_tagged_consent=true&l=' +
                new Date().getTime() + Math.random();
              var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(tf, s);
            })();
          `,
        }}
      />
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="https://api.trustedform.com/ns.gif" alt="" />
      </noscript>

      {/* Header */}
      <header className="border-b border-slate-700 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Customer Intake Form</h1>
              <p className="text-sm text-slate-400">
                Collect customer information for policy processing
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1.5 text-xs font-medium rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                Final Expense
              </span>
              <span className="px-3 py-1.5 text-xs font-medium rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                TrustedForm Protected
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <CustomerIntakeForm />
      </main>
    </div>
  );
}
