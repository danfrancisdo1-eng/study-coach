import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { getListRepsQueryKey, useCreateRep, useListReps, useMarkRepPaid, useUnmarkRepPaid, type RepRow } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { TYPE } from '@/constants/type';
import { AuroraBackground } from '@/components/AuroraBackground';
import { HeaderIconButton, ScreenHeader } from '@/components/ScreenHeader';
import { PRESS_SCALE, PressScale } from '@/components/PressScale';
import { friendlyError } from '@/lib/friendly-error';
import { money, monthLabel, normalizeRepCode } from '@/lib/rep-code';

/**
 * Campus reps (D-219; the mock Dan approved, "Your page: all reps and payouts"), from Account, for the owner's account
 * only (the server answers 403 to everyone else). One month at a time: totals, then a card per rep with their code,
 * sign-ups, who studied this week, who pays, what came in after Apple's fee and the rep's share, Mark paid, and the
 * link to the rep's private page to send them. Add rep creates a code (or takes one typed).
 */
export default function RepsScreen() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [school, setSchool] = useState('All');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const params = month ? { month } : {};
  const report = useListReps(params, { query: { queryKey: getListRepsQueryKey(params) } });
  const markPaid = useMarkRepPaid();
  const unmarkPaid = useUnmarkRepPaid();
  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/account'); };
  const data = report.data;
  const shownMonth = data?.month ?? month ?? '';
  const schools = ['All', ...Array.from(new Set((data?.reps ?? []).map((r) => r.school)))];
  const reps = (data?.reps ?? []).filter((r) => school === 'All' || r.school === school);
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListRepsQueryKey(params) });

  const togglePaid = async (rep: RepRow) => {
    setError('');
    try {
      if (rep.paid) await unmarkPaid.mutateAsync({ repId: rep.id, month: shownMonth });
      else await markPaid.mutateAsync({ repId: rep.id, month: shownMonth });
      await refresh();
    } catch (problem) { setError(friendlyError(problem)); }
  };
  const shareLink = (rep: RepRow) => {
    void Share.share({ message: `Hi ${rep.name.split(' ')[0]}! Your RapidRecall AI rep page (sign-ups and earnings): ${rep.link}\nYour code: ${rep.code}` });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="screen-reps">
      <AuroraBackground />
      <ScreenHeader leading="back" onLeading={back} kicker="Campus reps" title={shownMonth ? monthLabel(shownMonth) : 'Campus reps'}
        right={<HeaderIconButton icon="user-plus" label="Add rep" onPress={() => setAdding(true)} testID="button-add-rep" />} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
        {report.isLoading ? <ActivityIndicator color={colors.primaryText} /> : null}
        {report.error ? <Text style={styles.error} accessibilityRole="alert">{friendlyError(report.error)}</Text> : null}
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        {data ? (
          <>
            <Text style={styles.caption}>Reps get their share of what you receive from their students, after Apple's fee. Test (sandbox) purchases don't count.</Text>
            {data.months.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {data.months.map((m) => (
                  <PressScale key={m} accessibilityRole="button" accessibilityState={{ selected: m === shownMonth }} onPress={() => setMonth(m)} style={[styles.chip, m === shownMonth && styles.chipOn]} testID="chip-rep-month">
                    <Text style={[styles.chipText, m === shownMonth && styles.chipTextOn]}>{monthLabel(m)}</Text>
                  </PressScale>
                ))}
              </ScrollView>
            ) : null}
            <View style={styles.totals}>
              {[
                [String(data.totals.signups), 'sign-ups with a rep code'],
                [String(data.totals.paying), 'paying students'],
                [money(data.totals.netCents), 'you received (after Apple)'],
                [money(data.totals.owedCents), 'owed to reps'],
              ].map(([value, label]) => (
                <View key={label} style={styles.total} accessible accessibilityLabel={`${value} ${label}`}>
                  <Text style={styles.totalValue}>{value}</Text>
                  <Text style={styles.totalLabel}>{label}</Text>
                </View>
              ))}
            </View>
            {schools.length > 2 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {schools.map((s) => (
                  <PressScale key={s} accessibilityRole="button" accessibilityState={{ selected: s === school }} onPress={() => setSchool(s)} style={[styles.chip, s === school && styles.chipOn]} testID="chip-rep-school">
                    <Text style={[styles.chipText, s === school && styles.chipTextOn]}>{s}</Text>
                  </PressScale>
                ))}
              </ScrollView>
            ) : null}
            {!data.reps.length ? <Text style={styles.empty}>No reps yet. Tap the add button to create your first rep and their code.</Text> : null}
            {reps.map((rep) => (
              <View key={rep.id} style={styles.card} testID="card-rep">
                <View style={styles.cardHead}>
                  <View style={styles.flex}>
                    <Text style={styles.name}>{rep.name}</Text>
                    <Text style={styles.caption}>{rep.school} · <Text style={styles.code}>{rep.code}</Text>{rep.sharePercent !== 50 ? ` · ${rep.sharePercent}%` : ''}</Text>
                  </View>
                  <PressScale scale={PRESS_SCALE.icon} accessibilityRole="button" accessibilityLabel={`Send ${rep.name} their page link`} onPress={() => shareLink(rep)} style={styles.iconButton} testID="button-share-rep">
                    <Feather name="share" size={18} color={colors.primaryText} />
                  </PressScale>
                </View>
                <Text style={styles.stats}>{rep.signups} signed up · {rep.active7d} studied this week · {rep.paying} paying</Text>
                <View style={styles.moneyRow}>
                  <Text style={styles.moneyText}>Received {money(rep.netCents)}</Text>
                  <Text style={styles.share}>Their share {money(rep.shareCents)}</Text>
                </View>
                <PressScale accessibilityRole="button" accessibilityState={{ checked: rep.paid }} disabled={markPaid.isPending || unmarkPaid.isPending}
                  onPress={() => void togglePaid(rep)} style={[styles.paidButton, rep.paid && styles.paidOn]} testID="button-rep-paid">
                  <Text style={[styles.paidText, rep.paid && styles.paidTextOn]}>{rep.paid ? 'Paid ✓' : `Mark ${monthLabel(shownMonth).split(' ')[0]} paid`}</Text>
                </PressScale>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
      <AddRepSheet visible={adding} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); void refresh(); }} />
    </View>
  );
}

