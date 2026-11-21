import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

/**
 * Local fixtures are strictly disabled on deployed production builds unless
 * NEXT_PUBLIC_USE_FIXTURES is explicitly "true". Setting NEXT_PUBLIC_USE_FIXTURES="false"
 * disables fixtures everywhere.
 */
export function isFixtureModeEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_FIXTURES;
  if (flag === 'false') {
    return false;
  }
  if (process.env.NODE_ENV === 'production') {
    return flag === 'true';
  }
  if (flag === 'true') {
    return true;
  }
  return !isFirebaseConfigured();
}

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;

export function getFirebaseAuthClient(): Auth | null {
  if (typeof window === 'undefined' || !isFirebaseConfigured()) {
    return null;
  }

  if (!cachedApp) {
    cachedApp = getApps().find(app => app.name === 'cleansheet') ?? initializeApp(firebaseConfig, 'cleansheet');
  }
  if (!cachedAuth) {
    cachedAuth = getAuth(cachedApp);
    const emulatorUrl = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL;
    if (process.env.NODE_ENV !== 'production' && emulatorUrl) connectAuthEmulator(cachedAuth, emulatorUrl);
  }
  return cachedAuth;
}

export async function signInWithGoogle(): Promise<User> {
  const auth = getFirebaseAuthClient();
  if (!auth) {
    throw new Error('Firebase browser configuration is missing.');
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  return credential.user;
}

export async function signOutUser(): Promise<void> {
  const auth = getFirebaseAuthClient();
  if (auth) {
    await signOut(auth);
  }
}

export async function getCurrentIdToken(forceRefresh = false): Promise<string | null> {
  const auth = getFirebaseAuthClient();
  await auth?.authStateReady();
  const user = auth?.currentUser;
  if (!user) {
    return null;
  }
  return user.getIdToken(forceRefresh);
}

export function subscribeToAuthState(callback: (user: User | null) => void): () => void {
  const auth = getFirebaseAuthClient();
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}
