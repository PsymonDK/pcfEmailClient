// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { EmailClientRoot, type RestorableState } from '../EmailClientRoot';
import type { DraftApiLike } from '../../data/draft';

/**
 * The shell, rendered for real against a fake Dataverse — the first test that imports
 * `EmailClientRoot.tsx` at all.
 *
 * Written 2026-09-28 after the published app hung solid on CAS-01131-N6S2T3. The rows below are
 * that case's rows, verbatim where it matters: an inbound message with no conversation data (it
 * was created over the API), our sent reply, and a DRAFT reply to our own sent reply.
 *
 * A synchronous render/effect loop never lets a test time out, so the fakes count their calls
 * and THROW past a ceiling — which turns a hang into a failure with a stack.
 */

const CASE = '71cdb358-2abb-f111-aaad-000d3ab16615';
const USER = '{4F2D39F5-23CC-F011-8544-6045BDE0FA7E}';
const CARE = '23b1c48e-1ff2-f011-8406-7ced8d2e4880';
const IN = '215d0958-2abb-f111-aaad-000d3ab163fb';
const SENT = 'a53c3fe5-2abb-f111-aaad-000d3ab16615';
const DRAFT = '84708d7c-2abb-f111-aaad-000d3ab16615';

const emailRows = [
  {
    activityid: IN, subject: 'Test: kodegennemgang', directioncode: false, statecode: 1, statuscode: 4,
    createdon: '2026-09-28T10:50:03Z', baseconversationindexhash: null, conversationindex: null,
    _regardingobjectid_value: CASE, attachmentcount: 1,
  },
  {
    activityid: SENT, subject: 'RE: Test: kodegennemgang CRM:0100017', directioncode: true, statecode: 1,
    statuscode: 3, createdon: '2026-09-28T10:53:56Z', baseconversationindexhash: -1269871662,
    conversationindex: '0100A36B1BCD88459D8FF773DD63C8EDEEDD4F37E3F1',
    _parentactivityid_value: IN, _regardingobjectid_value: CASE,
  },
  {
    activityid: DRAFT, subject: 'RE: Test: kodegennemgang', directioncode: true, statecode: 0, statuscode: 1,
    createdon: '2026-09-28T11:05:19Z', baseconversationindexhash: null, conversationindex: null,
    _parentactivityid_value: SENT, _regardingobjectid_value: CASE,
    _ownerid_value: '4f2d39f5-23cc-f011-8544-6045bde0fa7e', modifiedon: '2026-09-28T11:27:22Z',
  },
];

const party = (activityId: string, mask: number, name: string, address: string, entity: string, id: string) => ({
  _activityid_value: activityId, participationtypemask: mask, addressused: address,
  _partyid_value: id,
  '_partyid_value@OData.Community.Display.V1.FormattedValue': name,
  '_partyid_value@Microsoft.Dynamics.CRM.lookuplogicalname': entity,
  '_partyid_value@Microsoft.Dynamics.CRM.associatednavigationproperty': `partyid_${entity}`,
});
const CONTACT = 'b5e30418-23f2-f011-8406-0022489cf5dd';
const partyRows = [
  party(IN, 1, 'Simon Jehrbo', 'simon.jehrbo@example.com', 'contact', CONTACT),
  party(IN, 2, 'Care', 'caredemo@example.invalid', 'queue', CARE),
  party(SENT, 1, 'Care', 'caredemo@example.invalid', 'queue', CARE),
  party(SENT, 2, 'Simon Jehrbo', 'simon.jehrbo@example.com', 'contact', CONTACT),
  party(DRAFT, 1, 'Care', 'caredemo@example.invalid', 'queue', CARE),
];

