import * as path from "path";

function isWindowsPath(inputPath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(inputPath) || inputPath.startsWith("\\\\");
}

export function getWorkflowPathImplementation(inputPath: string): path.PlatformPath {
  return isWindowsPath(inputPath) ? path.win32 : path.posix;
}

function hasTraversalSegment(inputPath: string): boolean {
  return inputPath.split(/[\\/]+/).includes("..");
}

/**
 * Validates a workflow directory path to prevent path traversal attacks.
 * Ensures the path is absolute, doesn't contain traversal sequences,
 * and doesn't point to dangerous system directories.
 */
export function validateWorkflowPath(inputPath: string): {
  valid: boolean;
  resolved: string;
  error?: string;
} {
  const pathImpl = getWorkflowPathImplementation(inputPath);

  // Must be an absolute path
  if (!pathImpl.isAbsolute(inputPath)) {
    return {
      valid: false,
      resolved: inputPath,
      error: "Path must be absolute",
    };
  }

  // Reject explicit traversal segments before normalizing.
  if (hasTraversalSegment(inputPath)) {
    return {
      valid: false,
      resolved: pathImpl.resolve(inputPath),
      error: "Path contains traversal sequences",
    };
  }

  const resolved = pathImpl.resolve(inputPath);

  // Block known dangerous POSIX system directories.
  const dangerousPrefixes = [
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/sys",
    "/proc",
    "/var/run",
    "/System",
    "/Library",
  ];

  if (pathImpl === path.posix) {
    for (const prefix of dangerousPrefixes) {
      if (resolved.startsWith(prefix + "/") || resolved === prefix) {
        return {
          valid: false,
          resolved,
          error: `Access to ${prefix} is not allowed`,
        };
      }
    }
  }

  return {
    valid: true,
    resolved,
  };
}
