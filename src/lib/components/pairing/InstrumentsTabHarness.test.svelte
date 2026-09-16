<script lang="ts">
	import InstrumentsTab from './InstrumentsTab.svelte';
	import type { PlanDeviceGroup } from '$api/service';
	import type { InstrumentDecision } from '$lib/pairing/planGroups';

	// The tab takes the name editor as a snippet, shared with the Parameters tab. Here it is the
	// name alone: what is under test is the selection, not the editor.
	let {
		instrumentDecisions,
		labInstruments,
		planDevices = [],
		onassign,
	}: {
		instrumentDecisions: InstrumentDecision[];
		labInstruments: Array<{ id: string; name: string | null; serial_number: string | null }>;
		planDevices?: PlanDeviceGroup[];
		onassign: (rows: InstrumentDecision[], instrumentId: string) => void;
	} = $props();
</script>

<InstrumentsTab
	planInstruments={{ groups: [], unassigned: [], devices: [], curves: [] }}
	{planDevices}
	{instrumentDecisions}
	{labInstruments}
	openInstrumentQuestions={instrumentDecisions.length}
	acceptingSuggestions={false}
	instrumentOptions={() => []}
	instrumentValue={() => ''}
	instrumentStatus={() => 'unset'}
	instrumentRowId={(scope) => `instrument-row-${scope}`}
	onchoose={() => {}}
	onattach={() => {}}
	{onassign}
	onacceptall={() => {}}
>
	{#snippet nameField(_scope, _anchor, proposedName)}
		<span>{proposedName}</span>
	{/snippet}
</InstrumentsTab>
