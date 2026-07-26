import React, { useEffect, useRef } from 'react';

/**
 * MatrixClock — Matrix digital rain with a permanent UTC clock overlay.
 *
 * Cyan/blue digits rain down behind a always-visible UTC clock readout.
 * The rain is slower and more ambient; the clock stays on top at all
 * times with "UTC" inline on the same line.
 *
 * Colors match the Log2Go web app palette.
 */
export function MatrixClock() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d: CanvasRenderingContext2D = canvas.getContext('2d')!;
    if (!ctx2d) return;

    // ── Config ──────────────────────────────────────────────────────
    const W = 200;
    const H = 56;
    canvas.width = W;
    canvas.height = H;

    const fontSize = 12;
    const fontStr = `${fontSize}px "Courier New", monospace`;
    const colWidth = fontSize;
    const cols = Math.floor(W / colWidth);
    const colDrops: number[] = new Array(cols).fill(0).map(() => Math.random() * H);
    // Slower speeds — ambient, not frantic
    const colSpeeds: number[] = new Array(cols).fill(0).map(() => 0.25 + Math.random() * 0.5);
    const colChars: string[][] = new Array(cols).fill(0).map(() =>
      new Array(Math.ceil(H / fontSize) + 2).fill(0).map(() => randomChar()),
    );

    function randomChar(): string {
      const chars = '0123456789';
      return chars[Math.floor(Math.random() * chars.length)];
    }

    function formatUtcClock(): string {
      const now = new Date();
      const h = String(now.getUTCHours()).padStart(2, '0');
      const m = String(now.getUTCMinutes()).padStart(2, '0');
      const s = String(now.getUTCSeconds()).padStart(2, '0');
      return `UTC ${h}:${m}:${s}`;
    }

    // ── Render loop ─────────────────────────────────────────────────
    let rafId = 0;

    function frame() {
      // Fade background (trailing effect)
      ctx2d.fillStyle = 'rgba(7, 17, 31, 0.15)';
      ctx2d.fillRect(0, 0, W, H);

      // ── Matrix rain (always running, behind clock) ────────────────
      ctx2d.font = fontStr;
      for (let col = 0; col < cols; col++) {
        const x = col * colWidth;
        const headY = colDrops[col];

        for (let i = 0; i < colChars[col].length; i++) {
          const y = headY - i * fontSize;
          if (y < -fontSize || y > H + fontSize) continue;

          if (Math.random() < 0.03) {
            colChars[col][i] = randomChar();
          }

          if (i === 0) {
            ctx2d.fillStyle = '#9fe7ff';
          } else if (i < 2) {
            ctx2d.fillStyle = '#38bdf8';
          } else if (i < 5) {
            ctx2d.fillStyle = '#00b4ff';
          } else {
            ctx2d.fillStyle = `rgba(0, 120, 200, ${Math.max(0, 0.6 - i / 16)})`;
          }

          ctx2d.fillText(colChars[col][i], x, y);
        }

        colDrops[col] += colSpeeds[col];
        if (colDrops[col] > H + fontSize * 3 && Math.random() > 0.975) {
          colDrops[col] = -fontSize;
          colSpeeds[col] = 0.25 + Math.random() * 0.5;
        }
      }

      // ── Dim the rain in the center where the clock sits ───────────
      ctx2d.fillStyle = 'rgba(7, 17, 31, 0.55)';
      ctx2d.fillRect(W * 0.08, 0, W * 0.84, H);

      // ── Clock text (always visible, on top) ───────────────────────
      const clockStr = formatUtcClock();
      ctx2d.font = `bold 18px "Courier New", monospace`;
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.shadowColor = '#00b4ff';
      ctx2d.shadowBlur = 10;
      ctx2d.fillStyle = '#e5f4ff';
      ctx2d.fillText(clockStr, W / 2, H / 2);
      ctx2d.shadowBlur = 0;
      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'alphabetic';

      rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div className="matrix-clock-box" title="UTC time">
      <canvas ref={canvasRef} />
    </div>
  );
}