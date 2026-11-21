'use client';

/**
 * CleanSheet motion primitives, adapted from patterns popularised by
 * motion.dev, motion-primitives (AnimatedNumber, TextShimmer), React Bits
 * (BlurText, SpotlightCard), and hover.dev (magnetic buttons, sliding pills).
 * Everything respects prefers-reduced-motion via <MotionConfig reducedMotion="user">.
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

const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/* ---------- AnimatedNumber (motion-primitives) ---------- */

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
  const spring = useSpring(reduce ? value : 0, { stiffness: 70, damping: 18, mass: 0.9 });
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

/* ---------- TextShimmer (motion-primitives) ---------- */

export function TextShimmer({
  children,
  className = '',
  duration = 1.8,
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

/* ---------- BlurReveal (React Bits BlurText) ---------- */

type RevealTag = 'h1' | 'h2' | 'p' | 'blockquote';

export function BlurReveal({
  text,
  as = 'h1',
  className,
  id,
  tabIndex,
  lang,
  delay = 0,
  stagger = 0.06,
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

  return (
    <Tag key={text} id={id} tabIndex={tabIndex} className={className} lang={lang}>
      <span className="visually-hidden">{text}</span>
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          aria-hidden="true"
          className={`reveal-word ${highlightWords.includes(word) ? 'reveal-word-accent' : ''}`}
          initial={{ opacity: 0, y: '0.35em', filter: 'blur(12px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ delay: delay + i * stagger, duration: 0.75, ease: EASE_OUT_EXPO }}
        >
          {word}
          {i < words.length - 1 ? '\u00A0' : ''}
        </motion.span>
      ))}
    </Tag>
  );
}

/* ---------- SpotlightCard (React Bits) ---------- */

type SpotlightTag = 'div' | 'section' | 'li';

interface SpotlightCardProps extends HTMLMotionProps<'div'> {
  as?: SpotlightTag;
  spotlightColor?: string;
  delay?: number;
}

export function SpotlightCard({
  as = 'div',
  spotlightColor = 'rgba(89, 124, 128, 0.28)',
  delay = 0,
  className = '',
  style,
  children,
  onPointerMove,
  ...rest
}: SpotlightCardProps) {
  const Comp = (
    as === 'section' ? motion.section : as === 'li' ? motion.li : motion.div
  ) as unknown as typeof motion.div;

  function handleMove(event: ReactPointerEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    el.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
    onPointerMove?.(event);
  }

  return (
    <Comp
      className={`spotlight-card ${className}`}
      style={{ ...(style ?? {}), ['--spot-color' as string]: spotlightColor } as CSSProperties}
      initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
      transition={{ delay, duration: 0.75, ease: EASE_OUT_EXPO }}
      onPointerMove={handleMove}
      {...rest}
    >
      {children}
    </Comp>
  );
}

/* ---------- MagneticButton (hover.dev) ---------- */

interface MagneticButtonProps extends HTMLMotionProps<'button'> {
  strength?: number;
}

export function MagneticButton({
  strength = 0.28,
  className = '',
  type = 'button',
  disabled,
  children,
  onPointerMove,
  onPointerLeave,
  ...rest
}: MagneticButtonProps) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 300, damping: 18, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 300, damping: 18, mass: 0.5 });
  const innerX = useTransform(sx, (v) => v * 0.45);
  const innerY = useTransform(sy, (v) => v * 0.45);

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
      className={`magnetic ${className}`}
      style={{ x: sx, y: sy }}
      whileHover={disabled ? undefined : { scale: 1.03 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      disabled={disabled}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      {...rest}
    >
      <motion.span className="magnetic-inner" style={{ x: innerX, y: innerY }}>
        {children as ReactNode}
      </motion.span>
    </motion.button>
  );
}

