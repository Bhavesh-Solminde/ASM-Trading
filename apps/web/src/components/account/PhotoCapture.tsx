"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/shell/Icon";
import { captureFrame, useCamera, type Facing } from "./use-camera";

export type CaptureGuide = "oval" | "card";

interface Shot {
  blob: Blob;
  url: string;
}

function Guide({ guide }: { guide: CaptureGuide }) {
  // The dashed shape is the framing aid; the huge shadow dims everything outside it.
  const shape =
    guide === "oval"
      ? "h-[72%] aspect-[7/9] rounded-[50%]"
      : "w-[88%] aspect-[1.586] rounded-2xl";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className={`${shape} border-[3px] border-dashed border-white/75 shadow-[0_0_0_999px_rgb(0_0_0/0.45)]`} />
    </div>
  );
}

/**
 * Live-camera capture for one photo: a framing guide over the viewfinder, a
 * 76px shutter, a review step (Retake / Use photo) and a gallery escape hatch.
 * When the camera can't open (unsupported, blocked, none found) it says why and
 * offers the system camera / gallery picker instead, so the photo can always be
 * supplied. Everything it produces leaves through `onFile` as a JPEG `File`,
 * the same shape the plain file input hands over.
 */
export function PhotoCapture({
  fileBase,
  facing,
  guide,
  hint,
  tips,
  busy,
  error,
  onFile,
}: {
  /** File name stem, e.g. "selfie". */
  fileBase: string;
  facing: Facing;
  guide: CaptureGuide;
  /** One line shown on the viewfinder. */
  hint: string;
  tips: string[];
  busy: boolean;
  error: string | null;
  onFile: (file: File) => void;
}) {
  const [shot, setShot] = useState<Shot | null>(null);
  const { videoRef, phase, reason } = useCamera(facing, shot === null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const nativeRef = useRef<HTMLInputElement | null>(null);
  const shotUrl = shot?.url;

  // Free the preview object URL when it is replaced or the component goes away.
  useEffect(
    () => () => {
      if (shotUrl) URL.revokeObjectURL(shotUrl);
    },
    [shotUrl],
  );

  async function take() {
    const video = videoRef.current;
    if (!video) return;
    const blob = await captureFrame(video);
    if (blob) setShot({ blob, url: URL.createObjectURL(blob) });
  }

  function use() {
    if (!shot) return;
    onFile(new File([shot.blob], `${fileBase}.jpg`, { type: "image/jpeg" }));
  }

  function picked(file: File | undefined, input: HTMLInputElement | null) {
    if (file) onFile(file);
    if (input) input.value = "";
  }

  const mirrored = facing === "user";
  const reviewing = shot !== null;

  return (
    <div className="grid gap-4">
      <div className="relative mx-auto h-[min(52dvh,380px)] w-full overflow-hidden rounded-3xl bg-panel">
        {reviewing ? (
          <img src={shot.url} alt="Your photo, ready to use" className="size-full object-cover" />
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            aria-label="Camera preview"
            className={`size-full object-cover ${mirrored ? "[transform:scaleX(-1)]" : ""} ${phase === "live" ? "" : "invisible"}`}
          />
        )}

        {!reviewing && phase === "live" ? <Guide guide={guide} /> : null}

        {!reviewing && phase === "starting" ? (
          <p role="status" className="absolute inset-0 grid place-items-center text-sm text-ink-2">
            Starting camera…
          </p>
        ) : null}

        {!reviewing && phase === "unavailable" ? (
          <div className="absolute inset-0 grid place-content-center justify-items-center gap-3 px-6 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-tile text-ink-2">
              <Icon name="camera" className="size-6" />
            </span>
            <p role="status" className="text-sm font-semibold">
              {reason}
            </p>
            <p className="text-xs text-ink-2">Use your phone&apos;s camera or pick a photo instead.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => nativeRef.current?.click()}
                disabled={busy}
                className="h-11 rounded-xl bg-brand-fill px-4 text-sm font-bold text-white hover:bg-brand-fill-hi disabled:opacity-60"
              >
                Take photo
              </button>
              <button
                type="button"
                onClick={() => galleryRef.current?.click()}
                disabled={busy}
                className="h-11 rounded-xl bg-tile px-4 text-sm font-bold text-ink hover:bg-tile-hi disabled:opacity-60"
              >
                Choose a photo
              </button>
            </div>
          </div>
        ) : null}

        {!reviewing && phase === "live" ? (
          <p className="absolute inset-x-0 bottom-3.5 flex justify-center">
            <span className="rounded-full bg-black/60 px-3 py-1.5 text-[13px] text-ink">{hint}</span>
          </p>
        ) : null}
      </div>

      {!reviewing && phase !== "unavailable" ? (
        <ul className="grid gap-2 px-1 text-[13px] text-ink-2">
          {tips.map((tip) => (
            <li key={tip} className="flex items-center gap-2">
              <Icon name="check" className="size-4 text-up" strokeWidth={2.6} />
              {tip}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="text-center text-xs text-down">
          {error}
        </p>
      ) : null}

      {reviewing ? (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setShot(null)}
            disabled={busy}
            className="h-12 rounded-xl bg-tile text-[15px] font-semibold text-ink hover:bg-tile-hi disabled:opacity-60"
          >
            Retake
          </button>
          <button
            type="button"
            onClick={use}
            disabled={busy}
            className="h-12 rounded-xl bg-brand-fill text-[15px] font-bold text-white hover:bg-brand-fill-hi disabled:opacity-60"
          >
            {busy ? "Uploading…" : "Use photo"}
          </button>
        </div>
      ) : phase !== "unavailable" ? (
        <div className="grid justify-items-center gap-2.5">
          <button
            type="button"
            aria-label="Take photo"
            onClick={() => void take()}
            disabled={phase !== "live" || busy}
            className="size-[76px] rounded-full border-4 border-ink/35 bg-ink shadow-[inset_0_0_0_4px_var(--color-ground)] transition-transform active:scale-95 disabled:opacity-40 motion-reduce:transition-none"
          />
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            disabled={busy}
            className="h-11 rounded-xl px-3.5 text-sm font-bold text-brand hover:bg-tile disabled:opacity-60"
          >
            {busy ? "Uploading…" : "Upload from gallery instead"}
          </button>
        </div>
      ) : null}

      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => picked(e.target.files?.[0], e.target)}
      />
      <input
        ref={nativeRef}
        type="file"
        accept="image/*"
        capture={facing}
        className="hidden"
        onChange={(e) => picked(e.target.files?.[0], e.target)}
      />
    </div>
  );
}

/**
 * Full-screen layer around a PhotoCapture, used for the Aadhaar / PAN photos
 * (three on one step). Escape and the close button dismiss it; Tab stays
 * inside and focus returns to whatever opened it.
 */
export function CaptureDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      opener?.focus?.();
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ground">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="mx-auto flex min-h-full w-full max-w-md flex-col px-4 pb-6 pt-2.5"
      >
        <div className="flex items-center gap-2 pb-3">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close camera"
            className="grid size-11 place-items-center rounded-xl text-ink hover:bg-tile"
          >
            <Icon name="close" className="size-5" strokeWidth={2.2} />
          </button>
          <h2 id={titleId} className="text-base font-bold">
            {title}
          </h2>
        </div>
        {children}
      </div>
    </div>
  );
}
