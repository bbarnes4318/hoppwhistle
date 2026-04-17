export type CurrentView = 'roleSelect' | 'agentDashboard' | 'publisherSetup' | 'crmDashboard';
export type AgentStatus = 'available' | 'away' | 'on_call';
export type ActiveCallView = 'script' | 'data';
export type SelectedScript = 'sales' | 'retention';

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
  dob?: string;
  age?: number;
  gender?: string;
  coverage_amount?: number;
  faceAmount?: number;
  premium?: string;
  monthlyPremium?: string;
  carrier?: string;
  beneficiary?: string;
  [key: string]: unknown;
}

export interface ApplicationData extends ProspectData {
  id: string;
  name?: string;
  status: string;
  planType?: string;
}

export interface CallRecord {
  id: string;
  notificationId: string;
  prospect: ProspectData;
  timestamp: string;
  disposition: string;
  dispositionDetails: string | object;
  callDuration?: number;
  callEndTime: string;
}
