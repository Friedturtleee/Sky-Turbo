"use client";

import { ColorType, createChart, LineSeries, type IChartApi, type UTCTimestamp } from "lightweight-charts";
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
    const buySeries = chart.addSeries(LineSeries, {
      color: "#63e69a",
      lineWidth: 2,
      priceLineVisible: !compact,
      lastValueVisible: !compact,
    });
    const sellSeries = chart.addSeries(LineSeries, {
      color: "#ff737d",
      lineWidth: 2,
      priceLineVisible: !compact,
      lastValueVisible: !compact,
    });
    const hasBuyOrderHistory = points.some((point) => (point.buyOrderPrice ?? 0) > 0);
    const hasSellOrderHistory = points.some((point) => (point.sellOrderPrice ?? 0) > 0);
    buySeries.setData(points.flatMap((point) => {
      const value = hasBuyOrderHistory ? point.buyOrderPrice : point.price;
      return value && value > 0
        ? [{ time: Math.floor(point.time / 1000) as UTCTimestamp, value }]
        : [];
    }));
    sellSeries.setData(points.flatMap((point) => {
      const value = hasSellOrderHistory ? point.sellOrderPrice : point.price;
      return value && value > 0
        ? [{ time: Math.floor(point.time / 1000) as UTCTimestamp, value }]
        : [];
    }));
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(() => chart?.applyOptions({ width: container.clientWidth }));
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart?.remove();
    };
  }, [compact, height, points]);
  return <div className={`price-chart${compact ? " compact" : ""}`}>
    <div className="price-chart-canvas" ref={containerRef} />
    <div className="price-chart-legend" aria-label="圖表圖例">
      <span><i className="buy" />Buy Order</span>
      <span><i className="sell" />Sell Order</span>
    </div>
  </div>;
}
