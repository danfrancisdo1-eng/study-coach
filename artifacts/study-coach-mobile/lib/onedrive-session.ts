// Direct OneDrive (D-190): sign-in, the kept sign-in, Graph calls and the download, all on the
// phone. The Microsoft tokens never go to our server. Only the refresh token is stored, in the
// phone's secure storage (Keychain); the short-lived access token stays in memory.
import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import {
  DRIVE_URL, ONEDRIVE_CLIENT_ID, ONEDRIVE_DISCOVERY, ONEDRIVE_REDIRECT_PATH, ONEDRIVE_SCOPES,
  OneDriveError, downloadLink, graphProblem, itemUrl, listUrl, ownerName, parseItems, pickProblem,
  searchUrl, toStored, tokenFresh, type OneDriveRow, type StoredTokens,
} from './onedrive';

const REFRESH_KEY = 'onedrive.refreshToken';
let memory: StoredTokens | null = null;

function redirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: 'study-coach-mobile', path: ONEDRIVE_REDIRECT_PATH });
}

async function keep(tokens: StoredTokens): Promise<void> {
  memory = tokens;
  if (tokens.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
}

/** True when this phone has a OneDrive sign-in (it may still need a refresh). */
export async function isConnected(): Promise<boolean> {
  if (memory) return true;
  return Boolean(await SecureStore.getItemAsync(REFRESH_KEY));
}

/** Microsoft's sign-in page in a browser sheet. False when the student closed it. */
export async function connect(): Promise<boolean> {
  if (Constants.executionEnvironment === 'storeClient') {
    // Expo Go answers on its own exp:// address, which Microsoft does not know.
    throw new OneDriveError('OneDrive sign-in works in the TestFlight or App Store app, not in Expo Go.');
  }
  const uri = redirectUri();
  const request = new AuthSession.AuthRequest({
    clientId: ONEDRIVE_CLIENT_ID, scopes: ONEDRIVE_SCOPES, redirectUri: uri, usePKCE: true,
    extraParams: { prompt: 'select_account' },
  });
  const result = await request.promptAsync(ONEDRIVE_DISCOVERY);
  if (result.type === 'cancel' || result.type === 'dismiss') return false;
  if (result.type !== 'success' || typeof result.params.code !== 'string' || !request.codeVerifier) {
    const denied = result.type === 'error' && /access_denied|consent/i.test(`${result.params?.error ?? ''} ${result.params?.error_description ?? ''}`);
    throw new OneDriveError(denied
      ? "Microsoft didn't allow the sign-in. If it's a school or work account, your school may block outside apps."
      : "The OneDrive sign-in didn't finish. Try again.");
  }
  const reply = await AuthSession.exchangeCodeAsync({
    clientId: ONEDRIVE_CLIENT_ID, code: result.params.code, redirectUri: uri, scopes: ONEDRIVE_SCOPES,
    extraParams: { code_verifier: request.codeVerifier },
  }, ONEDRIVE_DISCOVERY);
  await keep(toStored(reply));
  return true;
}

/** Removes the sign-in from this phone. */
export async function disconnect(): Promise<void> {
  memory = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

async function accessToken(): Promise<string> {
  if (tokenFresh(memory)) return (memory as StoredTokens).accessToken;
  const refreshToken = memory?.refreshToken ?? await SecureStore.getItemAsync(REFRESH_KEY);
  if (!refreshToken) throw new OneDriveError('Sign in to OneDrive first.', true);
  try {
    const reply = await AuthSession.refreshAsync({ clientId: ONEDRIVE_CLIENT_ID, refreshToken, scopes: ONEDRIVE_SCOPES }, ONEDRIVE_DISCOVERY);
    await keep(toStored(reply, refreshToken));
    return (memory as StoredTokens).accessToken;
  } catch (problem) {
    // A refused refresh (revoked, expired after months unused) means signing in again; a
    // network failure keeps the sign-in so the next try can work.
    const refused = problem instanceof Error && /invalid_grant|interaction_required|AADSTS/i.test(problem.message);
    if (refused) { await disconnect(); throw new OneDriveError('Your OneDrive sign-in expired. Sign in again.', true); }
    throw new OneDriveError("Couldn't reach OneDrive. Check your connection and try again.");
  }
}

async function graph(url: string, signal?: AbortSignal): Promise<unknown> {
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal });
  } catch (problem) {
    if (signal?.aborted) throw problem;
    throw new OneDriveError("Couldn't reach OneDrive. Check your connection and try again.");
  }
  if (response.status === 401) { await disconnect(); throw graphProblem(401); }
  if (!response.ok) throw graphProblem(response.status);
  return response.json();
}

/** A folder's readable contents (the top of the drive when folderId is null). */
export async function listFolder(folderId: string | null, signal?: AbortSignal): Promise<OneDriveRow[]> {
  return parseItems(await graph(listUrl(folderId), signal));
}

export async function searchDrive(query: string, signal?: AbortSignal): Promise<OneDriveRow[]> {
  return parseItems(await graph(searchUrl(query), signal));
}

/** The drive owner's name for "Signed in as …" ('' when Microsoft doesn't say). */
export async function driveOwner(signal?: AbortSignal): Promise<string> {
  return ownerName(await graph(DRIVE_URL, signal));
}

/** Copies the chosen file to the phone's cache; the upload then goes through the normal path. */
export async function downloadToCache(row: OneDriveRow): Promise<string> {
  const problem = pickProblem(row);
  if (problem) throw new OneDriveError(problem);
  const link = downloadLink(await graph(itemUrl(row.id)));
  if (!link) throw new OneDriveError(`${row.name} couldn't be downloaded from OneDrive. Try again.`);
  const safeName = row.name.replace(/[\\/:*?"<>|]/g, '_').slice(-120);
  const target = new File(Paths.cache, `onedrive-${Date.now().toString(36)}-${safeName}`);
  try {
    // The link is pre-signed by Microsoft for a few minutes, so no sign-in header is sent with it.
    const file = await File.downloadFileAsync(link, target, { idempotent: true });
    return file.uri;
  } catch {
    throw new OneDriveError(`${row.name} couldn't be downloaded from OneDrive. Check your connection and try again.`);
  }
}
