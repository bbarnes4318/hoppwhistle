const fs = require('fs');
const f = 'apps/web/src/components/call-center/CallCenterPortal.tsx';
let c = fs.readFileSync(f, 'utf8');
const lines = c.split('\n');

const newCode = `  const handleSaveDisposition = async () => {
  if (!selectedDisposition) return;
  let followUpAt: string | undefined;
  if (followUpDate && followUpTime) {
  followUpAt = new Date(\`\${followUpDate}T\${followUpTime}\`).toISOString();
  } else if (followUpDate) {
  followUpAt = new Date(\`\${followUpDate}T09:00:00\`).toISOString();
  }
  const callRecord: CallRecord = {
  id: 'record-' + Date.now(),
  notificationId: 'pop-' + Date.now(),
  prospect: activeCallData || {},
  timestamp: new Date().toISOString(),
  disposition: selectedDisposition,
  dispositionNotes: callNotes,
  callDuration: callTimer,
  callEndTime: new Date().toISOString(),
  callSource: 'CALL_CENTER',
  followUpAt,
  };
  setCallRecords(prev => [...prev, callRecord]);
  if (selectedDisposition === 'SET_APPOINTMENT') {
  setAppointmentsCount(prev => prev + 1);
  }
  if (selectedDisposition === 'SET_CALLBACK' || selectedDisposition === 'FOLLOW_UP') {
  setFollowUpCount(prev => prev + 1);
  }
  try {
  const response = await fetch('/api/v1/calls/disposition', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
  callId: callSessionIdRef.current,
  disposition: selectedDisposition,
  notes: callNotes,
  duration: callTimer,
  callerNumber: activeCallData?.caller_id || activeCallData?.phone,
  direction: 'OUTBOUND',
  callSource: 'CALL_CENTER',
  followUpAt,
  }),
  });
  if (!response.ok) {
  console.error('[CallCenter] Disposition save failed:', response.status);
  }
  } catch (err) {
  console.error('[CallCenter] Disposition save error:', err);
  }
  setDispositionSaved(true);
  setTimeout(() => {
  setDispositionSaved(false);
  setShowDisposition(false);
  setSelectedDisposition('');
  setFollowUpDate('');
  setFollowUpTime('');
  setCallNotes('');
  setCallTimer(0);
  setActiveCallData(null);
  callSessionIdRef.current = null;
  dispositionHandledRef.current = false;
  setPreInjectedData(null);
  clearLead();
  }, 2000);
  };`;

const newLines = newCode.split('\n');

// Replace lines 443-501 (0-indexed: 442-500) — the orphaned block
lines.splice(442, 59, ...newLines);
fs.writeFileSync(f, lines.join('\n'));
console.log('Done. Total lines:', lines.length);
