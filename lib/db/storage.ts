import { supabase } from '@/lib/supabase/client'

const BUCKET = 'files'

export interface UploadResult {
  fileUrl: string
  filePath: string
  fileExtension: string
}

export async function uploadFile(file: File, prefix: string): Promise<UploadResult> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'bin'
  const path = `${prefix}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file)
  if (error) throw new Error(error.message)
  // Try signed URL first (private bucket); fall back to public URL.
  const { data: signed, error: signedErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600 * 24 * 7) // 7-day expiry
  if (!signedErr && signed?.signedUrl) {
    return { fileUrl: signed.signedUrl, filePath: path, fileExtension: extension }
  }
  // Fallback: public bucket (no signed URL needed)
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { fileUrl: data.publicUrl, filePath: path, fileExtension: extension }
}

export async function deleteFile(filePath: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([filePath])
  if (error) throw new Error(error.message)
}

/**
 * Session cache for fileExists probes: liveness of a URL is stable within a
 * run, so repeated .ics imports of the same file references (or repeated
 * probes across dialogs) resolve from memory instead of re-HEADing. Keyed by
 * URL; results of any shape (true/false/null) are stored.
 */
const fileExistsCache = new Map<string, boolean | null>()

/**
 * Whether a public file URL still resolves. Returns true when the object
 * answers (same- or foreign-project URL — either way the link works), false
 * when it is definitively gone (404/410), and null when it can't be
 * determined (network error, CORS, non-http URL). Callers keep their
 * fallback heuristic (no matching file block) for null, so a reference is
 * only flagged dangling when the object is actually gone. Results are cached
 * for the session (see fileExistsCache).
 */
export async function fileExists(fileUrl: string): Promise<boolean | null> {
  if (!/^https?:\/\//i.test(fileUrl)) return null
  const cached = fileExistsCache.get(fileUrl)
  if (cached !== undefined) return cached
  let result: boolean | null
  try {
    const res = await fetch(fileUrl, { method: 'HEAD', cache: 'no-store' })
    result = res.ok ? true : res.status === 404 || res.status === 410 ? false : null
  } catch {
    result = null
  }
  fileExistsCache.set(fileUrl, result)
  return result
}