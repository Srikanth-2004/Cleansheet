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

const STEPS = [
  {
    num: '01',
    title: 'Speak to Raz',
    body: 'Say the fee in Hindi or Kannada. Sarvam saaras:v4 transcribes it and sarvam-105b drafts the fee.',
  },
  {
    num: '02',
    title: 'Confirm the preview',
    body: 'Nothing is saved until the coach taps confirm. One fee per player and month.',
  },
  {
    num: '03',
    title: 'Parent pays',
    body: 'The parent pays through Cashfree Sandbox checkout. The server verifies the payment and counts it once.',
  },
] as const;

const ROLE_CARDS = [
  {
    href: '/coach',
    role: 'coach' as const,
    title: 'Coach dashboard',
    body: 'Ask Raz, confirm fees, and watch collections update.',
    color: 'rgba(89, 124, 128, 0.34)',
  },
  {
    href: '/parent',
    role: 'parent' as const,
    title: 'Parent fee view',
    body: 'See what is due and pay through Cashfree Sandbox.',
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
      <section className="hero" aria-labelledby="main-heading">
        <motion.p
          className="eyebrow"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          First Touch Academy · U12 · Season 2026
        </motion.p>

        <BlurReveal
          as="h1"
          id="main-heading"
          tabIndex={-1}
          className="hero-title"
          text="Collect fees. Not excuses."
          highlightWords={['Not', 'excuses.']}
          stagger={0.09}
        />

        <motion.p
          className="hero-sub"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.7 }}
        >
          Speak a fee in Hindi or Kannada. Raz drafts it, you confirm it, and the parent pays
          through Cashfree. The server verifies every payment before it counts.
        </motion.p>

        {needsSignIn ? (
          <motion.div
            className="hero-ctas"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.6 }}
          >
            {firebaseReady ? (
              <MagneticButton
                className="btn btn-primary btn-lg"
                onClick={onSignIn}
                disabled={signingIn}
              >
                <GoogleIcon />
                {signingIn ? 'Signing in…' : 'Sign in with Google'}
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
                delay={0.55 + index * 0.1}
                whileHover={{ y: -4 }}
              >
                <span className="role-card-kicker">{card.role === 'coach' ? 'Coach' : 'Parent'}</span>
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
      </section>

      <section className="steps-section" aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="section-kicker">
          How it works
        </h2>
        <ol className="steps">
          {STEPS.map((step, index) => (
            <motion.li
              key={step.num}
              className="step"
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: index * 0.12, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="step-num" aria-hidden="true">
                {step.num}
              </span>
              <h3 className="step-title">{step.title}</h3>
              <p className="step-body">{step.body}</p>
            </motion.li>
          ))}
        </ol>
      </section>

      <motion.section
        className="stat-band"
        aria-label="Demo outcome"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.8 }}
      >
        <div>
          <p className="section-kicker">The demo</p>
          <p className="stat-caption">
            From a spoken command to a verified ₹1,500 payment on the coach dashboard.
          </p>
        </div>
        <AnimatedNumber value={150000} format={rupees} className="stat-figure" startOnView />
      </motion.section>
    </div>
  );
}
