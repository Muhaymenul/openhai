/** A retry submits only files whose previous request did not succeed. */
export async function uploadPendingPdfs<T>(
  files: readonly T[],
  completed: Set<T>,
  importPdf: (file: T) => Promise<void>,
  onImported: () => void,
): Promise<void> {
  for (const file of files) {
    if (completed.has(file)) continue;
    await importPdf(file);
    completed.add(file);
    onImported();
  }
}
