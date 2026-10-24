// Direct OneDrive (D-190): the student signs in with Microsoft on the phone and picks a file from
// their own OneDrive. Pure helpers only (no Expo imports) so unit tests load this file directly;
// sign-in, token storage and the download live in onedrive-session.ts.
//
// Microsoft app registration "Study Coach" (docs/microsoft-registration.md): a public client, so
// there is no secret anywhere. The client ID is configuration, not a password. Read-only access.
// The same types the Files button accepts (material-file-provider.ts; a test keeps the two equal).
// A local copy because this file is loaded by the tests without the app's import resolver.
export const READABLE_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'pdf', 'docx', 'pptx', 'png', 'jpg', 'jpeg', 'webp']);

export const ONEDRIVE_CLIENT_ID = '4c70bc67-bc44-4e37-8db0-7363dac3aa16';
/** Read the student's own files; offline_access keeps them signed in (a refresh token). */
export const ONEDRIVE_SCOPES = ['Files.Read', 'offline_access'];
/** "common": personal Microsoft accounts and school/work accounts (the registration's audience). */
export const ONEDRIVE_DISCOVERY = {
  authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
};
/** Registered in Azure as a "Mobile and desktop" redirect URI: study-coach-mobile://onedrive */
export const ONEDRIVE_REDIRECT_PATH = 'onedrive';
export const MAX_ONEDRIVE_BYTES = 12 * 1024 * 1024;

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SELECT = 'id,name,size,folder,file,lastModifiedDateTime';

export type OneDriveRow = {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  size: number;
  /** Items inside a folder (0 when unknown). */
  childCount: number;
  modified: string;
};

export type StoredTokens = { accessToken: string; refreshToken?: string; expiresAt: number };

/** A folder's contents, or the top of the drive when no folder is given. */
export function listUrl(folderId?: string | null): string {
  const where = folderId ? `/me/drive/items/${encodeURIComponent(folderId)}` : '/me/drive/root';
  return `${GRAPH}${where}/children?$select=${SELECT}&$top=200`;
}

/** Search the whole drive by name and content. OData strings double their single quotes. */
export function searchUrl(query: string): string {
  const q = query.trim().replace(/'/g, "''");
  return `${GRAPH}/me/drive/root/search(q='${encodeURIComponent(q)}')?$select=${SELECT}&$top=100`;
}

/** One file's details, including the short-lived download link Microsoft signs for it. */
export function itemUrl(id: string): string {
  return `${GRAPH}/me/drive/items/${encodeURIComponent(id)}`;
}

/** Whose OneDrive this is, for the "Signed in as" line. */
export const DRIVE_URL = `${GRAPH}/me/drive?$select=owner`;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isReadable(name: string): boolean {
  return READABLE_EXTENSIONS.has(extensionOf(name));
}

export function isPhoto(name: string): boolean {
  return ['png', 'jpg', 'jpeg', 'webp'].includes(extensionOf(name));
}

/**
 * Graph's list → rows the student can use: folders first, then files the app can read (the rest
 * are hidden, so nothing on the list fails when tapped), each group A–Z. Malformed entries are
 * skipped. OneNote notebooks and other packages are neither folders nor files and are skipped too.
 */
export function parseItems(body: unknown): OneDriveRow[] {
  const value = body && typeof body === 'object' && Array.isArray((body as { value?: unknown }).value)
    ? (body as { value: unknown[] }).value : [];
  const rows: OneDriveRow[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name.trim()) continue;
    const folder = item.folder && typeof item.folder === 'object' ? item.folder as { childCount?: unknown } : null;
    const isFile = Boolean(item.file && typeof item.file === 'object');
    if (!folder && !isFile) continue;
    if (!folder && !isReadable(item.name)) continue;
    rows.push({
      id: item.id,
      name: item.name,
      kind: folder ? 'folder' : 'file',
      size: typeof item.size === 'number' && item.size > 0 ? item.size : 0,
      childCount: folder && typeof folder.childCount === 'number' ? folder.childCount : 0,
      modified: typeof item.lastModifiedDateTime === 'string' ? item.lastModifiedDateTime : '',
    });
  }
  return rows.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) : a.kind === 'folder' ? -1 : 1));
}

