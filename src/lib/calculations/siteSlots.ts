// The site's parameter slots read as the groups that brought them in: a group holds the columns
// entered at a visit and the ones its calculations publish, and applying it declares both here. A
// calculation belongs to no group (Q169), so the tie between the two is the parameters they share.

import type { ParameterGroup, ParameterGroupMember, SiteParameter } from '$api/crud';
import type { CalculationImpact } from '$api/service';

/** A calculation over one slot: the one that publishes it, or one that reads it. */
export interface SlotCalculation {
	/** The calculation's page, null where the name resolved to no id the tab can link. */
	id: string | null;
	name: string;
	label: string;
	writes: boolean;
}

export interface SlotGroup {
	id: string | null;
	code: string | null;
	label: string;
	slots: SiteParameter[];
	/** The calculations publishing one of these slots here, which is what applying the group
	 *  declared at this site. */
	declared: SlotCalculation[];
}

const UNGROUPED = 'No group';

/**
 * What each parameter is to the calculations the closure returned. A calculation that both reads a
 * parameter and publishes it is listed once, as the one that publishes it.
 */
export function calculationsBySlot(
	calculations: CalculationImpact[],
	ids: Map<string, string>,
): Map<string, SlotCalculation[]> {
	const bySlot = new Map<string, SlotCalculation[]>();
	const add = (parameterId: string, calculation: SlotCalculation) => {
		const listed = bySlot.get(parameterId) ?? [];
		const already = listed.find((c) => c.name === calculation.name);
		if (already) {
			already.writes = already.writes || calculation.writes;
			return;
		}
		bySlot.set(parameterId, [...listed, calculation]);
	};
	for (const calculation of calculations) {
		const of = (writes: boolean): SlotCalculation => ({
			id: ids.get(calculation.tool) ?? null,
			name: calculation.tool,
			label: calculation.label,
			writes,
		});
		for (const output of calculation.outputs) add(output.parameter_id, of(true));
		for (const read of calculation.reads) add(read.parameter_id, of(false));
	}
	return bySlot;
}

/**
 * The site's slots under the group each belongs to, groups in their own order and the slots a group
 * holds in the group's column order. Slots in no group come last.
 */
export function groupSlots(
	siteParameters: SiteParameter[],
	members: ParameterGroupMember[],
	groups: ParameterGroup[],
	bySlot: Map<string, SlotCalculation[]> = new Map(),
): SlotGroup[] {
	const memberOf = new Map<string, ParameterGroupMember>();
	for (const member of members) {
		if (!memberOf.has(member.parameter_id)) memberOf.set(member.parameter_id, member);
	}
	const held = new Map<string, SiteParameter[]>();
	const ungrouped: SiteParameter[] = [];
	for (const slot of siteParameters) {
		const member = memberOf.get(slot.parameter_id);
		if (!member) {
			ungrouped.push(slot);
			continue;
		}
		held.set(member.group_id, [...(held.get(member.group_id) ?? []), slot]);
	}
	const ordinal = (slot: SiteParameter) => memberOf.get(slot.parameter_id)?.ordinal ?? 0;
	const listed: SlotGroup[] = [...groups]
		.sort((a, b) => a.ordinal - b.ordinal)
		.filter((group) => held.has(group.id))
		.map((group) => {
			const slots = [...(held.get(group.id) ?? [])].sort((a, b) => ordinal(a) - ordinal(b));
			return { id: group.id, code: group.code, label: group.label, slots, declared: declaredIn(slots, bySlot) };
		});
	if (ungrouped.length > 0) {
		listed.push({
			id: null,
			code: null,
			label: UNGROUPED,
			slots: ungrouped,
			declared: declaredIn(ungrouped, bySlot),
		});
	}
	return listed;
}

/** The calculations publishing one of `slots`, each named once. */
function declaredIn(
	slots: SiteParameter[],
	bySlot: Map<string, SlotCalculation[]>,
): SlotCalculation[] {
	const declared: SlotCalculation[] = [];
	for (const slot of slots) {
		for (const calculation of bySlot.get(slot.parameter_id) ?? []) {
			if (!calculation.writes || declared.some((d) => d.name === calculation.name)) continue;
			declared.push(calculation);
		}
	}
	return declared;
}

/** The cadence a slot declares, as the instrument toggle words it. */
export function cadenceLabel(cadence: string | undefined): string {
	return cadence === 'low' ? 'Low frequency' : 'High frequency';
}

/**
 * What declaring the other cadence means for the slot, for the confirmation that asks. The two
 * engines read the declaration: `high` is computed where the stream carries it, `low` at the
 * visit a person records.
 */
export function cadenceConsequence(cadence: string | undefined): string {
	return cadence === 'low'
		? 'Declare this slot high frequency? A stream carries it, and the continuous engine computes it there; nothing is computed at a visit.'
		: 'Declare this slot low frequency? A person records it at a visit, and the calculation chain computes it from that visit’s values.';
}

/** The cadence the other choice is. */
export function otherCadence(cadence: string | undefined): 'high' | 'low' {
	return cadence === 'low' ? 'high' : 'low';
}
