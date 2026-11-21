'use client';

/**
 * Architectural sports-telemetry motion primitives:
 * - LineMaskReveal: crisp baseline overflow mask wipe
 * - CurtainButton: upward sweeping contrast fill curtain
 * - TelemetryPanel: geometric clip-path reveal + spring 3D micro-tilt + corner ticks
 * - LifecyclePipeline: 4-stage spring layoutId telemetry rail
 * - AnimatedNumber: spring-interpolated integer counter
 * - VoiceWave: real-time AnalyserNode spectrum or active processing bar wave
 */

import {
  AnimatePresence,
  type HTMLMotionProps,
  MotionConfig,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const EASE_SHARP = [0.16, 1, 0.3, 1] as const;

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/* ---------- Architectural Telemetry Grid Backdrop ---------- */

export function TelemetryGridBackdrop() {
  return (
    <div className="telemetry-bg" aria-hidden="true">
      <div className="telemetry-grid-lines" />
      <div className="telemetry-horizon" />
    </div>
  );
}

/* ---------- LineMaskReveal (Lando / Editorial Wipe) ---------- */

type RevealTag = 'h1' | 'h2' | 'p' | 'blockquote';

export function BlurReveal({
  text,
  as = 'h1',
  className,
  id,
  tabIndex,
  lang,
  delay = 0,
  stagger = 0.045,
  highlightWords = [],
}: {
  text: string;
  as?: RevealTag;
  className?: string;
  id?: string;
  tabIndex?: number;
  lang?: string;
  delay?: number;
  stagger?: number;
  highlightWords?: string[];
}) {
  const Tag = as;
  const words = text.split(' ');
  const reduce = useReducedMotion();

  return (
    <Tag key={text} id={id} tabIndex={tabIndex} className={className} lang={lang}>
      <span className="visually-hidden">{text}</span>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="mask-word-clip" aria-hidden="true">
          <motion.span
            className={`mask-word ${highlightWords.includes(word) ? 'reveal-word-accent' : ''}`}
            initial={reduce ? { y: 0, opacity: 1 } : { y: '112%', opacity: 0.2 }}
            animate={{ y: '0%', opacity: 1 }}
            transition={{
              delay: delay + i * stagger,
              duration: 0.52,
              ease: EASE_SHARP,
            }}
          >
            {word}
            {i < words.length - 1 ? '\u00A0' : ''}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}

/* ---------- AnimatedNumber ---------- */

export function AnimatedNumber({
  value,
  format = (n) => String(n),
  className,
  startOnView = false,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  startOnView?: boolean;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: '0px' });
  const spring = useSpring(reduce ? value : 0, { stiffness: 95, damping: 20, mass: 0.8 });
  const display = useTransform(spring, (v) => format(Math.round(v)));

  useEffect(() => {
    if (startOnView && !inView) {
      return;
    }
    if (reduce) {
      spring.jump(value);
    } else {
      spring.set(value);
    }
  }, [inView, reduce, spring, startOnView, value]);

  return (
    <span ref={ref} className={className}>
      <span className="visually-hidden">{format(value)}</span>
      <motion.span aria-hidden="true">{display}</motion.span>
    </span>
  );
}

/* ---------- TextShimmer ---------- */

export function TextShimmer({
  children,
  className = '',
  duration = 1.6,
}: {
  children: ReactNode;
  className?: string;
  duration?: number;
}) {
  return (
    <motion.span
      className={`text-shimmer ${className}`}
      initial={{ backgroundPosition: '100% center' }}
      animate={{ backgroundPosition: '0% center' }}
      transition={{ repeat: Infinity, duration, ease: 'linear' }}
    >
      {children}
    </motion.span>
  );
}

/* ---------- TelemetryPanel (Geometric Clip + 3D Tilt + Border Spotlight) ---------- */

type PanelTag = 'div' | 'section' | 'li' | 'aside';

interface TelemetryPanelProps extends HTMLMotionProps<'div'> {
  as?: PanelTag;
  spotlightColor?: string;
  delay?: number;
  tilt?: boolean;
}

export function SpotlightCard({
  as = 'div',
  spotlightColor = 'rgba(89, 124, 128, 0.34)',
  delay = 0,
  tilt = true,
  className = '',
  style,
  children,
  onPointerMove,
  onPointerLeave,
  ...rest
}: TelemetryPanelProps) {
  const reduce = useReducedMotion();
  const Comp = (
    as === 'section'
      ? motion.section
      : as === 'li'
        ? motion.li
        : as === 'aside'
          ? motion.aside
          : motion.div
  ) as unknown as typeof motion.div;

  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 260, damping: 22 });
  const sry = useSpring(ry, { stiffness: 260, damping: 22 });

  function handleMove(event: ReactPointerEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    el.style.setProperty('--spot-x', `${px}px`);
    el.style.setProperty('--spot-y', `${py}px`);

    if (!reduce && tilt && event.pointerType === 'mouse' && rect.width > 0 && rect.height > 0) {
      const nx = (px / rect.width - 0.5) * 2;
      const ny = (py / rect.height - 0.5) * 2;
      rx.set(-ny * 1.8);
      ry.set(nx * 1.8);
    }
    onPointerMove?.(event);
  }

  function handleLeave(event: ReactPointerEvent<HTMLDivElement>) {
    rx.set(0);
    ry.set(0);
    onPointerLeave?.(event);
  }

  return (
    <Comp
      className={`telemetry-panel ${className}`}
      style={{
        ...(style ?? {}),
        rotateX: srx,
        rotateY: sry,
        transformPerspective: 1100,
        ['--spot-color' as string]: spotlightColor,
      } as CSSProperties}
      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 14, clipPath: 'inset(0 0 14% 0)' }}
      animate={{
        opacity: 1,
        y: 0,
        clipPath: 'inset(0 0 0% 0)',
        transitionEnd: { clipPath: 'none' },
      }}
      transition={{ delay, duration: 0.48, ease: EASE_SHARP }}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      {...rest}
    >
      <span className="panel-corner panel-corner-tl" aria-hidden="true" />
      <span className="panel-corner panel-corner-tr" aria-hidden="true" />
      {children as ReactNode}
    </Comp>
  );
}

