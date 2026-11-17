"use client";

import { useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const inr = (value: number) => `₹${rupees.format(value)}`;

/** Same progressive-enhancement pattern as marketing/Reveal, with scoped cleanup.
 * The home page CountUp starts at zero in SSR; these financial examples must render
 * their actual final values before hydration and when JavaScript is disabled. */
export function AnimatedNumber({ value, money = false, suffix = "", duration = 1.8 }: {
  value: number; money?: boolean; suffix?: string; duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef<number | null>(null);
  const completed = useRef(false);
  const label = `${money ? inr(value) : rupees.format(value)}${suffix}`;
  useEffect(() => {
    if (!ref.current) return;
    gsap.registerPlugin(ScrollTrigger);
    const el = ref.current;
    const last = previous.current;
    const initial = !completed.current;
    const mm = gsap.matchMedia();
    mm.add({ motion: "(prefers-reduced-motion: no-preference)", reduce: "(prefers-reduced-motion: reduce)" }, (ctx) => {
      if (ctx.conditions?.reduce) { el.textContent = label; previous.current = value; return; }
      const state = { n: last ?? 0 };
      gsap.to(state, {
        n: value, duration: initial ? duration : 0.55, ease: "power3.out",
        ...(initial ? { scrollTrigger: { trigger: el, start: "top 95%", once: true } } : {}),
        onStart: () => { el.textContent = `${money ? inr(state.n) : rupees.format(Math.floor(state.n))}${suffix}`; },
        onUpdate: () => { previous.current = state.n; el.textContent = `${money ? inr(Math.floor(state.n)) : rupees.format(Math.floor(state.n))}${suffix}`; },
        onComplete: () => { previous.current = value; completed.current = true; el.textContent = label; },
      });
    });
    return () => { mm.revert(); el.textContent = label; };
  }, [value, money, suffix, label, duration]);
  return <><span ref={ref} aria-hidden="true">{label}</span><span className="sr-only">{label}</span></>;
}

export function AffiliateMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current) return;
    gsap.registerPlugin(ScrollTrigger);
    const el = root.current;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from(el.querySelectorAll("[data-hero-enter]"), { y: 30, opacity: 0.35, duration: 1.15, stagger: 0.13, ease: "power3.out", clearProps: "all" });
      el.querySelectorAll<HTMLElement>("[data-reveal]").forEach((section) => {
        if (section.getBoundingClientRect().top < innerHeight) return;
        gsap.from(section, { y: 42, opacity: 0.25, duration: 0.9, ease: "power3.out", clearProps: "all",
          scrollTrigger: { trigger: section, start: "top 90%", once: true } });
      });
      el.querySelectorAll<HTMLElement>("[data-grow]").forEach((bar) => {
        gsap.from(bar, { scaleY: 0.05, transformOrigin: "bottom", duration: 1.2, ease: "power3.out",
          scrollTrigger: { trigger: bar, start: "top 95%", once: true } });
      });
      const floating = gsap.to(el.querySelectorAll("[data-float]"), { y: -12, rotation: (i) => i % 2 ? -2 : 2, duration: 3.2, stagger: 0.3, repeat: -1, yoyo: true, ease: "sine.inOut", paused: true });
      const glow = gsap.to(el.querySelectorAll("[data-glow]"), { scale: 1.08, opacity: 0.6, duration: 3, repeat: -1, yoyo: true, ease: "sine.inOut", paused: true });
      let heroVisible = false;
      const sync = () => { const play = heroVisible && !document.hidden; floating.paused(!play); glow.paused(!play); };
      const io = new IntersectionObserver(([entry]) => { heroVisible = !!entry?.isIntersecting; sync(); });
      const hero = el.querySelector("[data-hero]");
      if (hero) io.observe(hero);
      document.addEventListener("visibilitychange", sync);
      return () => { io.disconnect(); document.removeEventListener("visibilitychange", sync); };
    }, el);
    mm.add("(min-width: 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference)", () => {
      const card = el.querySelector<HTMLElement>("[data-tilt]");
      if (!card) return;
      const x = gsap.quickTo(card, "rotationY", { duration: 0.7, ease: "power3.out" });
      const y = gsap.quickTo(card, "rotationX", { duration: 0.7, ease: "power3.out" });
      const move = (event: PointerEvent) => { const rect = card.getBoundingClientRect(); x(((event.clientX - rect.left) / rect.width - 0.5) * 12); y(((event.clientY - rect.top) / rect.height - 0.5) * -12); };
      const reset = () => { x(0); y(0); };
      card.addEventListener("pointermove", move); card.addEventListener("pointerleave", reset); window.addEventListener("blur", reset);
      return () => { card.removeEventListener("pointermove", move); card.removeEventListener("pointerleave", reset); window.removeEventListener("blur", reset); };
    }, el);
    return () => mm.revert();
  }, []);
  return <div ref={root}>{children}</div>;
}
