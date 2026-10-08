"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { shrinkImage } from "@/lib/shrink-image";

type DocKind = "AADHAAR_FRONT" | "AADHAAR_BACK" | "PAN" | "SELFIE";

export type KycDetails = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  aadhaar: string;
  pan: string;
  address: string;
  country: string;
};

const STEPS = ["Details", "ID proof", "Selfie", "Submit"] as const;
const ID_DOCS: { kind: DocKind; label: string; hint: string }[] = [
  { kind: "AADHAAR_FRONT", label: "Aadhaar — front", hint: "Side with your photo and name" },
  { kind: "AADHAAR_BACK", label: "Aadhaar — back", hint: "Side with your address" },
  { kind: "PAN", label: "PAN card", hint: "Front side, all four corners visible" },
];

const FIELD =
  "mt-1 h-11 w-full rounded-lg border border-rule bg-tile px-3 text-sm outline-none focus:border-brand";
const LABEL = "text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-2";

function detailsProblem(d: KycDetails): string | null {
  if (!d.firstName.trim() || !d.lastName.trim()) return "Enter your first and last name as on your Aadhaar.";
  if (!d.dateOfBirth) return "Enter your date of birth.";
  const dob = new Date(d.dateOfBirth);
  const adult = new Date(dob.getFullYear() + 18, dob.getMonth(), dob.getDate()) <= new Date();
  if (!adult) return "You must be 18 or older to verify.";
  if (!/^[0-9]{12}$/.test(d.aadhaar.replace(/\s/g, ""))) return "Aadhaar number is 12 digits.";
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(d.pan.trim().toUpperCase())) return "PAN looks like ABCDE1234F.";
  if (!d.address.trim()) return "Enter your address.";
  if (!d.country.trim()) return "Enter your country.";
  return null;
}

/**
 * KYC in four short steps — details, Aadhaar + PAN photos, selfie, submit —
 * shown in place of a status card once submitted (in review) or verified.
 */
