export function segmentLabel(segment: string): string {
  const map: Record<string, string> = {
    superfan: 'Superfan',
    vip_list: 'VIP List',
    previous_merch: 'Merch Buyer',
    tour_city: 'Tour City',
    stream_save: 'Stream Saver',
    fan_club_inactive: 'Inactive FC',
  };
  return map[segment] || segment;
}

export function outcomeLabel(outcome: string): string {
  const map: Record<string, string> = {
    pre_saved: 'Pre-Saved',
    ticket_intent: 'Ticket Intent',
    merch_intent: 'Merch Intent',
    vip_interest: 'VIP Interest',
    needs_follow_up: 'Needs Follow-Up',
    no_action: 'No Action',
    opted_out: 'Opted Out',
  };
  return map[outcome] || outcome;
}

export function campaignTypeLabel(type: string): string {
  const map: Record<string, string> = {
    album_presave: 'Album Pre-Save',
    tour_onsale: 'Tour On-Sale',
    merch_drop: 'Merch Drop',
    vip_upgrade: 'VIP Upgrade',
    fan_club_reactivation: 'FC Reactivation',
    festival_announcement: 'Festival Alert',
    post_show_feedback: 'Show Feedback',
  };
  return map[type] || type;
}

export function formatCurrency(val: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

export function formatCurrencyInt(val: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(val);
}

export function formatCompactNumber(num: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(num);
}

export function formatPercentage(num: number): string {
  return `${num.toFixed(1)}%`;
}

export function formatDurationMmSs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function campaignStatusStyle(status: string) {
  switch (status.toLowerCase()) {
    case 'active':
    case 'running':
      return {
        bg: 'bg-emerald-500/10',
        text: 'text-emerald-400',
        dot: 'bg-emerald-400',
      };
    case 'completed':
      return {
        bg: 'bg-blue-500/10',
        text: 'text-blue-400',
        dot: 'bg-blue-400',
      };
    case 'paused':
      return {
        bg: 'bg-amber-500/10',
        text: 'text-amber-400',
        dot: 'bg-amber-400',
      };
    case 'draft':
    default:
      return {
        bg: 'bg-zinc-500/10',
        text: 'text-zinc-400',
        dot: 'bg-zinc-400',
      };
  }
}

export function formatChange(change: number): { label: string; positive: boolean } {
  const positive = change >= 0;
  const absVal = Math.abs(change);
  const label = `${absVal.toFixed(1)}%`;
  return { label, positive };
}

