'use client';

import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { fetchMe } from '@/lib/client/api';
import {
  isFirebaseConfigured,
  isFixtureModeEnabled,
  signInWithGoogle,
  signOutUser,
  subscribeToAuthState,
} from '@/lib/client/firebase';
import {
  FIXTURE_EVENT_NAME,
  type FixtureScenario,
  type FixtureState,
  getFixtureState,
  resetFixtureScenario,
  setFixtureRole,
  setFixtureSimulatedOutcome,
  type SimulatedVerifyOutcome,
} from '@/lib/client/fixtures';
import type { MeData, Role } from '@/lib/client/types';
import { AppHeader } from './AppHeader';
import { CoachDashboard } from './CoachDashboard';
import { GoogleIcon } from './icons';
import { Landing } from './Landing';
import {
  AnimatedAlert,
  BlurReveal,
  MagneticButton,
  Marquee,
  MotionProvider,
  SpotlightCard,
  TelemetryGridBackdrop,
  TextShimmer,
} from './motion/primitives';
import { ParentFeeView } from './ParentFeeView';

interface CleanSheetAppProps {
  routeRole?: Role;
  activePath: '/' | '/coach' | '/parent';
}

const pageTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.34, ease: [0.16, 1, 0.3, 1] },
} as const;

const MARQUEE_ITEMS = [
  'CLEANSHEET TELEMETRY',
  'SARVAM SAARAS:V4 + 105B + MCP',
  'CASHFREE PG & SUBSCRIPTIONS SANDBOX',
  'SECURE ID OTP + RELAY CONSENT',
  'FIRST TOUCH ACADEMY U12',
];

