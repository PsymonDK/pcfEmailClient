/**
 * "Open in email form" — the escape hatch to the standard email form (2026-09-29).
 *
 * For anything the client does not show: Bcc (issue #11), activity details, the platform's own
 * commands. It opens as a DIALOG over the case (`navigateTo`, target 2), deliberately not
 * `openForm`: navigating the tab away would tear the control down, and with it any open compose.
 *
 * Like `lookupObjects`, this lives on `window.Xrm`, not on the PCF context — resolved at call
 * time and absent outside a model-driven host, where the menu item is simply not offered.
 */
export interface XrmNavigation {
  navigateTo(pageInput: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export function resolveXrmNavigation(): XrmNavigation | undefined {
  if (typeof window === 'undefined') return undefined;
  const xrm = (window as unknown as Record<string, unknown>).Xrm as
    | { Navigation?: { navigateTo?: unknown } }
    | undefined;
  return typeof xrm?.Navigation?.navigateTo === 'function' ? (xrm.Navigation as XrmNavigation) : undefined;
}

/** The page input and dialog options, separated so the shape is asserted rather than hoped for. */
export function emailDialog(emailId: string): {
  pageInput: Record<string, unknown>;
  options: Record<string, unknown>;
} {
  return {
    pageInput: { pageType: 'entityrecord', entityName: 'email', entityId: emailId },
    // 2 = dialog, 1 = centred. Large enough to read a long message without leaving the case.
    options: { target: 2, position: 1, width: { value: 80, unit: '%' }, height: { value: 85, unit: '%' } },
  };
}

/**
 * Resolves when the dialog closes — the caller reloads then, since the agent may have edited or
 * sent the email there. `false` when there is no host to open it in, or the host refused.
 */
export async function openEmailInForm(
  emailId: string,
  navigation: XrmNavigation | undefined = resolveXrmNavigation(),
): Promise<boolean> {
  if (!navigation) return false;
  const { pageInput, options } = emailDialog(emailId);
  try {
    await navigation.navigateTo(pageInput, options);
    return true;
  } catch {
    return false;
  }
}