export function KycFlow({
  initialDetails,
  initialStatus,
  initialDocuments,
  reviewNote,
}: {
  initialDetails: KycDetails;
  initialStatus: string;
  initialDocuments: DocKind[];
  /** The admin's reason when the last submission was rejected. */
  reviewNote: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [details, setDetails] = useState(initialDetails);
  const [docs, setDocs] = useState<Set<DocKind>>(() => new Set(initialDocuments));
  const [detailsSaved, setDetailsSaved] = useState(() => detailsProblem(initialDetails) === null);
  const [step, setStep] = useState(() => {
    if (!detailsSaved) return 0;
    if (!ID_DOCS.every((d) => initialDocuments.includes(d.kind))) return 1;
    if (!initialDocuments.includes("SELFIE")) return 2;
    return 3;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  if (status === "VERIFIED") {
    return (
      <StatusCard tone="up" title="You're verified" body="Your identity is confirmed — withdrawals are enabled.">
        <Link href="/withdrawal" className="self-start rounded-lg bg-up px-5 py-2.5 text-sm font-bold text-up-ink phone:self-stretch phone:text-center">
          Go to withdrawal →
        </Link>
      </StatusCard>
    );
  }
  if (status === "PENDING") {
    return (
      <StatusCard
        tone="caution"
        title="Verification in review"
        body="We have your details and documents and are checking them, usually within 24 hours. Withdrawals unlock as soon as you're verified."
      >
        <Checklist rows={[["Personal details", true], ...ID_DOCS.map((d) => [d.label, true] as [string, boolean]), ["Selfie", true]]} />
      </StatusCard>
    );
  }

  async function saveDetails() {
    const problem = detailsProblem(details);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: details.firstName.trim(),
        lastName: details.lastName.trim(),
        dateOfBirth: details.dateOfBirth,
        aadhaar: details.aadhaar.replace(/\s/g, ""),
        pan: details.pan.trim().toUpperCase(),
        address: details.address.trim(),
        country: details.country.trim(),
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setDetailsSaved(true);
      return setStep(1);
    }
    const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setError(data?.error ?? "Could not save your details. Try again.");
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/kyc/submit", { method: "POST" }).catch(() => null);
    setBusy(false);
    if (res?.ok) return setStatus("PENDING");
    const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setError(data?.error ?? "Could not submit. Try again.");
  }

  const onUploaded = (kind: DocKind) => setDocs((prev) => new Set(prev).add(kind));
  const idDone = ID_DOCS.every((d) => docs.has(d.kind));
  const reachable = [true, detailsSaved, detailsSaved && idDone, detailsSaved && idDone && docs.has("SELFIE")];

  return (
    <div className="flex flex-col gap-5">
      {status === "REJECTED" ? (
        <div className="rounded-lg border border-down/40 bg-down/10 p-3 text-sm text-down">
          <p className="font-semibold">Your last verification wasn&apos;t approved.</p>
          {reviewNote ? <p className="mt-1">Reason: {reviewNote}</p> : null}
          <p className="mt-1 text-ink-2">Fix it below — replace any photo that needs it — and submit again.</p>
        </div>
      ) : null}

      <ol className="grid grid-cols-4 gap-1.5">
        {STEPS.map((label, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <li key={label}>
              <button
                type="button"
                disabled={!reachable[i] || busy}
                onClick={() => {
                  setError(null);
                  setStep(i);
                }}
                className={`w-full border-t-[3px] pt-1.5 text-left text-[11px] font-semibold uppercase tracking-wider disabled:cursor-default ${
                  active ? "border-up text-ink" : done ? "border-up/50 text-ink-2" : "border-rule text-ink-3"
                }`}
              >
                <span className="block text-[10px] text-ink-3">Step {i + 1}</span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>

      {step === 0 ? (
        <section className="flex flex-col gap-3">
          <StepTitle title="Your details" sub="Exactly as they appear on your Aadhaar and PAN card." />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="First name" value={details.firstName} autoComplete="given-name" onChange={(v) => setDetails({ ...details, firstName: v })} />
            <TextField label="Last name" value={details.lastName} autoComplete="family-name" onChange={(v) => setDetails({ ...details, lastName: v })} />
            <TextField label="Date of birth" type="date" value={details.dateOfBirth} autoComplete="bday" onChange={(v) => setDetails({ ...details, dateOfBirth: v })} />
            <TextField
              label="Aadhaar number"
              value={details.aadhaar}
              inputMode="numeric"
              placeholder="12 digits"
              maxLength={14}
              onChange={(v) => setDetails({ ...details, aadhaar: v.replace(/[^0-9 ]/g, "") })}
            />
            <TextField
              label="PAN number"
              value={details.pan}
              placeholder="ABCDE1234F"
              maxLength={10}
              onChange={(v) => setDetails({ ...details, pan: v.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
            />
            <TextField label="Country" value={details.country} autoComplete="country-name" onChange={(v) => setDetails({ ...details, country: v })} />
          </div>
          <TextField label="Address" value={details.address} autoComplete="street-address" placeholder="House, street, city, PIN code" onChange={(v) => setDetails({ ...details, address: v })} />
          <ErrorLine error={error} />
          <PrimaryButton busy={busy} onClick={() => void saveDetails()}>
            Save & continue
          </PrimaryButton>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="flex flex-col gap-3">
          <StepTitle title="ID proof" sub="Clear photos, no glare, all four corners in the frame." />
          {ID_DOCS.map((d) => (
            <UploadTile key={d.kind} kind={d.kind} label={d.label} hint={d.hint} uploaded={docs.has(d.kind)} onUploaded={onUploaded} />
          ))}
          <PrimaryButton disabled={!idDone} onClick={() => setStep(2)}>
            Continue
          </PrimaryButton>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="flex flex-col gap-3">
          <StepTitle title="Selfie" sub="Face the camera in good light — no cap, mask or sunglasses." />
          <UploadTile kind="SELFIE" label="Your selfie" hint="Opens your front camera" uploaded={docs.has("SELFIE")} onUploaded={onUploaded} selfie />
          <PrimaryButton disabled={!docs.has("SELFIE")} onClick={() => setStep(3)}>
            Continue
          </PrimaryButton>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="flex flex-col gap-3">
          <StepTitle title="Review & submit" sub="We'll check everything and verify your account, usually within 24 hours." />
          <Checklist
            rows={[
              ["Personal details", detailsProblem(details) === null],
              ...ID_DOCS.map((d) => [d.label, docs.has(d.kind)] as [string, boolean]),
              ["Selfie", docs.has("SELFIE")],
            ]}
          />
          <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none accent-[var(--color-up)]"
            />
            <span>These documents are mine and the details are correct.</span>
          </label>
          <ErrorLine error={error} />
          <PrimaryButton busy={busy} disabled={!confirmed} onClick={() => void submit()}>
            Submit for verification
          </PrimaryButton>
        </section>
      ) : null}
    </div>
  );
}

function UploadTile({
  kind,
  label,
  hint,
  uploaded,
  onUploaded,
  selfie = false,
}: {
  kind: DocKind;
  label: string;
  hint: string;
  uploaded: boolean;
  onUploaded: (kind: DocKind) => void;
  selfie?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const blob = await shrinkImage(file);
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", blob, blob === file ? file.name : `${kind.toLowerCase()}.jpg`);
    const res = await fetch("/api/account/kyc/documents", { method: "POST", body: form }).catch(() => null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (res?.ok) {
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
      onUploaded(kind);
      return;
    }
    const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setError(
      data?.error ??
        (res?.status === 413 ? "That photo is too large. Try a smaller one." : "Upload failed. Try again."),
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={`grid w-full grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${
          uploaded ? "border-up/50 bg-up/[0.06]" : "border-dashed border-rule bg-panel hover:border-tile-hi"
        }`}
      >
        <span className="grid size-14 place-items-center overflow-hidden rounded-md bg-tile text-ink-3">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img src={preview} alt="" className="size-full object-cover" />
          ) : (
            <CameraGlyph />
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{label}</span>
          <span className="block truncate text-[12px] text-ink-3">{busy ? "Uploading…" : hint}</span>
        </span>
        <span className={`text-[12px] font-bold ${uploaded ? "text-up" : "text-brand"}`}>
          {busy ? "…" : uploaded ? "✓ Replace" : selfie ? "Take photo" : "Upload"}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        {...(selfie ? { capture: "user" as const } : {})}
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <ErrorLine error={error} />
    </div>
  );
}

function StatusCard({
  tone,
  title,
  body,
  children,
}: {
  tone: "up" | "caution";
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  const toneCls = tone === "up" ? "border-up/40 bg-up/10 [&_h2]:text-up" : "border-caution/30 bg-caution/10 [&_h2]:text-caution";
  return (
    <section className={`flex flex-col gap-3 rounded-lg border p-4 ${toneCls}`}>
      <h2 className="text-base font-bold">{title}</h2>
      <p className="text-sm leading-relaxed text-ink-2">{body}</p>
      {children}
    </section>
  );
}

function Checklist({ rows }: { rows: [string, boolean][] }) {
  return (
    <ul className="grid gap-1.5 rounded-lg border border-rule bg-panel p-3">
      {rows.map(([label, ok]) => (
        <li key={label} className="flex items-center justify-between text-sm">
          <span>{label}</span>
          <span className={`text-[12px] font-bold ${ok ? "text-up" : "text-down"}`}>{ok ? "✓ Done" : "Missing"}</span>
        </li>
      ))}
    </ul>
  );
}

function StepTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-base font-bold">{title}</h2>
      <p className="text-[13px] text-ink-2">{sub}</p>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "numeric";
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={FIELD} {...rest} />
    </label>
  );
}

function PrimaryButton({
  busy = false,
  disabled = false,
  onClick,
  children,
}: {
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className="mt-1 h-12 rounded-lg bg-up text-sm font-black text-up-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {busy ? "Please wait…" : children}
    </button>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-1.5 text-xs text-down">
      {error}
    </p>
  ) : null;
}

function CameraGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
