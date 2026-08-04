import fs from 'node:fs/promises'
import path from 'node:path'

export async function publishFile(destPath, contents) {
  // Single-file atomic publish: write to a sibling temp file, then rename
  // over the destination. rename() is atomic on the same filesystem, so a
  // reader never observes a partially-written file, and a failed write never
  // touches the previously-published (valid) file at all.
  const tmpPath = path.join(path.dirname(destPath), `.${path.basename(destPath)}.tmp-${process.pid}-${Date.now()}`)
  try {
    await fs.writeFile(tmpPath, contents)
    await fs.rename(tmpPath, destPath)
  } catch (error) {
    await fs.rm(tmpPath, { force: true })
    throw error
  }
}
