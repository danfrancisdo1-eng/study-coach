import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { File as ExpoFile } from 'expo-file-system';
import { useExtractStudyWebsite, type StudyMaterialExtraction } from '@workspace/api-client-react';
import { selectProviderMaterial } from '@/lib/material-file-provider';
import { useColors } from '@/hooks/useColors';
import { friendlyError } from '@/lib/friendly-error';
import { ActionButton } from '@/components/ActionButton';
import { NotesView } from '@/components/NotesView';
import { ProgressBar, useElapsed } from '@/components/ProgressBar';
import { materialWorkMs, timeLeftText, uploadThenWork } from '@/lib/progress';
import { uploadMaterial } from '@/lib/material-upload';
import { isStorageFull, partRange, partsSavedLine } from '@/lib/upload-parts';
import { useAuth } from '@clerk/expo';

/**
 * Material intake (CLAUDE.md §8): Photos, Files, OneDrive (via the Files picker),
 * Website link → transient extraction → editable preview → explicit "Save to course".
 * Extracted verbatim from app/(tabs)/courses.tsx so the chat-first home can reuse it.
 * The component owns its transient state; the parent owns the saved materials.
 */

export type SavedMaterial = {
  id: string;
  courseId: string;
  name: string;
  text: string;
  extractionFormat?: StudyMaterialExtraction['format'];
  extractionStatus?: StudyMaterialExtraction['status'];
  extractionCoverage?: StudyMaterialExtraction['coverage'];
  coverageNote?: string;
  sourceUrl?: string;
  /** D-124: the coach's Markdown notes (the raw `text` is kept unchanged). */
  notes?: string;
};

export type IntakeStatus = { uploading: boolean; reviewing: boolean; saving: boolean };

type PendingMaterial = { id: string; url?: string; uri: string; filename: string; courseId: string };

function id(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

// One plain sentence, never a native exception or a URL (D-065, D-067).
const readableError = (problem: unknown): string => friendlyError(problem);

function MaterialExtractionTask({ upload, onComplete, onFailure, onProgress }: {
  upload: PendingMaterial;
  onComplete: (upload: PendingMaterial, result: StudyMaterialExtraction) => void;
  onFailure: (upload: PendingMaterial, problem: unknown) => void;
  /** D-126: the share of the file sent so far (0–1), and the file's size once known. */
  onProgress: (sent: number, bytes: number) => void;
}) {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;
  const websiteExtraction = useExtractStudyWebsite();
  const websiteMutationRef = useRef(websiteExtraction.mutateAsync);
  websiteMutationRef.current = websiteExtraction.mutateAsync;
  const callbacksRef = useRef({ onComplete, onFailure });
  callbacksRef.current = { onComplete, onFailure };

  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    const extract = async () => {
      try {
        if (upload.url) {
          const result = await websiteMutationRef.current({ data: { url: upload.url } });
          if (active) callbacksRef.current.onComplete(upload, result);
          return;
        }
        const file = new ExpoFile(upload.uri);
        if (file.size > 12 * 1024 * 1024) {
          throw new Error('Files must be 12 MB or smaller. No text was extracted.');
        }
        if (file.size === 0) {
          throw new Error('The selected file is empty. No text was extracted.');
        }
        if (!active) return;
        progressRef.current(0, file.size);
        // D-126: streamed from disk with upload progress (same route, headers and auth as before).
        const result = await uploadMaterial({
          file, filename: upload.filename, token: await getTokenRef.current(), signal: abort.signal,
          onProgress: (sent) => { if (active) progressRef.current(sent, file.size); },
        });
        if (!active) return;
        if (result.status !== 'complete' || !result.text.trim()) {
          throw new Error('The server did not return a complete text extraction. Nothing was saved.');
        }
        callbacksRef.current.onComplete(upload, result);
      } catch (problem) {
        if (active) callbacksRef.current.onFailure(upload, problem);
      }
    };
    void extract();
    return () => { active = false; abort.abort(); };
  }, [upload.id]);

  return null;
}

