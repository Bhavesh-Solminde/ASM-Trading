"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { shrinkImage } from "@/lib/shrink-image";
import { Icon } from "@/components/shell/Icon";
import { CaptureDialog, PhotoCapture } from "@/components/account/PhotoCapture";
import { cameraSupported } from "@/components/account/use-camera";

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
const STEP_COPY: { title: string; sub: string }[] = [
  {
    title: "Your details",
    sub: "Exactly as they appear on your Aadhaar and PAN card. Required once before your first withdrawal; it takes about 2 minutes.",
  },
  { title: "ID proof", sub: "Clear photos, no glare, all four corners in the frame." },
  { title: "Take a selfie", sub: "We match it to your Aadhaar and PAN photos. It's only used for verification." },
  { title: "Review & submit", sub: "We'll check everything and verify your account, usually within 24 hours." },
];
const ID_DOCS: { kind: DocKind; label: string; hint: string }[] = [
  { kind: "AADHAAR_FRONT", label: "Aadhaar — front", hint: "Side with your photo and name" },
  { kind: "AADHAAR_BACK", label: "Aadhaar — back", hint: "Side with your address" },
  { kind: "PAN", label: "PAN card", hint: "Front side, all four corners visible" },
];

const FIELD =
  "mt-1 h-11 w-full rounded-lg border border-rule bg-tile px-3 text-sm outline-none focus:border-brand";
