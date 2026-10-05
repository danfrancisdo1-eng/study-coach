import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  ScrollView,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { CourseManager, type ManagedMaterial } from '@/components/CourseManager';
import { useAuth, useClerk } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { selectProviderMaterial } from '@/lib/material-file-provider';
import { File as ExpoFile } from 'expo-file-system';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import {
  getGetStudySessionQueryKey,
  getGetStudyStateQueryKey,
  getListStudySessionsQueryKey,
  getListLecturesQueryKey,
  deleteCourse,
  useCheckInStudySession,
  useCreateStudySession,
  useExtractStudyMaterial,
  useExtractStudyWebsite,
  useFlagStudyQuestion,
  useGenerateStudyQuiz,
  useGetStudySession,
  useGetStudyState,
  useGradeStudyQuiz,
  useListStudySessions,
  usePutStudyState,
  useSaveStudyAnswer,
  useSendStudyMessage,
  type StudySession,
  type StudySessionSummary,
  type StudyMaterialExtraction,
  type StudyQuestionFlagInputKind,
  type StudyState,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

type Course = { id: string; name: string; code?: string };
type SavedMaterial = {
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
type PendingMaterial = { id: string; url?: string; uri: string; filename: string; sessionId: string; courseId: string };
type ViewName = 'home' | 'session';
type Colors = ReturnType<typeof useColors>;

const emptyStudyState: StudyState = {
  aiConsent: false,
  courses: [],
  materials: [],
  reviewSchedule: [],
};

function id(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function coursesFrom(state: StudyState): Course[] {
  return (state.courses ?? []).flatMap((item) => {
    const record = objectRecord(item);
    if (typeof record.id !== 'string' || typeof record.name !== 'string') return [];
    return [{ id: record.id, name: record.name, ...(typeof record.code === 'string' ? { code: record.code } : {}) }];
  });
}

function materialsFrom(state: StudyState, courseId: string): SavedMaterial[] {
  return (state.materials ?? []).flatMap((item) => {
    const record = objectRecord(item);
    if (record.courseId !== courseId || typeof record.id !== 'string' ||
      typeof record.name !== 'string' || typeof record.text !== 'string') return [];
    return [{
      id: record.id,
      courseId,
      name: record.name,
      text: record.text,
      ...(typeof record.extractionFormat === 'string' ? { extractionFormat: record.extractionFormat as StudyMaterialExtraction['format'] } : {}),
      ...(typeof record.extractionStatus === 'string' ? { extractionStatus: record.extractionStatus as StudyMaterialExtraction['status'] } : {}),
      ...(typeof record.extractionCoverage === 'string' ? { extractionCoverage: record.extractionCoverage as StudyMaterialExtraction['coverage'] } : {}),
      ...(typeof record.sourceUrl === 'string' ? { sourceUrl: record.sourceUrl } : {}),
      ...(typeof record.coverageNote === 'string' ? { coverageNote: record.coverageNote } : {}),
    }];
  });
}

function reviewKeysFrom(items: readonly unknown[]): Set<string> {
  return new Set(items.flatMap((item) => {
    const key = objectRecord(item).reviewKey;
    return typeof key === 'string' ? [key] : [];
  }));
}

function sourceStatusText(status: StudySession['messages'][number]['sourceStatus']): string {
  if (!status) return '';
  if (!status.usedSourceMaterial) return 'Supplemental explanation · no matching course material was used';
  const labels = status.sources.filter((source) => source.kind === 'source').map((source) => source.label);
  const coverage = status.truncated ? 'Selected excerpts' : 'Course material';
  return `${coverage}: ${labels.join(', ') || 'saved course materials'}`;
}

function Header({ title, subtitle, onBack, onSignOut }: {
  title: string;
  subtitle: string;
  onBack?: () => void;
  onSignOut: () => void;
}) {
  const colors = useColors();
  const styles = createStyles(colors);
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable accessibilityRole="button" testID="button-back-home" onPress={onBack} style={styles.iconButton}>
          <Feather name="arrow-left" size={19} color={colors.foreground} />
        </Pressable>
      ) : (
        <View style={[styles.brandMark, { backgroundColor: colors.primary }]}><Feather name="book-open" size={17} color={colors.primaryForeground} /></View>
      )}
      <View style={styles.headerCopy}>
        <Text style={styles.brand}>Study Coach</Text>
        <Text numberOfLines={1} style={styles.headerSub}>{subtitle || title}</Text>
      </View>
      <Pressable accessibilityLabel="Sign out" accessibilityRole="button" testID="button-sign-out" onPress={onSignOut} style={styles.iconButton}>
        <Feather name="log-out" size={18} color={colors.foreground} />
      </Pressable>
    </View>
  );
}

