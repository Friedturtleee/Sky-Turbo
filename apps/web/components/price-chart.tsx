"use client";

import { calculateRobustChartPriceRange, type ChartPriceRange, type PricePoint } from "@sky-turbo/core";
import { ColorType, createChart, LineSeries, type AutoscaleInfoProvider, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { useI18n } from "./i18n";

function createRobustAutoscaleProvider(range: ChartPriceRange | undefined): AutoscaleInfoProvider | undefined {
  if (!range) return undefined;
  return (original) => {
    const info = original();
    const visibleRange = info?.priceRange;
    if (!visibleRange) return info;

    // Keep zoomed-in periods outside the default band inspectable. If the
    // visible period overlaps the normal band, clip only its extreme tail.
    if (visibleRange.maxValue < range.minValue || visibleRange.minValue > range.maxValue) return info;
    const minValue = Math.max(visibleRange.minValue, range.minValue);
    const maxValue = Math.min(visibleRange.maxValue, range.maxValue);
    return minValue < maxValue ? { ...info, priceRange: { minValue, maxValue } } : info;
  };
}

export function PriceChart({ points, height = 320, compact = false }: { points: PricePoint[]; height?: number; compact?: boolean }) {
  const { t } = useI18n();
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
      timeScale: {
        visible: !compact,
        borderColor: "#303238",
        timeVisible: true,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: { vertLine: { color: "#676b73" }, horzLine: { color: "#676b73" } },
      handleScroll: !compact,
      handleScale: !compact,
    });
    const hasBuyOrderHistory = points.some((point) => (point.buyOrderPrice ?? 0) > 0);
    const hasSellOrderHistory = points.some((point) => (point.sellOrderPrice ?? 0) > 0);
    const buyData = points.flatMap((point) => {
      const value = hasBuyOrderHistory ? point.buyOrderPrice : point.price;
      return value && value > 0
        ? [{ time: Math.floor(point.time / 1000) as UTCTimestamp, value }]
        : [];
    });
    const sellData = points.flatMap((point) => {
      const value = hasSellOrderHistory ? point.sellOrderPrice : point.price;
      return value && value > 0
        ? [{ time: Math.floor(point.time / 1000) as UTCTimestamp, value }]
        : [];
    });
    const buySeries = chart.addSeries(LineSeries, {
      color: "#63e69a",
      lineWidth: 2,
      priceLineVisible: !compact,
      lastValueVisible: !compact,
      autoscaleInfoProvider: createRobustAutoscaleProvider(calculateRobustChartPriceRange(buyData.map((point) => point.value))),
    });
    const sellSeries = chart.addSeries(LineSeries, {
      color: "#ff737d",
      lineWidth: 2,
      priceLineVisible: !compact,
      lastValueVisible: !compact,
      autoscaleInfoProvider: createRobustAutoscaleProvider(calculateRobustChartPriceRange(sellData.map((point) => point.value))),
    });
    buySeries.setData(buyData);
    sellSeries.setData(sellData);
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
    <div className="price-chart-legend" aria-label={t("chart.legend")}>
      <span><i className="buy" />{t("chart.buyOrder")}</span>
      <span><i className="sell" />{t("chart.sellOrder")}</span>
    </div>
  </div>;
}