/* ---------- CurtainButton (Kinetic Sweep Fill + Magnetic Pull) ---------- */

interface CurtainButtonProps extends HTMLMotionProps<'button'> {
  strength?: number;
}

export function MagneticButton({
  strength = 0.16,
  className = '',
  type = 'button',
  disabled,
  children,
  onPointerMove,
  onPointerLeave,
  ...rest
}: CurtainButtonProps) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 360, damping: 24, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 360, damping: 24, mass: 0.4 });

  function handleMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!reduce && !disabled && event.pointerType === 'mouse') {
      const rect = event.currentTarget.getBoundingClientRect();
      x.set((event.clientX - (rect.left + rect.width / 2)) * strength);
      y.set((event.clientY - (rect.top + rect.height / 2)) * strength);
    }
    onPointerMove?.(event);
  }

  function handleLeave(event: ReactPointerEvent<HTMLButtonElement>) {
    x.set(0);
    y.set(0);
    onPointerLeave?.(event);
  }

  return (
    <motion.button
      type={type}
      className={`curtain-btn ${className}`}
      style={{ x: sx, y: sy }}
      whileTap={disabled ? undefined : { scale: 0.975 }}
      disabled={disabled}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      {...rest}
    >
      <span className="curtain-bg" aria-hidden="true" />
      <span className="curtain-content">{children as ReactNode}</span>
    </motion.button>
  );
}

/* ---------- 4-Stage Telemetry Pipeline ---------- */

export interface PipelineStage {
  id: string;
  code: string;
  label: string;
  state: 'done' | 'active' | 'pending';
}

