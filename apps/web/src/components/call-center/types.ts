export type CurrentView = 'roleSelect' | 'agentDashboard' | 'publisherSetup' | 'crmDashboard';
export type AgentStatus = 'available' | 'away' | 'on_call';
export type ActiveCallView = 'script' | 'data' | 'captured_data';
export type SelectedScript = 'sales' | 'retention' | 'underwriting' | 'verification' | 'cold_call_transfer';

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