/** Why a file can't be used, in one plain sentence; null when it can. */
export function pickProblem(row: Pick<OneDriveRow, 'name' | 'size' | 'kind'>): string | null {
  if (row.kind !== 'file') return 'Open the folder, then choose a file.';
  if (!isReadable(row.name)) return `${row.name} can't be read. Choose a PDF, Word, PowerPoint, text or photo file.`;
  if (row.size > MAX_ONEDRIVE_BYTES) return `${row.name} is bigger than 12 MB. Choose a smaller file.`;
  return null;
}

/** "2.4 MB", "830 KB", "12 items". */
export function rowDetail(row: OneDriveRow): string {
  if (row.kind === 'folder') return row.childCount === 1 ? '1 item' : `${row.childCount} items`;
  if (row.size >= 1024 * 1024) return `${(row.size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(row.size / 1024))} KB`;
}

/** Usable for at least another minute (a list or download started now finishes in time). */
export function tokenFresh(tokens: StoredTokens | null, now = Date.now()): boolean {
  return Boolean(tokens?.accessToken) && (tokens as StoredTokens).expiresAt - now > 60_000;
}

/** The token reply → what is kept in the phone's secure storage. */
export function toStored(reply: { accessToken: string; refreshToken?: string; expiresIn?: number; issuedAt?: number }, previousRefresh?: string): StoredTokens {
  const issuedMs = typeof reply.issuedAt === 'number' ? reply.issuedAt * 1000 : Date.now();
  const lifeMs = (typeof reply.expiresIn === 'number' && reply.expiresIn > 0 ? reply.expiresIn : 3600) * 1000;
  const refreshToken = reply.refreshToken ?? previousRefresh;
  return { accessToken: reply.accessToken, ...(refreshToken ? { refreshToken } : {}), expiresAt: issuedMs + lifeMs };
}

export function parseStored(raw: string | null): StoredTokens | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredTokens>;
    if (typeof value.accessToken !== 'string' || typeof value.expiresAt !== 'number') return null;
    return { accessToken: value.accessToken, expiresAt: value.expiresAt, ...(typeof value.refreshToken === 'string' ? { refreshToken: value.refreshToken } : {}) };
  } catch {
    return null;
  }
}

/** The drive owner's name from DRIVE_URL's reply, or ''. */
export function ownerName(body: unknown): string {
  const user = (body as { owner?: { user?: { displayName?: unknown } } } | null)?.owner?.user;
  return typeof user?.displayName === 'string' ? user.displayName.trim().slice(0, 80) : '';
}

/** The signed download link from itemUrl's reply, or null. */
export function downloadLink(body: unknown): string | null {
  const link = (body as Record<string, unknown> | null)?.['@microsoft.graph.downloadUrl'];
  return typeof link === 'string' && /^https:\/\//.test(link) ? link : null;
}

export class OneDriveError extends Error {
  /** The sign-in expired or was revoked, so the student signs in again. */
  reconnect: boolean;
  constructor(message: string, reconnect = false) {
    super(message);
    this.reconnect = reconnect;
  }
}

/** A Graph status → a plain sentence (never a raw error from Microsoft). */
export function graphProblem(status: number): OneDriveError {
  if (status === 401) return new OneDriveError('Your OneDrive sign-in expired. Sign in again.', true);
  if (status === 403) return new OneDriveError("OneDrive didn't allow access to this. If it's a school or work account, your school may block outside apps.");
  if (status === 404) return new OneDriveError('That file or folder is no longer in your OneDrive.');
  if (status === 429 || status === 503) return new OneDriveError('OneDrive is busy. Try again in a minute.');
  return new OneDriveError("Couldn't reach OneDrive. Check your connection and try again.");
}
