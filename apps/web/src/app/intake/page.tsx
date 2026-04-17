'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';

import { CustomerIntakeForm } from '@/components/call-center/CustomerIntakeForm';

// Declare TrustedForm global type
declare global {
 interface Window {
 TrustedForm?: {
 getCertUrl?: () => string;
 ping?: () => void;
 };
 }
}

export default function IntakePage(): JSX.Element {
 const [certUrl, setCertUrl] = useState<string | null>(null);

 // Check for TrustedForm certificate URL periodically
 useEffect(() => {
 console.log('[IntakePage] Setting up TrustedForm monitoring...');

 const checkForCert = () => {
 // Method 1: Check for hidden input (TrustedForm injects this)
 const hiddenInput = document.querySelector<HTMLInputElement>(
 'input[name="xxTrustedFormCertUrl"]'
 );
 if (hiddenInput?.value) {
 console.log('[IntakePage] Found TrustedForm cert URL in hidden input:', hiddenInput.value);
 setCertUrl(hiddenInput.value);
 return true;
 }

 // Method 2: Check global TrustedForm object
 if (window.TrustedForm?.getCertUrl) {
 const url = window.TrustedForm.getCertUrl();
 if (url) {
 console.log('[IntakePage] Found TrustedForm cert URL via API:', url);
 setCertUrl(url);
 return true;
 }
 }

 return false;
 };

 // Check immediately
 if (!checkForCert()) {
 // Poll every 500ms until we find it (max 20 seconds)
 let attempts = 0;
 const interval = setInterval(() => {
 attempts++;
 if (checkForCert() || attempts > 40) {
 clearInterval(interval);
 if (attempts > 40) {
 console.warn(
 '[IntakePage] Could not find TrustedForm certificate URL after 20 seconds'
 );
 }
 }
 }, 500);

 return () => clearInterval(interval);
 }
 }, []);

 return (
 <div className="min-h-screen bg-muted">
 {/* TrustedForm Script - Direct injection */}
 <Script
 id="trustedform-script"
 strategy="afterInteractive"
 src="https://api.trustedform.com/trustedform.js?field=xxTrustedFormCertUrl&use_tagged_consent=true&provide_referrer=true"
 onLoad={() => {
 console.log('[IntakePage] TrustedForm script loaded successfully');
 }}
 onError={e => {
 console.error('[IntakePage] TrustedForm script failed to load:', e);
 }}
 />

 {/* Hidden form element for TrustedForm to inject into */}
 <form
 id="trustedform-container"
 style={{
 position: 'absolute',
 left: '-9999px',
 width: '1px',
 height: '1px',
 overflow: 'hidden',
 }}
 >
 {/* TrustedForm will inject xxTrustedFormCertUrl input here */}
 </form>

 {/* Header */}
 <header className="border-b border-slate-700 bg-slate-900/80 sticky top-0 z-10">
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
 {certUrl ? (
 <span className="px-3 py-1.5 text-xs font-medium rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
 ✓ TrustedForm Active
 </span>
 ) : (
 <span className="px-3 py-1.5 text-xs font-medium rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
 TrustedForm Loading...
 </span>
 )}
 </div>
 </div>
 </div>
 </header>

 {/* Main Content */}
 <main className="max-w-7xl mx-auto px-6 py-8">
 <CustomerIntakeForm />
 </main>

 {/* Debug: Show cert URL if available */}
 {certUrl && (
 <div className="fixed bottom-4 right-4 max-w-md p-3 bg-slate-800/90 border border-slate-600 rounded-lg text-xs">
 <div className="text-emerald-400 font-medium mb-1">TrustedForm Certificate Active</div>
 <code className="text-slate-400 break-all">{certUrl}</code>
 </div>
 )}
 </div>
 );
}


