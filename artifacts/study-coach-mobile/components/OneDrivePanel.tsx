import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { PRESS_SCALE, PressScale } from '@/components/PressScale';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ActionButton } from '@/components/ActionButton';
import { isPhoto, pickProblem, rowDetail, type OneDriveRow } from '@/lib/onedrive';
import { connect, disconnect, downloadToCache, driveOwner, isConnected, listFolder, searchDrive } from '@/lib/onedrive-session';

/**
 * Direct OneDrive (D-190), shown inside the + sheet in place of the source buttons: sign in with
 * Microsoft (first time only), then the student's own OneDrive, folders first, readable files only.
 * Tapping a file copies it to the phone and hands it to the normal upload (split, notes, duplicates).
 */
export function OneDrivePanel({ aiConsent, onPick, onClose }: {
  aiConsent: boolean;
  onPick: (uri: string, filename: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = createStyles(colors);
  const [phase, setPhase] = useState<'checking' | 'signin' | 'browse'>('checking');
  const [signingIn, setSigningIn] = useState(false);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<OneDriveRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [owner, setOwner] = useState('');
  const mounted = useRef(true);
  const signingRef = useRef(false);
  const loadRef = useRef<AbortController | null>(null);
  useEffect(() => () => { mounted.current = false; loadRef.current?.abort(); }, []);

  const failed = (error: unknown) => {
    if (!mounted.current) return;
    const reconnect = Boolean(error && typeof error === 'object' && 'reconnect' in error && (error as { reconnect?: boolean }).reconnect);
    setProblem(error instanceof Error && error.message ? error.message : "Couldn't reach OneDrive. Try again.");
    if (reconnect) setPhase('signin');
  };

  const load = async (run: (signal: AbortSignal) => Promise<OneDriveRow[]>) => {
    loadRef.current?.abort();
    const abort = new AbortController();
    loadRef.current = abort;
    setLoading(true); setProblem('');
    try {
      const next = await run(abort.signal);
      if (mounted.current && !abort.signal.aborted) setRows(next);
    } catch (error) {
      if (!abort.signal.aborted) failed(error);
    } finally {
      if (mounted.current && loadRef.current === abort) setLoading(false);
    }
  };

  const openDrive = () => {
    setPhase('browse'); setFolders([]); setSearched(''); setQuery('');
    void load((signal) => listFolder(null, signal));
    void driveOwner().then((name) => { if (mounted.current) setOwner(name); }).catch(() => undefined);
  };

  const signIn = async () => {
    if (signingRef.current) return;
    signingRef.current = true;
    setSigningIn(true); setProblem('');
    try {
      if (await connect()) { if (mounted.current) openDrive(); }
      else if (mounted.current) setPhase('signin');
    } catch (error) {
      failed(error);
      if (mounted.current) setPhase('signin');
    } finally {
      signingRef.current = false;
      if (mounted.current) setSigningIn(false);
    }
  };

  // Tapping OneDrive is the request: signed in already → the drive; first time → Microsoft's page.
  useEffect(() => {
    void isConnected().then((yes) => {
      if (!mounted.current) return;
      if (yes) openDrive(); else void signIn();
    }).catch(() => { if (mounted.current) setPhase('signin'); });
  }, []);

  const openFolder = (row: OneDriveRow) => {
    setFolders((stack) => [...stack, { id: row.id, name: row.name }]);
    setSearched('');
    void load((signal) => listFolder(row.id, signal));
  };

  const back = () => {
    if (searched) {
      setSearched(''); setQuery('');
      const current = folders[folders.length - 1];
      void load((signal) => listFolder(current?.id ?? null, signal));
      return;
    }
    const stack = folders.slice(0, -1);
    setFolders(stack);
    void load((signal) => listFolder(stack[stack.length - 1]?.id ?? null, signal));
  };

  const search = () => {
    const text = query.trim();
    if (!text) return;
    setSearched(text);
    void load((signal) => searchDrive(text, signal));
  };

  const choose = async (row: OneDriveRow) => {
    if (downloading) return;
    if (row.kind === 'folder') { openFolder(row); return; }
    const reason = pickProblem(row);
    if (reason) { setProblem(reason); return; }
    if (isPhoto(row.name) && !aiConsent) { setProblem('Enable AI-assisted study before reading photos.'); return; }
    setDownloading(row.id); setProblem('');
    try {
      const uri = await downloadToCache(row);
      if (mounted.current) onPick(uri, row.name);
    } catch (error) {
      failed(error);
    } finally {
      if (mounted.current) setDownloading(null);
    }
  };

  const signOut = async () => {
    await disconnect().catch(() => undefined);
    if (!mounted.current) return;
    setRows([]); setFolders([]); setOwner(''); setSearched(''); setQuery('');
    setProblem('OneDrive is disconnected from this phone.');
    setPhase('signin');
  };

  const title = searched ? `Results for "${searched}"` : folders[folders.length - 1]?.name ?? 'OneDrive';
  const canGoBack = phase === 'browse' && (folders.length > 0 || Boolean(searched));

  return (
    <View style={styles.panel} testID="panel-onedrive">
      <View style={styles.header}>
        {canGoBack ? (
          <PressScale scale={PRESS_SCALE.icon} onPress={back} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={styles.iconButton} testID="button-onedrive-back">
            <Feather name="chevron-left" size={22} color={colors.foreground} />
          </PressScale>
        ) : <Feather name="cloud" size={18} color={colors.primaryText} style={styles.cloud} />}
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{title}</Text>
        <PressScale scale={PRESS_SCALE.icon} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close OneDrive" hitSlop={8} style={styles.iconButton} testID="button-onedrive-close">
          <Feather name="x" size={20} color={colors.mutedForeground} />
        </PressScale>
      </View>

      {phase === 'checking' ? <ActivityIndicator color={colors.primaryText} /> : null}

      {phase === 'signin' ? (
        <View style={styles.stack}>
          <Text style={styles.muted}>Sign in with your Microsoft account to pick a file from your OneDrive. Study Coach can only read files; it never changes them.</Text>
          <ActionButton label={signingIn ? 'Opening Microsoft…' : 'Sign in to OneDrive'} icon="log-in" onPress={() => void signIn()} disabled={signingIn} testID="button-onedrive-signin" />
        </View>
      ) : null}

      {phase === 'browse' ? (
        <View style={styles.stack}>
          <TextInput
            accessibilityLabel="Search OneDrive" testID="input-onedrive-search" value={query} onChangeText={setQuery}
            onSubmitEditing={search} returnKeyType="search" autoCapitalize="none" autoCorrect={false}
            placeholder="Search your OneDrive" placeholderTextColor={colors.mutedForeground} style={styles.input}
          />
          <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled" testID="list-onedrive">
            {loading ? <ActivityIndicator style={styles.spinner} color={colors.primaryText} /> : null}
            {!loading && !rows.length ? (
              <Text style={[styles.muted, styles.empty]}>{searched ? 'No PDF, Word, PowerPoint, text or photo files match.' : 'No PDF, Word, PowerPoint, text or photo files here.'}</Text>
            ) : null}
            {!loading ? rows.map((row) => (
              <PressScale scale={PRESS_SCALE.card}
                key={row.id} onPress={() => void choose(row)} disabled={Boolean(downloading)}
                accessibilityRole="button" accessibilityLabel={`${row.name}, ${row.kind === 'folder' ? 'folder' : 'file'}, ${rowDetail(row)}`}
                style={[styles.row]} testID="row-onedrive-item"
              >
                <Feather name={row.kind === 'folder' ? 'folder' : isPhoto(row.name) ? 'image' : 'file-text'} size={20} color={row.kind === 'folder' ? colors.primaryText : colors.mutedForeground} />
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={2}>{row.name}</Text>
                  <Text style={styles.caption}>{rowDetail(row)}</Text>
                </View>
                {downloading === row.id ? <ActivityIndicator color={colors.primaryText} />
                  : row.kind === 'folder' ? <Feather name="chevron-right" size={18} color={colors.mutedForeground} /> : null}
              </PressScale>
            )) : null}
          </ScrollView>
          <View style={styles.footer}>
            <Text style={[styles.caption, styles.footerText]} numberOfLines={1}>{owner ? `Signed in as ${owner}` : 'Signed in to OneDrive'}</Text>
            <PressScale onPress={() => void signOut()} accessibilityRole="button" accessibilityLabel="Disconnect OneDrive" hitSlop={10} style={styles.linkButton} testID="button-onedrive-disconnect">
              <Text style={styles.link}>Disconnect</Text>
            </PressScale>
          </View>
        </View>
      ) : null}

      {problem ? <Text style={styles.problem} testID="status-onedrive">{problem}</Text> : null}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  panel: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cloud: { width: 44, textAlign: 'center' },
  title: { flex: 1, color: colors.foreground, fontSize: 17, lineHeight: 23, fontWeight: '700' },
  stack: { gap: 10 },
  muted: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  caption: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.card, color: colors.foreground, fontSize: 15, paddingHorizontal: 13 },
  list: { maxHeight: 360 },
  spinner: { paddingVertical: 18 },
  empty: { paddingVertical: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pressed: { opacity: 0.6 },
  rowText: { flex: 1, gap: 2 },
  rowName: { color: colors.foreground, fontSize: 15, lineHeight: 20 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  footerText: { flex: 1 },
  linkButton: { minHeight: 44, justifyContent: 'center' },
  link: { color: colors.primaryText, fontSize: 13, fontWeight: '600' },
  problem: { color: colors.accentForeground, fontSize: 12, lineHeight: 18 },
});
