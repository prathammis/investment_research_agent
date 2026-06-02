import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Upload, FileText, ArrowLeft, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { uploadDocumentFile } from "@/lib/api";
import { getListDocumentsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

export default function UploadPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type === "application/pdf") {
      setFile(f);
      setError(null);
      if (!companyName && f.name) {
        setCompanyName(f.name.replace(/\.pdf$/i, "").replace(/[_-]/g, " "));
      }
    } else {
      setError("Only PDF files are supported.");
    }
  }, [companyName]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setError(null);
      if (!companyName) {
        setCompanyName(f.name.replace(/\.pdf$/i, "").replace(/[_-]/g, " "));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !companyName.trim()) return;
    setUploading(true);
    setError(null);
    try {
      await uploadDocumentFile(companyName.trim(), file, setProgress);
      setDone(true);
      queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
      toast.success(`"${companyName}" uploaded — indexing in background`);
      setTimeout(() => navigate("/"), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to workspace
        </button>
        <div className="h-4 w-px bg-border" />
        <span className="text-sm font-medium text-foreground">Upload Annual Report</span>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-lg">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">
              Upload Company Report
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload a PDF annual report to index it for AI-powered research analysis.
            </p>
          </div>

          {done ? (
            <div className="rounded border border-border bg-card p-8 text-center">
              <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3" />
              <p className="text-foreground font-medium">Upload complete</p>
              <p className="text-sm text-muted-foreground mt-1">Redirecting to workspace...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={`relative cursor-pointer rounded border-2 border-dashed transition-colors p-10 text-center
                  ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 bg-card"}
                `}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={onFileChange}
                />
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileText className="w-8 h-8 text-primary" />
                    <span className="text-sm font-medium text-foreground">{file.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="w-8 h-8 text-muted-foreground" />
                    <p className="text-sm text-foreground font-medium">Drop PDF here or click to browse</p>
                    <p className="text-xs text-muted-foreground">Annual reports, 10-K filings, earnings reports</p>
                  </div>
                )}
              </div>

              {/* Company name */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Company Name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Apple Inc."
                  className="w-full rounded border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
                  required
                />
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* Progress */}
              {uploading && !done && (
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Uploading...</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-200"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              <Button
                type="submit"
                disabled={!file || !companyName.trim() || uploading}
                className="w-full"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload & Index Report
                  </>
                )}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
