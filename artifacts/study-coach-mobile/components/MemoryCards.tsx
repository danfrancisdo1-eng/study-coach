import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { getGetStudySessionQueryKey, useFlagStudyQuestion, useGetStudySession, type StudyMemoryCards } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { ActionButton } from '@/components/ActionButton';
import { ScreenHeader } from '@/components/ScreenHeader';
import { FONT, TYPE } from '@/constants/type';
import { parseSeen, positionLabel, progressKey, startIndex } from '@/lib/memory-cards';

/** The memory cards of one graded set (D-194), polled while the server is still writing them. */
export function useMemoryCards(sessionId: string | null, userId: string | null | undefined): StudyMemoryCards | null {
  const key = [...getGetStudySessionQueryKey(sessionId ?? 'none'), userId];
  const query = useGetStudySession(sessionId ?? 'none', {
    query: { queryKey: key, enabled: Boolean(sessionId && userId), refetchInterval: (q) => (q.state.data?.memoryCards?.status === 'writing' ? 2500 : false) },
  });
  return sessionId ? query.data?.memoryCards ?? null : null;
}

/** How many cards of a set the student has seen (kept on the phone), and a way to raise it. */
export function useCardsSeen(userId: string | null | undefined, sessionId: string | null): [number, (n: number) => void] {
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    setSeen(0);
    if (!userId || !sessionId) return;
    AsyncStorage.getItem(progressKey(userId, sessionId)).then((v) => setSeen(parseSeen(v))).catch(() => {});
  }, [userId, sessionId]);
  const raise = (n: number) => {
    setSeen((current) => {
      const next = Math.max(current, n);
      if (next !== current && userId && sessionId) AsyncStorage.setItem(progressKey(userId, sessionId), String(next)).catch(() => {});
      return next;
    });
  };
  return [seen, raise];
}

/**
 * One memory card at a time (Dan: "behind a button"; UX: one item at a time, chunked): the one thing to
 * remember, why it was missed, the right answer, the memory tool, a cue, a picture, and a lock-in
 * question to answer in your head before tapping Show answer. Next moves on; Done closes.
 */
