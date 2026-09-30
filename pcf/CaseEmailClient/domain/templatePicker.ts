/**
 * R22 — which templates the picker shows, in what order, and in which language
 * (docs/design/04-template-picker.md, decisions of 2026-09-30).
 *
 * Decided at review:
 *  1. The default language is the agent's **interface language** (`userSettings.languageId`).
 *  2. **Personal templates are listed**, under their own heading above the organisation's.
 *  3. The click model: click 2 inserts — fill an empty message, insert at the cursor otherwise.
 *
 * Kept pure so the language rules are asserted: they are the part most likely to be "fixed"
 * later into a silent fallback, which is the one thing the requirement forbids.
 */

export interface PickerTemplate {
  templateId: string;
  title: string;
  description: string;
  /** LCID, e.g. 1033. `undefined` when the row carries none. */
  languageCode?: number;
  isPersonal: boolean;
}

export interface PickerSection {
  heading: string;
  templates: PickerTemplate[];
}

/** Every language the Case templates come in, most common first. */
export function templateLanguages(templates: readonly PickerTemplate[]): number[] {
  const counts = new Map<number, number>();
  for (const t of templates) {
    if (t.languageCode !== undefined) counts.set(t.languageCode, (counts.get(t.languageCode) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([lcid]) => lcid);
}

/**
 * Should the language control be shown at all?
 *
 * Only when the list is NOT simply "every template is in the agent's language". Two cases need it:
 * templates in several languages, and templates that are all in ONE language that is not the
 * agent's — showing those with no control would be exactly the silent fallback R22 forbids.
 * In the demo environment (all English, English UI) it never appears: a control that can do
 * nothing is worse than none.
 */
export function showLanguageControl(templates: readonly PickerTemplate[], uiLanguage: number | undefined): boolean {
  const langs = templateLanguages(templates);
  if (langs.length > 1) return true;
  return langs.length === 1 && uiLanguage !== undefined && langs[0] !== uiLanguage;
}

/** The language the picker opens on: the agent's interface language, when known. */
export function defaultLanguage(templates: readonly PickerTemplate[], uiLanguage: number | undefined): number | undefined {
  if (uiLanguage !== undefined && uiLanguage > 0) return uiLanguage;
  return templateLanguages(templates)[0];
}

/**
 * The sections to render: "My templates" first, then the organisation's, each by title.
 *
 * `language` filters only when the control is shown — otherwise every template is in the one
 * language there is, and filtering could only hide things. The search matches title and
 * description, case-insensitively, on every word typed.
 */
export function pickerSections(
  templates: readonly PickerTemplate[],
  options: { language?: number; filterByLanguage: boolean; query?: string },
): PickerSection[] {
  const words = (options.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (t: PickerTemplate) => {
    if (options.filterByLanguage && t.languageCode !== options.language) return false;
    const hay = `${t.title} ${t.description}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const byTitle = (a: PickerTemplate, b: PickerTemplate) => a.title.localeCompare(b.title);
  const visible = templates.filter(matches);
  const sections: PickerSection[] = [
    { heading: 'My templates', templates: visible.filter((t) => t.isPersonal).sort(byTitle) },
    { heading: 'Templates', templates: visible.filter((t) => !t.isPersonal).sort(byTitle) },
  ];
  return sections.filter((s) => s.templates.length > 0);
}

/**
 * Where a picked template goes (decision 3). An empty message — nothing but the signature — is
 * FILLED from the top, above the signature: that is the whole-letter case and there is nothing to
 * lose. Anything typed means the template goes in at the CURSOR, so one click never destroys work.
 * Replace stays one deliberate click away, on the bar shown after inserting.
 */
export function insertPlacement(hasTypedText: boolean): 'fill' | 'cursor' {
  return hasTypedText ? 'cursor' : 'fill';
}

const LCID_TAGS: Record<number, string> = {
  1025: 'ar-SA', 1028: 'zh-TW', 1029: 'cs-CZ', 1030: 'da-DK', 1031: 'de-DE', 1032: 'el-GR',
  1033: 'en-US', 1035: 'fi-FI', 1036: 'fr-FR', 1037: 'he-IL', 1038: 'hu-HU', 1040: 'it-IT',
  1041: 'ja-JP', 1042: 'ko-KR', 1043: 'nl-NL', 1044: 'nb-NO', 1045: 'pl-PL', 1046: 'pt-BR',
  1049: 'ru-RU', 1053: 'sv-SE', 1055: 'tr-TR', 1061: 'et-EE', 1062: 'lv-LV', 1063: 'lt-LT',
  2052: 'zh-CN', 2057: 'en-GB', 2070: 'pt-PT', 3082: 'es-ES', 3084: 'fr-CA',
};

/**
 * A language's name for the chip and the empty state — in the agent's own interface language, so
 * an English UI says "Danish", not "dansk". Unknown LCIDs say so rather than guessing.
 */
export function languageName(lcid: number, uiLanguage?: number): string {
  const tag = LCID_TAGS[lcid];
  if (!tag) return `Language ${lcid}`;
  try {
    const display = new Intl.DisplayNames([LCID_TAGS[uiLanguage ?? 1033] ?? 'en-US'], { type: 'language' });
    // The language alone ("Danish"), not the region ("Danish (Denmark)").
    return display.of(tag.split('-')[0]) ?? tag;
  } catch {
    return tag;
  }
}
