import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { File as ExpoFile } from 'expo-file-system';
import { useExtractStudyMaterial, useExtractStudyWebsite, type StudyMaterialExtraction } from '@workspace/api-client-react';
import { selectProviderMaterial } from '@/lib/material-file-provider';
import { useColors } from '@/hooks/useColors';
import { ActionButton } from '@/components/ActionButton';

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
};

export type IntakeStatus = { uploading: boolean; reviewing: boolean; saving: boolean };

type PendingMaterial = { id: string; url?: string; uri: string; filename: string; courseId: string };

function id(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

function MaterialExtractionTask({ upload, onComplete, onFailure }: {
  upload: PendingMaterial;
  onComplete: (upload: PendingMaterial, result: StudyMaterialExtraction) => void;
  onFailure: (upload: PendingMaterial, problem: unknown) => void;
}) {
  const extraction = useExtractStudyMaterial({
    request: { headers: { 'X-Filename': upload.filename } },
  });
  const websiteExtraction = useExtractStudyWebsite();
  const websiteMutationRef = useRef(websiteExtraction.mutateAsync);
  websiteMutationRef.current = websiteExtraction.mutateAsync;
  const mutationRef = useRef(extraction.mutateAsync);
  const callbacksRef = useRef({ onComplete, onFailure });
  mutationRef.current = extraction.mutateAsync;
  callbacksRef.current = { onComplete, onFailure };

  useEffect(() => {
    let active = true;
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
        const bytes = await file.bytes();
        if (bytes.byteLength === 0) {
          throw new Error('The selected file is empty. No text was extracted.');
        }
        if (!active) return;
        const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        // React Native Blob cannot be constructed from binary views; its fetch transport
        // accepts ArrayBuffer directly, while the generated endpoint currently types body as Blob.
        const result = await mutationRef.current({ data: body as unknown as Blob });
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
    return () => { active = false; };
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
  /** Persist one reviewed material. Throws on failure; the preview is kept so the student can retry. */
  onSave: (addition: SavedMaterial) => Promise<void>;
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
      setMaterialUploading(true);
      setMaterialNotice(`${fileName} · uploading for text extraction. Nothing is saved yet.`);
      setMaterialUpload({ id: id(), uri: picked.uri, filename: fileName, courseId });
    } catch (problem) {
      if (!mounted.current) return;
      setMaterialNotice(`The file was not saved: ${readableError(problem)}`);
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
      setMaterialUploading(true);
      setMaterialNotice('Reading your photo…');
      setMaterialUpload({ id: id(), uri: asset.uri, filename, courseId });
    } catch (problem) {
      if (mounted.current) setMaterialNotice(`Could not open Photos: ${readableError(problem)}`);
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
      setMaterialUploading(true);
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
    setMaterialNotice(`${result.filename} · ready to review · ${result.characterCount.toLocaleString()} characters`);
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
    setMaterialNotice(`${filename} was not saved; complete text extraction failed: ${readableError(problem)}${pdfCoverage}`);
  };

  const saveExtractedMaterial = async () => {
    if (!materialUpload || !extractedMaterial || materialUpload.courseId !== courseId || !extractedMaterial.text.trim() || allBusy) return;
    setSaving(true);
    try {
      if (savedMaterials.some((material) => material.courseId === courseId && material.text === extractedMaterial.text)) {
        setMaterialNotice('This material is already saved for this course.');
        setExtractedMaterial(null);
        setMaterialUpload(null);
        return;
      }
      const addition: SavedMaterial = {
        id: id(),
        courseId,
        name: extractedMaterial.filename,
        text: extractedMaterial.text,
        extractionFormat: extractedMaterial.format,
        extractionStatus: extractedMaterial.status,
        extractionCoverage: extractedMaterial.coverage,
        coverageNote: extractedMaterial.coverageNote,
        ...(extractedMaterial.sourceUrl ? { sourceUrl: extractedMaterial.sourceUrl } : {}),
      };
      await onSave(addition);
      if (!mounted.current) return;
      setMaterialNotice(`${extractedMaterial.filename} · ${extractedMaterial.characterCount.toLocaleString()} characters saved for this course`);
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
      {materialUpload ? <MaterialExtractionTask key={materialUpload.id} upload={materialUpload} onComplete={handleMaterialExtracted} onFailure={handleMaterialExtractionError} /> : null}
      {materialUploading ? (
        <View style={styles.extractionPreview} accessibilityRole="progressbar" accessibilityLabel="Extracting course material text" testID="status-material-extracting">
          <ActivityIndicator color={colors.primaryText} />
          <Text style={styles.cardTitle}>Extracting text</Text>
          <Text style={styles.muted}>The file is being processed transiently. It will not be saved to your course unless you review and choose Save.</Text>
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
          <Text style={styles.cardTitle}>{extractedMaterial.filename} · {extractedMaterial.characterCount.toLocaleString()} characters</Text>
          <Text style={styles.muted}>{extractedMaterial.coverageNote}</Text>
          {extractedMaterial.sourceUrl ? <Text selectable style={styles.caption}>{extractedMaterial.sourceUrl}</Text> : null}
          <TextInput accessibilityLabel="Extracted material text" testID="input-extracted-text" multiline
            value={extractedMaterial.text} maxLength={100000}
            onChangeText={text => setExtractedMaterial({ ...extractedMaterial, text, characterCount: text.length })}
            style={[styles.input, { minHeight: 180, maxHeight: 320, textAlignVertical: 'top' }]} />
          <View style={styles.buttonRow}>
            <ActionButton label="Save to course" icon="check" onPress={() => void saveExtractedMaterial()} disabled={allBusy || !extractedMaterial.text.trim()} testID="button-save-extracted-material" />
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
  kicker: { color: colors.mutedForeground, fontSize: 12.5, lineHeight: 17, fontWeight: '600' },
  cardTitle: { color: colors.foreground, fontSize: 17, lineHeight: 23, fontWeight: '700' },
  muted: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  caption: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, color: colors.foreground, fontSize: 15, paddingHorizontal: 13 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  sourceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  materialNotice: { color: colors.accentForeground, fontSize: 12, lineHeight: 18 },
});
