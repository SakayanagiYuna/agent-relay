"use strict";

function terminalOverlayBounds(host, { collapsed = false, margin = 10, expandedHeight = 280, barHeight = 44 } = {}) {
  if (!host || typeof host !== "object") return null;
  const x = Number(host.x);
  const y = Number(host.y);
  const width = Number(host.width);
  const height = Number(host.height);
  if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) return null;
  const overlayHeight = collapsed
    ? barHeight
    : Math.min(expandedHeight, Math.max(barHeight, height - margin * 2));
  return {
    x: x + margin,
    y: y + height - overlayHeight - margin,
    width: Math.max(1, width - margin * 2),
    height: overlayHeight,
  };
}

module.exports = { terminalOverlayBounds };
