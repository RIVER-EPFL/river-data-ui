/**
 * Hand a blob to the browser as a file download. The object URL is revoked immediately after the
 * click, which every caller has to do and half of them wrote differently.
 */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
