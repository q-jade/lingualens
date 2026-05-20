export const ONBOARDING_PENDING_KEY = 'onboardingPending';

export async function isOnboardingPending(): Promise<boolean> {
  const result = await browser.storage.local.get(ONBOARDING_PENDING_KEY);
  return Boolean(result[ONBOARDING_PENDING_KEY]);
}

export async function markOnboardingPending(): Promise<void> {
  await browser.storage.local.set({ [ONBOARDING_PENDING_KEY]: true });
}

export async function clearOnboardingPending(): Promise<void> {
  await browser.storage.local.remove(ONBOARDING_PENDING_KEY);
}
