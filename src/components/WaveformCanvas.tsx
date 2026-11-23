import { useEffect, useRef, useState } from 'react';

interface WaveformCanvasProps {
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  active: boolean;
  muted?: boolean;
  label: string;
}

export function WaveformCanvas({
  analyserRef,
  active,
  muted = false,
  label,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peakDb, setPeakDb] = useState<string>('-∞ dB');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let rafId = 0;
    let lastDbUpdate = 0;
    const timeData = new Uint8Array(512);
    const freqData = new Uint8Array(64);

    const drawFrame = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width > 0 && height > 0) {
        if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
          canvas.width = Math.floor(width * dpr);
          canvas.height = Math.floor(height * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Background
        ctx.fillStyle = '#0D1015';
        ctx.fillRect(0, 0, width, height);

        // Subtle horizontal center reference line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        const analyser = analyserRef.current;
        if (active && analyser && !muted) {
          analyser.getByteTimeDomainData(timeData);
          analyser.getByteFrequencyData(freqData);

          // Draw subtle spectrum bars in background
          const barCount = 32;
          const gap = 4;
          const barWidth = Math.max(2, (width - gap * (barCount + 1)) / barCount);
          for (let i = 0; i < barCount; i++) {
            const val = freqData[i] / 255;
            const barHeight = Math.max(2, val * (height * 0.72));
            const x = gap + i * (barWidth + gap);
            const y = height - barHeight;
            ctx.fillStyle = 'rgba(14, 165, 233, 0.22)';
            ctx.fillRect(x, y, barWidth, barHeight);
          }

          // Draw crisp oscilloscope line
          ctx.strokeStyle = '#38BDF8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          let maxAmp = 0;
          const sliceWidth = width / timeData.length;
          for (let i = 0; i < timeData.length; i++) {
            const normalized = (timeData[i] - 128) / 128;
            maxAmp = Math.max(maxAmp, Math.abs(normalized));
            const x = i * sliceWidth;
            const y = height / 2 + normalized * (height * 0.42);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          if (now - lastDbUpdate > 180) {
            lastDbUpdate = now;
            if (maxAmp < 0.002) {
              setPeakDb('-60.0 dB');
            } else {
              const db = Math.max(-60, 20 * Math.log10(maxAmp));
              setPeakDb(`${db.toFixed(1)} dB`);
            }
          }
        } else {
          // Flat idle line
          ctx.strokeStyle = muted ? 'rgba(245, 158, 11, 0.45)' : 'rgba(156, 163, 175, 0.35)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, height / 2);
          ctx.lineTo(width, height / 2);
          ctx.stroke();

          if (now - lastDbUpdate > 300) {
            lastDbUpdate = now;
            setPeakDb(muted ? 'SILENCIADO' : '-∞ dB');
          }
        }
      }

      if (!prefersReducedMotion && active) {
        rafId = window.requestAnimationFrame(drawFrame);
      }
    };

    rafId = window.requestAnimationFrame(drawFrame);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [active, muted, analyserRef]);

  return (
    <div className="rounded-xl border border-white/10 bg-[#0D1015] p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-[#9CA3AF]">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-[#F4F5F7]">{peakDb}</span>
      </div>
      <canvas
        ref={canvasRef}
        data-testid="audio-visualizer"
        aria-label={label}
        className="h-24 w-full rounded-lg block"
      />
    </div>
  );
}
