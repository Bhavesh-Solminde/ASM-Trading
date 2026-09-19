"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";

/** Section entrance: 8px translate + fade, once, when 20% into view.
 *  Skips animation entirely when prefers-reduced-motion is set. */
export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      gsap.set(ref.current, { opacity: 1, y: 0 });
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            gsap.to(ref.current, { opacity: 1, y: 0, duration: 0.6, delay, ease: "power2.out" });
            io.disconnect();
          }
        }
      },
      { threshold: 0.2 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [delay]);
  return (
    <div ref={ref} style={{ opacity: 0, transform: "translateY(8px)" }}>
      {children}
    </div>
  );
}

/** A number that tweens up to `to` when it scrolls into view. Used for stats.
 *  `decimals` picks the format — no function props, so this works when rendered
 *  from a Server Component. */
export function CountUp({
  to,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 1.6,
}: {
  to: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const fmt = (n: number) => `${prefix}${n.toFixed(decimals)}${suffix}`;
  const [text, setText] = useState(() => fmt(0));
  useEffect(() => {
    if (!ref.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setText(fmt(to));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const state = { n: 0 };
          gsap.to(state, {
            n: to,
            duration,
            ease: "power2.out",
            onUpdate: () => setText(fmt(state.n)),
          });
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, prefix, suffix, decimals, duration]);
  return <span ref={ref}>{text}</span>;
}
