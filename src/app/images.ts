/**
 * The app's one image uploader.
 *
 * `shared/images/imgbb.ts` knows how to talk to ImgBB but deliberately knows
 * nothing about this app's configuration. This file is the join: it reads the
 * public key from the build environment once and hands every screen the same
 * client, so no feature ever constructs its own uploader or re-reads the key.
 */

import { env } from './env'
import {
  createImgbbClient,
  ImageUploadError,
  validateImageFile,
  type ImgbbClient,
  type UploadedImage,
  type UploadOptions,
} from '../shared/images/imgbb'

let client: ImgbbClient | null = null

function imageClient(): ImgbbClient {
  client ??= createImgbbClient({ apiKey: env.imgbbApiKey })
  return client
}

/** True when a key is configured. Screens use it to explain, not to crash. */
export function imageUploadsEnabled(): boolean {
  return imageClient().enabled
}

/** Uploads one image and resolves to its hosted URLs. */
export function uploadImage(file: File, options?: UploadOptions): Promise<UploadedImage> {
  return imageClient().upload(file, options)
}

/** Replaces the client. Tests only — production reads the environment. */
export function setImageClientForTests(next: ImgbbClient | null): void {
  client = next
}

export { ImageUploadError, validateImageFile }
export type { UploadedImage, UploadOptions }
