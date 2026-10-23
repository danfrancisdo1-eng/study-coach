/**
 * The sounds and haptics behind a graded answer (D-172, D-173). Two short clips (assets/sounds):
 * for a right answer Dan's own cash-register "cha-ching" recording, trimmed to the lever click
 * and the bell (0.95 s); for a wrong one a short, quiet buzzer made for the app (Dan: a buzzer,
 * "but probably not a good idea to annoy someone trying my app"). Both are
 * loaded once when a set opens, so the first answer plays without a delay, and the audio mode
 * is set so they follow the phone's silent switch and mix with whatever else is playing
 * (a podcast is not interrupted). Haptics do not depend on the "Answer sounds" switch: they
 * are silent and are the whole feedback when the phone is muted.
 */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import type { AnswerKind } from '@/lib/answer-feedback';

let players: Record<AnswerKind, AudioPlayer> | null = null;
let preparing: Promise<void> | null = null;

/** Load both clips and set the audio mode. Safe to call many times; it runs once. */
export function prepareFeedbackSounds(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  if (preparing) return preparing;
  preparing = (async () => {
    try {
      await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
      players = {
        correct: createAudioPlayer(require('../assets/sounds/right.wav')),
        wrong: createAudioPlayer(require('../assets/sounds/wrong.wav')),
      };
      players.correct.volume = 0.85;
      players.wrong.volume = 0.6;
    } catch {
      players = null; // No sound on this device; the haptic and the mark still happen.
    }
  })();
  return preparing;
}

/** Play the clip for the answer; a failure is silent. */
export async function playFeedbackSound(kind: AnswerKind): Promise<void> {
  try {
    await prepareFeedbackSounds();
    const player = players?.[kind];
    if (!player) return;
    await player.seekTo(0);
    player.play();
  } catch { /* no sound; nothing to do */ }
}

/** The haptic for the answer: a light success tap, or the error pattern. */
export function feedbackHaptic(kind: AnswerKind): void {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(kind === 'correct' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
}

/** Free the players (the chat screen unmounting). */
export function releaseFeedbackSounds(): void {
  try { players?.correct.remove(); players?.wrong.remove(); } catch { /* already gone */ }
  players = null;
  preparing = null;
}
