import { Alert, Platform } from 'react-native';

/** Ask before a destructive action: window.confirm on web, a native alert on iOS/Android. */
export function confirmDestructive(title: string, message?: string, confirmLabel = 'Löschen'): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Abbrechen', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}
