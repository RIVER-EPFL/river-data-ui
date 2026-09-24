/** What decommissioning a calculation active at `sites` sites does, said before it is done. */
export function decommissionConsequence(sites: number | null): string {
	const where =
		sites === null
			? 'It stops at every site it is active at.'
			: sites === 0
				? 'It is active at no site.'
				: `It stops at the ${sites} site${sites === 1 ? '' : 's'} it is active at.`;
	return `${where} Its name is freed for a new calculation, and an administrator can recommission it; nothing it computed is withdrawn.`;
}

/** What a recommission says it did: the name it came back under, and why when it is not its own. */
export function recommissionOutcome(name: string, restored: boolean): string {
	return restored
		? `Recommissioned as ${name}, switched off`
		: `Recommissioned as ${name}, switched off: its former name is held by another calculation`;
}

/** One line of a calculation's commission history. */
export function commissionLine(c: { event: string; name: string; actor: string; reason: string }): string {
	const what = c.event === 'decommissioned' ? 'Decommissioned' : 'Recommissioned';
	return `${what} by ${c.actor}, as ${c.name}: ${c.reason}`;
}
