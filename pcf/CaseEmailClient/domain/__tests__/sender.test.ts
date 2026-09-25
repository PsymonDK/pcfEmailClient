import { describe, it, expect } from 'vitest';
import {
  describeSender,
  isSelfAddress,
  pickSetting,
  resolveSender,
  selfAddresses,
  type SenderCandidate,
  type SettingRow,
} from '../sender';

/** The real Care queue, measured 2026-09-24. */
const CARE: SenderCandidate = {
  kind: 'queue',
  id: '23b1c48e-1ff2-f011-8406-7ced8d2e4880',
  displayName: 'Care',
  address: 'care@example.invalid',
  signatureId: 'ca237ab1-16f6-f011-8406-000d3ab39833',
};

const OTHER_QUEUE: SenderCandidate = {
  kind: 'queue',
  id: '0c3bdec6-0aad-f111-aaab-000d3ab16615',
  displayName: 'Offensive Support',
  address: 'doesntexists@invalid.local',
};

const AGENT: SenderCandidate = {
  kind: 'user',
  id: '4f2d39f5-23cc-f011-8544-6045bde0fa7e',
  displayName: 'Simon Jehrbo',
  address: 'simon.jehrbo@example.invalid',
};

const row = (over: Partial<SettingRow> = {}): SettingRow => ({
  isDefault: false,
  sendFromQueue: true,
  allowSenderOverride: true,
  ...over,
});

describe('pickSetting', () => {
  it('prefers the queue-specific row even when the default row is listed FIRST', () => {
    // The bug the obvious implementation has: `rows.find(r => r.isDefault || r.queueId === id)`
    // returns whichever comes first in the page, and OData gives no ordering guarantee.
    const rows = [row({ isDefault: true, sendFromQueue: false }), row({ queueId: CARE.id })];
    expect(pickSetting(rows, CARE.id)?.sendFromQueue).toBe(true);
  });

  it('falls back to the default row when no row names this queue', () => {
    const rows = [row({ queueId: OTHER_QUEUE.id }), row({ isDefault: true, sendFromQueue: false })];
    expect(pickSetting(rows, CARE.id)?.isDefault).toBe(true);
  });

  it('uses the default row when there is no queue at all', () => {
    const rows = [row({ queueId: CARE.id }), row({ isDefault: true })];
    expect(pickSetting(rows, undefined)?.isDefault).toBe(true);
  });

  it('matches queue ids case-insensitively and through braces', () => {
    const rows = [row({ queueId: `{${CARE.id.toUpperCase()}}` })];
    expect(pickSetting(rows, CARE.id)).toBeDefined();
  });

  it('returns nothing when the table is empty', () => {
    expect(pickSetting([], CARE.id)).toBeUndefined();
  });

  it('returns nothing when no row matches and none is default', () => {
    expect(pickSetting([row({ queueId: OTHER_QUEUE.id })], CARE.id)).toBeUndefined();
  });
});

describe('resolveSender — the fail-safe direction', () => {
  it('sends as the AGENT when there is no configuration at all', () => {
    // No settings table, unreadable settings table, or a fresh environment. This must behave
    // exactly like stock Dynamics rather than silently changing who mail comes from.
    const out = resolveSender(undefined, CARE, AGENT);
    expect(out.chosen).toBe(AGENT);
    expect(out.candidates).toEqual([AGENT]);
  });

  it('sends as the AGENT when sendFromQueue is off', () => {
    expect(resolveSender(row({ sendFromQueue: false }), CARE, AGENT).chosen).toBe(AGENT);
  });

  it('sends as the AGENT when sendFromQueue is on but the Case is in no queue', () => {
    // The chosen fallback: mail still goes out. Pre-flight is what tells the agent if it cannot.
    const out = resolveSender(row(), undefined, AGENT);
    expect(out.chosen).toBe(AGENT);
  });
});

describe('resolveSender — the queue path', () => {
  it('sends as the queue when configured to', () => {
    expect(resolveSender(row(), CARE, AGENT).chosen).toBe(CARE);
  });

  it('offers the agent as the alternative, with the queue first', () => {
    const out = resolveSender(row({ allowSenderOverride: true }), CARE, AGENT);
    expect(out.candidates).toEqual([CARE, AGENT]);
  });

  it('offers exactly one candidate when overriding is not allowed', () => {
    // One candidate is the signal the UI uses to render static text rather than a picker.
    const out = resolveSender(row({ allowSenderOverride: false }), CARE, AGENT);
    expect(out.candidates).toEqual([CARE]);
  });

  it('offers the queue as the alternative when the agent is the default sender', () => {
    const out = resolveSender(row({ sendFromQueue: false }), CARE, AGENT);
    expect(out.chosen).toBe(AGENT);
    expect(out.candidates).toEqual([AGENT, CARE]);
  });

  it('never lists the same identity twice', () => {
    const out = resolveSender(row(), CARE, { ...AGENT, id: CARE.id });
    expect(out.candidates).toHaveLength(1);
  });

  it('never prefers the agent over an available queue', () => {
    // Defaulting to the individual is how a customer ends up replying into a person's inbox.
    expect(resolveSender(row(), CARE, AGENT).chosen.kind).toBe('queue');
  });
});

describe('isSelfAddress / selfAddresses', () => {
  const candidates = [CARE, AGENT];

  it('recognises every candidate, not just the chosen one', () => {
    // An agent who switches the From picker must not find themselves in their own To line.
    expect(isSelfAddress(CARE.address, candidates)).toBe(true);
    expect(isSelfAddress(AGENT.address, candidates)).toBe(true);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(isSelfAddress(`  ${CARE.address.toUpperCase()} `, candidates)).toBe(true);
  });

  it('does not claim a customer', () => {
    expect(isSelfAddress('kunde@example.com', candidates)).toBe(false);
  });

  it('treats an empty address as not ours, rather than as everything', () => {
    expect(isSelfAddress('', candidates)).toBe(false);
    expect(isSelfAddress('   ', candidates)).toBe(false);
  });

  it('drops empty addresses from the exclusion list', () => {
    // An empty string in the exclusion set would filter out every recipient whose address failed
    // to resolve, silently emptying To.
    expect(selfAddresses([CARE, { ...AGENT, address: '' }])).toEqual([CARE.address]);
  });
});

describe('describeSender', () => {
  it('reads as a From line', () => {
    expect(describeSender(CARE)).toBe('Care <care@example.invalid>');
  });

  it('falls back to the name alone when there is no address', () => {
    expect(describeSender({ ...CARE, address: '' })).toBe('Care');
  });
});
