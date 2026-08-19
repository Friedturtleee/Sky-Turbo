"use client";

import { AreaSeries, ColorType, createChart, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { PricePoint } from "@sky-turbo/core";

export function PriceChart({ points, height = 320, compact = false }: { points: PricePoint[]; height?: number; compact?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    let chart: IChartApi | undefined;
    const container = containerRef.current;
    chart = createChart(container, {
      height,
      width: container.clientWidth,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8f9298" },
      grid: {
        vertLines: { color: compact ? "transparent" : "#202226" },
        horzLines: { color: compact ? "transparent" : "#202226" },
      },
      rightPriceScale: { visible: !compact, borderColor: "#303238" },
      timeScale: { visible: !compact, borderColor: "#303238", timeVisible: true },
      crosshair: { vertLine: { color: "#676b73" }, horzLine: { color: "#676b73" } },
      handleScroll: !compact,
      handleScale: !compact,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: "#63d99a",
      topColor: "rgba(99, 217, 154, 0.24)",
      bottomColor: "rgba(99, 217, 154, 0.01)",
      lineWidth: 2,
      priceLineVisible: !compact,
      lastValueVisible: !compact,
    });
    series.setData(
      points
        .filter((point) => point.price > 0)
        .map((point) => ({ time: Math.floor(point.time / 1000) as UTCTimestamp, value: point.price })),
    );
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(() => chart?.applyOptions({ width: container.clientWidth }));
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart?.remove();
    };
  }, [compact, height, points]);
  return <div className="price-chart" ref={containerRef} />;
}
