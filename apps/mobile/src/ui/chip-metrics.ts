/** Minimum touch target (pt). */
export const MIN_TOUCH = 44;

/** Vertical hitSlop that lifts a pill shorter than 44pt up to a 44pt target. */
export function chipHitSlop(height: number): number {
  return Math.max(0, Math.ceil((MIN_TOUCH - height) / 2));
}

/**
 * Accessibility state of a chip. A radio also reports `checked` (TalkBack says "checked", not just "selected"); a button or tab
 * reports `selected` only.
 */
export function chipA11yState(role: "button" | "tab" | "radio", selected: boolean, disabled: boolean) {
  return role === "radio" ? { selected, checked: selected, disabled } : { selected, disabled };
}
