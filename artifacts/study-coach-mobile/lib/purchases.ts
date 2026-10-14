/**
 * Apple in-app purchases through RevenueCat (D-090). The RevenueCat app user id is the Clerk
 * user id, so its webhook reaches the right account on our server; after a purchase or restore
 * the app asks the server to re-check (POST /premium/refresh), and the server stays the source
 * of truth for limits.
 *
 * Purchases need a development build: in Expo Go the SDK runs in preview mode, so the paywall
 * says purchases are not available in this build. EXPO_PUBLIC_REVENUECAT_IOS_KEY is RevenueCat's
 * public SDK key (made to ship in apps), never the secret key.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import Purchases, { PURCHASES_ERROR_CODE, type PurchasesPackage } from 'react-native-purchases';

const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
let configuredFor: string | null = null;

/** True in a development or App Store build with a key; false in Expo Go and on the web. */
export function purchasesAvailable(): boolean {
  return Platform.OS === 'ios' && apiKey.length > 0 && Constants.executionEnvironment !== 'storeClient';
}

/** Configure once per signed-in account (and switch accounts on sign-in as someone else). */
export async function preparePurchases(userId: string): Promise<boolean> {
  if (!purchasesAvailable()) return false;
  if (configuredFor === userId) return true;
  if (configuredFor === null) Purchases.configure({ apiKey, appUserID: userId });
  else await Purchases.logIn(userId);
  configuredFor = userId;
  return true;
}

/** The current offering's packages (monthly and yearly), or [] when purchases are unavailable. */
export async function premiumPackages(userId: string): Promise<PurchasesPackage[]> {
  if (!await preparePurchases(userId)) return [];
  const offerings = await Purchases.getOfferings();
  return offerings.current?.availablePackages ?? [];
}

export type PurchaseOutcome = 'purchased' | 'cancelled';

/** Buy a package. A cancel in Apple's sheet is not an error. */
export async function buy(userId: string, pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  await preparePurchases(userId);
  try {
    await Purchases.purchasePackage(pkg);
    return 'purchased';
  } catch (error) {
    const e = error as { code?: unknown; userCancelled?: boolean | null };
    if (e.userCancelled || e.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return 'cancelled';
    throw error;
  }
}

/** Restore Purchases (Apple requires it): re-links any subscription on this Apple ID to the account. */
export async function restore(userId: string): Promise<void> {
  if (!await preparePurchases(userId)) return;
  await Purchases.restorePurchases();
}

/** Apple's own subscription settings, where the student cancels or changes plan. */
export const MANAGE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';
/** Apple's standard licence agreement, linked from the paywall as App Review expects. */
export const TERMS_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
