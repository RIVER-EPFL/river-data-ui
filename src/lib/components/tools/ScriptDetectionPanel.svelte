<script lang="ts">
	import type { ToolInspectResponse } from '$api/service';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { dynamicRepBases, undeclaredOutputs } from '$lib/tools/validation';
	import { PARAM_KINDS, REP_SUFFIX, guessKind } from './manifest';

	let {
		inspection,
		inspecting = false,
		error = '',
		reconciliationSkipped = false,
		declaredOutputKeys = [],
		onAddParam,
		onAddOutput,
		onAddConstant,
		onAddCurve,
		onRemoveParam,
		onRemoveConstant,
		onRemoveCurve,
	}: {
		inspection: ToolInspectResponse | null;
		inspecting?: boolean;
		error?: string;
		/** True when the manifest was refused, so the detection ran without reconciliation. */
		reconciliationSkipped?: boolean;
		declaredOutputKeys?: string[];
		onAddParam: (name: string, kind: string) => void;
		onAddOutput: (key: string, perReplicate?: boolean) => void;
		onAddConstant: (name: string) => void;
		onAddCurve: (name: string) => void;
		onRemoveParam: (name: string) => void;
		onRemoveConstant: (name: string) => void;
		onRemoveCurve: (name: string) => void;
	} = $props();

	const rec = $derived(inspection?.reconciliation ?? null);
	const repBases = $derived(dynamicRepBases(inspection, declaredOutputKeys));
	const undeclaredOuts = $derived(undeclaredOutputs(inspection, declaredOutputKeys));

	// The kind a detected input starts with, correctable on its own line before the row is added.
	let kindChoice = $state<Record<string, string>>({});
	const kindFor = (name: string) => kindChoice[name] ?? guessKind(name);

	const notDeclared = $derived(
		(rec?.undeclared_inputs.length ?? 0) +
			(rec?.undeclared_constants.length ?? 0) +
			(rec?.undeclared_curves.length ?? 0) +
			repBases.length +
			undeclaredOuts.length,
	);
	const notRead = $derived(
		(rec?.unread_params.length ?? 0) +
			(rec?.unread_constants.length ?? 0) +
			(rec?.unread_curves.length ?? 0),
	);
</script>

{#snippet row(name: string, action: string, run: () => void)}
	<div class="flex items-center gap-2 py-0.5">
		<span class="font-mono text-xs truncate">{name}</span>
		<span class="grow"></span>
		<Button size="sm" onclick={run}>{action}</Button>
	</div>
{/snippet}

<div class="rounded-md border border-brand-divider bg-brand-surface">
	<div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-brand-divider">
		<h5 class="text-sm font-semibold" title="What the script reads and returns, against the manifest">
			Detection
		</h5>
		<span class="text-xs text-brand-muted">
			{#if inspecting}Reading…{:else if inspection}{inspection.parse_ok ? 'Parsed' : 'Not parsed'}{/if}
		</span>
	</div>

	<div class="p-3 space-y-2">
		{#if error}
			<ErrorNotice message={error} />
		{:else if !inspection}
			<p class="text-xs text-brand-muted">No script read yet.</p>
		{:else}
			{#if reconciliationSkipped}
				<p class="text-xs text-brand-muted" title="The manifest is not valid yet">Comparison paused.</p>
			{/if}

			{#if inspection.dynamic_outputs.any}
				<details>
					<summary class="text-xs cursor-pointer">
						Output names built at run time ({inspection.dynamic_outputs.expressions.length})
					</summary>
					{#each inspection.dynamic_outputs.expressions as expr}
						<p class="font-mono text-xs text-brand-muted break-all">{expr}</p>
					{/each}
				</details>
			{/if}
			{#if inspection.dynamic_reads.any}
				<details>
					<summary class="text-xs cursor-pointer">
						Input names built at run time ({inspection.dynamic_reads.expressions.length})
					</summary>
					{#each inspection.dynamic_reads.expressions as expr}
						<p class="font-mono text-xs text-brand-muted break-all">{expr}</p>
					{/each}
				</details>
			{/if}

			{#if notDeclared > 0}
				<div>
					<h6 class="text-xs font-semibold mb-1">Not declared ({notDeclared})</h6>
					{#each rec?.undeclared_inputs ?? [] as name}
						<div class="flex items-center gap-2 py-0.5">
							<span class="font-mono text-xs truncate">{name}</span>
							<span class="grow"></span>
							<select
								aria-label="Kind for {name}"
								value={kindFor(name)}
								onchange={(e) => (kindChoice = { ...kindChoice, [name]: e.currentTarget.value })}
								class="px-1 py-0.5 border border-brand-divider rounded-md bg-brand-surface text-xs"
							>
								{#each PARAM_KINDS as k}
									<option value={k}>{k}</option>
								{/each}
							</select>
							<Button size="sm" onclick={() => onAddParam(name, kindFor(name))}>Add</Button>
						</div>
					{/each}
					{#each rec?.undeclared_constants ?? [] as name}
						{@render row(name, 'Add constant', () => onAddConstant(name))}
					{/each}
					{#each rec?.undeclared_curves ?? [] as name}
						{@render row(name, 'Add curve', () => onAddCurve(name))}
					{/each}
					{#each repBases as base}
						{@render row(`${base}${REP_SUFFIX}`, 'Add', () => onAddOutput(base, true))}
					{/each}
					{#each undeclaredOuts as key}
						{@render row(key, 'Add', () => onAddOutput(key))}
					{/each}
				</div>
			{/if}

			{#if notRead > 0}
				<div>
					<h6
						class="text-xs font-semibold mb-1"
						title={rec?.reads_complete
							? 'Declared in the manifest, never read by the script'
							: 'Declared in the manifest and not read; the script also builds some names at run time'}
					>
						Declared, not read ({notRead})
					</h6>
					{#each rec?.unread_params ?? [] as name}
						{@render row(name, 'Remove', () => onRemoveParam(name))}
					{/each}
					{#each rec?.unread_constants ?? [] as name}
						{@render row(name, 'Remove', () => onRemoveConstant(name))}
					{/each}
					{#each rec?.unread_curves ?? [] as name}
						{@render row(name, 'Remove', () => onRemoveCurve(name))}
					{/each}
				</div>
			{/if}

			{#if notDeclared === 0 && notRead === 0}
				<p class="text-xs text-brand-muted">Manifest and script agree.</p>
			{/if}

			{#if inspection.script_functions_used.length > 0 || inspection.libraries.length > 0 || inspection.namespaces.length > 0}
				<details>
					<summary class="text-xs cursor-pointer">
						Prelude and libraries ({inspection.script_functions_used.length +
							inspection.libraries.length +
							inspection.namespaces.length})
					</summary>
					<div class="flex flex-wrap gap-1 pt-1">
						{#each inspection.script_functions_used as fn}
							<Badge variant="muted">{fn}</Badge>
						{/each}
						{#each [...inspection.libraries, ...inspection.namespaces] as lib}
							<Badge variant="accent">{lib}</Badge>
						{/each}
					</div>
				</details>
			{/if}
		{/if}
	</div>
</div>
