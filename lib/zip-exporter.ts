import JSZip from 'jszip'

/**
 * Pack a flat file map into a zip Buffer.
 * All files are nested under a top-level folder named after the project.
 */
export async function createProjectZip(
  files: Record<string, string>,
  projectName: string
): Promise<Buffer> {
  const zip = new JSZip()
  const folder = zip.folder(projectName)!

  for (const [filePath, content] of Object.entries(files)) {
    folder.file(filePath, content)
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
