'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import styles from './page.module.css';

const ENTER_TARGET = '/map';
const WARP_DURATION_MS = 950;

type WarpState = {
  active: boolean;
  start: number;
  target: string;
};

type WarpStreak = {
  angle: number;
  speed: number;
  baseOffset: number;
  lengthFactor: number;
  hueShift: number;
};

export default function LandingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const warpStateRef = useRef<WarpState>({ active: false, start: 0, target: ENTER_TARGET });
  const transitionedRef = useRef(false);
  const [isWarping, setIsWarping] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const stars: {
      x: number;
      y: number;
      r: number;
      alpha: number;
      twinkleSpeed: number;
      twinkleOffset: number;
    }[] = [];

    const brightStars: { x: number; y: number; size: number }[] = [];
    const warpStreaks: WarpStreak[] = [];

    const NUM_STARS = 1200;
    const NUM_BRIGHT = 34;
    const NUM_WARP_STREAKS = 340;

    for (let i = 0; i < NUM_STARS; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random(),
        r: Math.random() * 1.6 + 0.2,
        alpha: Math.random() * 0.7 + 0.2,
        twinkleSpeed: Math.random() * 0.03 + 0.003,
        twinkleOffset: Math.random() * Math.PI * 2,
      });
    }

    for (let i = 0; i < NUM_BRIGHT; i++) {
      brightStars.push({
        x: Math.random(),
        y: Math.random() * 0.92,
        size: Math.random() * 6 + 4,
      });
    }

    for (let i = 0; i < NUM_WARP_STREAKS; i++) {
      warpStreaks.push({
        angle: Math.random() * Math.PI * 2,
        speed: 0.55 + Math.random() * 1.5,
        baseOffset: Math.random(),
        lengthFactor: 0.45 + Math.random() * 1.35,
        hueShift: Math.random() * 30,
      });
    }

    let frame = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    function drawCrossStar(x: number, y: number, size: number, alpha: number) {
      if (!ctx) return;
      ctx.save();
      ctx.globalAlpha = alpha;

      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 2) {
        const x2 = x + Math.cos(angle) * size;
        const y2 = y + Math.sin(angle) * size;
        const grad = ctx.createLinearGradient(x, y, x2, y2);
        grad.addColorStop(0, 'rgba(210,230,255,0.95)');
        grad.addColorStop(1, 'rgba(210,230,255,0)');

        ctx.strokeStyle = grad as unknown as string;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(235,245,255,0.95)';
      ctx.fill();
      ctx.restore();
    }

    function drawNormalScene() {
      if (!canvas) return;
      const W = canvas.width;
      const H = canvas.height;

      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#00010a');
      bgGrad.addColorStop(0.2, '#000a33');
      bgGrad.addColorStop(0.5, '#08276d');
      bgGrad.addColorStop(0.72, '#0b3188');
      bgGrad.addColorStop(1, '#01041b');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      const topDust = ctx.createRadialGradient(
        W * 0.5,
        H * 0.06,
        0,
        W * 0.5,
        H * 0.08,
        W * 0.38,
      );
      topDust.addColorStop(0, 'rgba(185,205,255,0.28)');
      topDust.addColorStop(0.35, 'rgba(128,160,245,0.16)');
      topDust.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = topDust;
      ctx.fillRect(0, 0, W, H * 0.52);

      stars.forEach((star) => {
        const flicker = 0.72 + 0.28 * Math.sin(frame * star.twinkleSpeed + star.twinkleOffset);
        ctx.save();
        ctx.globalAlpha = star.alpha * flicker;
        ctx.beginPath();
        ctx.arc(star.x * W, star.y * H, star.r, 0, Math.PI * 2);
        ctx.fillStyle = '#d9e8ff';
        ctx.fill();
        ctx.restore();
      });

      brightStars.forEach((star, i) => {
        const twinkle = 0.55 + 0.45 * Math.sin(frame * 0.032 + i * 0.6);
        drawCrossStar(star.x * W, star.y * H, star.size, twinkle);
      });

      const horizonY = H * 0.705;
      const earthRadius = W * 1.14;
      const earthX = W * 0.5;
      const earthY = horizonY + earthRadius * 0.945;

      const sunrise = ctx.createRadialGradient(earthX, horizonY, 0, earthX, horizonY, W * 0.38);
      sunrise.addColorStop(0, 'rgba(238, 244, 224, 0.54)');
      sunrise.addColorStop(0.26, 'rgba(165, 214, 192, 0.3)');
      sunrise.addColorStop(0.55, 'rgba(100, 175, 255, 0.15)');
      sunrise.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sunrise;
      ctx.fillRect(0, 0, W, H);

      const atmos = ctx.createRadialGradient(
        earthX,
        earthY,
        earthRadius * 0.9,
        earthX,
        earthY,
        earthRadius * 1.06,
      );
      atmos.addColorStop(0, 'rgba(0,0,0,0)');
      atmos.addColorStop(0.5, 'rgba(68, 150, 245, 0.36)');
      atmos.addColorStop(0.8, 'rgba(152, 228, 255, 0.28)');
      atmos.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = atmos;
      ctx.fillRect(0, 0, W, H);

      const earth = ctx.createRadialGradient(
        earthX - W * 0.08,
        earthY - earthRadius * 0.05,
        earthRadius * 0.08,
        earthX,
        earthY,
        earthRadius,
      );
      earth.addColorStop(0, '#16358a');
      earth.addColorStop(0.35, '#0a2260');
      earth.addColorStop(0.72, '#030e33');
      earth.addColorStop(1, '#010414');

      ctx.save();
      ctx.beginPath();
      ctx.arc(earthX, earthY, earthRadius, 0, Math.PI * 2);
      ctx.fillStyle = earth;
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(earthX, earthY, earthRadius, Math.PI + 0.08, -0.08);
      ctx.strokeStyle = 'rgba(134, 214, 255, 0.62)';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(earthX, earthY, earthRadius * 1.011, Math.PI + 0.09, -0.09);
      ctx.strokeStyle = 'rgba(168, 232, 255, 0.24)';
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.restore();

      const lowerFade = ctx.createLinearGradient(0, horizonY + H * 0.02, 0, H);
      lowerFade.addColorStop(0, 'rgba(0, 4, 22, 0)');
      lowerFade.addColorStop(0.3, 'rgba(0, 4, 22, 0.58)');
      lowerFade.addColorStop(1, 'rgba(0, 2, 10, 1)');
      ctx.fillStyle = lowerFade;
      ctx.fillRect(0, horizonY, W, H - horizonY);
    }

    function drawWormhole(progress: number) {
      const W = canvas.width;
      const H = canvas.height;
      const cx = W * 0.5;
      const cy = H * 0.5;
      const maxDist = Math.hypot(W, H) * 0.9;
      const eased = 1 - Math.pow(1 - progress, 3);

      const tunnelBg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxDist);
      tunnelBg.addColorStop(0, 'rgba(8, 12, 60, 0.95)');
      tunnelBg.addColorStop(0.35, 'rgba(16, 30, 110, 0.88)');
      tunnelBg.addColorStop(1, 'rgba(2, 5, 36, 1)');
      ctx.fillStyle = tunnelBg;
      ctx.fillRect(0, 0, W, H);

      warpStreaks.forEach((streak, i) => {
        const spin = frame * 0.0007;
        const angle = streak.angle + spin;
        const travel = ((streak.baseOffset + eased * streak.speed * 2.8) % 1) * maxDist;
        const head = Math.max(18, travel);
        const length = (40 + eased * 280) * streak.lengthFactor;
        const tail = Math.max(0, head - length);

        const x1 = cx + Math.cos(angle) * tail;
        const y1 = cy + Math.sin(angle) * tail;
        const x2 = cx + Math.cos(angle) * head;
        const y2 = cy + Math.sin(angle) * head;

        const streakGrad = ctx.createLinearGradient(x1, y1, x2, y2);
        const tint = 200 + streak.hueShift;
        streakGrad.addColorStop(0, `hsla(${tint}, 100%, 75%, 0)`);
        streakGrad.addColorStop(0.25, `hsla(${tint}, 100%, 75%, ${0.4 + eased * 0.25})`);
        streakGrad.addColorStop(1, `hsla(${tint}, 100%, 82%, ${0.8 + eased * 0.2})`);

        ctx.strokeStyle = streakGrad;
        ctx.lineWidth = Math.min(10, 1 + eased * 5 + (i % 3) * 0.45);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });

      const centerCore = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60 + eased * 45);
      centerCore.addColorStop(0, 'rgba(170,220,255,0.95)');
      centerCore.addColorStop(0.45, 'rgba(95,170,255,0.65)');
      centerCore.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = centerCore;
      ctx.fillRect(0, 0, W, H);

      const vignette = ctx.createRadialGradient(cx, cy, maxDist * 0.45, cx, cy, maxDist);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, `rgba(0,0,0,${0.25 + eased * 0.4})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);
    }

    let animationId = 0;
    const animate = () => {
      const warpState = warpStateRef.current;

      if (warpState.active) {
        const progress = Math.min(1, (performance.now() - warpState.start) / WARP_DURATION_MS);
        drawWormhole(progress);

        if (progress >= 1 && !transitionedRef.current) {
          transitionedRef.current = true;
          router.push(warpState.target);
        }
      } else {
        drawNormalScene();
      }

      frame += 1;
      animationId = requestAnimationFrame(animate);
    };

    resize();
    animate();
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, [router]);

  const startWarp = () => {
    if (warpStateRef.current.active) return;
    warpStateRef.current = {
      active: true,
      start: performance.now(),
      target: ENTER_TARGET,
    };
    transitionedRef.current = false;
    setIsWarping(true);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <div className={`absolute inset-[10px] border pointer-events-none transition-opacity duration-500 ${isWarping ? 'opacity-0 border-transparent' : 'opacity-100 border-[#1a1f2e]/85'}`} />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
        <Image
          className={`${styles.atlasLogo} ${isWarping ? styles.atlasLogoWarp : ''}`}
          src="/logo.png"
          alt="Atlas logo"
          width={2048}
          height={729}
          priority
          aria-label="Atlas logo"
          style={{ width: 'clamp(400px, 50vw, 1000px)', height: 'auto' }}
        />
      </div>

      <div className="absolute inset-0 flex items-end justify-center pb-16 pointer-events-none">
        <button
          className={`pointer-events-auto ${styles.enterBtn} ${isWarping ? styles.enterBtnWarp : ''}`}
          onClick={startWarp}
          disabled={isWarping}
        >
          Enter
        </button>
      </div>
    </div>
  );
}