import { NativeModule, requireNativeModule } from 'expo';

export type PhotoFile = { name: string; size: number };
export type Folder = { id: string; revision: string; name: string; files: PhotoFile[]; scanMs: number };
export type ExportProgress = { copied: number; total: number; bytes: number; totalBytes: number; phase: 'copying' | 'verifying' };
export type ExportResult = { name: string; uri: string; count: number; bytes: number };

declare class PhotoPrunerNativeModule extends NativeModule<{ onExportProgress: (progress: ExportProgress) => void }> {
  apiVersion: number;
  openFolder(): Promise<Folder | null>;
  restoreFolder(): Promise<Folder | null>;
  refreshFolder(): Promise<Folder>;
  createDemoFolder(): Promise<Folder>;
  preview(name: string): Promise<string>;
  previewCandidates(revision: string, names: string[]): Promise<string>;
  exportKeepers(revision: string, names: string[]): Promise<ExportResult | null>;
  cancelExport(): Promise<void>;
  loadReview(folderID: string): Promise<string | null>;
  saveReview(folderID: string, json: string): Promise<void>;
}
export default requireNativeModule<PhotoPrunerNativeModule>('PhotoPrunerNative');
