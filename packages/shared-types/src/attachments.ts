import { z } from 'zod';

export const RequestUploadInputSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  sizeBytes: z.number().int().positive().max(25 * 1024 * 1024), // 25MB cap
});
export type RequestUploadInput = z.infer<typeof RequestUploadInputSchema>;

export interface RequestUploadResult {
  attachmentId: string;
  uploadUrl: string;
}

export interface AttachmentDto {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AttachmentViewUrl {
  url: string;
  expiresInSeconds: number;
}
