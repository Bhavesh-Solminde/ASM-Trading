/** The fixed sizes of the tab header row, shared by AppHeader, TopBar and the fit maths so they cannot drift. */
export interface HeaderMetrics {
  /** Left and right gutter of the row. */
  padX: number;
  /** Gap between the row's children. */
  gap: number;
  /** Width of the IXT mark. */
  mark: number;
  /** The square Deposit button. */
  deposit: number;
  /** Horizontal padding inside one Demo/Live pill. */
  pillPad: number;
}

export function headerMetrics(compact: boolean): HeaderMetrics {
  return { padX: compact ? 8 : 12, gap: compact ? 6 : 8, mark: compact ? 28 : 34, deposit: 40, pillPad: compact ? 8 : 11 };
}

/** The Demo/Live box around its pills: 2pt padding and a 1pt border on each side. */
export const SWITCH_CHROME = 6;
/** Demo/Live label size, and the smallest a pill can be (the 44pt touch target). */
export const PILL_FONT = 13;
export const PILL_MIN_WIDTH = 44;
