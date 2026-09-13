export interface ActivityEntry {
  id: number;
  at: number;
  sender: string;
  ok: boolean;
  detail: string;
}

const MAX_ENTRIES = 20;

let entries: ActivityEntry[] = [];
let nextId = 1;

export function logActivity(sender: string, ok: boolean, detail: string): void {
  entries = [{ id: nextId++, at: Date.now(), sender, ok, detail }, ...entries].slice(
    0,
    MAX_ENTRIES,
  );
}

export function getActivity(): ActivityEntry[] {
  return entries;
}
