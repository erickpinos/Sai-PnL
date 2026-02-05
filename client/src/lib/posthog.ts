import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';

export function initPostHog() {
  if (POSTHOG_KEY) {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
    });
  }
}

export function identifyUser(address: string) {
  if (POSTHOG_KEY) {
    posthog.identify(address, {
      wallet_address: address,
    });
  }
}

export function resetUser() {
  if (POSTHOG_KEY) {
    posthog.reset();
  }
}

export function trackEvent(eventName: string, properties?: Record<string, any>) {
  if (POSTHOG_KEY) {
    posthog.capture(eventName, properties);
  }
}

export { posthog };
