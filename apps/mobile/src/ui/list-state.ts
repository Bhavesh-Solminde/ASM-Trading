export type ListStateKind = "loading" | "error" | "empty" | "none";

/** Which of ListState's four views applies: skeletons, the retry message, the empty text, or nothing (the list shows). */
export function listStateKind(input: { loading: boolean; error: boolean; empty?: string }): ListStateKind {
  if (input.loading) return "loading";
  if (input.error) return "error";
  return input.empty ? "empty" : "none";
}
