import type { MediaKind } from './media';

export interface ExportSummary {
  mediaKind: MediaKind;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  durationSec?: number;
  inputBytes: number;
  outputBytes: number;
  byteDelta: number;
  reductionPct: number;
  processingMs: number;
  backendLabel: string;
}

export interface ShareCapability {
  canShareFiles: boolean;
  canCopyImageToClipboard: boolean;
  canDownload: boolean;
}