export function LifecyclePipeline({ stages }: { stages: ReadonlyArray<PipelineStage> }) {
  return (
    <ol className="telemetry-pipeline" aria-label="Collection lifecycle stages">
      {stages.map((stage, idx) => (
        <motion.li
          key={stage.id}
          className={`pipeline-node is-${stage.state}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.05, duration: 0.4, ease: EASE_SHARP }}
        >
          <div className="pipeline-meta">
            <span className="mono pipeline-code">{stage.code}</span>
            <span className={`pipeline-dot is-${stage.state}`} aria-hidden="true" />
          </div>
          <span className="pipeline-label">{stage.label}</span>
          <span className="pipeline-track" aria-hidden="true">
            <motion.span
              className="pipeline-fill"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: stage.state === 'done' ? 1 : stage.state === 'active' ? 0.55 : 0 }}
              transition={{ duration: 0.55, ease: EASE_SHARP }}
            />
          </span>
        </motion.li>
      ))}
    </ol>
  );
}

/* ---------- Sliding segmented control & Toggle ---------- */

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  layoutId,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  layoutId: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={`segmented-option ${active ? 'is-active' : ''}`}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="segmented-pill"
                transition={{ type: 'spring', stiffness: 460, damping: 36 }}
              />
            )}
            <span className="segmented-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ToggleSwitch({
  pressed,
  onToggle,
  children,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="switch" aria-pressed={pressed} onClick={onToggle}>
      <span className="switch-track" aria-hidden="true">
        <motion.span
          layout
          className="switch-thumb"
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        />
      </span>
      <span>{children}</span>
    </button>
  );
}

/* ---------- Morphing status pill ---------- */

export function MorphPill({
  keyValue,
  tone,
  children,
}: {
  keyValue: string;
  tone: string;
  children: ReactNode;
}) {
  return (
    <span className="pill-morph-wrap">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={keyValue}
          className={`pill ${tone}`}
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -8, opacity: 0 }}
          transition={{ duration: 0.28, ease: EASE_SHARP }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ---------- Animated alert ---------- */

export function AnimatedAlert({
  message,
  tone,
  role,
}: {
  message: string;
  tone: 'error' | 'success';
  role?: 'alert' | 'status';
}) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {message && (
        <motion.div
          key={message}
          initial={{ opacity: 0, height: 0, y: -4 }}
          animate={{ opacity: 1, height: 'auto', y: 0 }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25, ease: EASE_SHARP }}
          style={{ overflow: 'hidden' }}
        >
          <div className={`alert alert-${tone}`} role={role}>
            {message}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- Voice Spectrum Visualizer ---------- */

export function VoiceWave({
  active,
  levels,
  bars = 24,
}: {
  active: boolean;
  levels?: number[];
  bars?: number;
}) {
  const heights = useMemo(
    () => Array.from({ length: bars }, (_, i) => 0.28 + ((Math.sin(i * 1.45) + 1) / 2) * 0.72),
    [bars],
  );

  return (
    <div className={`voice-wave ${active ? 'is-active' : ''}`} aria-hidden="true">
      {heights.map((h, i) => {
        const liveLevel = levels && levels.length > 0 ? levels[i % levels.length] : null;
        return (
          <motion.span
            key={i}
            className="voice-bar"
            animate={
              liveLevel !== null && active
                ? { scaleY: liveLevel }
                : active
                  ? { scaleY: [0.22, h, 0.3, h * 0.85, 0.22] }
                  : { scaleY: 0.14 }
            }
            transition={
              liveLevel !== null && active
                ? { duration: 0.08, ease: 'linear' }
                : active
                  ? {
                      duration: 0.9 + (i % 4) * 0.12,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: i * 0.025,
                    }
                  : { duration: 0.25 }
            }
          />
        );
      })}
    </div>
  );
}

export function PulseRings({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active &&
        [0, 1].map((i) => (
          <motion.span
            key={i}
            className="pulse-ring"
            aria-hidden="true"
            initial={{ scale: 0.96, opacity: 0.7 }}
            animate={{ scale: 1.24, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.55, ease: 'easeOut' }}
          />
        ))}
    </AnimatePresence>
  );
}

/* ---------- Celebration ---------- */

const BURST_COLORS = ['#597C80', '#9E5C55', '#F2E9E7', '#8FB4B8'];

export function ParticleBurst({ trigger, count = 18 }: { trigger: number; count?: number }) {
  const reduce = useReducedMotion();
  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const distance = 60 + (i % 3) * 24;
        return {
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
          color: BURST_COLORS[i % BURST_COLORS.length],
          size: 4 + (i % 3) * 2,
          rotate: (i * 45) % 360,
        };
      }),
    [count],
  );

  if (!trigger || reduce) {
    return null;
  }

  return (
    <span className="particle-burst" aria-hidden="true">
      {particles.map((p, i) => (
        <motion.span
          key={`${trigger}-${i}`}
          className="particle"
          style={{ background: p.color, width: p.size, height: p.size }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.4, rotate: 0 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 1, rotate: p.rotate }}
          transition={{ duration: 0.8, ease: EASE_SHARP }}
        />
      ))}
    </span>
  );
}

export function CheckDraw({ size = 40 }: { size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 52 52"
      aria-hidden="true"
      className="check-draw"
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    >
      <motion.rect
        x="4"
        y="4"
        width="44"
        height="44"
        rx="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      />
      <motion.path
        d="M15 27 l7 7 l15 -16"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.35, delay: 0.35, ease: 'easeOut' }}
      />
    </motion.svg>
  );
}

/* ---------- Marquee ---------- */

export function Marquee({ items, speed = 38 }: { items: string[]; speed?: number }) {
  const [paused, setPaused] = useState(false);
  const content = `${items.join('  //  ')}  //  `;
  return (
    <div className="marquee">
      <button
        type="button"
        className="marquee-toggle"
        onClick={() => setPaused((prev) => !prev)}
      >
        {paused ? 'Play' : 'Pause'}
      </button>
      <div className="marquee-viewport" aria-hidden="true">
        <div
          className={`marquee-track ${paused ? 'is-paused' : ''}`}
          style={{ animationDuration: `${speed}s` }}
        >
          <span>{content}</span>
          <span>{content}</span>
        </div>
      </div>
    </div>
  );
}

export const fadeSwap = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.28, ease: EASE_SHARP },
} as const;