function AddRepSheet({ visible, onClose, onAdded }: { visible: boolean; onClose: () => void; onAdded: () => void }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const create = useCreateRep();
  const [name, setName] = useState('');
  const [school, setSchool] = useState('');
  const [code, setCode] = useState('');
  const [share, setShare] = useState('50');
  const [error, setError] = useState('');
  const percent = Number.parseInt(share, 10);
  const ready = name.trim().length > 1 && school.trim().length > 1 && percent >= 0 && percent <= 100;
  const save = async () => {
    setError('');
    try {
      await create.mutateAsync({ data: { name: name.trim(), school: school.trim(), ...(normalizeRepCode(code) ? { code: normalizeRepCode(code) } : {}), sharePercent: percent } });
      setName(''); setSchool(''); setCode(''); setShare('50');
      onAdded();
    } catch (problem) { setError(friendlyError(problem)); }
  };
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: 20, paddingBottom: insets.bottom }]}>
        <ScreenHeader kicker="Campus reps" title="Add a rep" right={<HeaderIconButton icon="x" label="Close" onPress={onClose} testID="button-close-add-rep" />} />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text style={styles.label}>Name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Jane Carter" placeholderTextColor={colors.mutedForeground} style={styles.input} accessibilityLabel="Rep name" testID="input-rep-name" />
          <Text style={styles.label}>School</Text>
          <TextInput value={school} onChangeText={setSchool} placeholder="Ole Miss" placeholderTextColor={colors.mutedForeground} style={styles.input} accessibilityLabel="School" testID="input-rep-school" />
          <Text style={styles.label}>Code <Text style={styles.caption}>(optional; made from the name and school if empty)</Text></Text>
          <TextInput value={code} onChangeText={setCode} placeholder="JANE-OM" autoCapitalize="characters" autoCorrect={false} placeholderTextColor={colors.mutedForeground} style={styles.input} accessibilityLabel="Rep code, optional" testID="input-rep-code-new" />
          <Text style={styles.label}>Their share (%)</Text>
          <TextInput value={share} onChangeText={setShare} keyboardType="number-pad" maxLength={3} style={styles.input} accessibilityLabel="Rep's share in percent" testID="input-rep-share" />
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <PressScale gradient={ready} accessibilityRole="button" disabled={!ready || create.isPending} onPress={() => void save()} style={[styles.primary, !ready && styles.disabled]} testID="button-save-rep">
            {create.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={styles.primaryText}>Add rep</Text>}
          </PressScale>
        </ScrollView>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 12 },
  caption: { ...TYPE.small, color: colors.mutedForeground },
  error: { ...TYPE.small, color: colors.destructive },
  empty: { ...TYPE.body, color: colors.mutedForeground },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.card },
  chipOn: { borderColor: colors.primaryText, backgroundColor: colors.secondary },
  chipText: { ...TYPE.bodySemi, fontSize: 14, color: colors.foreground },
  chipTextOn: { color: colors.primaryText },
  totals: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  total: { flexBasis: '47%', flexGrow: 1, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, gap: 2 },
  totalValue: { fontSize: 24, fontWeight: '800', color: colors.foreground },
  totalLabel: { ...TYPE.small, color: colors.mutedForeground },
  card: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, gap: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1, gap: 2 },
  name: { ...TYPE.bodySemi, fontSize: 17, color: colors.foreground },
  code: { fontWeight: '700', color: colors.foreground },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondary },
  stats: { ...TYPE.body, fontSize: 15, color: colors.foreground },
  moneyRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  moneyText: { ...TYPE.body, fontSize: 15, color: colors.mutedForeground },
  share: { ...TYPE.bodySemi, fontSize: 15, color: colors.foreground },
  paidButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  paidOn: { borderColor: colors.correct, backgroundColor: colors.secondary },
  paidText: { ...TYPE.bodySemi, fontSize: 15, color: colors.foreground },
  paidTextOn: { color: colors.correct },
  label: { ...TYPE.bodySemi, fontSize: 14, color: colors.foreground, marginTop: 4 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground },
  primary: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, marginTop: 8 },
  primaryText: { color: colors.primaryForeground, fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
