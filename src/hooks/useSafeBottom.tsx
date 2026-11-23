import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ExtraBottomContext = createContext<number>(0);

export function SafeBottomProvider({ children }: { children: React.ReactNode }) {
  const [overflowBottom, setOverflowBottom] = useState(0);
  const keyboardVisibleRef = useRef(false);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      keyboardVisibleRef.current = true;
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisibleRef.current = false;
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        if (Platform.OS !== 'android' || keyboardVisibleRef.current) return;
        const rootH = e.nativeEvent.layout.height;
        const winH = Dimensions.get('window').height;
        const diff = Math.round(rootH - winH);
        if (diff > 0 && diff <= 72) {
          setOverflowBottom(diff);
        } else if (diff <= 0) {
          setOverflowBottom(0);
        }
      }}
    >
      <ExtraBottomContext.Provider value={overflowBottom}>{children}</ExtraBottomContext.Provider>
    </View>
  );
}

export function useSafeBottom(): number {
  const insets = useSafeAreaInsets();
  const extraBottom = useContext(ExtraBottomContext);
  return Math.max(insets.bottom, extraBottom);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
