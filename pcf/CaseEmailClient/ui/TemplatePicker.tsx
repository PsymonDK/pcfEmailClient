import * as React from 'react';
import type { EmailTemplate } from '../data/templates';
import {
  defaultLanguage, languageName, pickerSections, showLanguageControl,
  templateLanguages, type PickerTemplate,
} from '../domain/templatePicker';
import { BODY_SURFACE, BODY_SURFACE_FG, RADIUS, T } from './tokens';

/** What resolving a template against the Case produced — see `useCompose.resolveTemplate`. */
export interface TemplateOutcome {
  html: string;
  subject: string;
  unresolved: string[];
  error?: string;
}

/**
 * R22 — the template picker (docs/design/04-template-picker.md).
 *
 * Two clicks: the button opens it, a row inserts. Everything else is free — hovering or arrowing
 * onto a row shows the RESOLVED preview (tokens filled server-side, cached per template), so an
 * unfillable placeholder is visible before anything lands in the reply.
 *
 * A popover rather than a dialog, so the reply stays visible; absolutely positioned inside its
 * wrapper because CSW's containers carry transforms that break fixed positioning. It opens DOWN,
 * over the editor: compose fills the reading pane now (2026-09-30), so the toolbar row sits near
 * its top and the space is below. It opened up while compose was docked at the bottom, and after
 * the change it opened into the rows above and was cut off.
 */
/** The popover's fixed height — the list and the preview scroll inside it. See the style below. */
export const PICKER_HEIGHT = 300;

