export type CurrentView = 'roleSelect' | 'agentDashboard' | 'publisherSetup' | 'crmDashboard';
export type ActiveCallView = 'script' | 'data' | 'captured_data';
export type SelectedScript =
  | 'sales'
  | 'medicare'
  | 'aca'
  | 'retention'
  | 'underwriting'
  | 'verification'
  | 'cold_call_transfer'
  | 'better_plan_callback'
  | 'hvac';

/**
 * The console's default script: Final Expense. Its value is `'sales'` because
 * that is what agents' saved `defaultScript` preferences already hold -- the
 * Final Expense script (`IntegratedScriptPanel`, built on `scriptData.ts`) has
 * always been the 'sales' entry; it was only labelled "Contractor".
 */
export const DEFAULT_SCRIPT: SelectedScript = 'sales';

export interface ProspectData {
  lead_token?: string;
  caller_id?: string;
  first_name?: string;
  last_name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  zip?: string;
  // Contractor-specific fields
  propertyAddress?: string;
  roofAge?: string;
  damageType?: string;
  insuranceClaim?: string;
  projectDetails?: string;
  [key: string]: unknown;
}

export interface ApplicationData extends ProspectData {
  id: string;
  name?: string;
  status: string;
}

export interface CallRecord {
  id: string;
  notificationId: string;
  prospect: ProspectData;
  timestamp: string;
  disposition: string;
  dispositionNotes?: string;
  dispositionDetails?: string | object;
  callDuration?: number;
  callEndTime: string;
  callSource?: string;
  followUpAt?: string;
  followUpStatus?: string;
}
