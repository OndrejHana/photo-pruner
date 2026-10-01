import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Button({ label, onPress, id, active = false, disabled = false, tone = 'default', accessibilityLabel = label.replace(/[✓✕↑↓←→]/g, '').trim() }: {
  label: string; onPress: () => void; id: string; active?: boolean; disabled?: boolean; tone?: 'default' | 'keep' | 'reject'; accessibilityLabel?: string;
}) {
  return <Pressable testID={id} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, tone === 'keep' && styles.keep, tone === 'reject' && styles.reject,
      active && styles.active, (disabled || pressed) && styles.dim]}>
    <Text style={[styles.buttonText, tone === 'keep' && styles.darkText]}>{label}</Text>
  </Pressable>;
}

export function Sheet({ title, visible, onClose, children, scroll = true, onDismiss }: {
  title: string; visible: boolean; onClose: () => void; children: ReactNode; scroll?: boolean; onDismiss?: () => void;
}) {
  return <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose} onDismiss={onDismiss}>
    <SafeAreaView style={styles.sheet}>
      <View style={styles.sheetHeader}><Text accessibilityRole="header" style={styles.sheetTitle}>{title}</Text>
        <Button id="close-sheet" label="Done" onPress={onClose} /></View>
      {scroll ? <ScrollView contentContainerStyle={styles.sheetContent}>{children}</ScrollView> : children}
    </SafeAreaView>
  </Modal>;
}

export const colors = { background: '#111412', panel: '#1d231f', border: '#343d35', text: '#f2f5ed', muted: '#b0baac', green: '#b8edab', red: '#f6aaa0' };
const styles = StyleSheet.create({
  button: { minHeight: 48, minWidth: 48, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: '#28312a', borderRadius: 9, borderWidth: 1, borderColor: '#3d483e' },
  buttonText: { color: '#f2f5ed', fontSize: 14, fontWeight: '600' }, darkText: { color: '#172313' },
  keep: { backgroundColor: '#b8edab', borderColor: '#b8edab' },
  reject: { backgroundColor: '#432d2b', borderColor: '#76504b' },
  active: { borderColor: '#b8edab', borderWidth: 2 }, dim: { opacity: 0.4 },
  sheet: { flex: 1, backgroundColor: '#171d19' }, sheetHeader: { padding: 22, gap: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: '#343d35' },
  sheetTitle: { flex: 1, color: '#f2f5ed', fontSize: 24, fontWeight: '600' }, sheetContent: { padding: 24, gap: 20 },
});
