import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { getGetStudySessionQueryKey, useGetStudySession, useReviewFlashcard, type StudySession } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

/**
 * Flashcards in the chat (D-021): front → tap to flip → Got it / Again. "Again" cards come
 * back around until every card's latest result is "got"; then the deck is finished.
 * Results are saved on the server as they are tapped, so leaving and coming back resumes.
 */
export function FlashcardDeck({ sessionId, userId, onFinished, onError, onStepChange }: {
  sessionId: string;
  userId: string | null | undefined;
  /** Called once when the last card is marked "got it" and the server has finished the deck. */
  onFinished: (session: StudySession) => void;
  onError: (problem: unknown) => void;
  onStepChange?: (step: string) => void;
}) {
  const colors = useColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const key = [...getGetStudySessionQueryKey(sessionId), userId];
  const sessionQuery = useGetStudySession(sessionId, { query: { queryKey: key, enabled: !!userId } });
  const review = useReviewFlashcard();
  const [flipped, setFlipped] = useState(false);
  const session = sessionQuery.data;
  const deck = session?.flashcards ?? null;
  const busy = review.isPending;

  // Cards still to do: never "got" as the latest result. "Again" sends a card to the back of the line.
  const pending = (deck?.cards ?? []).filter((card) => card.results[card.results.length - 1] !== 'got');
  const ordered = [...pending].sort((a, b) => a.results.length - b.results.length);
  const current = ordered[0];
  const total = deck?.cards.length ?? 0;
  const done = total - pending.length;
  const step = !deck ? 'loading' : deck.completedAt ? 'finished' : `${current?.id ?? 'none'}:${flipped ? 'back' : 'front'}`;
  useEffect(() => { onStepChange?.(step); }, [step]);

  if (sessionQuery.isLoading) return <View style={styles.card}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Loading your cards…</Text></View>;
  if (!session || !deck) {
    return <View style={styles.card}><Text style={styles.muted}>Couldn’t load this deck.</Text>
      <Pressable accessibilityRole="button" onPress={() => void sessionQuery.refetch()} style={styles.secondaryButton} testID="button-retry-deck"><Text style={styles.secondaryText}>Retry</Text></Pressable></View>;
  }

  if (deck.completedAt || !current) {
    const again = deck.cards.filter((card) => card.results.includes('again'));
    return (
      <View style={styles.card} testID="panel-deck-finished">
        <Text style={styles.kicker}>FLASHCARDS · {session.topic}</Text>
        <Text style={styles.score}>{total} / {total}</Text>
        <Text style={styles.body}>{again.length ? `${again.length} card${again.length === 1 ? '' : 's'} needed a second look.` : 'Every card on the first try.'}</Text>
        {again.map((card) => <Text key={card.id} style={styles.muted}>• {card.concept}</Text>)}
      </View>
    );
  }

  const mark = async (result: 'got' | 'again') => {
    if (busy) return;
    try {
      const updated = await review.mutateAsync({ id: sessionId, cardId: current.id, data: { result } });
      queryClient.setQueryData(key, updated);
      setFlipped(false);
      if (updated.flashcards?.completedAt) onFinished(updated);
    } catch (problem) { onError(problem); }
  };

  return (
    <View style={styles.card} testID="panel-deck-card">
      <Text style={styles.kicker}>FLASHCARDS · CARD {done + 1} OF {total}{current.results.length ? ' · AGAIN' : ''}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={flipped ? 'Card back' : 'Tap to flip'} onPress={() => setFlipped((f) => !f)} style={[styles.face, flipped && styles.faceBack]} testID="button-flip-card">
        <Text style={styles.faceLabel}>{flipped ? 'ANSWER' : 'TAP TO FLIP'}</Text>
        <Text style={styles.faceText}>{flipped ? current.back : current.front}</Text>
      </Pressable>
      {flipped ? (
        <View style={styles.row}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void mark('again')} style={[styles.againButton, busy && styles.disabled]} testID="button-card-again">
            <Feather name="rotate-ccw" size={16} color={colors.foreground} /><Text style={styles.againText}>Again</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void mark('got')} style={[styles.gotButton, busy && styles.disabled]} testID="button-card-got">
            <Feather name="check" size={16} color={colors.primaryForeground} /><Text style={styles.gotText}>Got it</Text>
          </Pressable>
        </View>
      ) : <Text style={styles.caption}>Say the answer to yourself, then flip.</Text>}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 16, gap: 12 },
  kicker: { color: colors.primary, fontSize: 10, letterSpacing: 1.3, fontWeight: '800' },
  face: { minHeight: 150, borderRadius: 16, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, padding: 16, justifyContent: 'center', gap: 8 },
  faceBack: { backgroundColor: colors.accent },
  faceLabel: { color: colors.mutedForeground, fontSize: 10, letterSpacing: 1.2, fontWeight: '800' },
  faceText: { color: colors.foreground, fontSize: 18, lineHeight: 26, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10 },
  againButton: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  againText: { color: colors.foreground, fontSize: 16, fontWeight: '700' },
  gotButton: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 13, backgroundColor: colors.primary },
  gotText: { color: colors.primaryForeground, fontSize: 16, fontWeight: '700' },
  body: { color: colors.foreground, fontSize: 15, lineHeight: 22 },
  muted: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  caption: { color: colors.mutedForeground, fontSize: 12 },
  score: { color: colors.primary, fontSize: 40, fontWeight: '700', letterSpacing: -1 },
  secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
