// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { EmailClientRoot, type RestorableState } from '../EmailClientRoot';
import type { DraftApiLike } from '../../data/draft';
import { installFakeFormComponent, type FakeFormComponent } from './fakeFormComponent';

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
/** The agent's signatures — empty unless a test needs one (the shape is `emailsignature`'s). */
const signatureRows: Record<string, unknown>[] = [];

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
          case 'emailsignature': return signatureRows;
          case 'jhrb_emailreadstate': return readStateRows;
          case 'contact':
            // The type-ahead's query; the address resolver's is an equality filter instead.
            return options?.includes("startswith(fullname,'sim")
              ? [{ contactid: CONTACT, fullname: 'Simon Jehrbo', emailaddress1: 'simon.jehrbo@example.com' }]
              : [];
          case 'template': return [
            { templateid: 'f00dcafe-0000-4000-8000-000000000001', title: 'Case Escalation', subject: 'Your case has been escalated' },
            { templateid: 'f00dcafe-0000-4000-8000-000000000002', title: 'Welcome', subject: 'Welcome' },
          ];
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
        return Promise.resolve({
          fullname: 'Simon Jehrbo', internalemailaddress: 'simon@example.invalid', emailrouteraccessapproval: 1,
          _defaultmailbox_value: '0b8c1d2e-3f40-4152-8637-48495a6b7c8e',
        });
      }
      if (entity === 'mailbox') return Promise.resolve({ outgoingemailstatus: 1 });
      if (entity === 'contact') return Promise.resolve({ emailaddress1: 'simon.jehrbo@example.com' });
      if (entity === 'incident') {
        return Promise.resolve({
          _customerid_value: CONTACT,
          '_customerid_value@Microsoft.Dynamics.CRM.lookuplogicalname': 'contact',
          '_customerid_value@OData.Community.Display.V1.FormattedValue': 'Simon Jehrbo',
        });
      }
      if (entity === 'email') return Promise.resolve({ activityid: IN, description: '<p>Hej Care</p>' });
      if (entity === 'organization') return Promise.resolve({ maxuploadfilesize: 5242880 });
      return Promise.resolve({});
    },
    createRecord: (entity: string, data: Record<string, unknown>) => {
      count('create');
      creates.push({ entity, data });
      return Promise.resolve({ id: CREATED_ID });
    },
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
let creates: { entity: string; data: Record<string, unknown> }[] = [];

/** The id the fake hands every created row — so the fake form can find what was created. */
const CREATED_ID = 'c0ffee00-0000-0000-0000-000000000001';

/**
 * What the row holds now, as the compose-body form would load it: the latest saved description,
 * else what the row was created with, else the seeded draft's.
 */
function bodyOf(id: string): string {
  const saved = [...updates].reverse().find((u) => u.entity === 'email' && u.id === id && typeof u.data.description === 'string');
  if (saved) return saved.data.description as string;
  if (id === CREATED_ID) {
    const created = [...creates].reverse().find((c) => c.entity === 'email');
    return typeof created?.data.description === 'string' ? created.data.description : '';
  }
  if (id === DRAFT) return '<p>M11 sessionsskift test</p><div id="divRplyFwdMsg"><p>old</p></div>';
  return '';
}

/** The compose body's form, faked — installed for every test; a test may swap it. */
let form: FakeFormComponent;
beforeEach(() => { form = installFakeFormComponent({ bodyFor: bodyOf }); });

let host: HTMLDivElement | undefined;
afterEach(() => {
  form.uninstall();
  readStateRows = [];
  deleted = [];
  updates = [];
  creates = [];
  if (host) { ReactDOM.unmountComponentAtNode(host); host.remove(); host = undefined; }
});

/**
 * Renders the shell the way `index.ts` does: `setControlState` hands the state straight back as
 * `restored` and re-renders — the round trip that hung the app once already (2026-09-11).
 */
