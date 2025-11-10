// API client implementation
import type { paths } from './generated-types.js';

type ApiPaths = paths;

export interface ClientConfig {
  baseUrl: string;
  apiKey?: string;
}

export class HopwhistleClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      headers?: Record<string, string>;
    }
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: {
          code: 'HTTP_ERROR',
          message: `HTTP ${response.status}: ${response.statusText}`,
        },
      }));
      throw error;
    }

    return response.json() as Promise<T>;
  }

  // Health check
  async health(): Promise<{ status: string; service: string }> {
    return this.request('GET', '/health');
  }

  // Public API - Numbers
  async listNumbers(params?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }): Promise<
    ApiPaths['/api/v1/numbers']['get']['responses']['200']['content']['application/json']
  > {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.status) query.append('status', params.status);
    if (params?.search) query.append('search', params.search);
    return this.request('GET', `/api/v1/numbers?${query.toString()}`);
  }

  async provisionNumber(
    body: ApiPaths['/api/v1/numbers']['post']['requestBody']['content']['application/json'],
    idempotencyKey?: string
  ): Promise<
    ApiPaths['/api/v1/numbers']['post']['responses']['201']['content']['application/json']
  > {
    return this.request('POST', '/api/v1/numbers', {
      body,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }

  async getNumber(
    numberId: string
  ): Promise<
    ApiPaths['/api/v1/numbers/{numberId}']['get']['responses']['200']['content']['application/json']
  > {
    return this.request('GET', `/api/v1/numbers/${numberId}`);
  }

  async updateNumber(
    numberId: string,
    body: ApiPaths['/api/v1/numbers/{numberId}']['patch']['requestBody']['content']['application/json'],
    idempotencyKey?: string
  ): Promise<
    ApiPaths['/api/v1/numbers/{numberId}']['patch']['responses']['200']['content']['application/json']
  > {
    return this.request('PATCH', `/api/v1/numbers/${numberId}`, {
      body,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }

  // Public API - Campaigns
  async listCampaigns(params?: {
    page?: number;
    limit?: number;
    status?: string;
    publisherId?: string;
  }): Promise<
    ApiPaths['/api/v1/campaigns']['get']['responses']['200']['content']['application/json']
  > {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.status) query.append('status', params.status);
    if (params?.publisherId) query.append('publisherId', params.publisherId);
    return this.request('GET', `/api/v1/campaigns?${query.toString()}`);
  }

  async createCampaign(
    body: ApiPaths['/api/v1/campaigns']['post']['requestBody']['content']['application/json'],
    idempotencyKey?: string
  ): Promise<
    ApiPaths['/api/v1/campaigns']['post']['responses']['201']['content']['application/json']
  > {
    return this.request('POST', '/api/v1/campaigns', {
      body,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }

  async getCampaign(
    campaignId: string
  ): Promise<
    ApiPaths['/api/v1/campaigns/{campaignId}']['get']['responses']['200']['content']['application/json']
  > {
    return this.request('GET', `/api/v1/campaigns/${campaignId}`);
  }

  async updateCampaign(
    campaignId: string,
    body: ApiPaths['/api/v1/campaigns/{campaignId}']['patch']['requestBody']['content']['application/json'],
    idempotencyKey?: string
  ): Promise<
    ApiPaths['/api/v1/campaigns/{campaignId}']['patch']['responses']['200']['content']['application/json']
  > {
    return this.request('PATCH', `/api/v1/campaigns/${campaignId}`, {
      body,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    await this.request('DELETE', `/api/v1/campaigns/${campaignId}`);
  }

  // Public API - Flows
  async listFlows(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<ApiPaths['/api/v1/flows']['get']['responses']['200']['content']['application/json']> {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.status) query.append('status', params.status);
    return this.request('GET', `/api/v1/flows?${query.toString()}`);
  }

  async createFlow(
    body: ApiPaths['/api/v1/flows']['post']['requestBody']['content']['application/json'],
    idempotencyKey?: string
  ): Promise<ApiPaths['/api/v1/flows']['post']['responses']['201']['content']['application/json']> {
    return this.request('POST', '/api/v1/flows', {
      body,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }

  async getFlow(
    flowId: string
  ): Promise<
    ApiPaths['/api/v1/flows/{flowId}']['get']['responses']['200']['content']['application/json']
  > {
    return this.request('GET', `/api/v1/flows/${flowId}`);
  }

  async updateFlow(
    flowId: string,
    body: ApiPaths['/api/v1/flows/{flowId}']['patch']['requestBody']['content']['application/json'],
    idempotencyKey?: string
  ): Promise<
    ApiPaths['/api/v1/flows/{flowId}']['patch']['responses']['200']['content']['application/json']
  > {
    return this.request('PATCH', `/api/v1/flows/${flowId}`, {
      body,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }

  // Public API - Calls
  async listCalls(params?: {
    page?: number;
    limit?: number;
    status?: string;
    direction?: string;
    campaignId?: string;
    fromNumber?: string;
    toNumber?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<ApiPaths['/api/v1/calls']['get']['responses']['200']['content']['application/json']> {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.status) query.append('status', params.status);
    if (params?.direction) query.append('direction', params.direction);
    if (params?.campaignId) query.append('campaignId', params.campaignId);
    if (params?.fromNumber) query.append('fromNumber', params.fromNumber);
    if (params?.toNumber) query.append('toNumber', params.toNumber);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    return this.request('GET', `/api/v1/calls?${query.toString()}`);
  }

  async initiateCall(
    body: ApiPaths['/api/v1/calls']['post']['requestBody']['content']['application/json'],
    idempotencyKey?: string
  ): Promise<ApiPaths['/api/v1/calls']['post']['responses']['201']['content']['application/json']> {
    return this.request('POST', '/api/v1/calls', {
      body,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }

  async getCall(
    callId: string
  ): Promise<
    ApiPaths['/api/v1/calls/{callId}']['get']['responses']['200']['content']['application/json']
  > {
    return this.request('GET', `/api/v1/calls/${callId}`);
  }

  // Public API - Recordings
  async listRecordings(params?: {
    page?: number;
    limit?: number;
    callId?: string;
    status?: string;
  }): Promise<
    ApiPaths['/api/v1/recordings']['get']['responses']['200']['content']['application/json']
  > {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.callId) query.append('callId', params.callId);
    if (params?.status) query.append('status', params.status);
    return this.request('GET', `/api/v1/recordings?${query.toString()}`);
  }

  async getRecording(
    recordingId: string
  ): Promise<
    ApiPaths['/api/v1/recordings/{recordingId}']['get']['responses']['200']['content']['application/json']
  > {
    return this.request('GET', `/api/v1/recordings/${recordingId}`);
  }

  // Public API - Webhooks
  async listWebhooks(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<
    ApiPaths['/api/v1/webhooks']['get']['responses']['200']['content']['application/json']
  > {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.status) query.append('status', params.status);
    return this.request('GET', `/api/v1/webhooks?${query.toString()}`);
  }

  async createWebhook(
    body: ApiPaths['/api/v1/webhooks']['post']['requestBody']['content']['application/json'],
    idempotencyKey?: string
  ): Promise<
    ApiPaths['/api/v1/webhooks']['post']['responses']['201']['content']['application/json']
  > {
    return this.request('POST', '/api/v1/webhooks', {
      body,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }

  async getWebhook(
    webhookId: string
  ): Promise<
    ApiPaths['/api/v1/webhooks/{webhookId}']['get']['responses']['200']['content']['application/json']
  > {
    return this.request('GET', `/api/v1/webhooks/${webhookId}`);
  }

  async updateWebhook(
    webhookId: string,
    body: ApiPaths['/api/v1/webhooks/{webhookId}']['patch']['requestBody']['content']['application/json'],
    idempotencyKey?: string
  ): Promise<
    ApiPaths['/api/v1/webhooks/{webhookId}']['patch']['responses']['200']['content']['application/json']
  > {
    return this.request('PATCH', `/api/v1/webhooks/${webhookId}`, {
      body,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.request('DELETE', `/api/v1/webhooks/${webhookId}`);
  }

  // Public API - Reporting
  async getCallAnalytics(params: {
    startDate: string;
    endDate: string;
    groupBy?: string;
    campaignId?: string;
  }): Promise<
    ApiPaths['/api/v1/reporting/calls']['get']['responses']['200']['content']['application/json']
  > {
    const query = new URLSearchParams();
    query.append('startDate', params.startDate);
    query.append('endDate', params.endDate);
    if (params.groupBy) query.append('groupBy', params.groupBy);
    if (params.campaignId) query.append('campaignId', params.campaignId);
    return this.request('GET', `/api/v1/reporting/calls?${query.toString()}`);
  }

  async getCampaignPerformance(
    campaignId: string,
    params: {
      startDate: string;
      endDate: string;
    }
  ): Promise<
    ApiPaths['/api/v1/reporting/campaigns/{campaignId}']['get']['responses']['200']['content']['application/json']
  > {
    const query = new URLSearchParams();
    query.append('startDate', params.startDate);
    query.append('endDate', params.endDate);
    return this.request('GET', `/api/v1/reporting/campaigns/${campaignId}?${query.toString()}`);
  }

  // Public API - Billing
  async listInvoices(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<
    ApiPaths['/api/v1/billing/invoices']['get']['responses']['200']['content']['application/json']
  > {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.status) query.append('status', params.status);
    return this.request('GET', `/api/v1/billing/invoices?${query.toString()}`);
  }

  async getInvoice(
    invoiceId: string
  ): Promise<
    ApiPaths['/api/v1/billing/invoices/{invoiceId}']['get']['responses']['200']['content']['application/json']
  > {
    return this.request('GET', `/api/v1/billing/invoices/${invoiceId}`);
  }

  async getAccountBalance(): Promise<
    ApiPaths['/api/v1/billing/balance']['get']['responses']['200']['content']['application/json']
  > {
    return this.request('GET', '/api/v1/billing/balance');
  }
}
