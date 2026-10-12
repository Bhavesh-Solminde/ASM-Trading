"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export type CameraPhase = "starting" | "live" | "unavailable";
export type Facing = "user" | "environment";

/** True when this browser/context can open a live camera (needs https or localhost). */
export function cameraSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** A short, plain reason for the user from a getUserMedia failure. */
export function cameraFailureReason(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device.";
    case "NotReadableError":
    case "AbortError":
      return "The camera is in use by another app.";
    default:
      return "We couldn't start the camera.";
  }
}

/**
 * Opens the camera while `enabled` and attaches it to the returned video ref.
 * Every track is stopped when `enabled` flips off, `facing` changes or the
 * component unmounts, so the camera light never outlives the screen.
 */
export function useCamera(
  facing: Facing,
  enabled: boolean,
): { videoRef: RefObject<HTMLVideoElement | null>; phase: CameraPhase; reason: string | null } {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<{ phase: CameraPhase; reason: string | null }>({
    phase: "starting",
    reason: null,
  });

  useEffect(() => {
    if (!enabled) return;
    if (!cameraSupported()) {
      setState({ phase: "unavailable", reason: "This browser can't open the camera here." });
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    setState({ phase: "starting", reason: null });

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      })
      .then(async (s) => {
        const video = videoRef.current;
        if (cancelled || !video) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        video.srcObject = s;
        try {
          await video.play();
        } catch {
          // Autoplay can reject while muted playback still works; the stream is attached either way.
        }
        if (!cancelled) setState({ phase: "live", reason: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ phase: "unavailable", reason: cameraFailureReason(err) });
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [facing, enabled]);

  return { videoRef, ...state };
}

/** Grabs the current video frame as a JPEG (longest side capped at 1920px). Null if nothing to grab. */
export function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return Promise.resolve(null);
  const scale = Math.min(1, 1920 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
}