/* ---------- Sliding segmented control (hover.dev / motion layoutId) ---------- */

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
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
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
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
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
          initial={{ y: 10, opacity: 0, filter: 'blur(4px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          exit={{ y: -10, opacity: 0, filter: 'blur(4px)' }}
          transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ---------- Animated alert (height + fade) ---------- */

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
          initial={{ opacity: 0, height: 0, y: -6 }}
          animate={{ opacity: 1, height: 'auto', y: 0 }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
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

/* ---------- Voice visuals ---------- */

export function VoiceWave({ active, bars = 28 }: { active: boolean; bars?: number }) {
  const heights = useMemo(
    () => Array.from({ length: bars }, (_, i) => 0.3 + ((Math.sin(i * 1.7) + 1) / 2) * 0.7),
    [bars],
  );

  return (
    <div className={`voice-wave ${active ? 'is-active' : ''}`} aria-hidden="true">
      {heights.map((h, i) => (
        <motion.span
          key={i}
          className="voice-bar"
          animate={active ? { scaleY: [0.2, h, 0.35, h * 0.8, 0.2] } : { scaleY: 0.12 }}
          transition={
            active
              ? {
                  duration: 1.1 + (i % 5) * 0.12,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: i * 0.035,
                }
              : { duration: 0.3 }
          }
        />
      ))}
    </div>
  );
}

export function PulseRings({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active &&
        [0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="pulse-ring"
            aria-hidden="true"
            initial={{ scale: 0.9, opacity: 0.6 }}
            animate={{ scale: 1.8, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity, delay: i * 0.6, ease: 'easeOut' }}
          />
        ))}
    </AnimatePresence>
  );
}

/* ---------- Celebration ---------- */

const BURST_COLORS = ['#597C80', '#9E5C55', '#F2E9E7', '#8FB4B8'];

export function ParticleBurst({ trigger, count = 22 }: { trigger: number; count?: number }) {
  const reduce = useReducedMotion();
  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const distance = 70 + (i % 4) * 24;
        return {
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
          color: BURST_COLORS[i % BURST_COLORS.length],
          size: 5 + (i % 3) * 3,
          rotate: (i * 47) % 360,
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
          transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}
    </span>
  );
}

export function CheckDraw({ size = 44 }: { size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 52 52"
      aria-hidden="true"
      className="check-draw"
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
    >
      <motion.circle
        cx="26"
        cy="26"
        r="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
      <motion.path
        d="M15 27 l7 7 l15 -16"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, delay: 0.45, ease: 'easeOut' }}
      />
    </motion.svg>
  );
}

/* ---------- Ambient layers (Awwwards / Lando-style) ---------- */

export function AuroraBackground() {
  return (
    <div className="aurora" aria-hidden="true">
      <span className="aurora-blob aurora-blob-a" />
      <span className="aurora-blob aurora-blob-b" />
      <span className="aurora-blob aurora-blob-c" />
      <span className="grain" />
    </div>
  );
}

export function CursorGlow() {
  const reduce = useReducedMotion();
  const x = useMotionValue(-600);
  const y = useMotionValue(-600);
  const sx = useSpring(x, { stiffness: 120, damping: 22 });
  const sy = useSpring(y, { stiffness: 120, damping: 22 });

  useEffect(() => {
    if (reduce) {
      return;
    }
    const handleMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') {
        return;
      }
      x.set(event.clientX);
      y.set(event.clientY);
    };
    window.addEventListener('pointermove', handleMove, { passive: true });
    return () => window.removeEventListener('pointermove', handleMove);
  }, [reduce, x, y]);

  if (reduce) {
    return null;
  }
  return <motion.div className="cursor-glow" aria-hidden="true" style={{ x: sx, y: sy }} />;
}

export function Marquee({ items, speed = 38 }: { items: string[]; speed?: number }) {
  const [paused, setPaused] = useState(false);
  const content = `${items.join('  ✦  ')}  ✦  `;
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
  initial: { opacity: 0, y: 12, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -8, filter: 'blur(6px)' },
  transition: { duration: 0.35, ease: EASE_OUT_EXPO },
} as const;
