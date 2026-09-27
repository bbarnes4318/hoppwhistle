import { describe, expect, it } from 'vitest';

import { acceptedPost } from '../publisher-post-result';

describe('acceptedPost', () => {
  it('treats accepted with a transfer number as success', () => {
    expect(
      acceptedPost({
        status: 'success',
        accepted: true,
        transfer_number: '+18005550100',
        ping_id: 'p1',
      })
    ).toEqual({ accepted: true, transferNumber: '+18005550100' });
  });

  it('is not fooled by the shape the tester used to expect', () => {
    expect(acceptedPost({ status: 'LEASED', leased_number: '+18005550100' })).toBeNull();
  });

  it('refuses an acceptance with no number to dial', () => {
    expect(acceptedPost({ accepted: true })).toBeNull();
    expect(acceptedPost({ accepted: true, transfer_number: '  ' })).toBeNull();
  });

  it('refuses a rejection, even one carrying a number', () => {
    expect(
      acceptedPost({ accepted: false, transfer_number: '+18005550100', error_code: 'X' })
    ).toBeNull();
    expect(acceptedPost({ accepted: 'true', transfer_number: '+18005550100' })).toBeNull();
  });

  it('refuses anything that is not an object', () => {
    expect(acceptedPost(null)).toBeNull();
    expect(acceptedPost('accepted')).toBeNull();
  });
});
