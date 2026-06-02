const BASE = "/api";

export async function uploadDocumentFile(
  companyName: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ id: string; companyName: string; fileName: string; uploadedAt: string; chunkCount: number; status: string; summary: string | null }> {
  const form = new FormData();
  form.append("companyName", companyName);
  form.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/documents/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 201) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Upload failed: ${xhr.statusText}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(form);
  });
}
