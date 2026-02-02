'use client';

import { CustomerIntakeForm } from '@/components/call-center/CustomerIntakeForm';

export default function IntakePage(): JSX.Element {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
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
