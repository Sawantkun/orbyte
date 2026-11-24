export type AssetItem = {
  id: string;
  name: string;
  kind: string;
  source: string;
  mimeType: string;
  extension: string | null;
  sizeBytes: number;
  hasThumbnail: boolean;
  isFavorite: boolean;
  collectionId: string | null;
  tags: string[];
  workflowName: string | null;
  createdAt: string;
};

export type CollectionItem = { id: string; name: string; description: string | null; assetCount: number; coverAssetId: string | null; updatedAt: string };

export const thumbUrl = (id: string) => `/api/assets/${id}/content?variant=thumbnail`;
export const contentUrl = (id: string) => `/api/assets/${id}/content`;
export const downloadUrl = (id: string) => `/api/assets/${id}/download`;
