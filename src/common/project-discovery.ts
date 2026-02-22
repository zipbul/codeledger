import path from "node:path";
import { promises as fs } from "node:fs";

/**
 * A discovered sub-project within the indexed project root.
 *
 * Returned by {@link Gildash.projects}.
 */
export interface ProjectBoundary {
  /** Relative directory path from the project root. */
  dir: string;
  /** Unique project name (typically the `name` field from `package.json`). */
  project: string;
}

const DISCOVERY_EXCLUDE = ["**/node_modules/**", "**/.git/**", "**/.zipbul/**", "**/dist/**"];

export async function discoverProjects(projectRoot: string): Promise<ProjectBoundary[]> {
  const boundaries: ProjectBoundary[] = [];

  for await (const relativePackageJson of fs.glob("**/package.json", {
    cwd: projectRoot,
    exclude: DISCOVERY_EXCLUDE,
  })) {
    const packageDir = path.dirname(relativePackageJson).replaceAll("\\", "/");
    const packagePath = path.join(projectRoot, relativePackageJson);
    const content = await Bun.file(packagePath).json();

    const packageName =
      typeof content?.name === "string" && content.name.length > 0
        ? content.name
        : path.basename(packageDir === "." ? projectRoot : packageDir);

    boundaries.push({
      dir: packageDir,
      project: packageName,
    });
  }

  boundaries.sort((left, right) => right.dir.length - left.dir.length);
  return boundaries;
}

export function resolveFileProject(
  filePath: string,
  boundaries: ProjectBoundary[],
  rootProject = "default",
): string {
  const normalizedFilePath = filePath.replaceAll("\\", "/");
  for (const boundary of boundaries) {
    if (boundary.dir === ".") {
      return boundary.project;
    }

    if (
      normalizedFilePath === boundary.dir ||
      normalizedFilePath.startsWith(`${boundary.dir}/`)
    ) {
      return boundary.project;
    }
  }

  return rootProject;
}