export const TemplatePicker: React.FC<{
  templates: readonly EmailTemplate[];
  /** `context.userSettings.languageId` — the default language (decision 1). */
  uiLanguage?: number;
  disabled?: boolean;
  onResolve: (templateId: string) => Promise<TemplateOutcome>;
  /** A template was picked and resolved cleanly: the parent inserts it. */
  onPick: (template: EmailTemplate, outcome: TemplateOutcome) => void;
}> = ({ templates, uiLanguage, disabled, onResolve, onPick }) => {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const pickerTemplates = React.useMemo<PickerTemplate[]>(() => templates.map((t) => ({
    templateId: t.templateId, title: t.title, description: t.description,
    languageCode: t.languageCode, isPersonal: t.isPersonal,
  })), [templates]);
  const withLanguage = showLanguageControl(pickerTemplates, uiLanguage);
  const [language, setLanguage] = React.useState(() => defaultLanguage(pickerTemplates, uiLanguage));
  const [activeId, setActiveId] = React.useState<string>();
  const [previews, setPreviews] = React.useState<Map<string, TemplateOutcome | 'loading'>>(new Map());
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  // A fixed id: React 16 (the platform's) has no useId, and only one picker is ever open.
  const listId = 'cec-templates';

  const sections = pickerSections(pickerTemplates, { language, filterByLanguage: withLanguage, query });
  const flat = sections.flatMap((s) => s.templates);
  const active = flat.find((t) => t.templateId === activeId) ?? flat[0];
  const preview = active ? previews.get(active.templateId) : undefined;

  const resolve = React.useCallback(async (templateId: string): Promise<TemplateOutcome> => {
    const cached = previews.get(templateId);
    if (cached && cached !== 'loading') return cached;
    setPreviews((p) => new Map(p).set(templateId, 'loading'));
    const out = await onResolve(templateId);
    setPreviews((p) => new Map(p).set(templateId, out));
    return out;
  }, [previews, onResolve]);

  // Resolve the row the agent is looking at — hover or arrow keys, never a click.
  React.useEffect(() => {
    if (open && active && !previews.has(active.templateId)) void resolve(active.templateId);
  }, [open, active, previews, resolve]);

  React.useEffect(() => {
    if (!open) return undefined;
    searchRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (returnFocus) buttonRef.current?.focus();
  };

  const pick = async (t: PickerTemplate) => {
    const template = templates.find((x) => x.templateId === t.templateId);
    if (!template) return;
    setActiveId(t.templateId);
    const out = await resolve(t.templateId);
    // A template that would not resolve is NOT inserted — the error stays in the preview.
    if (out.error) return;
    onPick(template, out);
    close(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const at = flat.findIndex((t) => t.templateId === active?.templateId);
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveId(flat[Math.min(flat.length - 1, at + 1)]?.templateId); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveId(flat[Math.max(0, at - 1)]?.templateId); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active) void pick(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
  };

  const languages = [...new Set([...(language !== undefined ? [language] : []), ...templateLanguages(pickerTemplates)])];
  const name = (lcid: number) => languageName(lcid, uiLanguage);

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: '0 0 auto' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          height: '22px', padding: '0 8px', boxSizing: 'border-box',
          border: `1px solid ${open ? T.brandStroke2 : T.stroke1}`, borderRadius: RADIUS.md,
          background: open ? T.brandBg2 : T.bg1, font: 'inherit', fontSize: '12px',
          color: open ? T.link : T.fg1, cursor: disabled ? 'default' : 'pointer',
        }}
      >
        Template ▾
      </button>

      {open && (
        <div
          onKeyDown={onKeyDown}
          style={{
            position: 'absolute', right: 0, top: '26px', zIndex: 3, width: '560px', maxWidth: '80vw',
            // Reset: the compose chrome around the toolbar inherits `nowrap`, and the formatting
            // note ran 567 px wide inside a 258 px column, cut off mid-word (measured live, 1.29.0).
            whiteSpace: 'normal',
            // A FIXED height, with the list and the preview scrolling inside it. While the popover
            // opened upward, a height that followed the preview moved every row under a still
            // cursor: hovering a template resized the popover, the row above slid under the
            // cursor and took the hover, its preview resized it back — a loop (reported 2026-09-30).
            height: `${PICKER_HEIGHT}px`,
            display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gridTemplateRows: '100%',
            background: T.bg1, border: `1px solid ${T.stroke1}`, borderRadius: RADIUS.md, overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', borderRight: `1px solid ${T.stroke2}`, minWidth: 0, minHeight: 0 }}>
            <div style={{ display: 'flex', gap: '6px', padding: '6px', borderBottom: `1px solid ${T.stroke2}` }}>
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActiveId(undefined); }}
                placeholder="Search templates"
                aria-label="Search templates"
                role="combobox"
                aria-controls={listId}
                aria-expanded
                aria-activedescendant={active ? `${listId}-${active.templateId}` : undefined}
                style={{
                  flexGrow: 1, minWidth: 0, height: '24px', padding: '0 6px', boxSizing: 'border-box',
                  border: `1px solid ${T.stroke1}`, borderRadius: RADIUS.sm, background: T.bg1,
                  font: 'inherit', fontSize: '12px', color: T.fg1,
                }}
              />
              {withLanguage && (
                <select
                  value={language ?? ''}
                  onChange={(e) => { setLanguage(Number(e.target.value)); setActiveId(undefined); }}
                  aria-label="Template language"
                  style={{
                    height: '24px', border: `1px solid ${T.stroke1}`, borderRadius: RADIUS.sm,
                    background: T.bg1, font: 'inherit', fontSize: '12px', color: T.fg1,
                  }}
                >
                  {languages.map((l) => <option key={l} value={l}>{name(l)}</option>)}
                </select>
              )}
            </div>

            <div id={listId} role="listbox" aria-label="Templates" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
              {sections.map((s) => (
                <div key={s.heading} role="group" aria-label={s.heading}>
                  {sections.length > 1 && (
                    <div style={{ padding: '6px 10px 2px', fontSize: '11px', color: T.fg3, fontWeight: 600 }}>{s.heading}</div>
                  )}
                  {s.templates.map((tpl) => {
                    const isActive = tpl.templateId === active?.templateId;
                    return (
                      <div
                        key={tpl.templateId}
                        id={`${listId}-${tpl.templateId}`}
                        role="option"
                        aria-selected={isActive}
                        // mousemove, not mouseenter: mouseenter also fires when content moves under a
                        // STILL cursor, which is how the resize loop kept re-selecting rows.
                        onMouseMove={() => { if (tpl.templateId !== activeId) setActiveId(tpl.templateId); }}
                        // mousedown, not click: a click would first blur the search box.
                        onMouseDown={(e) => { e.preventDefault(); void pick(tpl); }}
                        style={{
                          padding: '5px 10px', cursor: 'pointer',
                          background: isActive ? T.selected : 'transparent',
                        }}
                      >
                        <div style={{ fontSize: '13px', color: T.fg1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tpl.title}
                        </div>
                        {tpl.description && (
                          <div style={{ fontSize: '12px', color: T.fg3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {tpl.description}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              {flat.length === 0 && (
                <div style={{ padding: '10px', fontSize: '12px', color: T.fg2 }}>
                  {query.trim()
                    ? `No templates match "${query.trim()}".`
                    : withLanguage && language !== undefined
                      ? (
                        // Never a silent fallback: say there are none, and offer the others by name.
                        <>
                          No Case templates in {name(language)}.{' '}
                          {templateLanguages(pickerTemplates).filter((l) => l !== language).map((l) => (
                            <button
                              key={l}
                              type="button"
                              onClick={() => setLanguage(l)}
                              style={{ border: 'none', background: 'transparent', padding: 0, font: 'inherit', fontSize: '12px', color: T.link, cursor: 'pointer', marginRight: '8px' }}
                            >
                              Show {name(l)} templates
                            </button>
                          ))}
                        </>
                      )
                      : 'There are no Case templates.'}
                </div>
              )}
            </div>
          </div>

          <div aria-live="polite" style={{ padding: '8px 10px', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: T.fg3 }}>Preview · resolved for this case</span>
            {!active && <span style={{ fontSize: '12px', color: T.fg3 }}>Nothing selected.</span>}
            {preview === 'loading' && <span style={{ fontSize: '12px', color: T.fg3 }}>Resolving…</span>}
            {preview && preview !== 'loading' && preview.error && (
              <span role="alert" style={{ fontSize: '12px', color: T.dangerFg }}>{preview.error}</span>
            )}
            {preview && preview !== 'loading' && !preview.error && (
              <>
                {/* `preview.html` was sanitised when the template resolved (useCompose.resolveTemplate). */}
                <div
                  dangerouslySetInnerHTML={{ __html: preview.html }}
                  style={{
                    flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '6px 8px', boxSizing: 'border-box',
                    background: BODY_SURFACE, colorScheme: 'light', color: BODY_SURFACE_FG,
                    font: `400 12px/17px ${T.font}`, border: `1px solid ${T.stroke2}`,
                    borderRadius: RADIUS.sm, contain: 'content',
                  }}
                />
                {preview.unresolved.length > 0 && (
                  <span style={{ flex: '0 0 auto', fontSize: '12px', color: T.warnFg, background: T.warnBg2, border: `1px solid ${T.warnStroke}`, borderRadius: RADIUS.sm, padding: '3px 6px' }}>
                    {preview.unresolved.length === 1 ? '1 placeholder' : `${preview.unresolved.length} placeholders`} can&apos;t be filled: {preview.unresolved.join(', ')}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
