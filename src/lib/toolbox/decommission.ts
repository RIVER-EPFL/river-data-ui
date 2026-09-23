/** What decommissioning a calculation active at `sites` sites does, said before it is done. */
export function decommissionConsequence(sites: number | null): string {
	const where =
		sites === null
			? 'It stops at every site it is active at.'
			: sites === 0
				? 'It is active at no site.'
				: `It stops at the ${sites} site${sites === 1 ? '' : 's'} it is active at.`;
	return `${where} It is never switched on again; nothing it computed is withdrawn.`;
}
