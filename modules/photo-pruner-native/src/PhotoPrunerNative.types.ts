import type { ViewProps } from 'react-native';
export type PhotoPrunerNativeViewProps = ViewProps & {
  enabled: boolean;
  onCommand: (event: { nativeEvent: { key: string } }) => void;
};
