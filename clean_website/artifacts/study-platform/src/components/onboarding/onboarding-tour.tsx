import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n";
import { TOUR_STEPS, ONBOARDING_STORAGE_KEY } from "./tour-steps";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const measure = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

// First-run guided tour. Targets are plain DOM elements tagged with
// `data-tour="..."` elsewhere in the app (sidebar-layout.tsx, dashboard.tsx)
// -- looked up by selector rather than ref so the tour stays decoupled from
// those components. Positioning rides on Radix Popover's virtualRef anchor
// (no driver.js/react-joyride needed), which already resolves RTL flips via
// the surrounding `dir="rtl"` context.
export const OnboardingTour: React.FC = () => {
  const { isRTL } = useLanguage();
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [done, setDone] = useState(true);
  const targetElRef = useRef<HTMLElement | null>(null);
  const virtualRef = useRef({
    getBoundingClientRect: () =>
      targetElRef.current?.getBoundingClientRect() ?? new DOMRect(),
  });

  useEffect(() => {
    if (localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "1") setDone(false);
  }, []);

  const finish = useCallback(() => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
    setDone(true);
  }, []);

  // Locate the current step's target, skipping any step whose element isn't
  // rendered (e.g. "daily-review" for a brand-new user with no cards due).
  useEffect(() => {
    if (done) return;
    let index = stepIndex;
    let el: HTMLElement | null = null;
    while (index < TOUR_STEPS.length) {
      el = document.querySelector<HTMLElement>(`[data-tour="${TOUR_STEPS[index].target}"]`);
      if (el) break;
      index++;
    }
    if (!el) {
      finish();
      return;
    }
    if (index !== stepIndex) {
      setStepIndex(index);
      return;
    }
    targetElRef.current = el;
    setRect(measure(el));
  }, [done, stepIndex, finish]);

  useEffect(() => {
    if (done) return;
    const onUpdate = () => {
      if (targetElRef.current) setRect(measure(targetElRef.current));
    };
    window.addEventListener("resize", onUpdate);
    window.addEventListener("scroll", onUpdate, true);
    return () => {
      window.removeEventListener("resize", onUpdate);
      window.removeEventListener("scroll", onUpdate, true);
    };
  }, [done]);

  const next = () => {
    if (stepIndex + 1 >= TOUR_STEPS.length) finish();
    else setStepIndex((i) => i + 1);
  };

  if (done || !rect) return null;

  const step = TOUR_STEPS[stepIndex];
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  return createPortal(
    <>
      {/* Plain alpha dim layer -- no mix-blend-mode, see background-glow.tsx */}
      <div className="fixed inset-0 z-[100] bg-black/50 pointer-events-none" />

      <motion.div
        key={step.target}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed z-[101] rounded-xl ring-2 ring-primary animate-glow-pulse pointer-events-none"
        style={{
          top: rect.top - 6,
          left: rect.left - 6,
          width: rect.width + 12,
          height: rect.height + 12,
        }}
      />

      <Popover key={stepIndex} open dir={isRTL ? "rtl" : "ltr"}>
        <PopoverAnchor virtualRef={virtualRef} />
        <PopoverContent
          side={step.side}
          align="center"
          sideOffset={14}
          className="z-[102] w-72 space-y-3"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={stepIndex}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="space-y-2"
            >
              <p className="font-bold text-sm">{step.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{step.body}</p>
            </motion.div>
          </AnimatePresence>
          <div className="flex items-center justify-between pt-1">
            <button onClick={finish} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
              {isRTL ? "דלג" : "Skip"}
            </button>
            <Button size="sm" onClick={next}>
              {isLast ? (isRTL ? "סיימתי" : "Done") : isRTL ? "הבא" : "Next"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground text-center">
            {stepIndex + 1} / {TOUR_STEPS.length}
          </p>
        </PopoverContent>
      </Popover>
    </>,
    document.body
  );
};
