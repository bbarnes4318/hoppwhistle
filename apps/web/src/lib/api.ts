const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface ApiResponse<T> {
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

class ApiClient {
  private baseUrl: string;
  private token?: string;
  private apiKey?: string;

  constructor(baseUrl: string = API_URL) {
    this.baseUrl = baseUrl;
    // Get API key from environment
    this.apiKey = process.env.NEXT_PUBLIC_API_KEY;
    // Load token from localStorage if available (client-side only)
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('token') || undefined;
    }
  }

  // Get current token (checks localStorage for most up-to-date value)
  private getAuthToken(): string | undefined {
    if (typeof window !== 'undefined') {
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        this.token = storedToken;
      }
    }
    return this.token;
  }

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('token', token);
    }
  }

  clearToken() {
    this.token = undefined;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
    }
  }

  setApiKey(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    // Check for demo mode
    const demoMode = localStorage.getItem('demoMode') === 'true';
    const demoTenantId = localStorage.getItem('demoTenantId');

    // If demo mode is enabled, add demo tenant header
    if (demoMode && demoTenantId) {
      options.headers = {
        ...options.headers,
        'X-Demo-Tenant-Id': demoTenantId,
      };
    }
    const url = `${this.baseUrl}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Get the current auth token (checks localStorage for freshest value)
    const authToken = this.getAuthToken();
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    // Add API key header if available
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          error: {
            code: data.error?.code || 'UNKNOWN_ERROR',
            message: data.error?.message || 'An error occurred',
          },
        };
      }

      return { data };
    } catch (error) {
      return {
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error',
        },
      };
    }
  }

  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();

// Mock data generators for demo
export const mockData = {
  activeCalls: () => Math.floor(Math.random() * 50) + 10,
  asr: () => Math.random() * 0.3 + 0.4, // 40-70%
  aht: () => Math.floor(Math.random() * 300) + 120, // 120-420 seconds
  billableMinutes: () => Math.floor(Math.random() * 5000) + 1000,
  cpaStats: () => ({
    conversions: Math.floor(Math.random() * 50) + 10,
    revenue: Math.random() * 5000 + 1000,
  }),
};
