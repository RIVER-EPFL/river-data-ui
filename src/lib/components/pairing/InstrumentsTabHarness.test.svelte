<script lang="ts">
	import InstrumentsTab from './InstrumentsTab.svelte';
	import type { PlanDeviceGroup } from '$api/service';
	import type { InstrumentDecision } from '$lib/pairing/planGroups';

	// Each row offers only its own proposal, which is enough to show the name.
	let {
		instrumentDecisions,
		planDevices = [],
		deviceDecisions = [],
		coverage = new Map(),
	}: {
		instrumentDecisions: InstrumentDecision[];
		planDevices?: PlanDeviceGroup[];
		deviceDecisions?: InstrumentDecision[];
		coverage?: Map<string, { parameters: string[]; sites: string[] }>;
	} = $props();
</script>

<InstrumentsTab
	planInstruments={{ groups: [], unassigned: [], devices: [], curves: [], held_curves: [] }}
	{planDevices}
	{deviceDecisions}
	{instrumentDecisions}
	instrumentOptions={(d) => [{ label: 'Will be created', options: [{ value: `new:${d.proposedName}`, label: d.proposedName }] }]}
	instrumentValue={(d) => `new:${d.proposedName}`}
	instrumentStatus={() => 'unset'}
	instrumentRowId={(key) => `instrument-row-${key}`}
	{coverage}
	goToParam={() => {}}
	goToSite={() => {}}
	onchoose={() => {}}
	onattach={() => {}}
	onreview={() => {}}
	onmarkall={() => {}}
	marking={false}
	canMarkUnreviewed={false}
/>
