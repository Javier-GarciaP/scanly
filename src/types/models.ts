export interface Folder {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  documentCount?: number;
}

export interface PageSignaturePlacement {
  id: string;
  pageId: string;
  signatureId: string;
  imageUri: string;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
}

export interface PageRecord {
  id: string;
  documentId: string;
  imageUri: string;
  pageOrder: number;
  ocrText: string;
  createdAt: number;
  signatures: PageSignaturePlacement[];
}

export interface DocumentRecord {
  id: string;
  title: string;
  folderId: string | null;
  pdfUri: string | null;
  isPasswordProtected: boolean;
  ocrText: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  signatureCount: number;
  coverUri: string | null;
  folderName?: string | null;
  folderColor?: string | null;
}

export interface DocumentDetail extends DocumentRecord {
  pages: PageRecord[];
}

export interface SignatureRecord {
  id: string;
  name: string;
  imageUri: string;
  createdAt: number;
}
