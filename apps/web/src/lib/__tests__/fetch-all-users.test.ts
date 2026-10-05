import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ apiClient: { get } }));

import { fetchAllUsers } from '../api/users';

/** A page of the user list as the API answers it. */
function page(ids: string[], totalPages: number) {
  return { data: { data: ids.map(id => ({ id })), meta: { totalPages } } };
}

beforeEach(() => {
  get.mockReset();
});

describe('fetchAllUsers', () => {
  it('reads every page, so the oldest accounts -- the owner -- are not cut off', async () => {
    get
      .mockResolvedValueOnce(page(['newest'], 3))
      .mockResolvedValueOnce(page(['middle'], 3))
      .mockResolvedValueOnce(page(['owner'], 3));

    const response = await fetchAllUsers<{ id: string }>();

    expect(response.data?.data.map(u => u.id)).toEqual(['newest', 'middle', 'owner']);
    expect(get).toHaveBeenCalledWith('/api/v1/users?page=1&limit=100');
    expect(get).toHaveBeenCalledWith('/api/v1/users?page=3&limit=100');
  });

  it('asks once when everything fits on one page', async () => {
    get.mockResolvedValueOnce(page(['a', 'b'], 1));
    const response = await fetchAllUsers<{ id: string }>();
    expect(response.data?.data).toHaveLength(2);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('passes a refusal straight through', async () => {
    get.mockResolvedValueOnce({ error: { code: 'NO_ACTING_TENANT', message: 'Pick an agency' } });
    const response = await fetchAllUsers<{ id: string }>();
    expect(response.error?.code).toBe('NO_ACTING_TENANT');
  });
});
