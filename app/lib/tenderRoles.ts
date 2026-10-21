// Tender role catalog + the company's manual "this CV fits role X" tags
// (migration 0016: tender_roles, person_role_eligibility).
//
// Sarel, 2026-10-16: "companies need to specify which sanral roles a persons
// cv fits." So role fit comes from the human tag, not from Tender Ready
// guessing from years since graduating or the ECSA level text. Those
// heuristics (tenderCompliance.ts checkMinimumRequirement) are still run,
// but only shown NEXT TO the tag as a cross-check - and when they contradict
// the tag the row turns amber, because SANRAL's Stage 2 disqualifies a key
// person who doesn't meet C3.1.11, whoever tagged them.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComplianceStatus } from "./tenderCompliance";
import { sanralRoleCodeForPosition } from "./sanralMatrices";

export type TenderRole = {
  code: string;
  family: string;
  title: string;
  discipline: string | null;
  registration_body: string | null;
  sanral_base_code: string | null;
  sanral_matrix: string | null;
  default_managerial: boolean | null;
  source: string;
  sort_order: number;
};

export type RoleTag = { person_id: string; role_code: string; notes: string | null };

export const ROLE_FAMILY_LABEL: Record<string, string> = {
  sanral_consultant: "SANRAL consultant key positions (Book 1 codes)",
  construction_contractor: "Construction contractor key personnel",
  professional_services: "Professional services (registered professionals)",
  health_safety: "Health & safety",
  trades: "Trades / artisans",
  services: "Services",
};
export const ROLE_FAMILY_ORDER = Object.keys(ROLE_FAMILY_LABEL);

export const TENDER_ROLE_COLUMNS =
  "code, family, title, discipline, registration_body, sanral_base_code, sanral_matrix, default_managerial, source, sort_order";

export async function loadRoleCatalog(supabase: SupabaseClient): Promise<{ roles: TenderRole[]; error: string | null }> {
  const { data, error } = await supabase.from("tender_roles").select(TENDER_ROLE_COLUMNS).order("sort_order");
  return { roles: (data ?? []) as TenderRole[], error: error?.message ?? null };
}

/** tender_roles.code for a SANRAL tender position (see sanralMatrices.ts). */
export function roleCodeForPosition(positionCode: string, description: string | null): string | null {
  return sanralRoleCodeForPosition(positionCode, description);
}

export type RoleFit = {
  roleCode: string | null;
  roleTitle: string | null;
  status: ComplianceStatus;
  detail: string;
  taggedOthers: string[]; // other people the company tagged for this role (for an unfilled / untagged slot)
};

/**
 * Does the person on this position fit it? Driven by the company's tag.
 * heuristic = checkMinimumRequirement()'s result, shown as a cross-check only.
 */
export function roleFitCheck(input: {
  positionCode: string;
  description: string | null;
  person: { id: string; name: string } | null;
  tags: RoleTag[];
  roles: TenderRole[];
  peopleById: Map<string, { name: string }>;
  heuristic: { status: ComplianceStatus; detail: string } | null;
}): RoleFit {
  const roleCode = roleCodeForPosition(input.positionCode, input.description);
  const role = roleCode ? input.roles.find((r) => r.code === roleCode) ?? null : null;
  const taggedIds = roleCode ? input.tags.filter((t) => t.role_code === roleCode).map((t) => t.person_id) : [];
  const taggedOthers = taggedIds
    .filter((id) => id !== input.person?.id)
    .map((id) => input.peopleById.get(id)?.name)
    .filter((n): n is string => !!n);
  const base = { roleCode, roleTitle: role?.title ?? null, taggedOthers };

  if (!roleCode) {
    return {
      ...base,
      status: "check",
      detail: `Can't tell which role "${input.positionCode}" is from its description${input.description ? ` ("${input.description}")` : ""} - a Design Specialist is tendered per specialism. Confirm by hand.`,
    };
  }
  if (!role) {
    return { ...base, status: "check", detail: `"${roleCode}" isn't in the role catalog yet - confirm by hand.` };
  }
  if (!input.person) {
    return {
      ...base,
      status: "missing",
      detail: taggedOthers.length
        ? `No one confirmed. Tagged as fitting ${role.title}: ${taggedOthers.join(", ")}.`
        : `No one confirmed, and no one in People is tagged as fitting ${role.title}.`,
    };
  }
  const tagged = taggedIds.includes(input.person.id);
  if (!tagged) {
    return {
      ...base,
      status: "check",
      detail:
        `${input.person.name} isn't tagged as fitting ${role.title} - tag it on their People page if their CV qualifies them.` +
        (taggedOthers.length ? ` Tagged for this role: ${taggedOthers.join(", ")}.` : ""),
    };
  }
  if (input.heuristic?.status === "missing") {
    return {
      ...base,
      status: "check",
      detail: `Your company tagged ${input.person.name} as fitting ${role.title}, but the record on file disagrees: ${input.heuristic.detail} Check before submitting - SANRAL disqualifies a key person below the C3.1.11 minimum.`,
    };
  }
  return { ...base, status: "have", detail: `Your company tagged ${input.person.name} as fitting ${role.title}.` };
}
