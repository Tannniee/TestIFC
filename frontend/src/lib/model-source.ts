export interface ModelSource {
  name: string;
  size: number;
  modelHash?: string;
  file?: File;
  origin: "browser" | "desktop";
}

export function browserModelSource(file: File): ModelSource {
  return { name: file.name, size: file.size, file, origin: "browser" };
}

export function normalizeModelSource(source: File | ModelSource): ModelSource {
  return source instanceof File ? browserModelSource(source) : source;
}
