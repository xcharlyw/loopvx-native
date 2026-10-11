import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { C } from '../constants/theme';
import { completeSpliceLogin } from '../lib/splice';
import { setState, toast } from '../lib/store';
import { Txt } from '../ui/kit';

export { ErrorScreen as ErrorBoundary } from '../ui/ErrorScreen';

/** Where Splice sends the user back after logging in: finish the login, then return to the app. */
export default function SpliceCallback() {
  const router = useRouter();
  useEffect(() => {
    // Read the answer and clear the address first: the Supabase client would otherwise take ?code= for its own login.
    const search = window.location.search;
    window.history.replaceState({}, '', '/splice-callback');
    void completeSpliceLogin(search).then((error) => {
      router.replace('/');
      setTimeout(() => {
        if (error) toast(error, 'error');
        else {
          toast('Splice ist verbunden');
          setState({ panel: 'library' });
        }
      }, 400);
    });
  }, [router]);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Txt>Splice wird verbunden …</Txt>
    </View>
  );
}
