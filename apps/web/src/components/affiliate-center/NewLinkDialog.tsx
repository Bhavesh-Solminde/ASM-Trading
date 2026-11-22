"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/Icon";
import { LINK_KIND_LABELS } from "./presentation";
import styles from "./center.module.css";

export function NewLinkDialog() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function createLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const kind = values.get("kind");
    const comment = String(values.get("comment") ?? "").trim();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/program/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...(comment ? { comment } : {}) }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        setError(data?.error ?? "Couldn’t create this link. Try again.");
        return;
      }
      dialog.current?.close();
      form.reset();
      setNotice("Link created.");
      router.refresh();
    } catch {
      setError("Couldn’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {notice ? <span role="status" className="text-sm text-up">{notice}</span> : null}
        <button type="button" className={styles.primary} onClick={() => { setError(""); setNotice(""); dialog.current?.showModal(); }}>
          <Icon name="plus" className="size-4" />New link
        </button>
      </div>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby="new-affiliate-link"
        onCancel={(event) => { if (busy) event.preventDefault(); }}
        onClick={(event) => { if (!busy && event.target === event.currentTarget) dialog.current?.close(); }}>
        <div className={styles.popoverHeading}>
          <h2 id="new-affiliate-link">New link</h2>
          <button type="button" className={styles.iconButton} aria-label="Close new link" disabled={busy} onClick={() => dialog.current?.close()}>
            <Icon name="close" />
          </button>
        </div>
        <form className={styles.dialogForm} onSubmit={(event) => void createLink(event)}>
          <div className="grid gap-1">
            <label htmlFor="affiliate-link-kind">Type</label>
            <select id="affiliate-link-kind" name="kind" required className={styles.field} defaultValue="REGISTER">
              {Object.entries(LINK_KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
            </select>
          </div>
          <label>Comment (optional)
            <input name="comment" type="text" className={styles.field} maxLength={200} placeholder="Where you’ll share this link" />
          </label>
          {error ? <p role="alert" className="text-sm text-down">{error}</p> : null}
          <div className={styles.dialogActions}>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="submit" className={styles.primary} disabled={busy}>{busy ? "Creating…" : "Create link"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
