import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { C, mono } from '../../constants/theme';
import { noteName } from '../../lib/midi';
import { web } from '../drag';
import { Btn, Txt } from '../kit';

const WHITE = [0, 2, 4, 5, 7, 9, 11];
/** A black key sits after these white keys (C D _ F G A _). */
const BLACK_AFTER: [number, number][] = [[0, 1], [1, 3], [3, 6], [4, 8], [5, 10]];
const OCTAVES = 2;

/**
 * A two-octave keyboard to try a sound: tap a key to hear the note. The octave buttons move it; the lowest
 * note is `low` (a C). Notes sound for a moment, like a preset audition.
 */
export function Keys({ low, onLow, onKey, color }: { low: number; onLow: (low: number) => void; onKey: (pitch: number) => void; color: string }) {
  const [width, setWidth] = useState(300);
  const [down, setDown] = useState<number | null>(null);
  const whites = WHITE.length * OCTAVES + 1;
  const w = width / whites;
  const bw = w * 0.62;
  const H = 76;
  const whitePitch = (i: number) => low + Math.floor(i / 7) * 12 + WHITE[i % 7];
  /**
   * A key sounds the moment the finger lands (responder grant), not after Pressable's press delay: a quick tap on
   * a keyboard must make a sound. The key lights up until the finger lifts or a scroll takes the touch over.
   */
  const touch = (p: number) => ({
    onStartShouldSetResponder: () => true,
    onResponderGrant: () => {
      setDown(p);
      onKey(p);
    },
    onResponderRelease: () => setDown(null),
    onResponderTerminate: () => setDown(null),
  });
  return (
    <View>
      <View style={s.bar}>
        <Btn small accessibilityLabel="Tastatur tiefer" onPress={() => onLow(Math.max(12, low - 12))}>
          ◀ Oktave
        </Btn>
        <Txt style={s.range}>{`${noteName(low)} – ${noteName(low + 12 * OCTAVES)}`}</Txt>
        <Btn small accessibilityLabel="Tastatur höher" onPress={() => onLow(Math.min(96, low + 12))}>
          Oktave ▶
        </Btn>
      </View>
      <View style={{ height: H }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {Array.from({ length: whites }, (_, i) => {
          const p = whitePitch(i);
          return (
            <View
              key={`w${i}`}
              accessibilityRole="button"
              accessibilityLabel={`Taste ${noteName(p)}`}
              {...touch(p)}
              style={[s.white, { left: i * w, width: w - 1, height: H }, down === p && { backgroundColor: color }, web({ userSelect: 'none', touchAction: 'manipulation' })]}
            >
              {p % 12 === 0 && <Txt style={s.keyText}>{noteName(p)}</Txt>}
            </View>
          );
        })}
        {Array.from({ length: OCTAVES }, (_, o) =>
          BLACK_AFTER.map(([after, semis]) => {
            const p = low + o * 12 + semis;
            return (
              <View
                key={`b${o}-${semis}`}
                accessibilityRole="button"
                accessibilityLabel={`Taste ${noteName(p)}`}
                {...touch(p)}
                style={[s.black, { left: (o * 7 + after + 1) * w - bw / 2, width: bw, height: H * 0.6 }, down === p && { backgroundColor: color }, web({ userSelect: 'none', touchAction: 'manipulation' })]}
              />
            );
          }),
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  range: { ...mono(), fontSize: 12, color: C.muted },
  white: { position: 'absolute', top: 0, backgroundColor: '#e9e9ee', borderBottomLeftRadius: 4, borderBottomRightRadius: 4, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 3 },
  black: { position: 'absolute', top: 0, backgroundColor: '#101013', borderWidth: 1, borderColor: '#2a2a30', borderBottomLeftRadius: 3, borderBottomRightRadius: 3, zIndex: 2 },
  keyText: { ...mono(), fontSize: 8, color: '#555' },
});