async function renderShell(
  initial?: RestorableState,
  stateCeiling = 200,
) {
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
    expect(r.host.querySelector('.ck-editor__editable')?.textContent).toContain('M11 sessionsskift test');
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
    expect(r.host.querySelector('.ck-editor__editable')?.textContent).toContain('M11 sessionsskift test');
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

      // An edit, so closing saves — and that save rewrites every party.
      await act(async () => {
        const e = (r.host.querySelector('.ck-editor__editable') as unknown as { ckeditorInstance: { model: { insertContent(h: string): void } } }).ckeditorInstance;
        e.model.insertContent('<p>Tilføjet</p>');
        for (let i = 0; i < 3; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      });
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

  it('a case with NO email can get its first one: + opens a new email to the customer (2026-10-01)', async () => {
    const saved = emailRows.splice(0);
    try {
      const r = await renderShell();
      expect(r.host.textContent).toContain('No email on this case yet');
      const plus = r.host.querySelector<HTMLButtonElement>('button[aria-label="New email"]')!;
      expect(plus.disabled).toBe(false);
      await act(async () => {
        plus.click();
        for (let i = 0; i < 10; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      });

      const region = r.host.querySelector<HTMLElement>('[role=region][aria-label*="compose"]')!;
      expect(region.getAttribute('aria-label')).toBe('New email — compose');
      // To is the case's customer, bound to the record; the subject is open and empty; no quote.
      expect(region.querySelector('[aria-label="Remove Simon Jehrbo"]')).not.toBeNull();
      expect(region.querySelector<HTMLInputElement>('input[aria-label="Subject"]')!.value).toBe('');
      expect(region.textContent).not.toContain('Quoted message');
      const send = () => Array.from(region.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Send')!;
      expect(send().disabled).toBe(true);

      // Write something and close: the draft is created with the customer, and links to NOTHING.
      await act(async () => {
        const editable = region.querySelector<HTMLElement>('.ck-editor__editable')!;
        (editable as unknown as { ckeditorInstance: { model: { insertContent(html: string): void } } })
          .ckeditorInstance.model.insertContent('<p>Hej Simon</p>');
        for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      });
      expect(send().disabled).toBe(false);

      // The row exists from the start — the body is its form (S16) — with the customer in To.
      expect(creates.filter((c) => c.entity === 'email')).toHaveLength(1);
      // Send with no subject is refused before anything is saved…
      const writesBefore = updates.length + creates.length;
      await act(async () => {
        send().click();
        for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      });
      expect(region.textContent).toContain('Add a subject first.');
      expect(updates.length + creates.length).toBe(writesBefore);
      // …and the refusal goes the moment the agent fixes it, rather than outliving the cause.
      await act(async () => {
        const subject = region.querySelector<HTMLInputElement>('input[aria-label="Subject"]')!;
        // The native setter: React 16 ignores an input event whose value was assigned directly.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(subject, 'Opfølgning på din sag');
        subject.dispatchEvent(new Event('input', { bubbles: true }));
        await Promise.resolve();
      });
      expect(region.textContent).not.toContain('Add a subject first.');

      // What the server holds once the close-time save lands — the list must show it after
      // closing, not keep saying the case has no email until the agent presses Refresh.
      emailRows.push({
        activityid: 'c0ffee00-0000-0000-0000-000000000001', subject: 'Opfølgning på din sag',
        directioncode: true, statecode: 0, statuscode: 1, createdon: '2026-10-01T07:42:17Z',
        baseconversationindexhash: null, conversationindex: null, _regardingobjectid_value: CASE,
        _ownerid_value: '4f2d39f5-23cc-f011-8544-6045bde0fa7e', modifiedon: '2026-10-01T07:42:17Z',
      } as typeof emailRows[number]);
      await act(async () => {
        region.querySelector<HTMLButtonElement>('button[aria-label="Close compose"]')!.click();
        for (let i = 0; i < 10; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      });
      const created = creates.find((c) => c.entity === 'email')!;
      expect(created).toBeDefined();
      expect(created.data).not.toHaveProperty('parentactivityid@odata.bind');
      // The subject arrives with our save, which never writes the body — that is the form's,
      // and it was saved through the form.
      const subjectSave = [...updates].reverse().find((u) => u.id === CREATED_ID && 'subject' in u.data);
      expect(subjectSave?.data.subject).toBe('Opfølgning på din sag');
      expect(subjectSave?.data).not.toHaveProperty('description');
      expect(form.saves[form.saves.length - 1]).toContain('Hej Simon');
      expect(r.host.textContent).not.toContain('No email on this case yet');
      expect(r.host.textContent).toContain('Opfølgning på din sag');
      expect(created.data.email_activity_parties).toContainEqual(expect.objectContaining({
        participationtypemask: 2, 'partyid_contact@odata.bind': `/contacts(${CONTACT})`,
      }));
    } finally {
      emailRows.splice(0, emailRows.length, ...saved);
    }
  });

  it('the body is the form of the draft row: text added INSIDE the quote still counts, and is saved through the form (S16)', async () => {
    const r = await renderShell({ selectedThreadKey: 'h:-1269871662', compose: { mode: 'reply', activityId: IN } });
    // The row was created on open, with the starting body, and the form shows THAT row.
    const created = creates.find((c) => c.entity === 'email')!;
    expect(String(created.data.description)).toContain('divRplyFwdMsg');
    expect(form.records).toContain(CREATED_ID);
    const region = r.host.querySelector<HTMLElement>('[role=region][aria-label*="compose"]')!;
    const send = () => Array.from(region.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Send')!;
    expect(send().disabled).toBe(true);

    // What Copilot's *Keep it* does (measured): its draft lands at the start of the body, INSIDE
    // our quote container. Splitting the body would see no new text; the form's body changed.
    await act(async () => {
      const e = (region.querySelector('.ck-editor__editable') as unknown as { ckeditorInstance: { setData(h: string): void; getData(): string } }).ckeditorInstance;
      e.setData(e.getData().replace('<div id="divRplyFwdMsg">', '<div id="divRplyFwdMsg"><p>Kære kunde, tak for din henvendelse.</p>'));
      for (let i = 0; i < 3; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    expect(send().disabled).toBe(false);

    const deletedBefore = deleted.length;
    await act(async () => {
      region.querySelector<HTMLButtonElement>('button[aria-label="Close compose"]')!.click();
      for (let i = 0; i < 10; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    // Kept, not discarded — and the body went through the form, never through our own update.
    expect(deleted.length).toBe(deletedBefore);
    expect(form.saves[form.saves.length - 1]).toContain('Kære kunde');
    expect(updates.filter((u) => u.id === CREATED_ID).some((u) => 'description' in u.data)).toBe(false);
  });

  it('an untouched new reply leaves no row behind, and OpenEmailInfo carries the case only while compose is open', async () => {
    const r = await renderShell({ selectedThreadKey: 'h:-1269871662', compose: { mode: 'reply', activityId: IN } });
    const info = (window as unknown as { OpenEmailInfo?: { formContext: { getAttribute(n: string): { getValue(): { id: string; entityType: string }[] } | null } } }).OpenEmailInfo;
    // The editor's Copilot reads the Regarding from here (S16): the case, braced and upper-cased.
    expect(info?.formContext.getAttribute('regardingobjectid')?.getValue()[0]).toMatchObject({
      id: `{${CASE.toUpperCase()}}`, entityType: 'incident',
    });
    await act(async () => {
      r.host.querySelector<HTMLButtonElement>('button[aria-label="Close compose"]')!.click();
      for (let i = 0; i < 10; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    expect(deleted).toContain(`email:${CREATED_ID}`);
    expect((window as unknown as { OpenEmailInfo?: unknown }).OpenEmailInfo).toBeUndefined();
  });

  it('compose takes over the reading pane, and closing it gives the thread back as it was (2026-09-30)', async () => {
    const r = await renderShell({ selectedThreadKey: 'h:-1269871662', compose: { mode: 'reply', activityId: SENT } });
    const threadHidden = () => {
      let n: HTMLElement | null = r.host.querySelector<HTMLElement>('[data-message]');
      expect(n).not.toBeNull();
      for (; n && n !== r.host; n = n.parentElement) if (n.style.display === 'none') return true;
      return false;
    };
    expect(threadHidden()).toBe(true);
    // The compose surface and its editor are the column now — nothing is docked under a thread.
    expect(r.host.querySelector<HTMLElement>('[role=region][aria-label*="compose"]')!.style.flexGrow).toBe('1');

    await act(async () => {
      r.host.querySelector<HTMLButtonElement>('button[aria-label="Close compose"]')!.click();
      for (let i = 0; i < 10; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
    // Hidden, never unmounted: the same message rows come straight back.
    expect(threadHidden()).toBe(false);
  });

  it('inserting a template never changes the subject — the tracking token stays (2026-09-30)', async () => {
    // Every Case template carries a subject, and applying one used to replace the reply's subject
    // with it: "FW: RE: … CRM:0100017" became "Your case has been escalated", token and all gone.
    (window as unknown as { Xrm?: unknown }).Xrm = {
      WebApi: { online: { execute: () => Promise.resolve({
        json: () => Promise.resolve({ value: [{ subject: 'Your case has been escalated', description: '<p>Dear customer</p>' }] }),
      }) } },
    };
    try {
      const r = await renderShell({ selectedThreadKey: 'h:-1269871662', compose: { mode: 'forward', activityId: SENT } });
      const region = () => r.host.querySelector('[role=region][aria-label*="compose"]')?.textContent ?? '';
      expect(region()).toContain('FW: RE: Test: kodegennemgang CRM:0100017');

      // R22: click 1 opens the picker, click 2 on a row inserts.
      await act(async () => {
        Array.from(r.host.querySelectorAll('button')).find((b) => b.textContent === 'Template ▾')!.click();
        for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      });
      // The preview resolves on sight, before any click.
      expect(r.host.querySelector('[aria-live="polite"]')?.textContent).toContain('Dear customer');
      const row = r.host.querySelector('[role=listbox][aria-label="Templates"] [role=option]')!;
      expect(row.textContent).toContain('Case Escalation');
      await act(async () => {
        row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      });

      expect(r.host.querySelector('.ck-editor__editable')?.textContent).toContain('Dear customer');
      expect(region()).toContain('Inserted "Case Escalation"');
      expect(region()).toContain('FW: RE: Test: kodegennemgang CRM:0100017');
      expect(region()).not.toContain('Your case has been escalated');
    } finally {
      delete (window as unknown as { Xrm?: unknown }).Xrm;
    }
  });

  it('R22: after inserting, Undo takes it out and Replace leaves only the template', async () => {
    (window as unknown as { Xrm?: unknown }).Xrm = {
      WebApi: { online: { execute: () => Promise.resolve({
        json: () => Promise.resolve({ value: [{ subject: 'x', description: '<p>Dear customer</p>' }] }),
      }) } },
    };
    try {
      const r = await renderShell({ selectedThreadKey: 'h:-1269871662', compose: { mode: 'forward', activityId: SENT } });
      const editorText = () => r.host.querySelector('.ck-editor__editable')?.textContent ?? '';
      const before = editorText();
      const insert = async () => {
        await act(async () => {
          Array.from(r.host.querySelectorAll('button')).find((b) => b.textContent === 'Template ▾')!.click();
          for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
        });
        await act(async () => {
          r.host.querySelector('[role=listbox][aria-label="Templates"] [role=option]')!
            .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
        });
      };
      const click = async (label: string) => {
        await act(() => { Array.from(r.host.querySelectorAll('button')).find((b) => b.textContent === label)!.click(); return Promise.resolve(); });
      };

      await insert();
      // Nothing typed yet, so it FILLS from the top — above whatever the editor held.
      expect(editorText().startsWith('Dear customer')).toBe(true);
      await click('Undo');
      expect(editorText()).toBe(before);
      expect(r.host.textContent).not.toContain('Inserted "Case Escalation"');

      await insert();
      await click('Replace the whole message instead');
      // The editor holds the whole body now (the compose-body form, S16): Replace replaces the
      // agent's text and keeps the quote.
      expect(editorText().startsWith('Dear customer')).toBe(true);
      expect(editorText()).toContain('From:');
    } finally {
      delete (window as unknown as { Xrm?: unknown }).Xrm;
    }
  });

  it('Send judges "empty" by the signature rule: Undo back to signature-only disables it again (2026-09-30)', async () => {
    (window as unknown as { Xrm?: unknown }).Xrm = {
      WebApi: { online: { execute: () => Promise.resolve({
        json: () => Promise.resolve({ value: [{ subject: 'x', description: '<p>Dear customer</p>' }] }),
      }) } },
    };
    try {
      // The signature is what makes this test mean anything: without one, signature-only and
      // empty are the same text, and the old raw-text rule passes too.
      signatureRows.push({
        emailsignatureid: 'b0b0b0b0-0000-4000-8000-000000000001', title: 'Care', isdefault: true,
        body: '<?xml version="1.0" ?><xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0">'
          + '<xsl:output method="text" indent="no"/><xsl:template match="/data">'
          + '<![CDATA[<div><p style="margin: 0;">Venlig hilsen</p><p style="margin: 0;">Customer Care</p></div>]]>'
          + '</xsl:template></xsl:stylesheet>',
      });
      const r = await renderShell({ selectedThreadKey: 'h:-1269871662', compose: { mode: 'reply', activityId: IN } });
      expect(r.host.querySelector('.ck-editor__editable')?.textContent).toContain('Venlig hilsen');
      // A reply with no draft behind it: the editor holds only the signature, so Send starts off.
      const send = () => Array.from(r.host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Send')!;
      expect(send().disabled).toBe(true);
      await act(async () => {
        Array.from(r.host.querySelectorAll('button')).find((b) => b.textContent === 'Template ▾')!.click();
        for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      });
      await act(async () => {
        r.host.querySelector('[role=listbox][aria-label="Templates"] [role=option]')!
          .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      });
      expect(send().disabled).toBe(false);
      await act(() => { Array.from(r.host.querySelectorAll('button')).find((b) => b.textContent === 'Undo')!.click(); return Promise.resolve(); });
      expect(send().disabled).toBe(true);
    } finally {
      signatureRows.length = 0;
      delete (window as unknown as { Xrm?: unknown }).Xrm;
    }
  });

  it('the picker keeps a FIXED height, and only real mouse movement changes the hovered template', async () => {
    // Reported 2026-09-30: the popover opened upward and followed the preview's height, so hovering
    // resized it, a neighbouring row slid under the still cursor and took the hover, and the two
    // flipped forever. jsdom cannot measure layout, so this asserts the two guards instead.
    (window as unknown as { Xrm?: unknown }).Xrm = {
      WebApi: { online: { execute: () => Promise.resolve({ json: () => Promise.resolve({ value: [{ subject: 'x', description: '<p>x</p>' }] }) }) } },
    };
    try {
      const r = await renderShell({ selectedThreadKey: 'h:-1269871662', compose: { mode: 'forward', activityId: SENT } });
      await act(async () => {
        Array.from(r.host.querySelectorAll('button')).find((b) => b.textContent === 'Template ▾')!.click();
        for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      });
      const listbox = r.host.querySelector<HTMLElement>('[role=listbox][aria-label="Templates"]')!;
      const popover = listbox.parentElement!.parentElement!;
      expect(popover.style.height).toBe('300px');

      const rows = () => Array.from(listbox.querySelectorAll<HTMLElement>('[role=option]'));
      const selected = () => rows().find((o) => o.getAttribute('aria-selected') === 'true')?.textContent;
      expect(selected()).toContain('Case Escalation');
      // Content moving under a still cursor fires mouseenter/over — that must NOT change the hover.
      await act(() => { rows()[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return Promise.resolve(); });
      expect(selected()).toContain('Case Escalation');
      // A real move does.
      await act(() => { rows()[1].dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); return Promise.resolve(); });
      expect(selected()).toContain('Welcome');
    } finally {
      delete (window as unknown as { Xrm?: unknown }).Xrm;
    }
  });

  it('when the compose body form cannot load, compose says so and offers the standard form', async () => {
    const opened: unknown[] = [];
    (window as unknown as { Xrm?: unknown }).Xrm = {
      Navigation: { navigateTo: (page: unknown) => { opened.push(page); return Promise.resolve(); } },
    };
    try {
      form.uninstall();
      form = installFakeFormComponent({ bodyFor: bodyOf, failRender: true });
      const r = await renderShell({ selectedThreadKey: 'h:-1269871662', compose: { mode: 'forward', activityId: SENT } });
      const alert = Array.from(r.host.querySelectorAll('[role=alert]')).find((a) => a.textContent?.includes("couldn't load"));
      expect(alert?.textContent).toContain('open it in the email form');
      expect(r.host.querySelector('.ck-editor__editable')).toBeNull();

      // Hand-off: the draft is saved (forced — nothing typed), compose closes, the form opens on it.
      await act(async () => {
        Array.from(r.host.querySelectorAll('button')).find((b) => b.textContent === 'Open in the email form')!.click();
        for (let i = 0; i < 10; i += 1) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      });
      expect(opened[0]).toMatchObject({ pageType: 'entityrecord', entityName: 'email' });
      expect(r.host.querySelector('button[aria-label="Close compose"]')).toBeNull();
    } finally {
      delete (window as unknown as { Xrm?: unknown }).Xrm;
    }
  });

  it('on a page without the form component there is no editor, only the way out', async () => {
    form.uninstall();
    const r = await renderShell({ selectedThreadKey: 'h:-1269871662', compose: { mode: 'forward', activityId: SENT } });
    expect(Array.from(r.host.querySelectorAll('[role=alert]')).some((a) => a.textContent?.includes("couldn't load"))).toBe(true);
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