export function MaterialIntake({ courseId, aiConsent, busy, savedMaterials, onSave, onStatusChange, onError, footer }: {
  courseId: string;
  aiConsent: boolean;
  /** Parent-level busy flag (other mutations in flight). */
  busy: boolean;
  /** Materials already saved for this course, for the duplicate check. */
  savedMaterials: SavedMaterial[];
  /** Persist the reviewed material in one save: one upload, or a big file's parts (D-185). Throws on failure; the preview is kept so the student can retry. */
  onSave: (additions: SavedMaterial[]) => Promise<void>;
  onStatusChange?: (status: IntakeStatus) => void;
  onError?: (problem: unknown) => void;
  /** Rendered under the controls (check-in actions, "Done" button). */
  footer?: (status: IntakeStatus) => React.ReactNode;
}) {
  const colors = useColors();
  const styles = createStyles(colors);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [showWebsiteInput, setShowWebsiteInput] = useState(false);
  const [showCloudHelp, setShowCloudHelp] = useState(false);
  const [materialNotice, setMaterialNotice] = useState('');
  const [materialUpload, setMaterialUpload] = useState<PendingMaterial | null>(null);
  const [extractedMaterial, setExtractedMaterial] = useState<StudyMaterialExtraction | null>(null);
  const [materialUploading, setMaterialUploading] = useState(false);
  // D-126: what the waiting bar shows. sent = share of the file uploaded; workStart = when the
  // server's part (reading, writing notes) began; size drives the estimate.
  const [sent, setSent] = useState(0);
  const [fileBytes, setFileBytes] = useState(0);
  const [workStart, setWorkStart] = useState<number | null>(null);
  const uploadElapsed = useElapsed(materialUploading);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const status: IntakeStatus = { uploading: materialUploading, reviewing: Boolean(extractedMaterial), saving };
  const statusRef = useRef(onStatusChange);
  statusRef.current = onStatusChange;
  useEffect(() => { statusRef.current?.(status); }, [status.uploading, status.reviewing, status.saving]);
  const allBusy = busy || materialUploading || saving;

  const chooseMaterial = async () => {
    try {
      const picked = await selectProviderMaterial(DocumentPicker.getDocumentAsync);
      if (!picked || !mounted.current) return;
      const fileName = picked.name || 'Selected file';
      const extension = fileName.split('.').pop()?.toLowerCase();
      if (['jpg', 'jpeg', 'png', 'webp'].includes(extension ?? '') && !aiConsent) {
        setMaterialNotice('Enable AI-assisted study before reading photos.');
        return;
      }
      if (picked.size && picked.size > 12 * 1024 * 1024) {
        setMaterialNotice(`${fileName} was not uploaded or saved (larger than 12 MB).`);
        Alert.alert('File is too large', 'The extraction service accepts files up to 12 MB.');
        return;
      }
      setExtractedMaterial(null);
      setMaterialUploading(true); setSent(0); setFileBytes(0); setWorkStart(null);
      setMaterialNotice(`${fileName} · uploading for text extraction. Nothing is saved yet.`);
      setMaterialUpload({ id: id(), uri: picked.uri, filename: fileName, courseId });
    } catch (problem) {
      if (!mounted.current) return;
      setMaterialNotice(`The file was not saved. ${readableError(problem)}`);
      onError?.(problem);
    }
  };

  const choosePhoto = async () => {
    if (allBusy || extractedMaterial) return;
    if (!aiConsent) {
      setMaterialNotice('Enable AI-assisted study before reading photos.');
      return;
    }
    try {
      // The system picker grants access only to the photo the student selects.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 1, allowsMultipleSelection: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled || !result.assets[0] || !mounted.current) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > 12 * 1024 * 1024) {
        setMaterialNotice('Choose a photo smaller than 12 MB.');
        return;
      }
      const filename = asset.fileName || 'Study photo.jpg';
      setExtractedMaterial(null);
      setMaterialUploading(true); setSent(0); setFileBytes(0); setWorkStart(null);
      setMaterialNotice('Reading your photo…');
      setMaterialUpload({ id: id(), uri: asset.uri, filename, courseId });
    } catch (problem) {
      if (mounted.current) setMaterialNotice(`Could not open Photos. ${readableError(problem)}`);
    }
  };

  const readWebsite = () => {
    if (allBusy || extractedMaterial) return;
    try {
      const input = websiteUrl.trim();
      if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:\/\//i.test(input)) throw new Error();
      const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password || url.href.length > 2048) throw new Error();
      setExtractedMaterial(null);
      setMaterialUploading(true); setSent(0); setFileBytes(0); setWorkStart(null);
      setMaterialNotice('Reading the website…');
      setMaterialUpload({ id: id(), uri: '', url: url.href, filename: url.hostname, courseId });
    } catch {
      setMaterialNotice('Enter a valid public website link.');
    }
  };

  const handleMaterialExtracted = (upload: PendingMaterial, result: StudyMaterialExtraction) => {
    if (!mounted.current || upload.courseId !== courseId) return;
    setMaterialUploading(false);
    setExtractedMaterial(result);
    setMaterialNotice(result.parts?.length ? `${result.filename} is big, so it was split into ${result.parts.length} parts at its chapters. Check them, then Save.`
      : result.notes ? `${result.filename}: here are your notes. Check them, then Save.` : `${result.filename} is ready. Notes will be written after you save.`);
  };

  const handleMaterialExtractionError = (upload: PendingMaterial, problem: unknown) => {
    if (!mounted.current || upload.courseId !== courseId) return;
    const filename = upload.filename;
    const pdfCoverage = /\.pdf$/i.test(filename)
      ? ' PDF extraction only reads selectable text; scanned or image-only PDFs are unsupported and no OCR was performed.'
      : '';
    setMaterialUploading(false);
    setMaterialUpload(null);
    setExtractedMaterial(null);
    setMaterialNotice(`${filename} was not saved. ${readableError(problem)}${pdfCoverage}`);
  };

  const saveExtractedMaterial = async () => {
    if (!materialUpload || !extractedMaterial || materialUpload.courseId !== courseId || !extractedMaterial.text.trim() || allBusy) return;
    setSaving(true);
    try {
      const base = {
        courseId,
        extractionFormat: extractedMaterial.format,
        extractionStatus: extractedMaterial.status,
        extractionCoverage: extractedMaterial.coverage,
        coverageNote: extractedMaterial.coverageNote,
        ...(extractedMaterial.sourceUrl ? { sourceUrl: extractedMaterial.sourceUrl } : {}),
      };
      const parts = extractedMaterial.parts ?? [];
      if (parts.length > 1) {
        // D-185: every part in one save; when the account is full, keep the parts that fit (from the start) and name the rest.
        const fresh = parts.filter((part) => !savedMaterials.some((material) => material.courseId === courseId && material.text === part.text));
        if (!fresh.length) { setMaterialNotice('This material is already saved for this course.'); setExtractedMaterial(null); setMaterialUpload(null); return; }
        const additions: SavedMaterial[] = fresh.map((part) => ({ ...base, id: id(), name: part.name, text: part.text }));
        let saved = additions.length;
        for (;;) {
          try {
            if (saved > 0) await onSave(additions.slice(0, saved));
            break;
          } catch (problem) {
            if (!isStorageFull(problem) || saved === 0) throw problem;
            saved -= 1;
          }
        }
        if (!mounted.current) return;
        setMaterialNotice(partsSavedLine(extractedMaterial.filename, fresh, saved));
        setExtractedMaterial(null);
        setMaterialUpload(null);
        return;
      }
      if (savedMaterials.some((material) => material.courseId === courseId && material.text === extractedMaterial.text)) {
        setMaterialNotice('This material is already saved for this course.');
        setExtractedMaterial(null);
        setMaterialUpload(null);
        return;
      }
      const addition: SavedMaterial = {
        ...base,
        id: id(),
        name: extractedMaterial.filename,
        text: extractedMaterial.text,
        ...(extractedMaterial.notes ? { notes: extractedMaterial.notes } : {}),
      };
      await onSave([addition]);
      if (!mounted.current) return;
      setMaterialNotice(`${extractedMaterial.filename} saved to this course.`);
      setExtractedMaterial(null);
      setMaterialUpload(null);
    } catch (problem) {
      if (mounted.current) onError?.(problem);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <View style={styles.stack}>
      {materialUpload ? <MaterialExtractionTask key={materialUpload.id} upload={materialUpload} onComplete={handleMaterialExtracted} onFailure={handleMaterialExtractionError}
        onProgress={(fraction, bytes) => { setSent(fraction); setFileBytes(bytes); if (fraction >= 1) setWorkStart((at) => at ?? Date.now()); }} /> : null}
      {materialUploading ? (
        <View style={styles.extractionPreview} testID="status-material-extracting">
          <Text style={styles.cardTitle}>Reading and writing notes</Text>
          {(() => {
            // D-126: a website has no upload step; a file shows its real upload, then the estimate.
            const isWebsite = Boolean(materialUpload?.url);
            const isPhoto = /\.(png|jpe?g|webp|heic)$/i.test(materialUpload?.filename ?? '');
            const expected = materialWorkMs({ kind: isWebsite ? 'website' : isPhoto ? 'photo' : 'file', bytes: fileBytes });
            const workElapsed = isWebsite ? uploadElapsed : workStart ? Date.now() - workStart : 0;
            const fraction = isWebsite ? uploadThenWork(1, workElapsed, expected) : uploadThenWork(sent, workElapsed, expected);
            const label = !isWebsite && sent < 1
              ? `Uploading ${Math.round(sent * 100)}%`
              : `${isWebsite ? 'Reading the page' : isPhoto ? 'Reading your photo' : 'Reading your file'} and writing notes · ${timeLeftText(workElapsed, expected)}`;
            return <ProgressBar fraction={fraction} label={label} testID="progress-material" />;
          })()}
          <Text style={styles.muted}>Nothing is saved until you tap Save.</Text>
          <ActionButton
            label="Cancel extraction"
            secondary
            onPress={() => {
              setMaterialUploading(false);
              setMaterialUpload(null);
              setMaterialNotice('Extraction cancelled; no material was saved.');
            }}
            testID="button-cancel-material-extraction"
          />
        </View>
      ) : null}
      {extractedMaterial ? (
        <View style={styles.extractionPreview} testID="panel-material-extraction-preview">
          <Text style={styles.kicker}>REVIEW MATERIAL · {extractedMaterial.format.toUpperCase()}</Text>
          <Text style={styles.cardTitle}>{extractedMaterial.filename}</Text>
          <Text style={styles.muted}>{extractedMaterial.coverageNote}</Text>
          {extractedMaterial.sourceUrl ? <Text selectable style={styles.caption}>{extractedMaterial.sourceUrl}</Text> : null}
          {/* D-124: read-only. Anything wrong? Tell the coach in this course's chat after saving. */}
          <ScrollView style={[styles.input, { maxHeight: 320 }]} nestedScrollEnabled testID="panel-upload-notes">
            {extractedMaterial.parts?.length ? (
              // D-185: a big file is listed by part (where each one starts and ends), not as 200,000 characters of text.
              extractedMaterial.parts.map((part, i) => (
                <View key={part.name} style={styles.partRow} testID="row-upload-part">
                  <Text style={styles.cardTitle}>Part {i + 1} of {extractedMaterial.parts!.length}</Text>
                  <Text style={styles.muted}>{partRange([part]) || `${part.characterCount.toLocaleString()} characters`}</Text>
                </View>
              ))
            ) : extractedMaterial.notes ? <NotesView notes={extractedMaterial.notes} /> : <Text selectable style={styles.muted}>{extractedMaterial.text}</Text>}
          </ScrollView>
          <Text style={styles.caption}>{extractedMaterial.parts?.length ? 'Each part is saved as its own upload, and the coach writes notes for each one.' : extractedMaterial.notes ? 'Anything wrong? After saving, tell the coach in this course\'s chat and it fixes the notes.' : 'The coach will turn this into notes after you save.'}</Text>
          <View style={styles.buttonRow}>
            <ActionButton label={extractedMaterial.parts?.length ? `Save ${extractedMaterial.parts.length} parts` : 'Save to course'} icon="check" onPress={() => void saveExtractedMaterial()} disabled={allBusy || !extractedMaterial.text.trim()} testID="button-save-extracted-material" />
            <ActionButton
              label="Discard"
              secondary
              onPress={() => {
                setExtractedMaterial(null);
                setMaterialUpload(null);
                setMaterialNotice('Extracted text discarded; nothing was saved.');
              }}
              testID="button-discard-extracted-material"
            />
          </View>
        </View>
      ) : null}
      <View style={styles.sourceGrid}>
        <ActionButton label="Photos" icon="image" onPress={() => void choosePhoto()} disabled={allBusy || Boolean(extractedMaterial)} secondary testID="button-pick-photo" />
        <ActionButton label="Files" icon="file" onPress={() => void chooseMaterial()} disabled={allBusy || Boolean(extractedMaterial)} secondary testID="button-pick-material" />
        <ActionButton label="OneDrive" icon="cloud" onPress={() => { setShowCloudHelp(true); void chooseMaterial(); }} disabled={allBusy || Boolean(extractedMaterial)} secondary testID="button-pick-onedrive" />
        <ActionButton label="Website link" icon="link" onPress={() => setShowWebsiteInput(!showWebsiteInput)} disabled={allBusy || Boolean(extractedMaterial)} secondary testID="button-website-link" />
      </View>
      {showCloudHelp ? <Text style={styles.caption}>In Files, tap Browse → OneDrive. If it is missing, sign into the OneDrive app, then enable OneDrive in Files → Browse → … → Edit.</Text> : null}
      {showWebsiteInput ? <View style={styles.stack}>
        <TextInput accessibilityLabel="Website link" testID="input-website-link" value={websiteUrl} onChangeText={setWebsiteUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://…" placeholderTextColor={colors.mutedForeground} style={styles.input} />
        <ActionButton label="Read page" onPress={readWebsite} disabled={allBusy || !websiteUrl.trim() || Boolean(extractedMaterial)} testID="button-read-website" />
      </View> : null}
      {materialNotice ? <Text style={styles.materialNotice} testID="status-material-extraction">{materialNotice}</Text> : null}
      {footer?.(status)}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  stack: { gap: 14 },
  extractionPreview: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, gap: 10 },
  partRow: { gap: 2, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  kicker: { color: colors.mutedForeground, fontSize: 12.5, lineHeight: 17, fontWeight: '600' },
  cardTitle: { color: colors.foreground, fontSize: 17, lineHeight: 23, fontWeight: '700' },
  muted: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  caption: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, color: colors.foreground, fontSize: 15, paddingHorizontal: 13 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  sourceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  materialNotice: { color: colors.accentForeground, fontSize: 12, lineHeight: 18 },
});
