import path from "node:path";

export function toRelativePath(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).replaceAll("\\", "/");
}

export function toAbsolutePath(projectRoot: string, relativePath: string): string {
  return path.resolve(projectRoot, relativePath);
}