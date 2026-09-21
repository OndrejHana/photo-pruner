import { NativeModule, requireNativeModule } from 'expo';

export type PhotoFile = { name: string; size: number };
export type Folder = { id: string; name: string; files: PhotoFile[]; scanMs: number };

declare class PhotoPrunerNativeModule extends NativeModule {
  openFolder(): Promise<Folder | null>;
  restoreFolder(): Promise<Folder | null>;
  refreshFolder(): Promise<Folder>;
  createDemoFolder(): Promise<Folder>;
  preview(name: string): Promise<string>;
  loadReview(folderID: string): Promise<string | null>;
  saveReview(folderID: string, json: string): Promise<void>;
}
export default requireNativeModule<PhotoPrunerNativeModule>('PhotoPrunerNative');
