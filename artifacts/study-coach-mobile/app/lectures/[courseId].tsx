import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  AudioQuality, IOSOutputFormat, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { createLecture, getListLecturesQueryKey, useListLectures, type LectureSummary } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import {
  formatDuration, normalizedTitle, recordedSeconds, recordingLimitState, spokenDuration, type PendingRecording,
} from '@/lib/lecture-recording';
import { attachRecording, keepRecording, lectureAudio, listPendingRecordings, updatePendingRecording } from '@/lib/lecture-storage';

// Mono AAC at 48 kbps: clear speech, about 43 MB for the two-hour maximum.
const LECTURE_RECORDING: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 48000,
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM },
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  web: { mimeType: 'audio/webm', bitsPerSecond: 48000 },
};

const STATUS_LABEL: Record<LectureSummary['status'], { label: string; icon: React.ComponentProps<typeof Feather>['name'] }> = {
  recorded: { label: 'Not transcribed yet', icon: 'mic' },
  transcribed: { label: 'Transcript ready to review', icon: 'edit-3' },
  reviewed: { label: 'Used for studying', icon: 'check-circle' },
};

type Phase = { kind: 'idle' } | { kind: 'starting' } | { kind: 'recording'; startedAt: Date } | { kind: 'naming'; pending: PendingRecording } | { kind: 'saving' };