function fakeApi(ceiling = 400): { api: DraftApiLike; calls: () => number } {
  let n = 0;
  const count = (what: string) => {
    n += 1;
    if (n > ceiling) throw new Error(`webApi called more than ${ceiling} times (last: ${what}) — a loop`);
  };
  const api: DraftApiLike = {
    retrieveMultipleRecords: (entity: string, options?: string) => {
      count(`list ${entity}`);
      const rows = ((): Record<string, unknown>[] => {
        switch (entity) {
          case 'email':
            // The draft lookup (parent + status filter) vs the case list.
            if (options?.includes('_parentactivityid_value eq')) {
              return options.includes(SENT.toLowerCase())
                ? [{ activityid: DRAFT, subject: 'RE: Test: kodegennemgang', description: '<p>H2 tekst til besked A</p>' }]
                : [];
            }
            return emailRows;
          case 'activityparty': return partyRows;
          case 'jhrb_emailreadstate': return readStateRows;
          case 'contact':
            // The type-ahead's query; the address resolver's is an equality filter instead.
            return options?.includes("startswith(fullname,'sim")
              ? [{ contactid: CONTACT, fullname: 'Simon Jehrbo', emailaddress1: 'simon.jehrbo@example.com' }]
              : [];
          case 'organization': return [{ requireapprovalforqueueemail: true, requireapprovalforuseremail: true }];
          case 'queueitem': return [{ queueid: {
            queueid: CARE, name: 'Care', emailaddress: 'caredemo@example.invalid',
            emailrouteraccessapproval: 1, _defaultmailbox_value: '0b8c1d2e-3f40-4152-8637-48495a6b7c8d',
          } }];
          default: return [];
        }
      })();
      return Promise.resolve({ entities: rows });
    },
    retrieveRecord: (entity: string, id?: string) => {
      count(`get ${entity}`);
      if (entity === 'email' && id === DRAFT) {
        return Promise.resolve({
          activityid: DRAFT, subject: 'RE: Test: kodegennemgang', statecode: 0, statuscode: 1,
          _ownerid_value: '4f2d39f5-23cc-f011-8544-6045bde0fa7e',
          description: '<p>M11 sessionsskift test</p><div id="divRplyFwdMsg"><p>old</p></div>',
        });
      }
      if (entity === 'systemuser') {
        return Promise.resolve({ fullname: 'Simon Jehrbo', internalemailaddress: 'simon@example.invalid', emailrouteraccessapproval: 1 });
      }
      if (entity === 'mailbox') return Promise.resolve({ outgoingemailstatus: 1 });
      if (entity === 'contact') return Promise.resolve({ emailaddress1: 'simon.jehrbo@example.com' });
      if (entity === 'email') return Promise.resolve({ activityid: IN, description: '<p>Hej Care</p>' });
      if (entity === 'organization') return Promise.resolve({ maxuploadfilesize: 5242880 });
      return Promise.resolve({});
    },
    createRecord: () => { count('create'); return Promise.resolve({ id: 'c0ffee00-0000-0000-0000-000000000001' }); },
    updateRecord: (entity: string, id: string, data: Record<string, unknown>) => {
      count('update');
      updates.push({ entity, id, data });
      return Promise.resolve({ id: '' });
    },
    deleteRecord: (entity: string, id: string) => {
      count('delete');
      deleted.push(`${entity}:${id}`);
      return Promise.resolve({ id: '' });
    },
  };
  return { api, calls: () => n };
}

/** Read state the fake returns, and what was deleted — set per test, reset after each. */
let readStateRows: Record<string, unknown>[] = [];
let deleted: string[] = [];
let updates: { entity: string; id: string; data: Record<string, unknown> }[] = [];

let host: HTMLDivElement | undefined;
afterEach(() => {
  readStateRows = [];
  deleted = [];
  updates = [];
  if (host) { ReactDOM.unmountComponentAtNode(host); host.remove(); host = undefined; }
});

/**
 * Renders the shell the way `index.ts` does: `setControlState` hands the state straight back as
 * `restored` and re-renders — the round trip that hung the app once already (2026-09-11).
 */
