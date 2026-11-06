import { uploadImage } from './client'

export async function uploadImageApi(
  filePath: string,
): Promise<{ id: string; url: string | null; status: string }> {
  return uploadImage(filePath)
}
