"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { LogoWordmark } from "@/components/brand/Logo";
import { inr } from "./numbers";
import styles from "./affiliate.module.css";

export function InviteJourney({ bonus, minimumDeposit, minimumTrade }: { bonus: number; minimumDeposit: number; minimumTrade: number }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();
    mm.add({ desktop: "(min-width: 1024px) and (min-height: 740px)", mobile: "(max-width: 1023px), (max-height: 739px)", reduce: "(prefers-reduced-motion: reduce)" }, (ctx) => {
      if (ctx.conditions?.reduce) return;
      const select = gsap.utils.selector(el);
      const desktop = ctx.conditions?.desktop;
      if (!desktop) {
        const phone = el.querySelector("[data-phone]");
        const mobileTimeline = gsap.timeline({scrollTrigger: {trigger: phone, start: "top 65%", once: true}});
        mobileTimeline.from(select("[data-bonus]"), {scale: 0.9, opacity: 0.6, duration: 0.7})
          .from(select("[data-qualified]"), {x: -12, opacity: 0.5, stagger: 0.65, duration: 0.6}, "+=0.4")
          .from(select("[data-success]"), {y: 8, scale: 0.96, opacity: 0.5, duration: 0.5});
        gsap.from(select("[data-wallet]"), {y: 24, opacity: 0.6, duration: 0.8, scrollTrigger: {trigger: el.querySelector("[data-wallet]"), start: "top 85%", once: true}});
        let resume = false;
        const visibility = () => {
          if (document.hidden) {resume = mobileTimeline.isActive(); mobileTimeline.pause();}
          else if (resume) mobileTimeline.resume();
        };
        document.addEventListener("visibilitychange", visibility);
        return () => document.removeEventListener("visibilitychange", visibility);
      }
      const timeline = gsap.timeline({ defaults: { ease: "power2.out", duration: 0.75 }, scrollTrigger: {
        trigger: el, start: "top 92px", end: "+=1100",
        pin: true, scrub: true, anticipatePin: 1, invalidateOnRefresh: true,
      } });
      timeline.from(select("[data-beat='1']"), { y: 24, opacity: 0.4 }, 0)
        .from(select("[data-copied]"), { scale: 0.75, opacity: 0.2 }, 0.4)
        .from(select("[data-line='1']"), { scaleX: 0, transformOrigin: "left" }, 0.8)
        .from(select("[data-beat='2']"), { y: 24, opacity: 0.4 }, 1.2)
        .from(select("[data-phone]"), { y: 32, rotation: -4, opacity: 0.35 }, 1.2)
        .from(select("[data-beat='3']"), { y: 24, opacity: 0.4 }, 2.5)
        .from(select("[data-bonus]"), { scale: 0.7, opacity: 0.25, ease: "back.out(1.4)" }, 2.5)
        .from(select("[data-qualified]"), { x: -14, opacity: 0.3, stagger: 0.45 }, 3)
        .from(select("[data-success]"), { y: 8, scale: 0.96, opacity: 0.5 }, 3.7)
        .from(select("[data-line='2']"), { scaleX: 0, transformOrigin: "left" }, 4.2)
        .from(select("[data-beat='4']"), { y: 24, opacity: 0.4 }, 4.5)
        .from(select("[data-wallet]"), { scale: 0.9, y: 24, opacity: 0.4 }, 4.5)
        .from(select("[data-reward]"), { y: 14, opacity: 0.2, stagger: 0.2 }, 5);
      if (desktop) {
        const position = (target: string) => {
          const rect = el.querySelector(target)!.getBoundingClientRect();
          const stage = el.querySelector("[data-stage]")!.getBoundingClientRect();
          return { x: rect.left - stage.left + rect.width / 2 - 20, y: rect.top - stage.top + rect.height / 2 - 20 };
        };
        const packet = select("[data-packet]");
        timeline.fromTo(packet, { x: () => position("[data-source]").x, y: () => position("[data-source]").y, opacity: 0 }, { opacity: 1, duration: 0.15 }, 0.8)
          .to(packet, { x: () => position("[data-phone]").x, y: () => position("[data-phone]").y, duration: 1 }, 1)
          .to(packet, { opacity: 0, duration: 0.2 }, 2)
          .set(packet, { x: () => position("[data-phone]").x, y: () => position("[data-phone]").y }, 4)
          .to(packet, { opacity: 1, duration: 0.15 }, 4)
          .to(packet, { x: () => position("[data-wallet]").x, y: () => position("[data-wallet]").y, duration: 1 }, 4.1)
          .to(packet, { opacity: 0, duration: 0.2 }, 5.1);
      }
      timeline.to({}, {duration: 0.7});
    }, el);
    return () => mm.revert();
  }, []);
  return (
    <div ref={root} className={styles.journey}>
      <div className={styles.journeyScene} data-stage>
        <div className={styles.journeySource} data-source>
          <span className={styles.eyebrow}>01 / Your invitation</span><div className="mt-6 text-3xl text-brand" aria-hidden="true">↗</div><h3 className="mt-3 text-xl font-bold">A link worth sharing.</h3>
          <div className="mt-5 rounded-xl border border-rule bg-ground p-3 text-xs text-ink-2">indianxtrade.com/invite/<span className="text-ink">YOU</span></div>
          <p data-copied className="mt-4 text-sm font-semibold text-up"><span aria-hidden="true">✓ </span>Invitation link copied</p>
        </div>
        <div data-line="1" aria-hidden="true" className={styles.journeyLine} />
        <div className={styles.friendPhone} data-phone>
          <div className={styles.notch} aria-hidden="true" /><div className="flex justify-between text-[10px] text-ink-2"><span>9:41</span><span>● ▰</span></div>
          <div className={styles.phoneBrand}><LogoWordmark className="h-4" /><span>INVITATION</span></div>
          <div className={styles.phoneSender}><span aria-hidden="true">↗</span><div><strong>A friend invited you</strong><small>Your next chapter starts here</small></div></div>
          <p className={styles.phoneStep}>02 / YOUR INVITATION</p>
          <h3 className={styles.phoneTitle}>A bigger<br />first move.</h3>
          <div data-bonus className={styles.phoneBonus}><span className={styles.phoneBonusLabel}>YOUR FIRST-DEPOSIT BONUS</span>+{bonus}%<span>More to start with. Shared by a friend.</span></div>
          <div className={styles.phoneActions}>
            <p className={styles.phoneStep}>03 / MAKE IT COUNT</p>
            <div data-qualified className={styles.phoneAction}><span aria-hidden="true">↓</span><div><strong>Make your first deposit</strong><small>From {inr(minimumDeposit)}</small></div><b aria-hidden="true">✓</b></div>
            <div data-qualified className={styles.phoneAction}><span aria-hidden="true">↗</span><div><strong>Complete a real-money trade</strong><small>From {inr(minimumTrade)} of your own money</small></div><b aria-hidden="true">✓</b></div>
          </div>
          <p data-success className={styles.phoneSuccess}><span aria-hidden="true">✓</span> You’re qualified. They’re rewarded.</p>
          <div aria-hidden="true" className="mx-auto mt-5 h-1 w-16 rounded-full bg-ink-2/40" />
        </div>
        <div data-line="2" aria-hidden="true" className={styles.journeyLine} />
        <div className={styles.journeyWallet} data-wallet><span className={styles.eyebrow}>04 / Your affiliate wallet</span><div className="mt-6 text-3xl text-brand" aria-hidden="true">↓</div><h3 className="mt-3 text-xl font-bold">Your invitation.<br />Your earnings.</h3><p data-reward className="mt-5 rounded-xl border border-brand/25 bg-brand/10 p-3 text-sm font-bold">+ First-deposit reward</p><p data-reward className="mt-3 text-sm text-ink-2">+ Revenue Share from eligible trading</p><p className="mt-5 text-xs text-ink-2">Tracked in your Program Earnings.</p></div>
        <span data-packet aria-hidden="true" className={styles.packet}>↗</span>
      </div>
      <ol className={styles.journeyBeats}>{[
        ["Copy your link", "From your affiliate dashboard."], ["Invite a friend", "They sign up through your invitation."], ["They deposit & trade", "Both qualifying actions unlock the reward."], ["You earn", "Deposit rewards plus eligible Revenue Share."],
      ].map(([title, body], i) => <li key={title} data-beat={i + 1}><span aria-hidden="true">0{i + 1}</span><div><h3>{title}</h3><p>{body}</p></div></li>)}</ol>
    </div>
  );
}
