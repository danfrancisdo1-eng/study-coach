export type ProviderAsset = {
  name: string;
  uri: string;
  size?: number;
  mimeType?: string;
};

export type ProviderResult =
  | { canceled: true; assets?: null }
  | { canceled: false; assets: ProviderAsset[] };

export const FILE_PROVIDER_OPTIONS = {
  type: '*/*',
  copyToCacheDirectory: true,
  multiple: false,
} as const;

const SUPPORTED_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'pdf', 'docx', 'pptx', 'png', 'jpg', 'jpeg', 'webp',
]);

/**
 * iOS presents the available Files providers; it cannot be forced to OneDrive.
 * The picker completes after the selected provider supplies a local cache copy.
 * This function never enumerates accounts, folders or other unselected files.
 */
export async function selectProviderMaterial(
  pick: (options: typeof FILE_PROVIDER_OPTIONS) => Promise<ProviderResult>,
): Promise<ProviderAsset | null> {
  const result = await pick(FILE_PROVIDER_OPTIONS);
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset?.uri || !asset.name) {
    throw new Error('The selected file could not be downloaded or copied to this device. Please retry in Files.');
  }
  const extension = asset.name.split('.').pop()?.toLowerCase();
  if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`${asset.name}: unsupported file type. Choose TXT/Markdown, PDF, DOCX, PPTX, PNG, JPEG or WebP. Scanned PDFs need page screenshots; legacy DOC, XLSX and HEIC files are not supported.`);
  }
  if (asset.size !== undefined && asset.size > 12 * 1024 * 1024) {
    throw new Error(`${asset.name} exceeds the 12 MB limit. Select a smaller file.`);
  }
  if (asset.size === 0) throw new Error(`${asset.name} is empty. Select a nonempty file.`);
  return asset;
}