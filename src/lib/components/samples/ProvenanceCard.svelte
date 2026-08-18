<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { formatEquation } from '$lib/standardCurves';
	import Button from '$components/ui/Button.svelte';

	// Renders a sample's tool-run provenance blob: which script version produced the numbers,
	// the exact inputs, the curves consumed, and which outputs were saved to which parameters.
	let {
		provenance,
		paramName = (id: string) => id.slice(0, 8),
	}: {
		provenance: Record<string, unknown>;
		paramName?: (id: string) => string;
	} = $props();

	interface ProvCurve {
		name?: string;
		slope?: number | null;
		intercept?: number | null;
		label?: string | null;
		standard_curve_id?: string | null;
	}

	const tool = $derived(typeof provenance.tool === 'string' ? provenance.tool : '');
	const runId = $derived(typeof provenance.run_id === 'string' ? provenance.run_id : null);
	const version = $derived.by(() => {
		const v = provenance.tool_version;
		if (typeof v !== 'object' || v === null) return null;
		const o = v as Record<string, unknown>;
		return {
			versionNo: typeof o.version_no === 'number' ? o.version_no : null,
			hash: typeof o.content_hash === 'string' ? o.content_hash : null,
		};
	});
	const inputs = $derived.by(() => {
		const v = provenance.inputs;
		return typeof v === 'object' && v !== null && !Array.isArray(v)
			? Object.entries(v as Record<string, unknown>)
			: [];
	});
	const curves = $derived(
		Array.isArray(provenance.curves) ? (provenance.curves as ProvCurve[]) : [],
	);
	const outputs = $derived.by(() => {
		const v = provenance.outputs;
		return typeof v === 'object' && v !== null && !Array.isArray(v)
			? Object.entries(v as Record<string, unknown>)
			: [];
	});
	const saved = $derived.by(() => {
		const v = provenance.saved;
		return typeof v === 'object' && v !== null && !Array.isArray(v)
			? (v as Record<string, unknown>)
			: {};
	});

	// A saved entry keyed 'DIC' covers the replicate keys 'DIC_A', 'DIC_B', ...
	function savedParamFor(outputKey: string): string | null {
		for (const [k, pid] of Object.entries(saved)) {
			if (typeof pid !== 'string' || !pid) continue;
			if (outputKey === k || new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_[A-Za-z0-9]+$`).test(outputKey)) {
				return pid;
			}
		}
		return null;
	}

	function fmtValue(value: unknown): string {
		if (typeof value === 'number') return String(value);
		if (typeof value === 'string' || typeof value === 'boolean') return String(value);
		return JSON.stringify(value);
	}

	function reloadIntoTool() {
		sessionStorage.setItem(
			'tool-prefill',
			JSON.stringify({ tool, inputs: provenance.inputs ?? {} }),
		);
		goto(`${base}/tools?tool=${encodeURIComponent(tool)}&prefill=session`);
	}
</script>

<div class="rounded-md border border-brand-divider bg-brand-bg p-3 space-y-2.5 text-xs">
	<div class="flex items-center justify-between gap-2 flex-wrap">
		<div>
			<span class="font-semibold text-sm">{tool || 'Unknown tool'}</span>
			{#if version?.versionNo != null}
				<span class="text-brand-muted"> v{version.versionNo}</span>
			{/if}
			{#if version?.hash}
				<span class="font-mono text-brand-muted" title={version.hash}> ({version.hash.slice(0, 8)})</span>
			{/if}
		</div>
		{#if tool}
			<Button size="sm" onclick={reloadIntoTool}>Reload into tool</Button>
		{/if}
	</div>

	{#if inputs.length > 0}
		<div>
			<div class="font-semibold text-brand-muted uppercase tracking-wide mb-1">Inputs</div>
			<table class="w-full">
				<tbody>
					{#each inputs as [key, value]}
						<tr class="border-t border-brand-divider">
							<td class="py-0.5 pr-2 text-brand-muted whitespace-nowrap align-top">{key}</td>
							<td class="py-0.5 font-mono break-all">{fmtValue(value)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if curves.length > 0}
		<div>
			<div class="font-semibold text-brand-muted uppercase tracking-wide mb-1">Curves</div>
			{#each curves as c}
				<div class="flex items-baseline gap-2 flex-wrap py-0.5 border-t border-brand-divider">
					<span class="text-brand-muted">{c.name ?? 'curve'}</span>
					{#if c.label}<span>{c.label}</span>{/if}
					{#if typeof c.slope === 'number' && typeof c.intercept === 'number'}
						<span class="font-mono">{formatEquation(c.slope, c.intercept)}</span>
					{/if}
					{#if c.standard_curve_id}
						<span class="font-mono text-brand-muted" title={c.standard_curve_id}>[{c.standard_curve_id.slice(0, 8)}]</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	{#if outputs.length > 0}
		<div>
			<div class="font-semibold text-brand-muted uppercase tracking-wide mb-1">Outputs</div>
			<table class="w-full">
				<tbody>
					{#each outputs as [key, value]}
						{@const pid = savedParamFor(key)}
						<tr class="border-t border-brand-divider">
							<td class="py-0.5 pr-2 text-brand-muted whitespace-nowrap align-top">{key.replace(/_/g, ' ')}</td>
							<td class="py-0.5 font-mono">{fmtValue(value)}</td>
							<td class="py-0.5 pl-2 text-right whitespace-nowrap">
								{#if pid}
									<span class="px-1.5 py-0.5 rounded-full bg-severity-ok-soft text-severity-ok">saved → {paramName(pid)}</span>
								{:else}
									<span class="text-brand-muted">not saved</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if runId}
		<div class="text-brand-muted">Run <span class="font-mono">{runId}</span></div>
	{/if}
</div>