export function CleanSheetApp({ routeRole, activePath }: CleanSheetAppProps) {
  const fixtureMode = isFixtureModeEnabled();
  const firebaseReady = isFirebaseConfigured();

  const [authReady, setAuthReady] = useState<boolean>(fixtureMode);
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<MeData | null>(null);
  const [authError, setAuthError] = useState<string>('');
  const [signingIn, setSigningIn] = useState<boolean>(false);

  const [fixtureState, setFixtureState] = useState<FixtureState | null>(null);
  const [refreshSignal, setRefreshSignal] = useState<number>(0);
  const [returnOrderId, setReturnOrderId] = useState<string | null>(null);

  const syncFixtureState = useCallback(() => {
    if (!fixtureMode) {
      return;
    }
    const next = getFixtureState();
    setFixtureState(next);
    setRefreshSignal((prev) => prev + 1);
  }, [fixtureMode]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const orderParam = params.get('order_id') || params.get('orderId');
      if (orderParam) {
        setReturnOrderId(orderParam);
      }
    }
  }, []);

  useEffect(() => {
    if (!fixtureMode) {
      return;
    }

    if (routeRole) {
      const current = getFixtureState();
      if (current.role !== routeRole) {
        setFixtureRole(routeRole);
      }
    }
    syncFixtureState();

    const handleStorage = () => syncFixtureState();
    window.addEventListener('storage', handleStorage);
    window.addEventListener(FIXTURE_EVENT_NAME, handleStorage);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(FIXTURE_EVENT_NAME, handleStorage);
    };
  }, [fixtureMode, routeRole, syncFixtureState]);

  useEffect(() => {
    if (fixtureMode) {
      return;
    }

    const unsubscribe = subscribeToAuthState((nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return unsubscribe;
  }, [fixtureMode]);

  const loadIdentity = useCallback(async () => {
    if (!fixtureMode && !user) {
      setMe(null);
      return;
    }
    setAuthError('');
    const res = await fetchMe();
    if (res.ok) {
      setMe(res.data);
    } else {
      setMe(null);
      setAuthError(`${res.error.code}: ${res.error.message}`);
    }
  }, [fixtureMode, user]);

  useEffect(() => {
    if (!authReady) {
      return;
    }
    void loadIdentity();
  }, [authReady, loadIdentity, fixtureState]);

  async function handleGoogleSignIn() {
    setAuthError('');
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSignOut() {
    await signOutUser();
    setMe(null);
  }

  function handleFixtureRoleChange(role: Role) {
    setFixtureRole(role);
    syncFixtureState();
  }

  function handleFixtureScenarioChange(scenario: FixtureScenario) {
    resetFixtureScenario(scenario);
    syncFixtureState();
  }

  function handleFixtureOutcomeChange(outcome: SimulatedVerifyOutcome) {
    setFixtureSimulatedOutcome(outcome);
    syncFixtureState();
  }

  const needsSignIn = !fixtureMode && !user;
  const showRoleMismatch = Boolean(me && routeRole && me.role !== routeRole);

  let viewKey: string;
  let view: ReactNode;

  if (activePath === '/') {
    viewKey = 'landing';
    view = (
      <Landing
        fixtureMode={fixtureMode}
        firebaseReady={firebaseReady}
        needsSignIn={authReady && needsSignIn}
        me={me}
        signingIn={signingIn}
        authError={authError}
        onSignIn={() => void handleGoogleSignIn()}
      />
    );
  } else if (!authReady) {
    viewKey = 'checking';
    view = (
      <div className="card status-card">
        <TextShimmer>Verifying Firebase session…</TextShimmer>
      </div>
    );
  } else if (needsSignIn) {
    viewKey = 'signin';
    view = (
      <SpotlightCard as="section" className="card signin-card" aria-labelledby="main-heading">
        <p className="eyebrow mono">AUTH // FIRST TOUCH ACADEMY U12</p>
        <BlurReveal
          as="h1"
          id="main-heading"
          tabIndex={-1}
          className="display-title"
          text="Sign in to continue."
        />
        <p className="page-subtitle signin-sub">
          Authenticate with the Google account linked to your Coach or Parent role.
        </p>
        {!firebaseReady ? (
          <div className="alert alert-error" role="alert">
            Firebase browser configuration (<span className="mono">NEXT_PUBLIC_FIREBASE_*</span>) is
            missing and local fixtures are disabled.
          </div>
        ) : (
          <MagneticButton
            className="btn btn-primary btn-lg"
            onClick={() => void handleGoogleSignIn()}
            disabled={signingIn}
          >
            <GoogleIcon />
            {signingIn ? 'Signing in…' : 'Sign in with Google'}
          </MagneticButton>
        )}
        <AnimatedAlert message={authError} tone="error" role="alert" />
      </SpotlightCard>
    );
  } else if (!me) {
    viewKey = 'resolving';
    view = (
      <section className="card signin-card" aria-labelledby="main-heading">
        <h1 id="main-heading" tabIndex={-1} className="display-title">
          <TextShimmer>Resolving academy role…</TextShimmer>
        </h1>
        <p className="page-subtitle">
          Checking Firebase ID token via <span className="mono">GET /api/me</span>.
        </p>
        <AnimatedAlert message={authError} tone="error" role="alert" />
      </section>
    );
  } else if (showRoleMismatch) {
    viewKey = 'mismatch';
    view = (
      <section className="card signin-card" aria-labelledby="main-heading">
        <h1 id="main-heading" tabIndex={-1} className="display-title">
          Scope boundary enforced.
        </h1>
        <p className="page-subtitle signin-sub">
          You are authenticated as <strong>{me.role}</strong> ({me.academyName} · {me.teamName}),
          which cannot open the <strong>{routeRole}</strong> view.
        </p>
        <Link href={me.role === 'coach' ? '/coach' : '/parent'} className="btn btn-teal">
          Go to {me.role === 'coach' ? 'Coach console' : 'Parent portal'}
        </Link>
      </section>
    );
  } else if (me.role === 'coach') {
    viewKey = 'coach';
    view = <CoachDashboard me={me} fixtureMode={fixtureMode} refreshSignal={refreshSignal} />;
  } else {
    viewKey = 'parent';
    view = (
      <ParentFeeView
        me={me}
        fixtureMode={fixtureMode}
        returnOrderId={returnOrderId}
        refreshSignal={refreshSignal}
      />
    );
  }

  return (
    <MotionProvider>
      <div className="app-shell">
        <TelemetryGridBackdrop />

        <AppHeader
          me={me}
          fixtureMode={fixtureMode}
          fixtureState={fixtureState}
          activePath={activePath}
          userEmail={user?.email}
          onSignOut={() => void handleSignOut()}
          onFixtureRoleChange={handleFixtureRoleChange}
          onFixtureScenarioChange={handleFixtureScenarioChange}
          onFixtureOutcomeChange={handleFixtureOutcomeChange}
        />

        <main className="main-container">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={viewKey} {...pageTransition}>
              {view}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="site-footer">
          <Marquee items={MARQUEE_ITEMS} />
          <div className="footer-meta mono">
            <span>CLEANSHEET // CASHFREE × SARVAM BUILDATHON</span>
            <span>FIREBASE AUTH + FIRESTORE RULES + SANDBOX ONLY</span>
          </div>
        </footer>
      </div>
    </MotionProvider>
  );
}
