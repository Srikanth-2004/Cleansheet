const CASHFREE_SDK_URL = 'https://sdk.cashfree.com/js/v3/cashfree.js';

interface CashfreeCheckoutInstance {
  checkout: (options: {
    paymentSessionId: string;
    redirectTarget?: '_self' | '_blank' | '_modal';
  }) => Promise<{ error?: { message?: string }; redirect?: boolean; paymentDetails?: unknown }>;
  subscriptionsCheckout: (options: {
    subsSessionId: string;
    redirectTarget: '_self' | '_blank';
  }) => Promise<{ error?: { message?: string } } | undefined>;
}

declare global {
  interface Window {
    Cashfree?: (options: { mode: 'sandbox' | 'production' }) => CashfreeCheckoutInstance;
  }
}

let sdkPromise: Promise<void> | null = null;

function loadCashfreeSdk(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Cashfree SDK can only run in the browser.'));
  }
  if (window.Cashfree) {
    return Promise.resolve();
  }
  if (sdkPromise) {
    return sdkPromise;
  }

  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CASHFREE_SDK_URL}"]`,
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Cashfree SDK.')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = CASHFREE_SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Unable to load Cashfree JS v3 SDK.'));
    };
    document.head.appendChild(script);
  });

  return sdkPromise;
}

export async function openCashfreeSandboxCheckout(paymentSessionId: string): Promise<void> {
  await loadCashfreeSdk();
  if (!window.Cashfree) {
    throw new Error('Cashfree SDK loaded without global constructor.');
  }
  const cashfree = window.Cashfree({ mode: 'sandbox' });
  const result = await cashfree.checkout({
    paymentSessionId,
    redirectTarget: '_self',
  });
  if (result?.error?.message) {
    throw new Error(result.error.message);
  }
}

export async function openCashfreeSandboxSubscription(subsSessionId: string): Promise<void> {
  await loadCashfreeSdk();
  if (!window.Cashfree) throw new Error('Cashfree SDK loaded without global constructor.');
  const cashfree = window.Cashfree({ mode: 'sandbox' });
  const result = await cashfree.subscriptionsCheckout({ subsSessionId, redirectTarget: '_self' });
  if (result?.error?.message) throw new Error(result.error.message);
}
