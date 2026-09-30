import { describe, it, expect } from 'vitest';
import {
  defaultLanguage, describeLost, formattingLost, insertPlacement, languageName, pickerSections, showLanguageControl,
  templateLanguages, type PickerTemplate,
} from '../templatePicker';

const t = (title: string, over: Partial<PickerTemplate> = {}): PickerTemplate => ({
  templateId: title, title, description: `${title} description`, languageCode: 1033, isPersonal: false, ...over,
});

// The demo environment, measured 2026-09-30: five Case templates, all English, English UI.
const DEMO = [
  t('New Case Acknowledgement'), t('Case Escalation'), t('Closed Case Acknowledgement'),
  t('Case Auto Response'), t('Case resolution survey invite'),
];

describe('the language control (R22)', () => {
  it('does NOT appear when every template is in the agent\'s language — the demo environment', () => {
    expect(showLanguageControl(DEMO, 1033)).toBe(false);
  });

  it('appears when templates span several languages', () => {
    expect(showLanguageControl([...DEMO, t('Sagen er lukket', { languageCode: 1030 })], 1033)).toBe(true);
  });

  it('appears when every template is in ONE language that is not the agent\'s — never a silent fallback', () => {
    expect(showLanguageControl(DEMO, 1030)).toBe(true);
  });

  it('defaults to the interface language (decision 1), else the most common', () => {
    expect(defaultLanguage(DEMO, 1030)).toBe(1030);
    expect(defaultLanguage([t('a', { languageCode: 1030 }), t('b', { languageCode: 1030 }), t('c')], undefined)).toBe(1030);
    expect(templateLanguages([t('a', { languageCode: 1030 }), t('b')])).toEqual([1030, 1033]);
  });
});

describe('pickerSections', () => {
  it('lists personal templates first under "My templates" (decision 2), each section by title', () => {
    const sections = pickerSections([...DEMO, t('Min standardtekst', { isPersonal: true })], { filterByLanguage: false });
    expect(sections.map((s) => s.heading)).toEqual(['My templates', 'Templates']);
    expect(sections[1].templates.map((x) => x.title)).toEqual([
      'Case Auto Response', 'Case Escalation', 'Case resolution survey invite',
      'Closed Case Acknowledgement', 'New Case Acknowledgement',
    ]);
  });

  it('filters by language only when asked, and a language with none yields NO sections — the empty state', () => {
    expect(pickerSections(DEMO, { language: 1030, filterByLanguage: true })).toEqual([]);
    expect(pickerSections(DEMO, { language: 1030, filterByLanguage: false })).toHaveLength(1);
  });

  it('searches title and description, every word, case-insensitively', () => {
    const titles = (q: string) => pickerSections(DEMO, { filterByLanguage: false, query: q }).flatMap((s) => s.templates.map((x) => x.title));
    expect(titles('closed ack')).toEqual(['Closed Case Acknowledgement']);
    expect(titles('SURVEY')).toEqual(['Case resolution survey invite']);
    expect(titles('nothing like this')).toEqual([]);
  });
});

describe('insertPlacement (decision 3)', () => {
  it('fills an empty message, and inserts at the cursor once the agent has typed', () => {
    expect(insertPlacement(false)).toBe('fill');
    expect(insertPlacement(true)).toBe('cursor');
  });
});

describe('languageName', () => {
  it('names the language in the agent\'s own interface language, without the region', () => {
    expect(languageName(1030, 1033)).toBe('Danish');
    expect(languageName(1033, 1030)).toBe('engelsk');
  });

  it('says so for an unknown LCID rather than guessing', () => {
    expect(languageName(9999, 1033)).toBe('Language 9999');
  });
});

describe('formattingLost (#17) — what the editor would drop, said BEFORE inserting', () => {
  it('reports nothing for what the editor holds: paragraphs, bold, lists, links', () => {
    expect(formattingLost('<p>Hej <strong>Simon</strong></p><ul><li><p>a</p></li></ul><p><a href="https://x">x</a></p>')).toEqual([]);
  });

  it('names each kind of lost formatting once, in a readable order', () => {
    // The exact probe measured on 2026-09-30.
    const rich = '<table><tr><td style="color:red">Cell</td></tr></table><p><span style="font-family:Arial; color:#0078d4; font-size:14pt">Styled</span></p><p style="text-align:center">Centered</p><img src="data:image/png;base64,x">';
    expect(formattingLost(rich)).toEqual(['tables', 'images', 'fonts and sizes', 'colours', 'alignment']);
  });

  it('catches the legacy tags the Dynamics editor emits too', () => {
    expect(formattingLost('<font face="Segoe UI" color="#333">x</font><h2>T</h2><u>u</u><hr><blockquote>q</blockquote>'))
      .toEqual(['fonts and sizes', 'colours', 'headings', 'underline', 'quotes', 'lines']);
  });

  it('reads as one sentence', () => {
    expect(describeLost(['tables'])).toBe('tables');
    expect(describeLost(['tables', 'colours', 'alignment'])).toBe('tables, colours and alignment');
  });
});
