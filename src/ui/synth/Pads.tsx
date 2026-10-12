import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { C, font, mono } from '../../constants/theme';
import { KIT_PADS } from '../../audio/drum909';
import { noteName } from '../../lib/midi';
import { web } from '../drag';
import { Txt } from '../kit';

const COLUMNS = 4;

/**
 * The 909's pads, four across with the kick at the bottom left like a drum rack. A pad sounds the moment the finger
 * lands (responder grant, as the keyboard does), and lights up until it lifts.
 */
export function Pads({ onHit, color }: { onHit: (pitch: number) => void; color: string }) {
  const [down, setDown] = useState<number | null>(null);
  // Rows from the top: the last pads first, so the first pad ends up at the bottom left.
  const rows = Array.from({ length: Math.ceil(KIT_PADS.length / COLUMNS) }, (_, r) => KIT_PADS.slice(r * COLUMNS, r * COLUMNS + COLUMNS)).reverse();
  return (
    <View style={{ gap: 6 }}>
      {rows.map((row, r) => (
        <View key={r} style={s.row}>
          {row.map((pad) => (
            <View
              key={pad.id}
              accessibilityRole="button"
              accessibilityLabel={`Pad ${pad.name}`}
              onStartShouldSetResponder={() => true}
              onResponderGrant={() => {
                setDown(pad.pitch);
                onHit(pad.pitch);
              }}
              onResponderRelease={() => setDown(null)}
              onResponderTerminate={() => setDown(null)}
              style={[s.pad, down === pad.pitch && { backgroundColor: color, borderColor: color }, web({ userSelect: 'none', touchAction: 'manipulation' })]}
            >
              <Txt style={[s.name, down === pad.pitch && { color: C.accentInk }]}>{pad.short}</Txt>
              <Txt style={[s.note, down === pad.pitch && { color: C.accentInk }]}>{noteName(pad.pitch)}</Txt>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  pad: { flex: 1, height: 58, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: '#111114', alignItems: 'center', justifyContent: 'center' },
  name: { ...font(700), fontSize: 12 },
  note: { ...mono(), fontSize: 9.5, color: C.muted, marginTop: 2 },
});
