import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import {
  deleteLecture, getGetLectureQueryKey, getListLecturesQueryKey, updateLecture, useGetLecture, type Lecture,
} from '@workspace/api-client-react';
import { goBack } from '@/lib/nav';
import { useColors } from '@/hooks/useColors';
import {
  editedSegments, formatDuration, spokenDuration, transcriptHasText, transcriptionBlocker, type TranscriptSegment,
} from '@/lib/lecture-recording';
import { deleteLectureAudio, lectureAudio } from '@/lib/lecture-storage';
import { TranscriptionError, transcribeRecording } from '@/lib/lecture-transcribe';

const STEPS: { status: Lecture['status']; label: string }[] = [
  { status: 'recorded', label: 'Recorded' },
  { status: 'transcribed', label: 'Transcribed' },
  { status: 'reviewed', label: 'Ready to study' },
];

export default function LectureScreen() {
  const colors = useColors();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  const { id, courseName } = useLocalSearchParams<{ id: string; courseName?: string }>();
  const { userId, getToken } = useAuth();
  const queryClient = useQueryClient();
  const lectureKey = [...getGetLectureQueryKey(id), userId];
  const query = useGetLecture(id, { query: { queryKey: lectureKey, enabled: Boolean(userId && id) } });
  const lecture = query.data;

  const [hasAudio, setHasAudio] = useState(false);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'transcribing' | 'saving' | 'deleting' | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const abort = useRef<AbortController | null>(null);

  useFocusEffect(useCallback(() => { setHasAudio(Boolean(id && lectureAudio(id))); }, [id]));

  const refresh = async (updated?: Lecture) => {
    if (updated) queryClient.setQueryData(lectureKey, updated);
    await queryClient.invalidateQueries({ queryKey: [...getListLecturesQueryKey({ courseId: updated?.courseId ?? lecture?.courseId })] });
  };

  function confirmTranscribe() {
    const file = lectureAudio(id);
    const blocker = transcriptionBlocker(file?.size ?? null, lecture?.durationSeconds ?? 0);
    if (blocker) {
      setMessage(blocker);
      return;
    }
    Alert.alert(
      'Send this recording for transcription?',
      'The audio is sent to OpenAI to turn speech into text. It is not stored on RapidRecall AI’s server, and the recording stays on this iPhone.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Transcribe', onPress: () => void transcribe() }],
    );
  }

  async function transcribe() {
    const file = lectureAudio(id);
    if (!file || !lecture) return;
    setMessage('');
    setBusy('transcribing');
    setProgress(0);
    abort.current = new AbortController();
    try {
      const segments = await transcribeRecording({ file, token: await getToken(), signal: abort.current.signal, onProgress: setProgress });
      if (!transcriptHasText(segments)) {
        setMessage('No speech was found in this recording. It is still saved on this iPhone.');
        return;
      }
      const updated = await updateLecture(id, { version: lecture.version, segments });
      await refresh(updated);
      setEdits({});
      setEditing(true);
      setMessage('Transcript ready. Read it through and fix anything that sounds wrong, then save it.');
    } catch (error) {
      if (abort.current?.signal.aborted) setMessage('Transcription cancelled. The recording is still saved on this iPhone.');
      else if (error instanceof TranscriptionError) setMessage(error.message);
      else setMessage('The transcript couldn’t be saved to your account. Try again; the recording is still on this iPhone.');
    } finally {
      abort.current = null;
      setBusy(null);
    }
  }

  async function saveTranscript() {
    if (!lecture) return;
    const segments = editedSegments(lecture.segments, edits);
    if (!transcriptHasText(segments)) {
      setMessage('The transcript is empty. Add some text before saving.');
      return;
    }
    setBusy('saving');
    setMessage('');
    try {
      const updated = await updateLecture(id, { version: lecture.version, segments, status: 'reviewed' });
      await refresh(updated);
      setEdits({});
      setEditing(false);
      setMessage('Saved. Tutoring and quizzes for this course can now use this lecture.');
    } catch {
      // Edits stay in place so nothing typed is lost.
      setMessage('Couldn’t save. Your edits are still here. If you changed this lecture on another device, reopen it first.');
    } finally {
      setBusy(null);
    }
  }

  function confirmDeleteAudio() {
    Alert.alert('Delete the recording from this iPhone?', 'The transcript stays in your account. The audio can’t be recovered.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete recording', style: 'destructive', onPress: () => { deleteLectureAudio(id); setHasAudio(false); } },
    ]);
  }

  function confirmDeleteLecture() {
    Alert.alert('Delete this lecture?', 'This removes the lecture and its transcript from your account and deletes the recording from this iPhone. This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete lecture', style: 'destructive', onPress: () => void (async () => {
          setBusy('deleting');
          try {
            await deleteLecture(id);
            deleteLectureAudio(id);
            await refresh();
            goBack();
          } catch {
            setMessage('Couldn’t delete the lecture. Check your connection and try again.');
            setBusy(null);
          }
        })(),
      },
    ]);
  }

  const segments: TranscriptSegment[] = lecture?.segments ?? [];
  const stepIndex = lecture ? STEPS.findIndex((step) => step.status === lecture.status) : 0;
  const showEditor = lecture && segments.length > 0 && (editing || lecture.status === 'transcribed');

  let primary: { label: string; onPress: () => void; testID: string } | null = null;
  if (lecture && busy === null) {
    if (!segments.length && hasAudio) primary = { label: 'Transcribe recording', onPress: confirmTranscribe, testID: 'button-transcribe' };
    else if (showEditor) primary = { label: 'Save and use for studying', onPress: () => void saveTranscript(), testID: 'button-save-transcript' };
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to lectures" onPress={() => goBack()} disabled={busy === 'transcribing'} style={styles.iconButton} testID="button-lecture-back">
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={2}>{lecture?.title ?? 'Lecture'}</Text>
          {courseName ? <Text style={styles.caption} numberOfLines={1}>{courseName}</Text> : null}
        </View>
      </View>

      {query.isLoading ? <ActivityIndicator style={styles.loading} color={colors.primaryText} /> : null}
      {query.error ? (
        <View style={[styles.notice, styles.margin]} accessibilityRole="alert">
          <Text style={styles.body}>Couldn’t load this lecture.</Text>
          <Pressable accessibilityRole="button" onPress={() => void query.refetch()} style={styles.textButton}><Text style={styles.link}>Try again</Text></Pressable>
        </View>
      ) : null}

      {lecture ? (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 130 }]} keyboardShouldPersistTaps="handled">
          <Text style={styles.caption} accessibilityLabel={`Recorded ${new Date(lecture.recordedAt).toLocaleDateString()}, ${spokenDuration(lecture.durationSeconds)}`}>
            {new Date(lecture.recordedAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {formatDuration(lecture.durationSeconds)}
          </Text>

          <View style={styles.steps} accessibilityLabel={`Step ${stepIndex + 1} of 3: ${STEPS[stepIndex]?.label}`}>
            {STEPS.map((step, index) => (
              <View key={step.status} style={styles.step}>
                <Feather name={index <= stepIndex ? 'check-circle' : 'circle'} size={16} color={index <= stepIndex ? colors.accentForeground : colors.mutedForeground} />
                <Text style={[styles.stepText, index === stepIndex && styles.stepCurrent]}>{step.label}</Text>
              </View>
            ))}
          </View>

          {message ? <View style={styles.notice} accessibilityRole="alert"><Feather name="info" size={16} color={colors.foreground} /><Text style={styles.body}>{message}</Text></View> : null}

          {busy === 'transcribing' ? (
            <View style={styles.card} accessibilityLiveRegion="polite">
              <Text style={styles.cardTitle}>{progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : 'Transcribing…'}</Text>
              <Text style={styles.body}>Long lectures can take a few minutes. Keep RapidRecall AI open.</Text>
              <Pressable accessibilityRole="button" onPress={() => abort.current?.abort()} style={styles.textButton} testID="button-cancel-transcribe"><Text style={styles.link}>Cancel</Text></Pressable>
            </View>
          ) : null}

          {!segments.length && !hasAudio && busy === null ? (
            <Text style={styles.body}>The recording isn’t on this iPhone, so it can’t be transcribed here. It may have been recorded on another device.</Text>
          ) : null}

          {segments.length ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Transcript</Text>
                {lecture.status === 'reviewed' && !editing ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Edit transcript" onPress={() => setEditing(true)} style={styles.textButton} testID="button-edit-transcript"><Text style={styles.link}>Edit</Text></Pressable>
                ) : null}
              </View>
              {lecture.status === 'reviewed' && !editing ? <Text style={styles.caption}>Used as course material for tutoring and quizzes.</Text> : null}
              {segments.map((segment, index) => (
                <View key={`${segment.start}-${index}`} style={styles.passage}>
                  <Text style={styles.timestamp}>{formatDuration(segment.start)}</Text>
                  {showEditor ? (
                    <TextInput
                      multiline value={edits[index] ?? segment.text} onChangeText={(text) => setEdits((current) => ({ ...current, [index]: text }))}
                      accessibilityLabel={`Transcript passage at ${formatDuration(segment.start)}`} style={styles.passageInput} testID={`input-passage-${index}`}
                    />
                  ) : <Text style={styles.body} selectable>{segment.text}</Text>}
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.dangerZone}>
            {hasAudio ? (
              <Pressable accessibilityRole="button" onPress={confirmDeleteAudio} disabled={busy !== null} style={styles.textButton} testID="button-delete-audio">
                <Text style={styles.dangerLink}>Delete recording from this iPhone</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={confirmDeleteLecture} disabled={busy !== null} style={styles.textButton} testID="button-delete-lecture">
              <Text style={styles.dangerLink}>Delete lecture</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : null}

      {primary || busy === 'saving' ? (
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <Pressable accessibilityRole="button" disabled={!primary} onPress={primary?.onPress} style={({ pressed }) => [styles.primaryButton, !primary && styles.disabled, pressed && styles.pressed]} testID={primary?.testID ?? 'button-saving'}>
            {busy === 'saving' ? <ActivityIndicator color={colors.primaryForeground} /> : null}
            <Text style={styles.primaryText}>{busy === 'saving' ? 'Saving…' : primary?.label}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
    headerCopy: { flex: 1 },
    headerTitle: { color: colors.foreground, fontSize: 20, fontWeight: '700' },
    iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    loading: { marginTop: 40 },
    margin: { marginHorizontal: 18 },
    content: { paddingHorizontal: 18, gap: 16 },
    steps: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    step: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    stepText: { color: colors.mutedForeground, fontSize: 14 },
    stepCurrent: { color: colors.foreground, fontWeight: '700' },
    section: { gap: 10 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { color: colors.foreground, fontSize: 17, fontWeight: '700' },
    card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: colors.radius, padding: 17, gap: 8 },
    cardTitle: { color: colors.foreground, fontSize: 17, fontWeight: '700' },
    body: { color: colors.foreground, fontSize: 15, lineHeight: 22, flexShrink: 1 },
    caption: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
    notice: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: colors.muted, borderRadius: 12, padding: 12 },
    passage: { gap: 4 },
    timestamp: { color: colors.mutedForeground, fontSize: 12, fontVariant: ['tabular-nums'] },
    passageInput: { minHeight: 64, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, color: colors.foreground, fontSize: 15, lineHeight: 22, padding: 12, textAlignVertical: 'top' },
    textButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    link: { color: colors.primaryText, fontSize: 15, fontWeight: '600' },
    dangerZone: { marginTop: 18, gap: 2, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
    dangerLink: { color: colors.destructive, fontSize: 14 },
    bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10, backgroundColor: colors.background, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
    primaryButton: { minHeight: 54, borderRadius: 14, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    primaryText: { color: colors.primaryForeground, fontSize: 19, fontWeight: '700' }, // 19pt bold = large text; brand orange passes 3:1 only for large text
    disabled: { opacity: 0.55 },
    pressed: { opacity: 0.8 },
  });
}
