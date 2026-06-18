"use client";

import { useState, useRef, type DragEvent } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

interface FileUploadProps {
  onUpload: (file: { key: string; url: string; filename: string }) => void;
  accept?: string;
  maxSize?: number;
  className?: string;
  compact?: boolean;
}

export function FileUpload({
  onUpload,
  accept,
  maxSize = 10 * 1024 * 1024,
  className,
  compact = false,
}: FileUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setError(null);
    if (file.size > maxSize) {
      setError(`File too large (max ${Math.round(maxSize / 1024 / 1024)}MB)`);
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/files", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      const data = await res.json();
      onUpload({ key: data.file.key, url: data.url, filename: data.file.filename });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const onDragLeave = () => setDragging(false);

  const onFileSelect = () => {
    const file = inputRef.current?.files?.[0];
    if (file) handleUpload(file);
  };

  if (compact) {
    return (
      <div className={className}>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={onFileSelect}
          className="hidden"
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          Upload
        </button>
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </div>
    );
  }

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={onFileSelect}
        className="hidden"
      />
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors",
          dragging
            ? "border-primary bg-accent"
            : "border-gray-200 dark:border-gray-600 hover:border-primary/90",
        )}
      >
        {uploading ? (
          <Loader2 className="w-6 h-6 text-gray-400 mx-auto animate-spin" />
        ) : (
          <>
            <Upload className="w-6 h-6 text-gray-400 dark:text-gray-500 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Drop a file here or click to upload
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Max {Math.round(maxSize / 1024 / 1024)}MB
            </p>
          </>
        )}
      </div>
      {error && (
        <div className="flex items-center gap-2 mt-2 text-xs text-red-500">
          <X className="w-3 h-3" />
          {error}
        </div>
      )}
    </div>
  );
}
