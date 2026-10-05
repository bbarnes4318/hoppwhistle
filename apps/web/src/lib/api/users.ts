import { apiClient } from '../api';
import type { ApiResponse } from '../api';

/**
 * Every user of the acting agency, across every page.
 *
 * `GET /api/v1/users` pages, newest first, 20 to a page by default. Every
 * screen that listed the agency's people asked for page one only, so an agency
 * with more than 20 people never saw its oldest accounts -- which are its
 * owner and first administrators. They could not be found on Team Members to
 * be made an agent, and could not be picked to own a number or a lead.
 *
 * The first page's response is returned with `data` holding every user, so a
 * caller reading `response.data?.data` or `response.error` works unchanged.
 */
export async function fetchAllUsers<T>(): Promise<ApiResponse<{ data: T[] }>> {
  const PAGE_SIZE = 100;
  const first = await apiClient.get<{ data: T[]; meta?: { totalPages?: number } }>(
    `/api/v1/users?page=1&limit=${PAGE_SIZE}`
  );
  if (!first.data?.data) return first;

  const all = [...first.data.data];
  const totalPages = first.data.meta?.totalPages ?? 1;
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await apiClient.get<{ data: T[] }>(
      `/api/v1/users?page=${page}&limit=${PAGE_SIZE}`
    );
    if (!next.data?.data) return next;
    all.push(...next.data.data);
  }
  return { ...first, data: { ...first.data, data: all } };
}
