import { requireOptionalNativeModule } from 'expo-modules-core';

export type ScanOptions = {
  pageLimit?: number;
  galleryImportAllowed?: boolean;
};

export type ScanResult = {
  cancelled: boolean;
  pageUris: string[];
};

export type OcrBlock = {
  text: string;
};

export type OcrResult = {
  text: string;
  blocks: OcrBlock[];
};

export type SignatureOverlayInput = {
  pageIndex: number;
  imageUri: string;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
};

export type PageSizeOption = 'A4' | 'LETTER' | 'FIT';

export type GeneratePdfOptions = {
  imageUris: string[];
  outputPath: string;
  password?: string;
  pageSize?: PageSizeOption;
  signatures?: SignatureOverlayInput[];
};

export type GeneratePdfResult = {
  uri: string;
  sizeBytes: number;
  pageCount: number;
};

export type StrokePoint = {
  x: number;
  y: number;
};

export type RenderSignatureOptions = {
  strokes: StrokePoint[][];
  width: number;
  height: number;
  strokeColor: string;
  strokeWidth: number;
  outputPath: string;
};

export type SaveToDownloadsResult = {
  savedPath: string;
};

interface NativeDocEngineModule {
  scanDocument(options: ScanOptions): Promise<ScanResult>;
  recognizeText(imageUri: string): Promise<OcrResult>;
  generatePdf(options: GeneratePdfOptions): Promise<GeneratePdfResult>;
  renderSignaturePng(options: RenderSignatureOptions): Promise<string>;
  saveToDownloads(sourceUri: string, fileName: string): Promise<SaveToDownloadsResult>;
}

const NativeDocEngine = requireOptionalNativeModule<NativeDocEngineModule>('DocEngine');

function ensureNative(): NativeDocEngineModule {
  if (!NativeDocEngine) {
    throw new Error(
      'El módulo nativo DocEngine no está disponible. Compila e instala la app Android nativa para usar el escáner, OCR y generación de PDF.'
    );
  }
  return NativeDocEngine;
}

export const isDocEngineAvailable = Boolean(NativeDocEngine);

export async function scanDocument(options: ScanOptions = {}): Promise<ScanResult> {
  return ensureNative().scanDocument({
    pageLimit: options.pageLimit ?? 25,
    galleryImportAllowed: options.galleryImportAllowed ?? true,
  });
}

export async function recognizeText(imageUri: string): Promise<OcrResult> {
  return ensureNative().recognizeText(imageUri);
}

export async function generatePdf(options: GeneratePdfOptions): Promise<GeneratePdfResult> {
  return ensureNative().generatePdf(options);
}

export async function renderSignaturePng(options: RenderSignatureOptions): Promise<string> {
  return ensureNative().renderSignaturePng(options);
}

export async function saveToDownloads(
  sourceUri: string,
  fileName: string
): Promise<SaveToDownloadsResult> {
  return ensureNative().saveToDownloads(sourceUri, fileName);
}
