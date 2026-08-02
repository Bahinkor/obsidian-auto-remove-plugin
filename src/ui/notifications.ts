import { Notice } from "obsidian";
import type { CleanupOutcome } from "../services/cleanup-service";
import type { ActionFailure } from "../services/ports";
import { pluralize } from "./format";

/**
 * Tells the user what a cleanup run did.
 *
 * Automatic runs stay quiet when there was nothing to do — a startup notice
 * saying "nothing expired" every single launch is noise. A run the user asked
 * for always answers, because silence there reads as a broken command.
 */
export function reportOutcome(outcome: CleanupOutcome, wasRequested: boolean): void {
  const message = describeOutcome(outcome, wasRequested);
  if (message !== null) new Notice(message);

  if (outcome.status === "completed") logFailures(outcome.result.failed);
}

function describeOutcome(outcome: CleanupOutcome, wasRequested: boolean): string | null {
  switch (outcome.status) {
    case "nothing-expired":
      return wasRequested ? "Auto Remove: nothing has expired." : null;
    case "cancelled":
      return null;
    case "already-running":
      return wasRequested ? "Auto Remove: a cleanup is already in progress." : null;
    case "completed":
      return describeResult(outcome);
  }
}

function describeResult(outcome: Extract<CleanupOutcome, { status: "completed" }>): string {
  const { removed, deferred, failed } = outcome.result;
  const parts = [`Auto Remove: ${pluralize(removed.length, "file")} removed`];

  if (deferred.length > 0) {
    parts.push(`${deferred.length} waiting to be closed`);
  }
  if (failed.length > 0) {
    parts.push(`${pluralize(failed.length, "failure")} — see the console`);
  }

  return parts.join(", ");
}

/** Failures are the one thing worth putting in the console; nothing else is. */
function logFailures(failures: readonly ActionFailure[]): void {
  for (const { item, error } of failures) {
    console.error(`Auto Remove: could not remove "${item.file.path}"`, error);
  }
}
