"use client";

import { ColorType, createChart, LineSeries, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { SkyblockIndexPoint } from "@sky-turbo/core";

export function SkyblockIndexChart({ points }: { points: SkyblockIndexPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const chart: IChartApi = createChart(container, {
      height: 300,
      width: container.clientWidth,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8f9298" },
      grid: { vertLines: { color: "#202226" }, horzLines: { color: "#202226" } },
      rightPriceScale: { borderColor: "#303238" },
      timeScale: { borderColor: "#303238", timeVisible: true, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { vertLine: { color: "#676b73" }, horzLine: { color: "#676b73" } },
    });
    const series = chart.addSeries(LineSeries, {
      color: "#63d99a", lineWidth: 2, priceLineVisible: true, lastValueVisible: true,
    });
    series.setData(points.map((point) => ({
      time: Math.floor(point.time / 1000) as UTCTimestamp,
      value: point.value,
    })));
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }));
    observer.observe(container);
    return () => { observer.disconnect(); chart.remove(); };
  }, [points]);
  return <div className="skyblock-index-chart" ref={containerRef} />;
}
