'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { formatPaise, type MeData } from '@/lib/client/types';
import { ArrowIcon, GoogleIcon } from './icons';
import {
  AnimatedAlert,
  AnimatedNumber,
  BlurReveal,
  MagneticButton,
  SpotlightCard,
} from './motion/primitives';

interface LandingProps {
  fixtureMode: boolean;
  firebaseReady: boolean;
  needsSignIn: boolean;
  me: MeData | null;
  signingIn: boolean;
  authError: string;
  onSignIn: () => void;
}

const TELEMETRY_SPEC = [
  { code: '01 // STT+LLM', title: 'Sarvam saaras:v4 & 105B', detail: 'Hindi & Kannada voice → 0-write tool proposal' },
  { code: '02 // ESCROW', title: 'Cashfree PG & Mandate', detail: 'Integer paise checkout + revocable auto-pay' },
  { code: '03 // SECURE ID', title: 'Adult Contact + Consent', detail: 'Scrypt-hashed OTP verification before Relay' },
  { code: '04 // LEDGER', title: 'Atomic Net Collection', detail: 'Idempotent verify + bounded coach refund' },
] as const;

const ROLE_CARDS = [
  {
    href: '/coach',
    role: 'coach' as const,
    code: 'CONSOLE // 01',
    title: 'Coach command deck',
    body: 'Speak to Raz, confirm fee records, approve bounded refunds, and audit Relay alerts.',
    color: 'rgba(89, 124, 128, 0.34)',
  },
  {
    href: '/parent',
    role: 'parent' as const,
    code: 'PORTAL // 02',
    title: 'Parent checkout & mandate',
    body: 'Verify Secure ID OTP, manage recurring mandate decisions, and pay via Cashfree Sandbox.',
    color: 'rgba(158, 92, 85, 0.32)',
  },
];

const rupees = (paise: number) => formatPaise(Math.round(paise / 100) * 100);

export function Landing({
  fixtureMode,
  firebaseReady,
  needsSignIn,
  me,
  signingIn,
  authError,
  onSignIn,
}: LandingProps) {
  const visibleRoleCards =
    !fixtureMode && me ? ROLE_CARDS.filter((card) => card.role === me.role) : ROLE_CARDS;

  return (
    <div className="landing">
      <section className="hero-grid" aria-labelledby="main-heading">
        <div className="hero-primary">
          <motion.p
            className="eyebrow mono"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45 }}
          >
            SYS // FIRST TOUCH ACADEMY · U12 · SEASON 2026
          </motion.p>

          <BlurReveal
            as="h1"
            id="main-heading"
            tabIndex={-1}
            className="hero-title"
            text="Collect fees. Not excuses."
            highlightWords={['Not', 'excuses.']}
            stagger={0.07}
          />

          <motion.p
            className="hero-sub"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32, duration: 0.5 }}
          >
            Voice-native academy ledger. Speak a fee in Hindi or Kannada to Raz, confirm once,
            and settle through verified Cashfree PG, Subscriptions, Secure ID, and Relay.
          </motion.p>

          {needsSignIn ? (
            <motion.div
              className="hero-ctas"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.44, duration: 0.45 }}
            >
              {firebaseReady ? (
                <MagneticButton
                  className="btn btn-primary btn-lg"
                  onClick={onSignIn}
                  disabled={signingIn}
                >
                  <GoogleIcon />
                  {signingIn ? 'Authenticating…' : 'Sign in with Google'}
                </MagneticButton>
              ) : (
                <div className="alert alert-error" role="alert">
                  Firebase browser configuration (<span className="mono">NEXT_PUBLIC_FIREBASE_*</span>)
                  is missing and local fixtures are disabled.
                </div>
              )}
            </motion.div>
          ) : (
            <ul className="role-grid" role="list">
              {visibleRoleCards.map((card, index) => (
                <SpotlightCard
                  key={card.href}
                  as="li"
                  className="role-card"
                  spotlightColor={card.color}
                  delay={0.38 + index * 0.08}
                >
                  <span className="role-card-kicker mono">{card.code}</span>
                  <div>
                    <h2 className="role-card-title">
                      <Link href={card.href} className="stretched-link">
                        {card.title}
                      </Link>
                    </h2>
                    <p className="role-card-body">{card.body}</p>
                  </div>
                  <span className="role-card-arrow" aria-hidden="true">
                    <ArrowIcon />
                  </span>
                </SpotlightCard>
              ))}
            </ul>
          )}

          <AnimatedAlert message={authError} tone="error" role="alert" />
        </div>

        <SpotlightCard
          as="aside"
          className="telemetry-spec-card"
          spotlightColor="rgba(89, 124, 128, 0.25)"
          delay={0.25}
          aria-label="System specification"
        >
          <div className="spec-header">
            <span className="mono">TELEMETRY // LIVE SPEC</span>
            <span className="pill pill-teal mono">2026-11</span>
          </div>

          <div className="spec-figure-row">
            <div>
              <span className="metric-label">Demo Target Fee</span>
              <AnimatedNumber value={150000} format={rupees} className="stat-figure" />
            </div>
            <span className="mono spec-paise">150000 PAISE</span>
          </div>

          <ul className="spec-list" role="list">
            {TELEMETRY_SPEC.map((item) => (
              <li key={item.code} className="spec-item">
                <span className="mono spec-code">{item.code}</span>
                <strong className="spec-title">{item.title}</strong>
                <span className="spec-detail">{item.detail}</span>
              </li>
            ))}
          </ul>
        </SpotlightCard>
      </section>
    </div>
  );
}
