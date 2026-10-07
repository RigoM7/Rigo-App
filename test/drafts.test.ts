import { describe, it, expect } from 'vitest';
import { newerDraft } from '../src/client/lib/draft-rev.js';

// The driver's record on the phone: a save re-reads storage, and that read must never replace
// what the driver typed after it (found while testing several delivery lines quickly).

describe('draft revisions', () => {
  const d = (rev: number, state = 'local', note = '') => ({ rev, state, note });
  it('keeps newer typing over an older stored copy', () => {
    expect(newerDraft(d(5, 'local', 'typed'), d(4, 'local', 'stored'))).toEqual(d(5, 'local', 'typed'));
  });
  it('takes the stored copy when it is as new or newer (sent, accepted, edited elsewhere)', () => {
    expect(newerDraft(d(5), d(5, 'accepted'))).toEqual(d(5, 'accepted'));
    expect(newerDraft(d(5), d(6))).toEqual(d(6));
    expect(newerDraft(null, d(1))).toEqual(d(1));
  });
  it('follows a deletion', () => {
    expect(newerDraft(d(5), null)).toBeNull();
  });
});
