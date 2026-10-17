// ring.tsx — the ONLY module that imports chart.js.
//
// It is loaded on demand (see the lazy `Ring` in components.tsx): the chart
// chunk is ~138KB raw / ~48KB gzipped, and nothing on the page needs it to
// paint. Keeping the import here means Vite drops it out of the entry graph,
// so it is neither downloaded nor preloaded on first load — it arrives a
// moment later and the rings swap in.
import { Chart as ChartJS, ArcElement, Tooltip, type ChartOptions } from "chart.js";
import { useReducedMotion } from "framer-motion";
import { Doughnut } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip);

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  );
}

function doughnutOptions(cutout: string, reduce: boolean): ChartOptions<"doughnut"> {
  return {
    cutout,
    responsive: true,
    maintainAspectRatio: true,
    animation: reduce ? false : { duration: 800 },
    plugins: { legend: { display: false } },
  };
}

function doughnutData(percent: number, accent: string, track: string) {
  return {
    labels: ["Closed", "Open"],
    datasets: [
      {
        data: [percent, Math.max(0, 100 - percent)],
        backgroundColor: [accent, track],
        borderWidth: 0,
        hoverOffset: 0,
      },
    ],
  };
}

export default function Ring({ percent, cutout }: { percent: number; cutout: string }) {
  const reduce = useReducedMotion() ?? false;
  const accent = cssVar("--accent", "#1f6feb");
  const track = cssVar("--track", "#2a3441");
  return (
    <Doughnut
      data={doughnutData(percent, accent, track)}
      options={doughnutOptions(cutout, reduce)}
    />
  );
}
