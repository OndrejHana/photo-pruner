import { requireNativeView } from 'expo';
import * as React from 'react';

import { PhotoPrunerNativeViewProps } from './PhotoPrunerNative.types';

const NativeView: React.ComponentType<PhotoPrunerNativeViewProps> = requireNativeView('PhotoPrunerNative');

export default function PhotoPrunerNativeView(props: PhotoPrunerNativeViewProps) {
  return <NativeView {...props} />;
}
