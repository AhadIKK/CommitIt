/**
 * The one orchestrated moment.
 *
 * The product has a single idea worth animating: the track fills in *closing
 * order*, and a reopened task drags the line back. A still image cannot say
 * that — a static bar just reads as "some of it is done". So on load the fill
 * draws across to the last closed task and every node settles into place, in
 * one sequence, once.
 *
 * Rules this obeys:
 *  - one moment, not a fade-and-slide on every section and a hover on every row.
 *  - it runs once per session per goal, not on every re-render (useOncePerSession).
 *  - it never runs when prefers-reduced-motion is set; the CSS end state is
 *    already correct, so the page simply arrives finished.
 *  - everything is created inside useGSAP's context, so it reverts on unmount.
 */
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

function motionAllowed(): boolean {
  return (
    typeof window !== "undefined" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useTrackReveal(enabled: boolean) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!enabled || !motionAllowed()) return;
      const track = scope.current?.querySelector<HTMLElement>(".track");
      if (!track) return;

      const nodes = track.querySelectorAll<HTMLElement>(".track__node");
      const fill = track.querySelector<HTMLElement>(".track__fill");
      if (nodes.length === 0) return;

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      if (fill) {
        // start collapsed, then draw to the width the server already computed
        gsap.set(fill, { scaleX: 0, transformOrigin: "left center" });
        tl.to(fill, { scaleX: 1, duration: 0.9 }, 0);
      }

      tl.from(
        nodes,
        {
          opacity: 0,
          // the nodes arrive at the size they mean, from slightly under it
          scale: 0.72,
          duration: 0.5,
          stagger: { each: 0.045, from: "start" },
        },
        0.1,
      );

      // the rail draws itself before the nodes land on it
      const line = track.querySelector<HTMLElement>(".track__line");
      if (line) {
        gsap.set(line, { scaleX: 0, transformOrigin: "left center" });
        tl.to(line, { scaleX: 1, duration: 0.8 }, 0);
      }
    },
    { scope, dependencies: [enabled], revertOnUpdate: true },
  );

  return scope;
}