async function renderShell(initial?: RestorableState, stateCeiling = 200) {
  const { api, calls } = fakeApi();
  host = document.createElement('div');
  document.body.appendChild(host);
  let stateCalls = 0;
  let restored = initial;
  const target = host;
  const render = (): void => { ReactDOM.render(
    <EmailClientRoot
      caseId={CASE}
      caseIdSource="contextInfo"
      webApi={api}
      userId={USER}
      allocatedHeight={-1}
      allocatedWidth={1200}
      restored={restored}
      onStateChange={onStateChange}
    />,
    target,
  ); };
  function onStateChange(next: RestorableState): void {
    stateCalls += 1;
    if (stateCalls > stateCeiling) throw new Error(`onStateChange called more than ${stateCeiling} times — a loop`);
    restored = { ...next };
    // The platform answers setControlState with updateView.
    render();
  }
  await act(() => { render(); return Promise.resolve(); });
  for (let i = 0; i < 20; i += 1) {
    await act(() => new Promise<void>((resolve) => { setTimeout(resolve, 0); }));
  }
  return { calls: calls(), stateCalls: () => stateCalls, host: target };
}

describe('EmailClientRoot — renders the CAS-01131 rows without looping', () => {
  it('loads the case', async () => {
    const r = await renderShell();
    expect(r.host.textContent).toContain('Test: kodegennemgang');
    expect(r.stateCalls()).toBeLessThan(60);
  });

  it('reopens the compose that was open before a teardown, with its text (M11)', async () => {
    // Found in the published app 2026-09-28: the persist effect's first save came back as
    // `restored` before the landing ran, so the compose was already forgotten. This harness hands
    // every save straight back, exactly as index.ts does, so the same order is reproduced here.
    const r = await renderShell({
      selectedThreadKey: 'h:-1269871662',
      compose: { mode: 'reply', activityId: SENT, emailId: DRAFT },
    });
    expect(r.host.querySelector('[role=region][aria-label*="compose"]')).not.toBeNull();
    expect(r.host.querySelector('.ProseMirror')?.textContent).toContain('M11 sessionsskift test');
    expect(r.stateCalls()).toBeLessThan(60);
  });

  it('a draft offers "Continue draft", not Reply or Forward, and continuing reopens THAT row (N7)', async () => {
    // Found in the published app 2026-09-29: the pane offered Forward on the agent's own unsent
    // reply, labelled it "Sent on", and forwarding it composed a new message quoting the draft.
    const r = await renderShell({ selectedThreadKey: 'h:-1269871662', expandedMessageIds: [DRAFT] });
    const draftView = r.host.querySelector(`[data-message-id="${DRAFT}"]`);
    expect(draftView).not.toBeNull();
    expect(draftView!.textContent).toContain('Draft saved:');
    expect(draftView!.textContent).not.toContain('Sent on');
    expect(draftView!.querySelector('button[aria-label="Forward"]')).toBeNull();
    expect(draftView!.querySelector('button[aria-label="Reply"]')).toBeNull();
    const cont = Array.from(draftView!.querySelectorAll('button')).find((b) => b.textContent === 'Continue draft');
    expect(cont).toBeDefined();
    // The sent reply beside it still offers the normal actions.
    expect(r.host.querySelector(`[data-message-id="${SENT}"]`)).not.toBeNull();

    await act(async () => {
      cont!.click();
      for (let i = 0; i < 10; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    expect(r.host.querySelector('[role=region][aria-label*="compose"]')).not.toBeNull();
    expect(r.host.querySelector('.ProseMirror')?.textContent).toContain('M11 sessionsskift test');
  });

  it('a forward keeps the tracking token, and its header names whose message it is (N9)', async () => {
    // The token must never be removed from a subject (requirement, 2026-09-29). And a forward has
    // no recipient yet, so "Forward to Care" — the original sender — was wrong.
    const r = await renderShell({
      selectedThreadKey: 'h:-1269871662',
      compose: { mode: 'forward', activityId: SENT },
    });
    const text = r.host.querySelector('[role=region][aria-label*="compose"]')?.textContent ?? '';
    expect(text).toContain('FW: RE: Test: kodegennemgang CRM:0100017');
    expect(text).toContain('Forwardmessage from Care');
    expect(text).not.toContain('to Care');
  });

  it('"More actions" is a real menu: Mark as unread, Expand all, Collapse all, Open in email form', async () => {
    // It was a button that did nothing from Phase 1b until 2026-09-29.
    const READ_ROW = '9a9a9a9a-0000-4000-8000-000000000001';
    readStateRows = [{ jhrb_emailreadstateid: READ_ROW, _jhrb_emailid_value: IN }];
    const opened: unknown[] = [];
    (window as unknown as { Xrm?: unknown }).Xrm = {
      Navigation: { navigateTo: (page: unknown) => { opened.push(page); return Promise.resolve(); } },
    };
    try {
      const r = await renderShell({ selectedThreadKey: 'h:-1269871662', expandedMessageIds: [IN] });
      const openMenu = async () => {
        await act(() => { r.host.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!.click(); return Promise.resolve(); });
        return Array.from(r.host.querySelectorAll<HTMLButtonElement>('[role=menu] [role=menuitem]'));
      };
      const pick = async (label: string) => {
        const item = (await openMenu()).find((b) => b.textContent === label)!;
        expect(item.getAttribute('aria-disabled')).toBeNull();
        await act(async () => { item.click(); for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); }); });
      };

      expect((await openMenu()).map((b) => b.textContent))
        .toEqual(['Open in email form', 'Mark as unread', 'Expand all', 'Collapse all']);
      await act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return Promise.resolve(); });
      expect(r.host.querySelector('[role=menu]')).toBeNull();

      // Expand all opens every message in the thread; Collapse all closes them.
      await pick('Expand all');
      const expandedCount = () => r.host.querySelectorAll('[data-message-id] button[aria-expanded="true"]').length;
      expect(expandedCount()).toBeGreaterThan(1);
      await pick('Collapse all');
      expect(expandedCount()).toBe(0);

      // This conversation holds only our own mail, so there is nothing to mark unread — and the
      // item says why rather than quietly marking some other message.
      const none = (await openMenu()).find((b) => b.textContent === 'Mark as unread')!;
      expect(none.getAttribute('aria-disabled')).toBe('true');
      expect(none.title).toBe('This conversation has no received mail to mark unread.');
      await act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return Promise.resolve(); });

      // The incoming message's own conversation: it is read (the row above), so Mark as unread
      // targets it and deletes this agent's read-state row for it.
      await act(async () => {
        r.host.querySelector<HTMLElement>('[data-row-id^="thread:s:"]')!.click();
        for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      });
      await pick('Mark as unread');
      expect(deleted).toEqual([`jhrb_emailreadstate:${READ_ROW}`]);
      const unreadItem = (await openMenu()).find((b) => b.textContent === 'Mark as unread')!;
      expect(unreadItem.getAttribute('aria-disabled')).toBe('true');
      expect(unreadItem.title).toBe('Already unread.');
      await act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return Promise.resolve(); });

      await pick('Open in email form');
      expect(opened[0]).toMatchObject({ pageType: 'entityrecord', entityName: 'email' });
    } finally {
      delete (window as unknown as { Xrm?: unknown }).Xrm;
    }
  });

  it('resuming a draft keeps its Bcc: shown in compose, and written back on save (issue #11)', async () => {
    // Measured 2026-09-29: a party PATCH replaces the whole set, Bcc included, and the first save
    // after resume always rewrites parties — so a Bcc compose did not know about was deleted.
    const LEADER = 'c0c0c0c0-0000-4000-8000-000000000004';
    partyRows.push(party(DRAFT, 4, 'Leder', 'leder@example.invalid', 'systemuser', LEADER));
    try {
      const r = await renderShell({
        selectedThreadKey: 'h:-1269871662',
        compose: { mode: 'reply', activityId: SENT, emailId: DRAFT },
      });
      expect(r.host.querySelector('[aria-label="Remove Leder"]')).not.toBeNull();
      expect(r.host.querySelector('input[aria-label="Add Bcc recipient by name or address"]')).not.toBeNull();

      await act(async () => {
        r.host.querySelector<HTMLButtonElement>('button[aria-label="Close compose"]')!.click();
        for (let i = 0; i < 10; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      });
      const partySaves = updates.filter((u) => u.entity === 'email' && u.id === DRAFT && 'email_activity_parties' in u.data);
      expect(partySaves.length).toBeGreaterThan(0);
      const last = partySaves[partySaves.length - 1].data.email_activity_parties as Record<string, unknown>[];
      expect(last).toContainEqual(expect.objectContaining({
        participationtypemask: 4, 'partyid_systemuser@odata.bind': `/systemusers(${LEADER})`,
      }));
    } finally {
      partyRows.pop();
    }
  });

  it('a new reply never carries Bcc, and the Bcc row stays hidden until asked for', async () => {
    const r = await renderShell({ selectedThreadKey: 'h:-1269871662', compose: { mode: 'replyAll', activityId: SENT } });
    expect(r.host.querySelector('input[aria-label="Add Bcc recipient by name or address"]')).toBeNull();
    const reveal = Array.from(r.host.querySelectorAll('button')).find((b) => b.textContent === 'Bcc')!;
    await act(() => { reveal.click(); return Promise.resolve(); });
    expect(r.host.querySelector('input[aria-label="Add Bcc recipient by name or address"]')).not.toBeNull();
  });

  it('type-ahead: typing a name offers the record, and picking it adds a BOUND recipient', async () => {
    const r = await renderShell({
      selectedThreadKey: 'h:-1269871662',
      compose: { mode: 'reply', activityId: SENT, emailId: DRAFT },
    });
    const input = r.host.querySelector<HTMLInputElement>('input[aria-label^="Add To recipient"]');
    expect(input).not.toBeNull();
    await act(async () => {
      // The native setter: React 16 ignores an input event whose value was assigned directly.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'sim');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise<void>((resolve) => { setTimeout(resolve, 400); });
    });
    const option = r.host.querySelector('#cec-suggest-to [role=option]');
    expect(option?.textContent).toContain('simon.jehrbo@example.com');
    await act(() => {
      option!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      return Promise.resolve();
    });
    const chip = r.host.querySelector('[aria-label="Remove Simon Jehrbo"]');
    expect(chip).not.toBeNull();
    expect(r.host.querySelector('#cec-suggest-to [role=option]')).toBeNull();
  });

  it('a flagged chip can be resolved in place through the platform lookup', async () => {
    const picks: unknown[] = [];
    (window as unknown as { Xrm?: unknown }).Xrm = {
      Utility: {
        lookupObjects: (opts: unknown) => {
          picks.push(opts);
          return Promise.resolve([{ id: `{${CONTACT.toUpperCase()}}`, entityType: 'contact', name: 'Simon Jehrbo' }]);
        },
      },
    };
    try {
      const r = await renderShell({
        selectedThreadKey: 'h:-1269871662',
        compose: { mode: 'reply', activityId: SENT, emailId: DRAFT },
      });
      const input = r.host.querySelector<HTMLInputElement>('input[aria-label^="Add To recipient"]')!;
      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, 'nobody@example.invalid');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise<void>((resolve) => { setTimeout(resolve, 400); });
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await new Promise<void>((resolve) => { setTimeout(resolve, 300); });
      });
      const resolveButton = r.host.querySelector<HTMLButtonElement>('button[aria-label="Resolve nobody@example.invalid to a record"]');
      expect(Array.from(r.host.querySelectorAll('span[title]'), (x) => x.getAttribute('title')).filter((t) => t?.includes('@'))).toContain('nobody@example.invalid — not a known contact, account, lead, user or queue. Click to pick the right record.');
      expect(resolveButton).not.toBeNull();
      await act(async () => {
        resolveButton!.click();
        await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
      });
      // The lookup opened searching for the chip's address, single-pick.
      expect(picks[0]).toMatchObject({ searchText: 'nobody@example.invalid', allowMultiSelect: false });
      expect(r.host.querySelector('button[aria-label^="Resolve "]')).toBeNull();
      expect(r.host.querySelector('[aria-label="Remove Simon Jehrbo"]')).not.toBeNull();
    } finally {
      delete (window as unknown as { Xrm?: unknown }).Xrm;
    }
  });
});
