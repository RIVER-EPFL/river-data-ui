<script lang="ts">
	import TimestampInput from './TimestampInput.svelte';

	// Two callers: one binding the instant, one passing it down and taking the change back, which
	// is what a field driven by something else (a slider, a preset) does.
	let { instant = $bindable(''), oneWay = '' }: { instant?: string; oneWay?: string } = $props();
	let echoed = $state<string | null>(null);
</script>

<TimestampInput bind:value={instant} ariaLabel="Bound" />
<output data-testid="bound">{instant}</output>

<TimestampInput value={oneWay} ariaLabel="One way" onchange={(next) => (echoed = next)} />
<output data-testid="echoed">{echoed ?? oneWay}</output>
