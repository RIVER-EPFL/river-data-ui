<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { api } from '$api/crud';
	import { formatEquation } from '$lib/standardCurves';
	import Button from '$components/ui/Button.svelte';

	// Renders a sample's tool-run provenance blob: which script version and runner produced the
	// numbers, the exact inputs, the constants and curves consumed, and which outputs were saved
	// to which parameters.
	let {
		provenance,
		paramName,
	}: {
		provenance: Record<string, unknown>;
		/** Resolver for saved parameter ids. Omitted, the card resolves the names it needs itself. */
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
			runnerImage: typeof o.runner_image === 'string' ? o.runner_image : null,
			rVersion: typeof o.r_version === 'string' ? o.r_version : null,
		};
	});
	const inputs = $derived.by(() => {
		const v = provenance.inputs;
		return typeof v === 'object' && v !== null && !Array.isArray(v)
			? Object.entries(v as Record<string, unknown>)
			: [];
	});
	// Constants are named in the manifest and resolved server-side from the constants table, so the
	// value a run used is only recoverable from the blob: the table row may have changed since.
	const constants = $derived.by(() => {
		const v = provenance.constants;
		return typeof v === 'object' && v !== null && !Array.isArray(v)
			? Object.entries(v as Record<string, unknown>)
			: [];
	});
	// Two shapes reach this field: the flat curve the save panel records, and the runner's snapshot
	// `{ name, curve: { … } }`. Reading both keeps older blobs rendering after the shape changed.
	const curves = $derived.by((): ProvCurve[] => {
		if (!Array.isArray(provenance.curves)) return [];
		return (provenance.curves as unknown[]).flatMap((entry) => {
			if (typeof entry !== 'object' || entry === null) return [];
			const o = entry as Record<string, unknown>;
			const inner = o.curve;
			if (typeof inner === 'object' && inner !== null) {
				return [{ name: typeof o.name === 'string' ? o.name : undefined, ...(inner as ProvCurve) }];
			}
			return [o as ProvCurve];
		});
	});
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

	// Names for the saved parameter ids, when the host has no list of its own to resolve them from.
	const resolvedNames = new SvelteMap<string, string>();
	const requested = new Set<string>();
	$effect(() => {
		if (paramName) return;
		for (const pid of Object.values(saved)) {
			if (typeof pid !== 'string' || !pid || requested.has(pid)) continue;
			requested.add(pid);
			api.parameters
				.get(pid)
				.then((p) => resolvedNames.set(pid, p.name))
				.catch(() => {
					// A parameter the caller cannot read, or one since deleted, stays an id.
				});
		}
	});

	function nameOf(id: string): string {
		if (paramName) return paramName(id);
		return resolvedNames.get(id) ?? id.slice(0, 8);
	}

	// A saved entry keyed 'DIC' covers the replicate keys 'DIC_A', 'DIC_B', ... The suffix has to be
	// a single replicate label: a longer one is an aggregate the manifest declares separately
	// ('DIC_avg', 'DIC_std'), which is display-only and never saved.
	function savedParamFor(outputKey: string): string | null {
		for (const [k, pid] of Object.entries(saved)) {
			if (typeof pid !== 'string' || !pid) continue;
			if (outputKey === k || new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_[A-Za-z0-9]$`).test(outputKey)) {
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

	// The runner reports its R version either bare ('4.6.0') or as the full banner
	// ('R version 4.6.0 (2026-04-24)'), so the 'R' prefix is added only when it is missing.
	const rVersionLabel = $derived.by(() => {
		const v = version?.rVersion;
		if (!v) return null;
		return /^r\b/i.test(v) ? v : `R ${v}`;
	});

	// The authoring page is keyed by script name and version number; both are what the blob records.
	const versionHref = $derived(
		tool && version?.versionNo != null
			? `${base}/tools/manage?script=${encodeURIComponent(tool)}&version=${version.versionNo}`
			: null,
	);

	function reloadIntoTool() {
		sessionStorage.setItem(
			'tool-prefill',
			JSON.stringify({ tool, inputs: provenance.inputs ?? {} }),
		);
		goto(`${base}/tools?tool=${encodeURIComponent(tool)}&prefill=session`);
	}
</script>

<div class="rounded-md border border-brand-divider bg-brand-bg p-3 space-y-2.5 text-xs">
	<div class="flex items-start justify-between gap-2 flex-wrap">
		<div>
			<div>
				<span class="font-semibold text-sm">{tool || 'Unknown tool'}</span>
				{#if version?.versionNo != null}
					{#if versionHref}
						<a href={versionHref} class="ml-1 text-brand-primary no-underline hover:underline" title="Open this version in the authoring page">Version {version.versionNo}</a>
					{:else}
						<span class="ml-1 text-brand-muted">Version {version.versionNo}</span>
					{/if}
				{/if}
				{#if version?.hash}
					<span class="font-mono text-brand-muted" title={version.hash}> ({version.hash.slice(0, 8)})</span>
				{/if}
			</div>
			{#if version?.runnerImage || rVersionLabel}
				<div class="text-brand-muted">
					Runner
					{#if version?.runnerImage}<span class="font-mono">{version.runnerImage}</span>{/if}
					{#if version?.runnerImage && rVersionLabel}<span> · </span>{/if}
					{#if rVersionLabel}<span class="font-mono">{rVersionLabel}</span>{/if}
				</div>
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

	{#if constants.length > 0}
		<div>
			<div class="font-semibold text-brand-muted uppercase tracking-wide mb-1" title="Values resolved from the constants table when the tool ran">Constants</div>
			<table class="w-full">
				<tbody>
					{#each constants as [key, value]}
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
									<span class="px-1.5 py-0.5 rounded-full bg-severity-ok-soft text-severity-ok">saved → {nameOf(pid)}</span>
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
