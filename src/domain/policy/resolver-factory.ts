import { toRemovalAction } from "../removal-action";
import type { AutoRemoveSettings, FolderRule } from "../types";
import { FolderRulePolicySource } from "./folder-rule-policy-source";
import type { FolderRuleBinding } from "./folder-rule-policy-source";
import { FrontmatterPolicySource } from "./frontmatter-policy-source";
import { PolicyResolver } from "./policy-resolver";
import type { PolicySource } from "./policy-source";

/**
 * Composes the policy chain for one cleanup run.
 *
 * A resolver is built fresh from a settings snapshot each time, which compiles
 * the ignore patterns once and makes cache invalidation a non-problem: a run
 * always sees one consistent configuration, and edits take effect on the next.
 *
 * The array order below *is* the documented priority: frontmatter, then folder
 * rules. Teaching Auto Remove a new way to claim files means adding one entry.
 */
export function createPolicyResolver(settings: AutoRemoveSettings): PolicyResolver {
  const sources: PolicySource[] = [];

  const frontmatterAction = toRemovalAction(
    settings.defaultAction,
    settings.defaultMoveDestination,
  );
  if (frontmatterAction !== null) {
    sources.push(
      new FrontmatterPolicySource({
        ttlDays: settings.defaultTtlDays,
        action: frontmatterAction,
      }),
    );
  }

  sources.push(new FolderRulePolicySource(settings.folderRules.flatMap(toBinding)));

  return new PolicyResolver(sources);
}

/**
 * Pairs a rule with its action, dropping rules whose action cannot be carried
 * out. A half-configured rule — move, no destination — then claims nothing,
 * instead of claiming files it would fail on.
 */
function toBinding(rule: FolderRule): FolderRuleBinding[] {
  const action = toRemovalAction(rule.action, rule.moveDestination);
  return action === null ? [] : [{ rule, action }];
}
