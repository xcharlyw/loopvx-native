import type { ErrorBoundaryProps } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { C } from '../constants/theme';
import { createProject } from '../lib/project';
import { openProject, START_BLANK } from '../lib/store';
import { db } from '../storage/db';

/**
 * Shown instead of a blank screen when rendering throws. Projects and samples are already saved,
 * so a retry or reload loses nothing. Plain Text: the custom fonts may be what failed to load.
 */
export function ErrorScreen({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={s.wrap}>
      <Text style={s.title}>Da ist etwas schiefgelaufen</Text>
      <Text style={s.text}>Deine Projekte und Samples sind gespeichert. Versuch es nochmal oder lade die App neu.</Text>
      <Text style={s.detail} numberOfLines={4}>
        {error.message}
      </Text>
      <View style={s.row}>
        <Pressable style={[s.btn, s.primary]} onPress={() => void retry()}>
          <Text style={[s.btnText, { color: C.accentInk }]}>Nochmal versuchen</Text>
        </Pressable>
        {Platform.OS === 'web' && (
          <Pressable style={s.btn} onPress={() => window.location.reload()}>
            <Text style={s.btnText}>Neu laden</Text>
          </Pressable>
        )}
      </View>
      {/* If the open project itself is what breaks, reopening it would fail again. */}
      <Pressable onPress={() => void startBlank(retry)}>
        <Text style={s.link}>Mit leerem Projekt starten</Text>
      </Pressable>
    </View>
  );
}

async function startBlank(retry: () => Promise<void>) {
  await db.setKv('lastProjectId', START_BLANK);
  if (Platform.OS === 'web') window.location.reload();
  else {
    await openProject(createProject());
    await retry();
  }
}

const s = StyleSheet.create({
  link: { color: C.muted, fontSize: 13, textDecorationLine: 'underline', marginTop: 6 },
  wrap: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { color: C.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  text: { color: C.muted, fontSize: 14, textAlign: 'center', maxWidth: 360, lineHeight: 20 },
  detail: { color: C.dim, fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', textAlign: 'center', maxWidth: 360 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btn: { borderRadius: 999, borderWidth: 1, borderColor: C.line, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.panel },
  primary: { backgroundColor: C.accent, borderColor: C.accent },
  btnText: { color: C.text, fontSize: 14, fontWeight: '600' },
});