export function MemoryCardsSheet({ visible, view, sessionId, userId, seen, onSeen, onClose }: {
  visible: boolean;
  view: StudyMemoryCards | null;
  sessionId: string;
  userId: string;
  seen: number;
  onSeen: (n: number) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const queryClient = useQueryClient();
  const flag = useFlagStudyQuestion();
  const cards = view?.status === 'ready' ? view.cards : [];
  const total = cards.length;
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const [rechecked, setRechecked] = useState<Record<string, 'sent' | 'failed'>>({});
  // Each opening starts at the first card not yet seen.
  useEffect(() => { if (visible) { setIndex(startIndex(seen, total)); setShown(false); } }, [visible, total]);
  useEffect(() => { if (visible && total) onSeen(index + 1); }, [visible, index, total]);
  const card = cards[Math.min(index, Math.max(0, total - 1))];
  const last = index >= total - 1;
  const go = (next: number) => { setIndex(next); setShown(false); };

  const recheck = async () => {
    if (!card?.keyConcern || rechecked[card.questionId] === 'sent') return;
    try {
      const updated = await flag.mutateAsync({ id: sessionId, questionId: card.questionId, data: { kind: 'wrong_answer', reason: card.keyConcern.slice(0, 500) } });
      queryClient.setQueryData([...getGetStudySessionQueryKey(sessionId), userId], updated);
      setRechecked((r) => ({ ...r, [card.questionId]: 'sent' }));
    } catch {
      setRechecked((r) => ({ ...r, [card.questionId]: 'failed' }));
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]} testID="sheet-memory-cards">
        <ScreenHeader leading="down" leadingLabel="Close memory cards" onLeading={onClose} leadingTestID="button-close-cards"
          kicker="Memory cards" title={total ? positionLabel(index, total) : 'Memory cards'} divider />
        {!card ? (
          <View style={styles.waiting}>
            {view?.status === 'writing' ? <ActivityIndicator color={colors.primaryText} /> : null}
            <Text style={styles.muted}>{view?.status === 'writing' ? 'Writing your memory cards…' : "Couldn't write memory cards for this set."}</Text>
          </View>
        ) : (
          <>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="scroll-memory-card">
              <Animated.View key={card.questionId} entering={reduceMotion ? undefined : FadeIn.duration(220)} style={styles.stack}>
                {index === 0 && view?.setNote ? <Text style={styles.setNote} testID="text-cards-set-note">{view.setNote}</Text> : null}
                <View style={styles.card} testID="card-memory">
                  <Text style={styles.kicker}>{card.techniqueLabel}</Text>
                  <Text style={styles.headline} accessibilityRole="header">{card.headline}</Text>
                  {card.whyYouMissed ? (
                    <View style={styles.block}>
                      <Text style={styles.label}>Why you missed it</Text>
                      <Text style={styles.body}>{card.whyYouMissed}</Text>
                    </View>
                  ) : null}
                  <View style={styles.answerBox}>
                    <Feather name="check-circle" size={16} color={colors.primaryText} />
                    <Text style={styles.answerText}><Text style={styles.answerLabel}>Right answer: </Text>{card.correctAnswer}</Text>
                  </View>
                  <View style={styles.toolBox} testID="text-memory-tool">
                    <Text style={styles.toolLabel}>Remember it</Text>
                    <Text style={styles.toolText}>{card.memoryTool}</Text>
                  </View>
                  {card.visualCue ? (
                    <View style={styles.row}>
                      <Feather name="image" size={16} color={colors.mutedForeground} />
                      <Text style={[styles.body, styles.flex]}><Text style={styles.strong}>Picture it: </Text>{card.visualCue}</Text>
                    </View>
                  ) : null}
                  {card.recallCue ? (
                    <View style={styles.row}>
                      <Feather name="key" size={16} color={colors.mutedForeground} />
                      <Text style={[styles.body, styles.flex]}><Text style={styles.strong}>Cue: </Text>{card.recallCue}</Text>
                    </View>
                  ) : null}
                </View>
                {card.lockIn ? (
                  <View style={styles.lockIn} testID="card-lock-in">
                    <Text style={styles.label}>Lock it in</Text>
                    <Text style={styles.prompt}>{card.lockIn.prompt}</Text>
                    {shown ? <Text style={styles.body} testID="text-lock-in-answer">{card.lockIn.answer}</Text> : (
                      <Pressable accessibilityRole="button" accessibilityHint="Answer it in your head first" onPress={() => setShown(true)} style={({ pressed }) => [styles.showButton, pressed && styles.pressed]} testID="button-show-answer">
                        <Text style={styles.showText}>Show answer</Text>
                      </Pressable>
                    )}
                  </View>
                ) : null}
                {card.keyConcern ? (
                  <View style={styles.concern} testID="card-key-concern">
                    <Text style={styles.caption}>The coach isn't sure this answer key is right: {card.keyConcern}</Text>
                    {rechecked[card.questionId] === 'sent' ? <Text style={styles.caption}>Re-check requested. It shows on the question in your set.</Text> : (
                      <Pressable accessibilityRole="button" disabled={flag.isPending} onPress={() => void recheck()} style={styles.linkButton} testID="button-recheck-key">
                        <Text style={styles.link}>{rechecked[card.questionId] === 'failed' ? "Couldn't send. Try again" : 'Ask for a re-check'}</Text>
                      </Pressable>
                    )}
                  </View>
                ) : null}
              </Animated.View>
            </ScrollView>
            <View style={styles.footer}>
              {index > 0 ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Previous card" onPress={() => go(index - 1)} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} testID="button-card-back">
                  <Feather name="chevron-left" size={22} color={colors.foreground} />
                </Pressable>
              ) : null}
              <View style={styles.flex}>
                <ActionButton label={last ? 'Done' : 'Next card'} icon={last ? 'check' : 'arrow-right'} onPress={() => (last ? onClose() : go(index + 1))} testID={last ? 'button-cards-done' : 'button-card-next'} />
              </View>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.background },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 24 },
  stack: { gap: 14 },
  setNote: { ...TYPE.body, color: colors.foreground },
  card: { gap: 12, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  kicker: { ...TYPE.kicker, fontSize: 12, color: colors.primaryText },
  headline: { fontFamily: FONT.serif, fontSize: 22, lineHeight: 29, color: colors.foreground },
  block: { gap: 2 },
  label: { ...TYPE.smallSemi, color: colors.mutedForeground },
  body: { ...TYPE.body, color: colors.foreground },
  strong: { fontFamily: FONT.sansSemi },
  muted: { ...TYPE.body, color: colors.mutedForeground, textAlign: 'center' },
  caption: { ...TYPE.small, color: colors.mutedForeground },
  answerBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 12, backgroundColor: colors.accent },
  answerLabel: { fontFamily: FONT.sansSemi },
  answerText: { ...TYPE.body, color: colors.accentForeground, flex: 1 },
  toolBox: { gap: 4, padding: 14, borderRadius: 12, backgroundColor: colors.hookBg },
  toolLabel: { ...TYPE.smallSemi, color: colors.hookText },
  toolText: { ...TYPE.bodySemi, color: colors.hookText },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  flex: { flex: 1 },
  lockIn: { gap: 8, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  prompt: { ...TYPE.prompt, color: colors.foreground },
  showButton: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: colors.primaryText },
  showText: { ...TYPE.smallSemi, color: colors.primaryText },
  concern: { gap: 4, paddingHorizontal: 4 },
  linkButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  link: { ...TYPE.smallSemi, color: colors.primaryText },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 8 },
  backButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, borderWidth: 1, borderColor: colors.border },
  pressed: { opacity: 0.6 },
});
