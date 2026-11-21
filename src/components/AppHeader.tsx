'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { useState } from 'react';
import {
  type FixtureScenario,
  type FixtureState,
  type SimulatedVerifyOutcome,
} from '@/lib/client/fixtures';
import type { MeData, Role } from '@/lib/client/types';
import { SegmentedControl, ToggleSwitch } from './motion/primitives';

interface AppHeaderProps {
  me: MeData | null;
  fixtureMode: boolean;
  fixtureState: FixtureState | null;
  activePath: '/' | '/coach' | '/parent';
  userEmail?: string | null;
  onSignOut?: () => void;
  onFixtureRoleChange?: (role: Role) => void;
  onFixtureScenarioChange?: (scenario: FixtureScenario) => void;
  onFixtureOutcomeChange?: (outcome: SimulatedVerifyOutcome) => void;
}

const NAV_LINKS = [
  { href: '/' as const, label: 'Home' },
  { href: '/coach' as const, label: 'Coach' },
  { href: '/parent' as const, label: 'Parent' },
];

const ROLE_OPTIONS = [
  { value: 'coach' as Role, label: 'Coach' },
  { value: 'parent' as Role, label: 'Parent' },
];

const SCENARIO_OPTIONS = [
  { value: 'fresh' as FixtureScenario, label: 'Fresh ₹0' },
  { value: 'smoke' as FixtureScenario, label: 'Smoke ₹1,500' },
];

export function AppHeader({
  me,
  fixtureMode,
  fixtureState,
  activePath,
  userEmail,
  onSignOut,
  onFixtureRoleChange,
  onFixtureScenarioChange,
  onFixtureOutcomeChange,
}: AppHeaderProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <header className="app-header">
      <a href="#main-heading" className="skip-link visually-hidden">
        Skip to main content
      </a>

      <div className="header-inner">
        <Link href="/" className="brand-group brand-link" aria-label="CleanSheet home">
          <motion.span
            className="brand-mark"
            aria-hidden="true"
            whileHover={{ rotate: -8, scale: 1.06 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
          >
            <img src="/logo.png" alt="" width={26} height={26} className="brand-logo-img" />
          </motion.span>
          <span>
            <span className="brand-title">CleanSheet</span>
            <span className="brand-subtitle">
              {me ? `${me.academyName} · ${me.teamName}` : 'Academy fee collection'}
            </span>
          </span>
        </Link>

        <div className="header-actions">
          <span className="pill pill-sandbox">
            <span className="live-dot" aria-hidden="true" />
            Cashfree PG Sandbox
          </span>
          {me && (
            <span className={`pill ${me.role === 'coach' ? 'pill-teal' : 'pill-terracotta'}`}>
              {me.role === 'coach' ? 'Coach' : 'Linked parent'}
            </span>
          )}

          <nav aria-label="Primary" className="nav-links" onPointerLeave={() => setHovered(null)}>
            {NAV_LINKS.map((link) => {
              const active = activePath === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`nav-link ${active ? 'nav-link-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onPointerEnter={() => setHovered(link.href)}
                  onFocus={() => setHovered(link.href)}
                  onBlur={() => setHovered(null)}
                >
                  {hovered === link.href && (
                    <motion.span
                      layoutId="nav-hover-pill"
                      className="nav-hover-pill"
                      transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                    />
                  )}
                  <span className="nav-label">{link.label}</span>
                  {active && <span className="nav-active-dot" aria-hidden="true" />}
                </Link>
              );
            })}
          </nav>

          {!fixtureMode && userEmail && onSignOut && (
            <button type="button" className="btn btn-secondary btn-compact" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </div>

      {fixtureMode && fixtureState && (
        <motion.div
          className="fixture-banner"
          role="region"
          aria-label="Local fixture controls"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="fixture-banner-inner">
            <div className="fixture-banner-title">
              <span className="pill pill-terracotta">LOCAL FIXTURE MODE</span>
              <span className="fixture-note">Local test data. Turned off on the deployed build.</span>
            </div>

            <div className="fixture-controls">
              <SegmentedControl
                label="Act as role"
                options={ROLE_OPTIONS}
                value={fixtureState.role}
                onChange={(role) => onFixtureRoleChange?.(role)}
                layoutId="fixture-role-pill"
              />
              <SegmentedControl
                label="Scenario"
                options={SCENARIO_OPTIONS}
                value={fixtureState.scenario}
                onChange={(scenario) => onFixtureScenarioChange?.(scenario)}
                layoutId="fixture-scenario-pill"
              />
              <ToggleSwitch
                pressed={fixtureState.simulatedVerifyOutcome === 'paid'}
                onToggle={() =>
                  onFixtureOutcomeChange?.(
                    fixtureState.simulatedVerifyOutcome === 'paid' ? 'processing' : 'paid',
                  )
                }
              >
                Mock verify: {fixtureState.simulatedVerifyOutcome === 'paid' ? 'Paid' : 'Processing'}
              </ToggleSwitch>
            </div>
          </div>
        </motion.div>
      )}
    </header>
  );
}
