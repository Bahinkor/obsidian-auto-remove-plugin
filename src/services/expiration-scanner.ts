import { isExpired, toExpiredFile } from "../domain/expiration";
import type { PolicyResolver } from "../domain/policy/policy-resolver";
import type { ExpiredFile } from "../domain/types";
import type { Clock, FileRepository } from "./ports";

/**
 * Finds every file that has outlived its TTL.
 *
 * The scan is a single pass over an in-memory file list with no vault reads, so
 * it stays cheap even on large vaults; the resolver has already compiled its
 * ignore patterns by the time it gets here.
 */
export class ExpirationScanner {
  constructor(
    private readonly repository: FileRepository,
    private readonly clock: Clock,
  ) {}

  scan(resolver: PolicyResolver): ExpiredFile[] {
    const now = this.clock();
    const expired: ExpiredFile[] = [];

    for (const file of this.repository.listFiles()) {
      const policy = resolver.resolve(file);
      if (policy === null || !isExpired(file, policy, now)) continue;
      expired.push(toExpiredFile(file, policy, now));
    }

    return expired.sort((a, b) => a.file.path.localeCompare(b.file.path));
  }

  /**
   * Re-checks a single path against current configuration.
   *
   * Used when a queued action finally becomes possible: the file may have been
   * edited, moved, or had its frontmatter changed in the meantime, and the
   * answer we cached is no longer authoritative.
   */
  rescan(path: string, resolver: PolicyResolver): ExpiredFile | null {
    const file = this.repository.getFile(path);
    if (file === null) return null;

    const policy = resolver.resolve(file);
    if (policy === null) return null;

    const now = this.clock();
    return isExpired(file, policy, now) ? toExpiredFile(file, policy, now) : null;
  }
}