export default function CourseLecturesScreen() {
  const colors = useColors();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  const { courseId, courseName } = useLocalSearchParams<{ courseId: string; courseName?: string }>();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const listKey = [...getListLecturesQueryKey({ courseId }), userId];
  const lectures = useListLectures({ courseId }, { query: { queryKey: listKey, enabled: Boolean(userId && courseId) } });

  const recorder = useAudioRecorder(LECTURE_RECORDING, (status) => {
    // Interrupted by iOS (call, Siri, another app taking the microphone): keep what was recorded.
    if ((status.isFinished || status.hasError) && phaseRef.current.kind === 'recording') void finishRecording();
  });
  const recorderState = useAudioRecorderState(recorder, 500);
  const [phase, setPhaseState] = useState<Phase>({ kind: 'idle' });
  const phaseRef = useRef<Phase>(phase);
  const setPhase = (next: Phase) => { phaseRef.current = next; setPhaseState(next); };
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState<PendingRecording[]>([]);
  const [message, setMessage] = useState('');

  const elapsedSeconds = Math.floor(recorderState.durationMillis / 1000);
  const limit = recordingLimitState(elapsedSeconds);

  const refreshPending = useCallback(async () => {
    try {
      setPending((await listPendingRecordings()).filter((item) => item.courseId === courseId));
    } catch {
      setMessage('Couldn’t read recordings saved on this iPhone. They have not been deleted.');
    }
  }, [courseId]);

  // Register recordings that were saved while offline (or before the app was closed).
  const uploadPending = useCallback(async (items: PendingRecording[]) => {
    for (const item of items) {
      try {
        const lecture = await createLecture({ courseId: item.courseId, title: item.title, recordedAt: item.recordedAt, durationSeconds: item.durationSeconds });
        await attachRecording(item.localId, lecture.id);
      } catch {
        setMessage('Some recordings are saved on this iPhone but not yet in your account. They will upload when you’re online.');
        break;
      }
    }
    await refreshPending();
    await queryClient.invalidateQueries({ queryKey: listKey });
  }, [queryClient, refreshPending, listKey.join('|')]);

  useFocusEffect(useCallback(() => {
    void (async () => {
      const items = (await listPendingRecordings().catch(() => [])).filter((item) => item.courseId === courseId);
      setPending(items);
      if (items.length && phaseRef.current.kind === 'idle') await uploadPending(items);
    })();
  }, [courseId, uploadPending]));

  async function startRecording() {
    setMessage('');
    setPhase({ kind: 'starting' });
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setPhase({ kind: 'idle' });
        Alert.alert('Microphone is off', 'To record lectures, allow Study Coach to use the microphone in Settings.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase({ kind: 'recording', startedAt: new Date() });
    } catch {
      setPhase({ kind: 'idle' });
      setMessage('Recording couldn’t start. Check that no other app is using the microphone, then try again.');
    }
  }

  async function finishRecording() {
    const current = phaseRef.current;
    if (current.kind !== 'recording') return;
    setPhase({ kind: 'saving' });
    const durationMillis = recorder.getStatus().durationMillis || recorderState.durationMillis;
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch {
      // Already stopped by iOS; the file written so far is still kept below.
    }
    await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false }).catch(() => {});
    const uri = recorder.uri;
    if (!uri) {
      setPhase({ kind: 'idle' });
      setMessage('The recording couldn’t be saved. Nothing was recorded to keep.');
      return;
    }
    const info: PendingRecording = {
      localId: Crypto.randomUUID(),
      courseId,
      title: normalizedTitle('', current.startedAt),
      recordedAt: current.startedAt.toISOString(),
      durationSeconds: recordedSeconds(durationMillis),
    };
    try {
      // Saved to this iPhone first, so nothing is lost if naming or upload never happens.
      await keepRecording(uri, info);
    } catch {
      setPhase({ kind: 'idle' });
      setMessage('The recording couldn’t be moved to safe storage. Don’t close the app; try stopping again.');
      return;
    }
    setTitle(info.title);
    setPhase({ kind: 'naming', pending: info });
    await refreshPending();
  }

  // Automatic stop at the two-hour transcription limit.
  useEffect(() => {
    if (phase.kind === 'recording' && limit === 'stop') void finishRecording();
  }, [phase.kind, limit]);

  async function saveNamedRecording() {
    if (phase.kind !== 'naming') return;
    const info = { ...phase.pending, title: normalizedTitle(title, new Date(phase.pending.recordedAt)) };
    setPhase({ kind: 'saving' });
    updatePendingRecording(info);
    try {
      const lecture = await createLecture({ courseId: info.courseId, title: info.title, recordedAt: info.recordedAt, durationSeconds: info.durationSeconds });
      await attachRecording(info.localId, lecture.id);
      await queryClient.invalidateQueries({ queryKey: listKey });
      await refreshPending();
      setPhase({ kind: 'idle' });
      router.push({ pathname: '/lecture/[id]', params: { id: lecture.id, courseName: courseName ?? '' } });
    } catch {
      await refreshPending();
      setPhase({ kind: 'idle' });
      setMessage('Saved on this iPhone. It will be added to your account when you’re online.');
    }
  }

  const recording = phase.kind === 'recording';
  const busy = phase.kind === 'starting' || phase.kind === 'saving';
  const items = lectures.data?.lectures ?? [];

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to courses" onPress={() => router.back()} disabled={recording} style={styles.iconButton} testID="button-lectures-back">
          <Feather name="arrow-left" size={20} color={recording ? colors.mutedForeground : colors.foreground} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle} accessibilityRole="header">Lectures</Text>
          {courseName ? <Text style={styles.caption} numberOfLines={1}>{courseName}</Text> : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]} keyboardShouldPersistTaps="handled">
        {message ? <View style={styles.notice} accessibilityRole="alert"><Feather name="info" size={16} color={colors.foreground} /><Text style={styles.body}>{message}</Text></View> : null}

        {phase.kind === 'naming' ? (
          <View style={styles.card} testID="panel-name-lecture">
            <Text style={styles.cardTitle}>Recording saved on this iPhone</Text>
            <Text style={styles.body}>{formatDuration(phase.pending.durationSeconds)} recorded. Name it so you can find it later.</Text>
            <TextInput
              value={title} onChangeText={setTitle} maxLength={200} autoFocus returnKeyType="done" onSubmitEditing={() => void saveNamedRecording()}
              accessibilityLabel="Lecture name" placeholder="Lecture name" placeholderTextColor={colors.mutedForeground} style={styles.input} testID="input-lecture-title"
            />
          </View>
        ) : null}

        {recording ? (
          <View style={styles.card} testID="panel-recording">
            <Text style={styles.timer} accessibilityLabel={`Recording, ${spokenDuration(elapsedSeconds)}`} accessibilityLiveRegion="polite">{formatDuration(elapsedSeconds)}</Text>
            <Text style={styles.body}>Recording keeps going if you lock your iPhone. Stop when the lecture ends.</Text>
            {limit === 'warning' ? <Text style={styles.warning} accessibilityRole="alert">Recording stops automatically at 2 hours.</Text> : null}
          </View>
        ) : null}

        {pending.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Saved on this iPhone</Text>
            {pending.map((item) => (
              <View key={item.localId} style={styles.row} testID={`row-pending-${item.localId}`}>
                <Feather name="smartphone" size={18} color={colors.mutedForeground} />
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.caption}>{formatDuration(item.durationSeconds)} · not yet in your account</Text>
                </View>
              </View>
            ))}
            {phase.kind === 'idle' ? (
              <Pressable accessibilityRole="button" onPress={() => void uploadPending(pending)} style={styles.textButton} testID="button-retry-pending">
                <Text style={styles.link}>Try adding them now</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your lectures</Text>
          {lectures.isLoading ? <ActivityIndicator color={colors.primaryText} /> : null}
          {lectures.error ? (
            <View style={styles.notice} accessibilityRole="alert">
              <Text style={styles.body}>Couldn’t load your lectures.</Text>
              <Pressable accessibilityRole="button" onPress={() => void lectures.refetch()} style={styles.textButton}><Text style={styles.link}>Try again</Text></Pressable>
            </View>
          ) : null}
          {!lectures.isLoading && !lectures.error && items.length === 0 && !pending.length ? (
            <Text style={styles.body}>Record a lecture and Study Coach turns it into notes you can review, ask about, and be quizzed on.</Text>
          ) : null}
          {items.map((item) => {
            const status = STATUS_LABEL[item.status];
            const onPhone = Boolean(lectureAudio(item.id));
            return (
              <Pressable
                key={item.id} accessibilityRole="button" disabled={recording}
                accessibilityLabel={`${item.title}, ${spokenDuration(item.durationSeconds)}, ${status.label}`}
                onPress={() => router.push({ pathname: '/lecture/[id]', params: { id: item.id, courseName: courseName ?? '' } })}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]} testID={`row-lecture-${item.id}`}
              >
                <Feather name={status.icon} size={18} color={item.status === 'reviewed' ? colors.accentForeground : colors.mutedForeground} />
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.caption}>
                    {new Date(item.recordedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {formatDuration(item.durationSeconds)} · {status.label}{onPhone ? '' : ' · audio not on this iPhone'}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        {phase.kind === 'naming' ? (
          <Pressable accessibilityRole="button" onPress={() => void saveNamedRecording()} style={styles.primaryButton} testID="button-save-lecture">
            <Text style={styles.primaryText}>Save lecture</Text>
          </Pressable>
        ) : (
          <>
            {!recording ? <Text style={styles.caption}>Only record where your instructor and classmates allow it.</Text> : null}
            <Pressable
              accessibilityRole="button" accessibilityLabel={recording ? 'Stop recording' : 'Record lecture'} disabled={busy}
              onPress={() => void (recording ? finishRecording() : startRecording())}
              style={({ pressed }) => [styles.primaryButton, busy && styles.disabled, pressed && styles.pressed]} testID="button-record-lecture"
            >
              {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name={recording ? 'square' : 'mic'} size={20} color={colors.primaryForeground} />}
              <Text style={styles.primaryText}>{recording ? 'Stop recording' : busy ? 'Please wait' : 'Record lecture'}</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
    headerCopy: { flex: 1 },
    headerTitle: { color: colors.foreground, fontSize: 22, fontWeight: '700' },
    iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    content: { paddingHorizontal: 18, gap: 18 },
    section: { gap: 10 },
    sectionTitle: { color: colors.foreground, fontSize: 17, fontWeight: '700' },
    card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: colors.radius, padding: 17, gap: 10 },
    cardTitle: { color: colors.foreground, fontSize: 17, fontWeight: '700' },
    body: { color: colors.foreground, fontSize: 15, lineHeight: 22, flexShrink: 1 },
    caption: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
    warning: { color: colors.destructive, fontSize: 15, fontWeight: '600' },
    timer: { color: colors.foreground, fontSize: 44, fontWeight: '700', fontVariant: ['tabular-nums'] },
    notice: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: colors.muted, borderRadius: 12, padding: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 14 },
    rowCopy: { flex: 1, gap: 2 },
    rowTitle: { color: colors.foreground, fontSize: 16, fontWeight: '600' },
    input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.background, color: colors.foreground, fontSize: 16, paddingHorizontal: 13 },
    textButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    link: { color: colors.primaryText, fontSize: 15, fontWeight: '600' },
    bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10, gap: 8, backgroundColor: colors.background, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
    primaryButton: { minHeight: 54, borderRadius: 14, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    primaryText: { color: colors.primaryForeground, fontSize: 19, fontWeight: '700' }, // 19pt bold = large text; brand orange passes 3:1 only for large text
    disabled: { opacity: 0.55 },
    pressed: { opacity: 0.8 },
  });
}
