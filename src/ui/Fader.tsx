import { useRef, useState } from 'react';
import { View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { C } from '../constants/theme';

interface Props {
  value: number;
  max: number;
  min?: number;
  onChange: (v: number) => void;
  vertical?: boolean;
  /** Vertical faders only: track length in px. */
  length?: number;
  thumbSize?: number;
  thickness?: number;
  thumbColor?: string;
  /** Filled part of the track (below/left of the thumb); omit for a plain track like the original `.fader`. */
  fillColor?: string;
  trackColor?: string;
  /** 1px track outline, as Chrome draws on a native (accent-color) range input. */
  trackBorderColor?: string;
  style?: StyleProp<ViewStyle>;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Range input drawn by hand so it looks the same on web, iOS and Android. */
export function Fader({
  value,
  max,
  min = 0,
  onChange,
  vertical,
  length = 160,
  thumbSize = 14,
  thickness = 4,
  thumbColor = C.text,
  fillColor,
  trackColor = C.line,
  trackBorderColor,
  style,
}: Props) {
  const [size, setSize] = useState(0);
  const origin = useRef(0);
  const ratio = clamp01((value - min) / (max - min || 1));
  const travel = Math.max(0, size - thumbSize);

  const toValue = (along: number) => {
    let r = travel > 0 ? (along - thumbSize / 2) / travel : 0;
    if (vertical) r = 1 - r;
    onChange(min + clamp01(r) * (max - min));
  };

  // Location is only trustworthy on the first touch (the target is this view);
  // afterwards track the page position against the origin captured here.
  const grant = (e: GestureResponderEvent) => {
    const { pageX, pageY, locationX, locationY } = e.nativeEvent;
    origin.current = vertical ? pageY - locationY : pageX - locationX;
    toValue(vertical ? locationY : locationX);
  };
  const move = (e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    toValue((vertical ? pageY : pageX) - origin.current);
  };

  const thumbPos = vertical ? (1 - ratio) * travel : ratio * travel;
  const cross = Math.max(thumbSize, thickness);
  const box = vertical ? 28 : cross;
  const b = trackBorderColor ? 1 : 0;
  const trackStyle = {
    position: 'absolute' as const,
    borderRadius: thickness / 2,
    backgroundColor: trackColor,
    borderWidth: b,
    borderColor: trackBorderColor,
    ...(vertical ? { top: 0, bottom: 0, left: (box - thickness) / 2, width: thickness } : { left: 0, right: 0, top: (box - thickness) / 2, height: thickness }),
  };
  const fillLen = thumbPos + thumbSize / 2;

  return (
    <View
      // Chrome gives range inputs a 2px margin; the original layout includes it.
      style={[vertical ? { width: 28, height: length, marginVertical: 2 } : { flex: 1, minWidth: 0, height: cross, marginHorizontal: 2 }, style]}
      onLayout={(e) => setSize(vertical ? e.nativeEvent.layout.height : e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={grant}
      onResponderMove={move}
    >
      <View pointerEvents="none" style={trackStyle} />
      {fillColor && size > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            backgroundColor: fillColor,
            borderRadius: thickness / 2 - b,
            ...(vertical
              ? { bottom: b, left: (box - thickness) / 2 + b, width: thickness - 2 * b, height: Math.max(0, size - fillLen - b) }
              : { left: b, top: (box - thickness) / 2 + b, height: thickness - 2 * b, width: Math.max(0, fillLen - b) }),
          }}
        />
      )}
      {size > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: thumbSize,
            height: thumbSize,
            borderRadius: thumbSize / 2,
            backgroundColor: thumbColor,
            ...(vertical ? { top: thumbPos, left: (box - thumbSize) / 2 } : { left: thumbPos, top: (box - thumbSize) / 2 }),
          }}
        />
      )}
    </View>
  );
}