function ActionButton({ label, onPress, disabled, secondary, testID, icon }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  testID?: string;
  icon?: React.ComponentProps<typeof Feather>['name'];
}) {
  const colors = useColors();
  const styles = createStyles(colors);
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        { backgroundColor: secondary ? colors.card : colors.primary, borderColor: secondary ? colors.border : colors.primary },
        secondary && styles.secondaryAction,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {icon ? <Feather name={icon} size={16} color={secondary ? colors.foreground : colors.primaryForeground} /> : null}
      <Text style={[styles.actionText, { color: secondary ? colors.foreground : colors.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
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

function StudyCoach() {
  const colors = useColors();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const activeUserIdRef = useRef<string | null | undefined>(userId);
  activeUserIdRef.current = userId;
  const { signOut } = useClerk();
  const accountStateKey = [...getGetStudyStateQueryKey(), userId];
  const accountSessionsKey = [...getListStudySessionsQueryKey(), userId];
  const stateQuery = useGetStudyState({ query: { queryKey: accountStateKey, enabled: Boolean(userId) } });
  const sessionsQuery = useListStudySessions({ query: { queryKey: accountSessionsKey, enabled: Boolean(userId) } });
  const updateState = usePutStudyState();
  const createSession = useCreateStudySession();
  const checkIn = useCheckInStudySession();
  const sendMessage = useSendStudyMessage();
  const generateQuiz = useGenerateStudyQuiz();
  const flagStudyQuestion = useFlagStudyQuestion();
  const saveAnswer = useSaveStudyAnswer();
  const gradeQuiz = useGradeStudyQuiz();
  const [view, setView] = useState<ViewName>('home');
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [courseName, setCourseName] = useState('');
  const [editCourseName, setEditCourseName] = useState('');
  const [topic, setTopic] = useState('');
  const [minutes, setMinutes] = useState('25');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionOwnerId, setSessionOwnerId] = useState<string | null>(null);
  const [addingMaterials, setAddingMaterials] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [showWebsiteInput, setShowWebsiteInput] = useState(false);
  const [showCloudHelp, setShowCloudHelp] = useState(false);
  const [materialNotice, setMaterialNotice] = useState('');
  const [materialUpload, setMaterialUpload] = useState<PendingMaterial | null>(null);
  const [extractedMaterial, setExtractedMaterial] = useState<StudyMaterialExtraction | null>(null);
  const [materialUploading, setMaterialUploading] = useState(false);
  const [reviewSyncPending, setReviewSyncPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingSavedSession, setLoadingSavedSession] = useState(true);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [quizHelp, setQuizHelp] = useState('');
  const [flaggingQuestionId, setFlaggingQuestionId] = useState<string | null>(null);
  const [flagKind, setFlagKind] = useState<StudyQuestionFlagInputKind>('invalid');
  const [flagReason, setFlagReason] = useState('');
  const gradeRequestRef = useRef(false);
  const activeSessionQuery = useGetStudySession(sessionId ?? '', {
    query: {
      queryKey: [...getGetStudySessionQueryKey(sessionId ?? ''), userId],
      enabled: Boolean(sessionId && userId && sessionOwnerId === userId),
      refetchOnWindowFocus: true,
    },
  });

  const savedState = stateQuery.data?.state ?? emptyStudyState;
  const courses = useMemo(() => coursesFrom(savedState), [savedState]);
  const session = activeSessionQuery.data;
  const busy = saving || updateState.isPending || createSession.isPending || checkIn.isPending ||
    sendMessage.isPending || generateQuiz.isPending || saveAnswer.isPending || gradeQuiz.isPending ||
    flagStudyQuestion.isPending || materialUploading || reviewSyncPending;
  const course = courses.find((item) => item.id === session?.courseId);
  const courseMaterials = session ? materialsFrom(savedState, session.courseId) : [];
  const activeQuiz = session?.quiz;
  const questions = activeQuiz?.questions ?? [];
  const flaggedQuestionCount = questions.filter((question) => Boolean(question.flag)).length;
  const answerableQuestionCount = questions.length - flaggedQuestionCount;
  const answeredCount = questions.filter((question) => !question.flag && Boolean(question.answer)).length;
  const isGraded = Boolean(activeQuiz?.grade);
  const latestAssistant = [...(session?.messages ?? [])].reverse().find((item) => item.role === 'assistant');
  const sessionReviewKeys = reviewKeysFrom(session?.reviewSchedule ?? []);
  const accountReviewKeys = reviewKeysFrom(savedState.reviewSchedule ?? []);
  const missingReviewKeys = [...sessionReviewKeys].filter((key) => !accountReviewKeys.has(key));
  const reviewScheduleNeedsSync = Boolean(session?.quiz?.grade && (missingReviewKeys.length > 0 || stateQuery.isError));

  useEffect(() => {
    let cancelled = false;
    setSelectedCourseId(null);
    setEditingCourseId(null);
    setCourseName('');
    setEditCourseName('');
    setTopic('');
    setMessage('');
    setQuizHelp('');
    setSelectedQuestionId(null);
    setFlaggingQuestionId(null);
    setFlagKind('invalid');
    setFlagReason('');
    setAddingMaterials(false);
    setMaterialsOpen(false);
    setWebsiteUrl('');
    setShowWebsiteInput(false);
    setShowCloudHelp(false);
    setMaterialNotice('');
    setMaterialUpload(null);
    setExtractedMaterial(null);
    setMaterialUploading(false);
    if (!userId) {
      setSessionId(null);
      setSessionOwnerId(null);
      setView('home');
      setLoadingSavedSession(false);
      return;
    }
    setLoadingSavedSession(true);
    setSessionId(null);
    setSessionOwnerId(null);
    setView('home');
    setError('');
    AsyncStorage.getItem(`study-coach-active-session:${userId}`)
      .then((savedId) => {
        if (!cancelled) {
          setSessionId(savedId);
          setSessionOwnerId(savedId ? userId : null);
        }
      })
      .catch(() => {
      if (!cancelled) setError('Your last session shortcut could not be restored. You can still open it from Recent sessions.');
      })
      .finally(() => {
        if (!cancelled) setLoadingSavedSession(false);
      });
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (activeSessionQuery.isError && sessionId) {
      setError(`Could not restore that session: ${readableError(activeSessionQuery.error)}`);
    }
  }, [activeSessionQuery.isError, activeSessionQuery.error, sessionId]);

  useEffect(() => {
    if (sessionId && userId && sessionOwnerId === userId) {
      AsyncStorage.setItem(`study-coach-active-session:${userId}`, sessionId).catch(() => {
        setError('Session is saved to your account, but the quick-resume shortcut could not be saved on this device.');
      });
    }
  }, [sessionId, sessionOwnerId, userId]);

  useEffect(() => {
    if (sessionId) setView('session');
  }, [sessionId]);

  // The Coach tab (chat-first home) opens a session it just started: /(tabs)/courses?openSession=<id>.
  const { openSession } = useLocalSearchParams<{ openSession?: string }>();
  useEffect(() => {
    if (typeof openSession === 'string' && openSession && userId) {
      setError('');
      setSessionOwnerId(userId);
      setSessionId(openSession);
      setView('session');
      router.setParams({ openSession: '' });
    }
  }, [openSession, userId]);

  useEffect(() => {
    if (session && !selectedQuestionId && session.quiz?.questions[0]) {
      setSelectedQuestionId(session.quiz.questions[0].id);
    }
  }, [session, selectedQuestionId]);

  const persistStudyState = async (next: StudyState) => {
    if (activeUserIdRef.current !== userId) throw new Error('Your signed-in account changed. Please retry from the current account.');
    if (!stateQuery.data) throw new Error('Your account study state is still loading. Please try again.');
    const response = await updateState.mutateAsync({
      data: { state: next, version: stateQuery.data.version },
    });
    if (activeUserIdRef.current !== userId) throw new Error('Your signed-in account changed. Please retry from the current account.');
    queryClient.setQueryData(accountStateKey, response);
    return response.state;
  };

  const handleError = (problem: unknown) => {
    if (activeUserIdRef.current === userId) setError(readableError(problem));
  };

  const updateCourse = async (name: string, targetId?: string) => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setError('');
    setSaving(true);
    try {
      const priorCourses = savedState.courses ?? [];
      const nextCourses = targetId
        ? priorCourses.map((item) => objectRecord(item).id === targetId ? { ...objectRecord(item), name: trimmed } : item)
        : [...priorCourses, { id: id(), name: trimmed }];
      await persistStudyState({ ...savedState, aiConsent: savedState.aiConsent === true, courses: nextCourses });
      setCourseName('');
      setEditingCourseId(null);
    } catch (problem) {
      handleError(problem);
    } finally {
      setSaving(false);
    }
  };

  const deleteMaterial = async (material: ManagedMaterial) => {
    setError('');
    setSaving(true);
    try {
      await persistStudyState({ ...savedState, materials: (savedState.materials ?? []).filter((item) => objectRecord(item).id !== material.id) });
    } catch (problem) {
      handleError(problem);
    } finally {
      setSaving(false);
    }
  };

  const removeCourse = async (courseId: string) => {
    setError('');
    setSaving(true);
    try {
      const result = await deleteCourse(courseId);
      if (activeUserIdRef.current !== userId) throw new Error('Your signed-in account changed. Please retry from the current account.');
      queryClient.setQueryData(accountStateKey, { state: result.state, version: result.version });
      await queryClient.invalidateQueries({ queryKey: accountSessionsKey });
      await queryClient.invalidateQueries({ queryKey: getListLecturesQueryKey() });
      setEditingCourseId(null);
      if (selectedCourseId === courseId) setSelectedCourseId(null);
    } catch (problem) {
      handleError(problem);
    } finally {
      setSaving(false);
    }
  };

  const setConsent = async (consented: boolean) => {
    setError('');
    try {
      await persistStudyState({ ...savedState, aiConsent: consented });
    } catch (problem) {
      handleError(problem);
    }
  };

  const createNewSession = async () => {
    if (!selectedCourseId || !topic.trim() || !savedState.aiConsent || busy) return;
    setError('');
    try {
      const created = await createSession.mutateAsync({
        data: { courseId: selectedCourseId, topic: topic.trim(), minutes: Math.max(1, Math.min(360, Number(minutes) || 25)) },
      });
      if (activeUserIdRef.current !== userId) return;
      queryClient.setQueryData([...getGetStudySessionQueryKey(created.id), userId], created);
      await queryClient.invalidateQueries({ queryKey: accountSessionsKey });
      setSessionOwnerId(userId ?? null);
      setSessionId(created.id);
      setView('session');
      setAddingMaterials(false);
      setMaterialUpload(null);
      setExtractedMaterial(null);
      setMaterialUploading(false);
      setMaterialNotice('');
      setMessage('');
      setSelectedQuestionId(null);
      setFlaggingQuestionId(null);
      setFlagKind('invalid');
      setFlagReason('');
    } catch (problem) {
      handleError(problem);
    }
  };

  const resumeSession = async (summary: StudySessionSummary) => {
    setError('');
    setSessionOwnerId(userId ?? null);
    setSessionId(summary.id);
    setView('session');
    setMaterialNotice('');
    setFlaggingQuestionId(null);
    setFlagKind('invalid');
    setFlagReason('');
  };

  const updateSession = (updated: StudySession) => {
    if (activeUserIdRef.current !== userId) return;
    queryClient.setQueryData([...getGetStudySessionQueryKey(updated.id), userId], updated);
    queryClient.invalidateQueries({ queryKey: accountSessionsKey }).catch(() => undefined);
  };

  const refreshGradedSessionAndAccountState = async () => {
    await Promise.all([activeSessionQuery.refetch(), stateQuery.refetch()]);
  };

  const handleCheckIn = async (skipped: boolean) => {
    if (!session || busy) return;
    setError('');
    try {
      const updated = await checkIn.mutateAsync({ id: session.id, data: { skipped } });
      updateSession(updated);
      setAddingMaterials(false);
    } catch (problem) {
      handleError(problem);
    }
  };

  const chooseMaterial = async () => {
    if (!session) return;
    setError('');
    try {
      const picked = await selectProviderMaterial(DocumentPicker.getDocumentAsync);
      if (!picked || activeUserIdRef.current !== userId) return;
      const fileName = picked.name || 'Selected file';
      const extension = fileName.split('.').pop()?.toLowerCase();
      if (['jpg', 'jpeg', 'png', 'webp'].includes(extension ?? '') && !savedState.aiConsent) {
        setMaterialNotice('Enable AI-assisted study before reading photos.');
        return;
      }
      if (picked.size && picked.size > 12 * 1024 * 1024) {
        setMaterialNotice(`${fileName} was not uploaded or saved (larger than 12 MB).`);
        Alert.alert('File is too large', 'The extraction service accepts files up to 12 MB.');
        return;
      }
      setError('');
      setExtractedMaterial(null);
      setMaterialUploading(true);
      setMaterialNotice(`${fileName} · uploading for text extraction. Nothing is saved yet.`);
      setMaterialUpload({
        id: id(),
        uri: picked.uri,
        filename: fileName,
        sessionId: session.id,
        courseId: session.courseId,
      });
    } catch (problem) {
      if (activeUserIdRef.current !== userId) return;
      setMaterialNotice(`The file was not saved: ${readableError(problem)}`);
      handleError(problem);
    }
  };

  const choosePhoto = async () => {
    if (!session || busy || extractedMaterial) return;
    if (!savedState.aiConsent) {
      setMaterialNotice('Enable AI-assisted study before reading photos.');
      return;
    }
    try {
      // The system picker grants access only to the photo the student selects.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 1, allowsMultipleSelection: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled || !result.assets[0] || activeUserIdRef.current !== userId) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > 12 * 1024 * 1024) {
        setMaterialNotice('Choose a photo smaller than 12 MB.');
        return;
      }
      const filename = asset.fileName || 'Study photo.jpg';
      setError('');
      setExtractedMaterial(null);
      setMaterialUploading(true);
      setMaterialNotice('Reading your photo…');
      setMaterialUpload({ id: id(), uri: asset.uri, filename, sessionId: session.id, courseId: session.courseId });
    } catch (problem) {
      if (activeUserIdRef.current === userId) setMaterialNotice(`Could not open Photos: ${readableError(problem)}`);
    }
  };

  const readWebsite = () => {
    if (!session || busy || extractedMaterial) return;
    try {
      const input = websiteUrl.trim();
      if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:\/\//i.test(input)) throw new Error();
      const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password || url.href.length > 2048) throw new Error();
      setError('');
      setExtractedMaterial(null);
      setMaterialUploading(true);
      setMaterialNotice('Reading the website…');
      setMaterialUpload({ id: id(), uri: '', url: url.href, filename: url.hostname, sessionId: session.id, courseId: session.courseId });
    } catch {
      setMaterialNotice('Enter a valid public website link.');
    }
  };

  const handleMaterialExtracted = (upload: PendingMaterial, result: StudyMaterialExtraction) => {
    if (activeUserIdRef.current !== userId) return;
    if (upload.sessionId !== session?.id || upload.courseId !== session.courseId) return;
    setMaterialUploading(false);
    setExtractedMaterial(result);
    setMaterialNotice(`${result.filename} · ready to review · ${result.characterCount.toLocaleString()} characters`);
  };

  const handleMaterialExtractionError = (upload: PendingMaterial, problem: unknown) => {
    if (activeUserIdRef.current !== userId) return;
    if (upload.sessionId !== session?.id || upload.courseId !== session.courseId) return;
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
    if (!session || !materialUpload || !extractedMaterial || materialUpload.sessionId !== session.id ||
      materialUpload.courseId !== session.courseId || !extractedMaterial.text.trim() || busy) return;
    setError('');
    setSaving(true);
    try {
      const current = savedState.materials ?? [];
      if (current.some((item) => {
        const material = objectRecord(item);
        return material.courseId === session.courseId && material.text === extractedMaterial.text;
      })) {
        setMaterialNotice('This material is already saved for this course.');
        setExtractedMaterial(null);
        setMaterialUpload(null);
        return;
      }
      const addition: SavedMaterial = {
        id: id(),
        courseId: session.courseId,
        name: extractedMaterial.filename,
        text: extractedMaterial.text,
        extractionFormat: extractedMaterial.format,
        extractionStatus: extractedMaterial.status,
        extractionCoverage: extractedMaterial.coverage,
        coverageNote: extractedMaterial.coverageNote,
        ...(extractedMaterial.sourceUrl ? { sourceUrl: extractedMaterial.sourceUrl } : {}),
      };
      await persistStudyState({ ...savedState, materials: [...current, addition] });
      setMaterialNotice(`${extractedMaterial.filename} · ${extractedMaterial.characterCount.toLocaleString()} characters saved for this course`);
      setExtractedMaterial(null);
      setMaterialUpload(null);
    } catch (problem) {
      if (activeUserIdRef.current === userId) handleError(problem);
    } finally {
      setSaving(false);
    }
  };

  const sendCoachMessage = async (content: string) => {
    if (!session || !content.trim() || !savedState.aiConsent || busy) return;
    setError('');
    try {
      const updated = await sendMessage.mutateAsync({ id: session.id, data: { content: content.trim() } });
      updateSession(updated);
      Keyboard.dismiss();
      setMessage('');
      setQuizHelp('');
    } catch (problem) {
      if (activeUserIdRef.current === userId) handleError(problem);
    }
  };

  const beginTeaching = () => {
    if (!session) return;
    const existingMessages = session.messages.length > 0;
    const opening = existingMessages
      ? `Please continue coaching me about ${session.topic}. Start by explaining the key idea in clear, small steps.`
      : `Please teach me ${session.topic} for ${course?.name ?? 'this course'}. Start with the central idea, connect it to one useful example, and ask me one short question to check my understanding. Use my saved course materials when relevant and tell me when a point is supplemental.`;
    void sendCoachMessage(opening);
  };

  const generatePractice = async (mode: 'diagnostic' | 'targeted') => {
    if (!session || busy) return;
    setError('');
    try {
      const updated = await generateQuiz.mutateAsync({ id: session.id, data: { mode } });
      if (activeUserIdRef.current !== userId) return;
      setSelectedQuestionId(updated.quiz?.questions[0]?.id ?? null);
      setFlaggingQuestionId(null);
      setFlagReason('');
      updateSession(updated);
    } catch (problem) {
      handleError(problem);
    }
  };

  const saveQuizAnswer = async (questionId: string, optionId: string, assisted: boolean) => {
    if (!session || busy) return;
    setError('');
    try {
      updateSession(await saveAnswer.mutateAsync({
        id: session.id,
        data: { questionId, optionId, assisted },
      }));
    } catch (problem) {
      handleError(problem);
    }
  };

  const reportQuestion = async (questionId: string) => {
    if (!session || busy) return;
    setError('');
    const reason = flagReason.trim();
    try {
      const updated = await flagStudyQuestion.mutateAsync({
        id: session.id,
        questionId,
        data: { kind: flagKind, ...(reason ? { reason } : {}) },
      });
      if (activeUserIdRef.current !== userId) return;
      updateSession(updated);
      setFlaggingQuestionId(null);
      setFlagReason('');
      await activeSessionQuery.refetch();
    } catch (problem) {
      handleError(problem);
      await activeSessionQuery.refetch();
    }
  };

  const submitQuiz = async () => {
    if (!session || !activeQuiz || (answeredCount === 0 && answerableQuestionCount > 0) ||
      flaggingQuestionId || busy || gradeRequestRef.current) return;
    gradeRequestRef.current = true;
    setReviewSyncPending(true);
    setError('');
    try {
      const graded = await gradeQuiz.mutateAsync({ id: session.id });
      updateSession(graded);
      await refreshGradedSessionAndAccountState();
    } catch (problem) {
      const gradeAlreadySaved = readableError(problem).toLowerCase().includes('grade is saved');
      if (!gradeAlreadySaved) handleError(problem);
      await refreshGradedSessionAndAccountState();
      if (gradeAlreadySaved && activeUserIdRef.current === userId) setError('');
    } finally {
      gradeRequestRef.current = false;
      setReviewSyncPending(false);
    }
  };

  const syncReviewSchedule = async () => {
    if (!session?.quiz?.grade || busy || gradeRequestRef.current) return;
    gradeRequestRef.current = true;
    setReviewSyncPending(true);
    setError('');
    try {
      const synced = await gradeQuiz.mutateAsync({ id: session.id });
      updateSession(synced);
      await refreshGradedSessionAndAccountState();
    } catch (problem) {
      handleError(problem);
      await refreshGradedSessionAndAccountState();
    } finally {
      gradeRequestRef.current = false;
      setReviewSyncPending(false);
    }
  };

  const shareExactReport = async () => {
    if (!session?.reportText) return;
    try {
      await Share.share({ message: session.reportText });
    } catch (problem) {
      handleError(problem);
    }
  };

  const openHome = () => {
    setSessionId(null);
    setSessionOwnerId(null);
    setView('home');
    setError('');
    setFlaggingQuestionId(null);
    setFlagKind('invalid');
    setFlagReason('');
    setAddingMaterials(false);
    setMaterialUpload(null);
    setExtractedMaterial(null);
    setMaterialUploading(false);
    setMaterialsOpen(false);
    setMaterialNotice('Any unsaved extraction was discarded; nothing was added to your course.');
  };

  const reportText = session?.reportText;
  const sessionSummaries = sessionsQuery.data?.sessions ?? [];
  const statusMessage = error || (stateQuery.isError ? readableError(stateQuery.error) : '');

  const renderMaterialExtractionControls = (checkInActions: boolean) => (
    <View style={styles.stack}>
      {materialUploading ? (
        <View style={styles.extractionPreview} accessibilityRole="progressbar" accessibilityLabel="Extracting course material text" testID="status-material-extracting">
          <ActivityIndicator color={colors.primary} />
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
            <ActionButton label="Save to course" icon="check" onPress={() => void saveExtractedMaterial()} disabled={busy || !extractedMaterial.text.trim()} testID="button-save-extracted-material" />
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
        <ActionButton label="Photos" icon="image" onPress={() => void choosePhoto()} disabled={busy || Boolean(extractedMaterial)} secondary testID="button-pick-photo" />
        <ActionButton label="Files" icon="file" onPress={chooseMaterial} disabled={busy || Boolean(extractedMaterial)} secondary testID="button-pick-material" />
        <ActionButton label="OneDrive" icon="cloud" onPress={() => { setShowCloudHelp(true); void chooseMaterial(); }} disabled={busy || Boolean(extractedMaterial)} secondary testID="button-pick-onedrive" />
        <ActionButton label="Website link" icon="link" onPress={() => setShowWebsiteInput(!showWebsiteInput)} disabled={busy || Boolean(extractedMaterial)} secondary testID="button-website-link" />
      </View>
      {showCloudHelp ? <Text style={styles.caption}>In Files, tap Browse → OneDrive. If it is missing, sign into the OneDrive app, then enable OneDrive in Files → Browse → … → Edit.</Text> : null}
      {showWebsiteInput ? <View style={styles.stack}>
        <TextInput accessibilityLabel="Website link" testID="input-website-link" value={websiteUrl} onChangeText={setWebsiteUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://…" placeholderTextColor={colors.mutedForeground} style={styles.input} />
        <ActionButton label="Read page" onPress={readWebsite} disabled={busy || !websiteUrl.trim() || Boolean(extractedMaterial)} testID="button-read-website" />
      </View> : null}
      {materialNotice ? <Text style={styles.materialNotice} testID="status-material-extraction">{materialNotice}</Text> : null}
      {checkInActions ? (
        <>
          <ActionButton label="Continue with these materials" icon="arrow-right" onPress={() => void handleCheckIn(false)} disabled={busy || Boolean(extractedMaterial)} secondary testID="button-continue-materials" />
          <ActionButton label="Skip materials" onPress={() => void handleCheckIn(true)} disabled={busy || Boolean(extractedMaterial)} secondary testID="button-skip-materials" />
        </>
      ) : (
        <ActionButton label="Done adding materials" onPress={() => { setMaterialsOpen(false); setAddingMaterials(false); }} disabled={false} secondary testID="button-done-adding-materials" />
      )}
    </View>
  );

  const sessionContent = () => {
    if (activeSessionQuery.isLoading || loadingSavedSession) {
      return <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Restoring your saved study session…</Text></View>;
    }
    if (!session) {
      return <View style={styles.emptyState}>
        <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}><Feather name="alert-circle" size={22} color={colors.accentForeground} /></View>
        <Text style={styles.sectionTitle}>Session unavailable</Text>
        <Text style={styles.muted}>This saved session could not be loaded. Your account session list is still available.</Text>
        <ActionButton label="Back to study space" onPress={openHome} secondary testID="button-return-home" />
      </View>;
    }
    if (!session.checkIn) {
      return (
        <View style={styles.stack}>
          <View style={styles.introCard}>
            <Text style={styles.kicker}>ONE QUICK CHECK-IN</Text>
            <Text style={styles.sectionTitle}>
              {courseMaterials.length > 0 ? 'Anything else before we start?' : 'Do you have any course materials you want to add?'}
            </Text>
            <Text style={styles.body}>Anything to add before we begin? Your saved course materials are ready to use.</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Optional course materials</Text>
            <Text style={styles.muted}>{courseMaterials.length} readable file{courseMaterials.length === 1 ? '' : 's'} already saved for {course?.name ?? 'this course'}. New files are appended; existing materials are never overwritten.</Text>
            {courseMaterials.map((material) => (
              <View key={material.id} style={styles.savedMaterialRow} testID={`saved-material-${material.id}`}>
                <Text style={styles.cardTitle}>{material.name}</Text>
                <Text style={styles.caption}>{material.text.length.toLocaleString()} saved characters</Text>
                {material.coverageNote ? <Text style={styles.muted}>{material.coverageNote}</Text> : null}
              </View>
            ))}
            {addingMaterials && !materialsOpen ? renderMaterialExtractionControls(true) : (
              <View style={styles.buttonRow}>
                <ActionButton label="Add materials" icon="plus" onPress={() => setMaterialsOpen(true)} disabled={busy} testID="button-add-materials" />
                <ActionButton label="Skip" onPress={() => void handleCheckIn(true)} disabled={busy || Boolean(extractedMaterial)} secondary testID="button-skip-materials" />
              </View>
            )}
          </View>
        </View>
      );
    }

    if (!activeQuiz) {
      return (
        <View style={styles.stack}>
          <View style={styles.introCard}>
            <Text style={styles.kicker}>TEACH FIRST / PRACTICE AFTER</Text>
            <Text style={styles.sectionTitle}>{session.topic}</Text>
            <Text style={styles.body}>{course?.name ?? 'Your course'} · {session.minutes} minutes · created {new Date(session.createdAt).toLocaleDateString()}</Text>
            <Text style={styles.caption}>{courseMaterials.length ? `${courseMaterials.length} readable course material${courseMaterials.length === 1 ? '' : 's'} available to the coach.` : 'No readable course materials saved for this course. The coach will identify supplemental knowledge.'}</Text>
          </View>
          {session.messages.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Start with an explanation</Text>
              <Text style={styles.body}>Your coach will respond using the saved course material when relevant. No answer or teaching content is filled in before the server returns it.</Text>
              <ActionButton label="Begin teaching" icon="book-open" onPress={beginTeaching} disabled={!savedState.aiConsent || busy} testID="button-begin-teaching" />
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Your saved conversation</Text>
              {session.messages.map((turn, index) => (
                <View key={`${turn.createdAt}-${index}`} style={[styles.turn, turn.role === 'user' ? styles.userTurn : styles.coachTurn]} testID={`turn-${index}`}>
                  <Text style={styles.turnRole}>{turn.role === 'assistant' ? 'STUDY COACH' : 'YOU'}</Text>
                  <Text style={styles.body}>{turn.content}</Text>
                  {turn.role === 'assistant' && turn.sourceStatus ? <Text style={styles.sourceNote}>{sourceStatusText(turn.sourceStatus)}</Text> : null}
                </View>
              ))}
              <View style={styles.composeBox}>
                <TextInput
                  testID="input-session-message"
                  accessibilityLabel="Ask a follow-up question"
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Ask a follow-up or explain what is confusing"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  style={styles.textArea}
                  returnKeyType="send"
                />
                <ActionButton label="Send" icon="send" onPress={() => void sendCoachMessage(message)} disabled={busy || !message.trim() || !savedState.aiConsent} testID="button-send-session-message" />
              </View>
              <ActionButton label="Continue teaching" icon="refresh-cw" onPress={beginTeaching} disabled={busy || !savedState.aiConsent} secondary testID="button-continue-teaching" />
            </View>
          )}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ready to check your understanding?</Text>
            <Text style={styles.muted}>The coach will create a diagnostic set from your topic and saved materials. Correct answers stay private until you submit and the server grades your work.</Text>
            <ActionButton
              label="Create diagnostic quiz"
              icon="check-square"
              onPress={() => void generatePractice('diagnostic')}
              disabled={!savedState.aiConsent || busy || !session.messages.some((turn) => turn.role === 'assistant')}
              testID="button-generate-diagnostic"
            />
            {!session.messages.some((turn) => turn.role === 'assistant') ? <Text style={styles.caption}>Start the teaching conversation before requesting practice.</Text> : null}
          </View>
        </View>
      );
    }

    if (isGraded) {
      const attemptFeedback = activeQuiz.questions.filter((question) => question.feedback);
      const reportedQuestions = activeQuiz.questions.filter((question) => question.flag);
      return (
        <View style={styles.stack}>
          <View style={styles.scoreCard}>
            <Text style={styles.kicker}>{activeQuiz.mode === 'diagnostic' ? 'DIAGNOSTIC REVIEW' : 'RETEST REVIEW'}</Text>
            <Text style={styles.score}>{activeQuiz.grade?.percent ?? 0}%</Text>
            <Text style={styles.body}>{activeQuiz.grade?.correct ?? 0} correct from {activeQuiz.grade?.answered ?? 0} answered · {activeQuiz.grade?.unanswered ?? 0} unanswered</Text>
            <Text style={styles.heroSub}>{activeQuiz.grade?.invalidItems ?? activeQuiz.invalidItemCount} item{(activeQuiz.grade?.invalidItems ?? activeQuiz.invalidItemCount) === 1 ? '' : 's'} excluded from scoring, including {reportedQuestions.length} learner report{reportedQuestions.length === 1 ? '' : 's'}.</Text>
          </View>
          <View style={styles.card} testID="panel-question-quality-notice">
            <Text style={styles.cardTitle}>Question quality and reporting</Text>
            <Text style={styles.body}>{activeQuiz.qualityNotice}</Text>
            <Text style={styles.body}>Automated AI checks do not guarantee factual validity.</Text>
            <Text style={styles.muted}>Question reports can only be submitted before grading. This screen cannot change a graded score or review schedule, and there is no built-in post-grade contact or feedback action here.</Text>
          </View>
          {reportedQuestions.length ? (
            <View style={styles.card} testID="panel-flagged-questions">
              <Text style={styles.cardTitle}>Reported and excluded questions · {reportedQuestions.length}</Text>
              {reportedQuestions.map((question) => (
                <View key={question.id} style={styles.flaggedQuestionStatus} testID={`flagged-question-${question.id}`}>
                  <Text style={styles.kicker}>{question.flag?.kind === 'ambiguous' ? 'REPORTED AMBIGUOUS' : 'REPORTED INVALID'}</Text>
                  <Text style={styles.body}>{question.prompt}</Text>
                  {question.flag?.reason ? <Text style={styles.muted}>Your report: {question.flag.reason}</Text> : null}
                  <Text style={styles.caption}>Excluded from this score and review schedule.</Text>
                </View>
              ))}
            </View>
          ) : null}
          {attemptFeedback.map((question, index) => {
            const feedback = question.feedback;
            if (!feedback) return null;
            const selectedOption = feedback.selectedOptionText;
            return (
              <View key={question.id} style={styles.card} testID={`review-question-${question.id}`}>
                <Text style={styles.kicker}>QUESTION {index + 1} · {feedback.assisted ? 'ASSISTED' : 'INDEPENDENT'}</Text>
                <Text style={styles.cardTitle}>{question.prompt}</Text>
                <Text style={[styles.feedbackResult, { color: feedback.selectedOptionId === feedback.correctOptionId ? colors.accentForeground : colors.primary }]}>
                  {feedback.selectedOptionId === feedback.correctOptionId ? 'Correct' : 'Review this concept'}
                </Text>
                {selectedOption ? <Text style={styles.body}>Your answer: {selectedOption}</Text> : <Text style={styles.body}>Unanswered</Text>}
                <Text style={styles.body}>Answer: {feedback.correctOptionText}</Text>
                <Text style={styles.muted}>{feedback.explanation}</Text>
              </View>
            );
          })}
          {session.reviewSchedule.length ? (
            <View style={styles.card} testID="panel-review-schedule">
              <Text style={styles.cardTitle}>Review schedule</Text>
              <Text style={styles.muted}>Your saved review reminders are based on this session’s graded results.</Text>
              {session.reviewSchedule.map((item, index) => {
                const entry = objectRecord(item);
                const dueAt = typeof entry.dueAt === 'string' ? new Date(entry.dueAt).toLocaleDateString() : 'Next review';
                const concept = typeof entry.concept === 'string' ? entry.concept : 'Session concept';
                const result = typeof entry.result === 'string' ? entry.result : 'scheduled';
                return <Text key={`${concept}-${index}`} style={styles.body} testID={`review-schedule-${index}`}>{concept} · {result} · due {dueAt}</Text>;
              })}
            </View>
          ) : null}
          {sessionReviewKeys.size ? (
            <View style={styles.card} testID="panel-review-sync">
              <Text style={styles.cardTitle}>Account review sync</Text>
              {reviewSyncPending ? (
                <Text style={styles.muted} testID="status-review-syncing">Checking and syncing this session’s review reminders with your account…</Text>
              ) : stateQuery.isError ? (
                <Text style={styles.muted} testID="status-review-unsynced">
                  The account review schedule could not be confirmed. Your grade is saved; syncing again is safe and will not create another quiz attempt.
                </Text>
              ) : missingReviewKeys.length ? (
                <Text style={styles.muted} testID="status-review-unsynced">
                  Your grade is saved, but {missingReviewKeys.length} of {sessionReviewKeys.size} review reminder{sessionReviewKeys.size === 1 ? '' : 's'} are not in your account yet. Syncing is safe and will not create another quiz attempt.
                </Text>
              ) : (
                <Text style={styles.muted} testID="status-review-synced">
                  All {sessionReviewKeys.size} review reminder{sessionReviewKeys.size === 1 ? '' : 's'} from this session are saved to your account.
                </Text>
              )}
              {reviewScheduleNeedsSync ? (
                <ActionButton
                  label={reviewSyncPending ? 'Syncing review…' : 'Sync review / Retry'}
                  icon="refresh-cw"
                  onPress={() => void syncReviewSchedule()}
                  disabled={busy}
                  testID="button-sync-review-schedule"
                />
              ) : null}
            </View>
          ) : null}
          {activeQuiz.mode === 'diagnostic' && !session.scores.targeted ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Review, then try fresh questions</Text>
              <Text style={styles.muted}>A targeted retest uses a new question set. Previous answers remain part of your session history.</Text>
              <ActionButton label="Create a fresh retest" icon="repeat" onPress={() => void generatePractice('targeted')} disabled={busy || !savedState.aiConsent || reviewScheduleNeedsSync} testID="button-fresh-retest" />
              {reviewScheduleNeedsSync ? <Text style={styles.caption}>Sync the saved review schedule before starting another attempt.</Text> : null}
            </View>
          ) : null}
          {reportText ? (
            <View style={styles.card}>
              <Text style={styles.kicker}>PREVIEW BEFORE SHARING</Text>
              <Text style={styles.cardTitle}>Your session report</Text>
              <Text style={styles.caption}>This is the exact server-approved text. Nothing is sent automatically.</Text>
              <Text selectable style={styles.reportText} testID="text-exact-report">{reportText}</Text>
              <ActionButton label="Share report" icon="share" onPress={shareExactReport} disabled={busy} testID="button-share-report" />
            </View>
          ) : null}
          <ActionButton label="Back to your study space" onPress={openHome} secondary testID="button-return-home" />
        </View>
      );
    }

    const canSubmit = (answeredCount > 0 || (answerableQuestionCount === 0 && flaggedQuestionCount > 0)) && !flaggingQuestionId;
    const progressPercent = answerableQuestionCount
      ? Math.min(100, (answeredCount / answerableQuestionCount) * 100)
      : 100;
    const gradeButtonLabel = answerableQuestionCount === 0
      ? 'Grade reported questions'
      : answeredCount === answerableQuestionCount
        ? 'Check my answers'
        : 'Grade answered questions';
    return (
      <View style={styles.stack}>
        <View style={styles.card}>
          <Text style={styles.kicker}>{activeQuiz.mode === 'diagnostic' ? 'DIAGNOSTIC' : 'FRESH RETEST'}</Text>
          <Text style={styles.cardTitle}>{session.topic}</Text>
          <Text style={styles.muted}>
            {answerableQuestionCount
              ? `${answeredCount} of ${answerableQuestionCount} answerable questions answered. ${flaggedQuestionCount} reported and excluded.`
              : 'All displayed questions are reported and excluded from scoring.'}
          </Text>
          <Text style={styles.caption}>
            {activeQuiz.invalidItemCount} total item{activeQuiz.invalidItemCount === 1 ? '' : 's'} excluded from scoring and review, including {flaggedQuestionCount} learner report{flaggedQuestionCount === 1 ? '' : 's'}.
          </Text>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progressPercent}%`, backgroundColor: colors.primary }]} /></View>
        </View>
        <View style={styles.card} testID="panel-question-quality-notice">
          <Text style={styles.cardTitle}>Question quality notice</Text>
          <Text style={styles.body}>{activeQuiz.qualityNotice}</Text>
          <Text style={styles.muted}>Automated AI checks do not guarantee factual validity. Before grading, report a question that is invalid or ambiguous.</Text>
        </View>
        {questions.map((question, index) => (
          <View key={question.id} style={[styles.card, selectedQuestionId === question.id && styles.currentQuestion, question.flag && styles.flaggedQuestion]} testID={`question-${question.id}`}>
            <Pressable onPress={() => setSelectedQuestionId(question.id)} accessibilityRole="button" testID={`button-select-question-${question.id}`}>
              <Text style={styles.kicker}>QUESTION {index + 1} / {questions.length}</Text>
              <Text style={styles.cardTitle}>{question.prompt}</Text>
            </Pressable>
            {question.flag ? (
              <View style={styles.flagStatus} testID={`question-flag-status-${question.id}`}>
                <Text style={styles.kicker}>{question.flag.kind === 'ambiguous' ? 'REPORTED AMBIGUOUS' : 'REPORTED INVALID'} · EXCLUDED</Text>
                {question.flag.reason ? <Text style={styles.muted}>Reason: {question.flag.reason}</Text> : <Text style={styles.muted}>No optional reason provided.</Text>}
                <Text style={styles.caption}>This item is excluded from scoring and review scheduling. Answering is disabled.</Text>
              </View>
            ) : null}
            <ActionButton
              label={flaggingQuestionId === question.id ? 'Close report form' : question.flag ? 'Update report' : 'Report invalid or ambiguous'}
              secondary
              icon={question.flag ? 'edit-2' : 'flag'}
              onPress={() => {
                if (flaggingQuestionId === question.id) {
                  setFlaggingQuestionId(null);
                  setFlagReason('');
                  return;
                }
                setFlaggingQuestionId(question.id);
                setFlagKind(question.flag?.kind ?? 'invalid');
                setFlagReason(question.flag?.reason ?? '');
                setError('');
              }}
              disabled={busy}
              testID={`button-report-question-${question.id}`}
            />
            {flaggingQuestionId === question.id ? (
              <View style={styles.flagForm} testID={`form-report-question-${question.id}`}>
                <Text style={styles.muted}>Choose a report type. You can report a question even if you have not answered it.</Text>
                <View style={styles.buttonRow}>
                  {([
                    ['invalid', 'Invalid'],
                    ['ambiguous', 'Ambiguous or unclear'],
                  ] as const).map(([kind, label]) => (
                    <Pressable
                      key={kind}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: flagKind === kind }}
                      disabled={busy}
                      onPress={() => setFlagKind(kind)}
                      style={[styles.option, flagKind === kind && styles.currentQuestion]}
                      testID={`button-flag-kind-${question.id}-${kind}`}
                    >
                      <Text style={styles.body}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  testID={`input-flag-reason-${question.id}`}
                  accessibilityLabel="Optional report reason"
                  value={flagReason}
                  onChangeText={setFlagReason}
                  placeholder="Optional reason (up to 500 characters)"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  maxLength={500}
                  editable={!busy}
                  style={styles.textArea}
                />
                <View style={styles.buttonRow}>
                  <ActionButton
                    label={flagStudyQuestion.isPending ? 'Sending report…' : 'Submit report'}
                    icon="flag"
                    onPress={() => void reportQuestion(question.id)}
                    disabled={busy}
                    testID={`button-submit-question-report-${question.id}`}
                  />
                  <ActionButton
                    label="Cancel"
                    secondary
                    onPress={() => {
                      setFlaggingQuestionId(null);
                      setFlagReason('');
                    }}
                    disabled={busy}
                    testID={`button-cancel-question-report-${question.id}`}
                  />
                </View>
              </View>
            ) : null}
            {question.options.map((option, optionIndex) => (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: question.answer?.optionId === option.id }}
                testID={`button-answer-${question.id}-${optionIndex}`}
                disabled={busy || Boolean(question.flag)}
                onPress={() => void saveQuizAnswer(question.id, option.id, question.answer?.assisted ?? false)}
                style={[
                  styles.option,
                  { borderColor: question.answer?.optionId === option.id ? colors.primary : colors.border },
                  question.answer?.optionId === option.id && { backgroundColor: colors.accent },
                  question.flag && styles.disabled,
                ]}
              >
                <Text style={styles.optionLetter}>{String.fromCharCode(65 + optionIndex)}</Text>
                <Text style={styles.optionText}>{option.text}</Text>
              </Pressable>
            ))}
            {question.answer ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: question.answer.assisted }}
                testID={`checkbox-assisted-${question.id}`}
                disabled={busy || Boolean(question.flag)}
                onPress={() => void saveQuizAnswer(question.id, question.answer!.optionId, !question.answer!.assisted)}
                style={styles.assistedRow}
              >
                <Feather name={question.answer.assisted ? 'check-square' : 'square'} size={18} color={colors.primary} />
                <Text style={styles.body}>Mark this answer as assisted</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Need to talk it through?</Text>
          <Text style={styles.muted}>Ask the coach for guidance without revealing an answer key. Mark the question assisted if you use help.</Text>
          <TextInput
            testID="input-quiz-help"
            accessibilityLabel="Ask the coach about this quiz"
            value={quizHelp}
            onChangeText={setQuizHelp}
            placeholder="What am I missing here?"
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={styles.textArea}
          />
          <ActionButton label="Ask coach" icon="message-circle" onPress={() => void sendCoachMessage(quizHelp)} disabled={busy || !quizHelp.trim() || !savedState.aiConsent} testID="button-ask-during-quiz" />
          {latestAssistant ? (
            <View style={styles.coachReply}>
              <Text style={styles.kicker}>LATEST COACH REPLY</Text>
              <Text style={styles.body}>{latestAssistant.content}</Text>
              {latestAssistant.sourceStatus ? <Text style={styles.sourceNote}>{sourceStatusText(latestAssistant.sourceStatus)}</Text> : null}
            </View>
          ) : null}
        </View>
        <ActionButton label={gradeButtonLabel} icon="check" onPress={() => void submitQuiz()} disabled={!canSubmit || busy} testID="button-submit-session-quiz" />
      </View>
    );
  };

  const recentSessions = (sessions: StudySessionSummary[]) => sessions.length ? (
    <View style={styles.stack}>
      {sessions.slice(0, 8).map((item) => {
        const sessionCourse = courses.find((entry) => entry.id === item.courseId);
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            testID={`button-resume-session-${item.id}`}
            onPress={() => void resumeSession(item)}
            style={({ pressed }) => [styles.sessionRow, pressed && styles.pressed]}
          >
            <View style={styles.sessionIcon}><Feather name={item.status === 'active' ? 'play' : 'check'} size={16} color={colors.primary} /></View>
            <View style={styles.sessionCopy}>
              <Text style={styles.sessionTitle}>{item.topic}</Text>
              <Text style={styles.caption}>{sessionCourse?.name ?? 'Course'} · {new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
            <Text style={[styles.sessionStatus, { color: item.status === 'active' ? colors.primary : colors.accentForeground }]}>
              {item.status === 'active' ? 'Resume' : `${item.diagnosticScore ?? item.targetedScore ?? 'Review'}${typeof item.diagnosticScore === 'number' || typeof item.targetedScore === 'number' ? '%' : ''}`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  ) : (
    <View style={styles.emptyInline}>
      <Feather name="bookmark" size={19} color={colors.mutedForeground} />
      <Text style={styles.body}>Your saved sessions will appear here.</Text>
    </View>
  );

  if (!userId) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (stateQuery.isLoading || sessionsQuery.isLoading) {
    return <View style={[styles.page, styles.loading, { paddingTop: insets.top + 40 }]}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Loading your account study space…</Text></View>;
  }

  if (stateQuery.isError || sessionsQuery.isError) {
    return (
      <View style={[styles.page, { paddingTop: insets.top + 18 }]}>
        <Header title="Study space" subtitle="Account" onSignOut={() => void signOut()} />
        <View style={styles.errorCard}><Text style={styles.errorTitle}>Could not load your account data</Text><Text style={styles.body}>{readableError(stateQuery.error ?? sessionsQuery.error)}</Text><ActionButton label="Try again" icon="refresh-cw" onPress={() => { stateQuery.refetch(); sessionsQuery.refetch(); }} testID="button-retry-load" /></View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={[styles.page, { paddingTop: insets.top + 7 }]} behavior="padding" keyboardVerticalOffset={0}>
      {materialUpload ? <MaterialExtractionTask key={materialUpload.id} upload={materialUpload} onComplete={handleMaterialExtracted} onFailure={handleMaterialExtractionError} /> : null}
      <Header title={view === 'session' ? (session?.topic ?? 'Study session') : 'Study space'} subtitle={view === 'session' ? (course?.name ?? 'Your saved session') : 'Your account · Study space'} onBack={view === 'session' ? openHome : undefined} onSignOut={() => void signOut()} />
      <FlatList
        data={view === 'session' ? [] : ['study-space']}
        renderItem={() => (
          <View style={styles.content}>
            {view === 'session' ? (
              <>
                {statusMessage ? <View style={styles.errorCard} accessibilityRole="alert" testID="status-session-error"><Text style={styles.errorTitle}>Something interrupted this step.</Text><Text style={styles.body}>{statusMessage}</Text><ActionButton label="Retry" icon="refresh-cw" onPress={() => { setError(''); if (sessionId) activeSessionQuery.refetch(); }} secondary testID="button-retry-session" /></View> : null}
                {busy ? <View style={styles.busyBanner}><ActivityIndicator size="small" color={colors.primary} /><Text style={styles.muted}>Working on your saved session…</Text></View> : null}
                {sessionContent()}
              </>
            ) : (
              <>
                {statusMessage ? <View style={styles.errorCard} accessibilityRole="alert" testID="status-account-error"><Text style={styles.errorTitle}>Something needs attention</Text><Text style={styles.body}>{statusMessage}</Text><ActionButton label="Retry" icon="refresh-cw" onPress={() => { setError(''); stateQuery.refetch(); }} secondary testID="button-retry-account" /></View> : null}
                <View style={styles.hero}>
                  <Text style={styles.kicker}>YOUR STUDY SPACE</Text>
                  <Text style={styles.heroTitle}>Learn it. Talk it through. Remember it.</Text>
                  <Text style={styles.heroSub}>Your courses, session history, and study progress are saved to your signed-in account.</Text>
                </View>
                <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Your courses</Text><Text style={styles.caption}>{courses.length} saved</Text></View>
                {courses.length === 0 ? (
                  <View style={styles.emptyInline} testID="text-no-courses">
                    <Feather name="book-open" size={20} color={colors.primary} />
                    <Text style={styles.body}>Add a course you want to study. Your account starts empty until you add one.</Text>
                  </View>
                ) : courses.map((item) => (
                  <View key={item.id} style={[styles.courseRow, selectedCourseId === item.id && styles.courseSelected]} testID={`row-course-${item.id}`}>
                    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selectedCourseId === item.id }} testID={`button-select-course-${item.id}`} style={styles.coursePick} onPress={() => setSelectedCourseId(item.id)}>
                      <View style={styles.courseBullet}><Feather name={selectedCourseId === item.id ? 'check-circle' : 'circle'} size={20} color={selectedCourseId === item.id ? colors.primary : colors.mutedForeground} /></View>
                      <View style={styles.sessionCopy}><Text style={styles.courseName}>{item.name}</Text>{item.code ? <Text style={styles.caption}>{item.code}</Text> : null}</View>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Lectures for ${item.name}`} testID={`button-lectures-${item.id}`} onPress={() => router.push({ pathname: '/lectures/[courseId]', params: { courseId: item.id, courseName: item.name } })} style={styles.iconButton}>
                      <Feather name="mic" size={18} color={colors.foreground} />
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`} testID={`button-edit-course-${item.id}`} onPress={() => { setEditingCourseId(item.id); setEditCourseName(item.name); }} style={styles.iconButton}>
                      <Feather name="edit-2" size={16} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                ))}
                {editingCourseId ? (
                  <View style={styles.formCard}>
                    <Text style={styles.cardTitle}>Edit course</Text>
                    <TextInput testID="input-edit-course" value={editCourseName} onChangeText={setEditCourseName} maxLength={120} placeholder="Course name" placeholderTextColor={colors.mutedForeground} style={styles.input} />
                    <View style={styles.buttonRow}><ActionButton label="Save changes" onPress={() => void updateCourse(editCourseName, editingCourseId)} disabled={busy || !editCourseName.trim()} testID="button-save-course" /><ActionButton label="Cancel" secondary onPress={() => setEditingCourseId(null)} testID="button-cancel-edit-course" /></View>
                    <CourseManager
                      courseName={courses.find((course) => course.id === editingCourseId)?.name ?? editCourseName}
                      materials={materialsFrom(savedState, editingCourseId).map((material) => ({ id: material.id, name: material.name, extractionFormat: material.extractionFormat }))}
                      busy={busy}
                      onDeleteMaterial={deleteMaterial}
                      onDeleteCourse={() => removeCourse(editingCourseId)}
                    />
                  </View>
                ) : (
                  <View style={styles.formCard}>
                    <Text style={styles.cardTitle}>Add a course</Text>
                    <TextInput testID="input-new-course" value={courseName} onChangeText={setCourseName} maxLength={120} placeholder="Course name" placeholderTextColor={colors.mutedForeground} style={styles.input} returnKeyType="done" />
                    <ActionButton label="Add course" icon="plus" onPress={() => void updateCourse(courseName)} disabled={busy || !courseName.trim()} testID="button-add-course" />
                  </View>
                )}
                <View style={styles.consentCard} testID="panel-ai-consent">
                  <View style={styles.consentHeading}><Feather name="shield" size={19} color={colors.accentForeground} /><Text style={styles.cardTitle}>Your choice before AI</Text></View>
                  <Text style={styles.body}>Study Coach sends the topic, your messages, selected course materials, and your quiz answers to AI to teach, generate practice, and explain results. AI may make mistakes; review explanations. You can change this choice at any time. Nothing is sent to a family member or other recipient.</Text>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: savedState.aiConsent === true }}
                    testID="checkbox-ai-consent"
                    disabled={busy}
                    onPress={() => void setConsent(savedState.aiConsent !== true)}
                    style={styles.consentToggle}
                  >
                    <Feather name={savedState.aiConsent === true ? 'check-square' : 'square'} size={21} color={colors.primary} />
                    <Text style={styles.body}>{savedState.aiConsent === true ? 'I consent to AI-assisted study' : 'I understand and consent to AI-assisted study'}</Text>
                  </Pressable>
                </View>
                <View style={styles.startCard}>
                  <Text style={styles.kicker}>START A SESSION</Text>
                  <Text style={[styles.cardTitle, { color: colors.background }]}>What do you want to work through?</Text>
                  <TextInput testID="input-session-topic" value={topic} onChangeText={setTopic} maxLength={300} placeholder="Topic or concept" placeholderTextColor={colors.mutedForeground} style={styles.input} />
                  <View style={styles.minutesRow}>
                    <Text style={[styles.body, { color: colors.background }]}>Minutes</Text>
                    <TextInput testID="input-session-minutes" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" maxLength={3} style={[styles.input, styles.minutesInput]} />
                  </View>
                  <ActionButton label="Start study session" icon="arrow-right" onPress={() => void createNewSession()} disabled={!selectedCourseId || !topic.trim() || !savedState.aiConsent || busy || !courses.length} testID="button-start-session" />
                  {!selectedCourseId && courses.length > 0 ? <Text style={[styles.caption, { color: colors.secondary }]}>Choose a course above to get started.</Text> : null}
                  {savedState.aiConsent !== true ? <Text style={[styles.caption, { color: colors.secondary }]}>Review and accept the AI notice before starting.</Text> : null}
                </View>
                <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Recent sessions</Text></View>
                {sessionsQuery.isFetching ? <ActivityIndicator color={colors.primary} /> : recentSessions(sessionSummaries)}
              </>
            )}
          </View>
        )}
        keyExtractor={(item) => item}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 18) + 96 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        scrollEnabled
        ListHeaderComponent={view === 'session' ? (
          <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, 18) + 96 }]}>
            {statusMessage ? <View style={styles.errorCard} accessibilityRole="alert" testID="status-session-error"><Text style={styles.errorTitle}>Something interrupted this step.</Text><Text style={styles.body}>{statusMessage}</Text><ActionButton label="Retry" icon="refresh-cw" onPress={() => { setError(''); if (sessionId) activeSessionQuery.refetch(); }} secondary testID="button-retry-session" /></View> : null}
            {busy ? <View style={styles.busyBanner}><ActivityIndicator size="small" color={colors.primary} /><Text style={styles.muted}>Working on your saved session…</Text></View> : null}
            {sessionContent()}
          </View>
        ) : null}
      />
      {view === 'session' && session ? <>
        <Pressable accessibilityRole="button" accessibilityLabel="Add study materials" testID="button-materials-plus"
          onPress={() => setMaterialsOpen(true)} style={[styles.materialsPlus, { bottom: Math.max(insets.bottom, 16) + 12 }]}>
          <Feather name="plus" size={27} color={colors.background} />
        </Pressable>
        <Modal visible={materialsOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setMaterialsOpen(false)}>
          <KeyboardAvoidingView behavior="padding" style={[styles.page, { paddingTop: 20 }]}>
            <View style={styles.header}>
              <View style={styles.headerCopy}><Text style={styles.sectionTitle}>Add materials</Text><Text style={styles.caption}>{course?.name}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close materials" onPress={() => setMaterialsOpen(false)} style={styles.iconButton}><Feather name="x" size={24} color={colors.foreground} /></Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
              {renderMaterialExtractionControls(false)}
              {error ? <Text accessibilityRole="alert" style={styles.materialNotice}>{error}</Text> : null}
              {courseMaterials.map(material => <View key={material.id} style={styles.savedMaterialRow}>
                <Text style={styles.cardTitle}>{material.name}</Text><Text style={styles.caption}>Saved · {material.text.length.toLocaleString()} characters</Text>
              </View>)}
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      </> : null}
    </KeyboardAvoidingView>
  );
}

export default StudyCoach;

function createStyles(colors: Colors) {
  return StyleSheet.create({
  materialsPlus: { position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  sourceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  page: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 12 },
  brandMark: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  brand: { fontSize: 17, fontWeight: '700', color: colors.foreground, letterSpacing: -0.4 },
  headerSub: { marginTop: 2, color: colors.mutedForeground, fontSize: 11 },
  iconButton: { minWidth: 42, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 18, paddingTop: 14, gap: 15 },
  scrollContent: { paddingBottom: 26 },
  hero: { padding: 23, borderRadius: 22, backgroundColor: colors.foreground, gap: 10 },
  kicker: { color: colors.primary, fontSize: 10, letterSpacing: 1.3, fontWeight: '800' },
  heroTitle: { color: colors.background, fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -1 },
  heroSub: { color: colors.secondary, fontSize: 14, lineHeight: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  sectionTitle: { color: colors.foreground, fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.6 },
  caption: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 17, gap: 12 },
  flaggedQuestion: { borderColor: colors.destructive, backgroundColor: colors.accent },
  flagStatus: { padding: 10, borderRadius: 11, borderLeftWidth: 3, borderLeftColor: colors.destructive, backgroundColor: colors.background, gap: 5 },
  flagForm: { paddingTop: 5, gap: 10 },
  flaggedQuestionStatus: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 11, gap: 6 },
  savedMaterialRow: { gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 11 },
  extractionPreview: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, gap: 10 },
  extractedTextPreview: { maxHeight: 220, overflow: 'hidden', borderRadius: 10, padding: 11, backgroundColor: colors.muted, color: colors.foreground, fontSize: 12, lineHeight: 18 },
  cardTitle: { color: colors.foreground, fontSize: 17, lineHeight: 23, fontWeight: '700' },
  body: { color: colors.foreground, fontSize: 14, lineHeight: 21 },
  muted: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  courseRow: { minHeight: 63, flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 10 },
  courseSelected: { borderColor: colors.primary, backgroundColor: colors.accent },
  coursePick: { flex: 1, minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 },
  courseBullet: { width: 31, alignItems: 'center' },
  courseName: { color: colors.foreground, fontSize: 15, fontWeight: '700' },
  sessionCopy: { flex: 1, gap: 3 },
  formCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 17, backgroundColor: colors.muted, gap: 12 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, color: colors.foreground, fontSize: 15, paddingHorizontal: 13 },
  minutesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  minutesInput: { width: 86, textAlign: 'center' },
  consentCard: { padding: 17, borderRadius: 18, backgroundColor: colors.accent, gap: 11 },
  consentHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  consentToggle: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  startCard: { padding: 19, borderRadius: 20, backgroundColor: colors.foreground, gap: 12 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  actionButton: { minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 11, alignSelf: 'flex-start' },
  secondaryAction: {},
  actionText: { fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.78 },
  sessionRow: { minHeight: 71, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  sessionIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondary, borderRadius: 11 },
  sessionTitle: { color: colors.foreground, fontSize: 14, fontWeight: '700' },
  sessionStatus: { fontSize: 12, fontWeight: '700' },
  emptyInline: { minHeight: 92, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 17, backgroundColor: colors.card },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 65, paddingHorizontal: 18, gap: 12 },
  emptyIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stack: { gap: 14 },
  introCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 20, gap: 11 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 13, padding: 24 },
  errorCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.destructive, padding: 15, borderRadius: 14, gap: 8, marginHorizontal: 18, marginTop: 13 },
  errorTitle: { color: colors.destructive, fontSize: 15, fontWeight: '700' },
  busyBanner: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, paddingHorizontal: 18 },
  userTurn: { backgroundColor: colors.secondary, alignSelf: 'flex-end', maxWidth: '92%' },
  coachTurn: { backgroundColor: colors.accent, alignSelf: 'stretch' },
  turn: { padding: 13, borderRadius: 14, gap: 7 },
  turnRole: { color: colors.primary, fontSize: 9, letterSpacing: 1, fontWeight: '800' },
  sourceNote: { color: colors.accentForeground, fontSize: 11, lineHeight: 16, marginTop: 3 },
  composeBox: { gap: 10 },
  textArea: { minHeight: 84, borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.card, color: colors.foreground, fontSize: 14, lineHeight: 20, paddingHorizontal: 13, paddingVertical: 12, textAlignVertical: 'top' },
  scoreCard: { borderRadius: 20, padding: 21, backgroundColor: colors.foreground, gap: 7 },
  score: { color: colors.primary, fontSize: 48, fontWeight: '700', letterSpacing: -2 },
  feedbackResult: { fontSize: 14, fontWeight: '700' },
  reportText: { color: colors.foreground, fontSize: 12, lineHeight: 18, padding: 12, borderRadius: 12, backgroundColor: colors.secondary },
  progressTrack: { height: 7, backgroundColor: colors.muted, overflow: 'hidden', borderRadius: 10, marginTop: 3 },
  progressFill: { height: '100%', borderRadius: 10 },
  currentQuestion: { borderColor: colors.primary },
  option: { minHeight: 50, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: 10, gap: 11 },
  optionLetter: { width: 27, height: 27, overflow: 'hidden', borderRadius: 8, textAlign: 'center', textAlignVertical: 'center', color: colors.foreground, backgroundColor: colors.muted, fontSize: 12, fontWeight: '700' },
  optionText: { flex: 1, color: colors.foreground, fontSize: 14, lineHeight: 19 },
  assistedRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 9 },
  coachReply: { padding: 13, borderRadius: 13, backgroundColor: colors.accent, gap: 7 },
  materialNotice: { color: colors.accentForeground, fontSize: 12, lineHeight: 18 },
  });
}