try {
  const m = await import('./dist/routes/insurance-leads.js');
  console.log('Insurance leads module loaded OK:', typeof m.registerInsuranceLeadRoutes);
} catch (e) {
  console.error('FAILED to import insurance-leads:', e.message);
  console.error(e.stack);
}