const LABEL = "legend";

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
        <Link
          href="/withdrawal"
          className="inline-flex h-12 items-center justify-center gap-1.5 self-start rounded-xl bg-brand-fill px-5 text-sm font-bold text-white hover:bg-brand-fill-hi phone:self-stretch"
        >
          Go to withdrawal
          <Icon name="chevron" className="size-4" strokeWidth={2.4} />
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
        <div className="rounded-xl border border-down/40 bg-down/10 p-3 text-sm text-down">
          <p className="font-semibold">Your last verification wasn&apos;t approved.</p>
          {reviewNote ? <p className="mt-1">Reason: {reviewNote}</p> : null}
          <p className="mt-1 text-ink-2">Fix it below — replace any photo that needs it — and submit again.</p>
        </div>
      ) : null}

      <nav aria-label="Verification progress" className="grid gap-2.5">
        <p className="flex items-baseline justify-between text-[13px]">
          <span className="font-semibold text-ink">{STEPS[step]}</span>
          <span className="text-ink-2">
            {step + 1} of {STEPS.length}
          </span>
        </p>
        <ol className="grid grid-cols-4 gap-1.5">
          {STEPS.map((label, i) => {
            const reached = i <= step;
            return (
              <li key={label}>
                <button
                  type="button"
                  disabled={!reachable[i] || busy}
                  aria-label={`Step ${i + 1}: ${label}`}
                  aria-current={i === step ? "step" : undefined}
                  onClick={() => {
                    setError(null);
                    setStep(i);
                  }}
                  className="relative block h-1 w-full rounded-full after:absolute after:-inset-y-3 after:inset-x-0 after:content-[''] disabled:cursor-default"
                >
                  <span
                    className={`absolute inset-0 rounded-full transition-colors motion-reduce:transition-none ${
                      reached ? "bg-brand" : "bg-tile-hi"
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <StepTitle title={STEP_COPY[step]!.title} sub={STEP_COPY[step]!.sub} />

      {step === 0 ? (
        <section className="flex flex-col gap-3">
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
          {ID_DOCS.map((d) => (
            <DocTile key={d.kind} doc={d} uploaded={docs.has(d.kind)} onUploaded={onUploaded} />
          ))}
          <PrimaryButton disabled={!idDone} onClick={() => setStep(2)}>
            Continue
          </PrimaryButton>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="flex flex-col gap-3">
          <SelfieStep uploaded={docs.has("SELFIE")} onUploaded={onUploaded} />
          <PrimaryButton disabled={!docs.has("SELFIE")} onClick={() => setStep(3)}>
            Continue
          </PrimaryButton>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="flex flex-col gap-3">
          <Checklist
            rows={[
              ["Personal details", detailsProblem(details) === null],
              ...ID_DOCS.map((d) => [d.label, docs.has(d.kind)] as [string, boolean]),
              ["Selfie", docs.has("SELFIE")],
            ]}
          />
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 size-5 flex-none accent-[var(--color-brand-fill)]"
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

/**
 * Uploads one KYC photo. The picked or captured file is compressed under the
 * proxy's body limit (`shrinkImage`) and POSTed to /api/account/kyc/documents,
 * exactly as the plain file input always did; the camera is just another
 * source of that File.
 */
function usePhotoUpload(kind: DocKind, onUploaded: (kind: DocKind) => void) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined): Promise<boolean> {
    if (!file) return false;
    setBusy(true);
    setError(null);
    const blob = await shrinkImage(file);
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", blob, blob === file ? file.name : `${kind.toLowerCase()}.jpg`);
    const res = await fetch("/api/account/kyc/documents", { method: "POST", body: form }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
      onUploaded(kind);
      return true;
    }
    const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setError(
      data?.error ??
        (res?.status === 413 ? "That photo is too large. Try a smaller one." : "Upload failed. Try again."),
    );
    return false;
  }

  return { preview, busy, error, upload };
}

/** One Aadhaar / PAN photo: a tile that opens the card-framing camera. */
function DocTile({
  doc,
  uploaded,
  onUploaded,
}: {
  doc: { kind: DocKind; label: string; hint: string };
  uploaded: boolean;
  onUploaded: (kind: DocKind) => void;
}) {
  const { preview, busy, error, upload } = usePhotoUpload(doc.kind, onUploaded);
  const [open, setOpen] = useState(false);
  const nativeRef = useRef<HTMLInputElement | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function start() {
    setNote(null);
    // No live camera in this browser/context: go straight to the system camera / picker.
    if (!cameraSupported()) {
      setNote("Live camera isn't available here, so we opened your camera app instead.");
      nativeRef.current?.click();
      return;
    }
    setOpen(true);
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={start}
        className={`grid min-h-[72px] w-full grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl p-2.5 text-left transition-colors ${
          uploaded ? "border border-up/40 bg-up/[0.07]" : "border border-dashed border-rule bg-panel hover:border-tile-hi"
        }`}
      >
        <span className="grid size-14 place-items-center overflow-hidden rounded-xl bg-tile text-ink-3">
          {preview ? (
            <img src={preview} alt="" className="size-full object-cover" />
          ) : (
            <Icon name="camera" className="size-6" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{doc.label}</span>
          <span className="block truncate text-xs text-ink-3">{busy ? "Uploading…" : doc.hint}</span>
        </span>
        <span className={`inline-flex items-center gap-1 pr-1 text-xs font-bold ${uploaded ? "text-up" : "text-brand"}`}>
          {uploaded ? <Icon name="check" className="size-3.5" strokeWidth={3} /> : null}
          {busy ? "…" : uploaded ? "Retake" : "Take photo"}
        </span>
      </button>
      {note ? <p className="mt-1.5 text-xs text-ink-2">{note}</p> : null}
      <ErrorLine error={open ? null : error} />
      <input
        ref={nativeRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void upload(file);
        }}
      />
      {open ? (
        <CaptureDialog title={doc.label} onClose={() => setOpen(false)}>
          <PhotoCapture
            fileBase={doc.kind.toLowerCase()}
            facing="environment"
            guide="card"
            hint="Fit the card inside the frame"
            tips={["All four corners visible", "No glare or shadows"]}
            busy={busy}
            error={error}
            onFile={(file) => void upload(file).then((ok) => ok && setOpen(false))}
          />
        </CaptureDialog>
      ) : null}
    </div>
  );
}

/**
 * The selfie step: the front camera sits right in the page with an oval guide
 * (nothing to tap first). Once a selfie is uploaded it collapses to a summary
 * with Retake.
 */
function SelfieStep({ uploaded, onUploaded }: { uploaded: boolean; onUploaded: (kind: DocKind) => void }) {
  const { preview, busy, error, upload } = usePhotoUpload("SELFIE", onUploaded);
  const [retaking, setRetaking] = useState(false);

  if (uploaded && !retaking) {
    return (
      <div className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-up/40 bg-up/[0.07] p-2.5">
        <span className="grid size-14 place-items-center overflow-hidden rounded-xl bg-tile text-ink-3">
          {preview ? (
            <img src={preview} alt="" className="size-full object-cover" />
          ) : (
            <Icon name="user" className="size-6" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Your selfie</span>
          <span className="block truncate text-xs text-ink-3">Uploaded</span>
        </span>
        <button
          type="button"
          onClick={() => setRetaking(true)}
          className="inline-flex h-11 items-center gap-1 rounded-xl px-3 text-xs font-bold text-up hover:bg-tile"
        >
          <Icon name="check" className="size-3.5" strokeWidth={3} />
          Retake
        </button>
      </div>
    );
  }

  return (
    <PhotoCapture
      fileBase="selfie"
      facing="user"
      guide="oval"
      hint="Hold still, face in the oval"
      tips={["Good light, face fills the oval", "No glasses, cap or mask"]}
      busy={busy}
      error={error}
      onFile={(file) => void upload(file).then((ok) => ok && setRetaking(false))}
    />
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
    <section className={`flex flex-col gap-3 rounded-2xl border p-4 ${toneCls}`}>
      <h2 className="text-base font-bold">{title}</h2>
      <p className="text-sm leading-relaxed text-ink-2">{body}</p>
      {children}
    </section>
  );
}

function Checklist({ rows }: { rows: [string, boolean][] }) {
  return (
    <ul className="grid divide-y divide-rule rounded-2xl bg-panel px-4">
      {rows.map(([label, ok]) => (
        <li key={label} className="flex min-h-12 items-center justify-between text-sm">
          <span>{label}</span>
          <span className={`inline-flex items-center gap-1 text-xs font-bold ${ok ? "text-up" : "text-down"}`}>
            {ok ? <Icon name="check" className="size-3.5" strokeWidth={3} /> : null}
            {ok ? "Done" : "Missing"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StepTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-[26px] font-extrabold leading-tight tracking-[-0.02em]">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{sub}</p>
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
      className="mt-1 h-12 rounded-xl bg-brand-fill text-[15px] font-bold text-white transition hover:bg-brand-fill-hi disabled:cursor-not-allowed disabled:opacity-45"
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
