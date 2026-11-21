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
  { href: '/' as const, label: 'Overview', code: '00' },
  { href: '/coach' as const, label: 'Coach', code: '01' },
  { href: '/parent' as const, label: 'Parent', code: '02' },
];

const ROLE_OPTIONS = [
  { value: 'coach' as Role, label: 'Coach' },
  { value: 'parent' as Role, label: 'Parent' },
];

const SCENARIO_OPTIONS = [
  { value: 'fresh' as FixtureScenario, label: 'Fresh ₹0' },
  { value: 'smoke' as FixtureScenario, label: 'Smoke ₹1,500' },
  { value: 'cancellation' as FixtureScenario, label: 'Cancel' },
  { value: 'recovery' as FixtureScenario, label: 'Recovery' },
  { value: 'refund' as FixtureScenario, label: 'Refund ₹500' },
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
            whileHover={{ rotate: -6, scale: 1.05 }}
            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          >
            <img src="/logo.png" alt="" width={26} height={26} className="brand-logo-img" />
          </motion.span>
          <span>
            <span className="brand-title">CleanSheet</span>
            <span className="brand-subtitle mono">
              {me ? `${me.academyName} // ${me.teamName}` : 'FIRST TOUCH // U12'}
            </span>
          </span>
        </Link>

        <div className="header-actions">
          <span className="pill pill-sandbox mono">
            <span className="live-dot" aria-hidden="true" />
            Cashfree PG Sandbox
          </span>
          {me && (
            <span className={`pill mono ${me.role === 'coach' ? 'pill-teal' : 'pill-terracotta'}`}>
              {me.role === 'coach' ? 'ROLE: COACH' : 'ROLE: PARENT'}
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
                      transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                    />
                  )}
                  <span className="nav-label">
                    <span className="nav-code mono">{link.code}</span>
                    {link.label}
                  </span>
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
        >
          <div className="fixture-banner-inner">
            <div className="fixture-banner-title">
              <span className="pill pill-terracotta mono">LOCAL FIXTURES</span>
              <span className="fixture-note">
                Disabled on deployed builds · Switch Relay &amp; PG states
              </span>
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
                Verify: {fixtureState.simulatedVerifyOutcome === 'paid' ? 'Paid' : 'Processing'}
              </ToggleSwitch>
            </div>
          </div>
        </motion.div>
      )}
    </header>
  );
}
