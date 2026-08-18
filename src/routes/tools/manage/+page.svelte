<script lang="ts">
	import { base } from '$app/paths';
	import {
		listToolScripts,
		getToolScript,
		createToolScript,
		updateToolScript,
		createToolVersion,
		getToolVersion,
		validateToolVersion,
		activateToolVersion,
		listToolActivations,
		toolLintFindings,
		type ToolScriptSummary,
		type ToolScriptDetail,
		type ToolVersionSummary,
		type ToolVersionDetail,
		type ToolLintFinding,
		type ToolValidateResponse,
		type ToolActivationRecord,
	} from '$api/service';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import { apiMessage } from '$lib/standardCurves';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	let scripts = $state<ToolScriptSummary[]>([]);
	let loading = $state(true);
	let loadError = $state('');

	let detail = $state<ToolScriptDetail | null>(null);
	let activations = $state<ToolActivationRecord[]>([]);
	let selectedVersion = $state<ToolVersionDetail | null>(null);

	// Editor buffers; seeded from the selected version, saved as a NEW immutable version.
	let scriptText = $state('');
	let entryFunction = $state('tool');
	let manifestText = $state('');
	let testCasesText = $state('');
	let manifestError = $state('');
	let testCasesError = $state('');
	let lintFindings = $state<ToolLintFinding[]>([]);
	let savingVersion = $state(false);

	let validation = $state<ToolValidateResponse | null>(null);
	let validatingId = $state<string | null>(null);

	let confirmActivate = $state<ToolVersionSummary | null>(null);
	let activateDialogOpen = $state(false);
	let activating = $state(false);

	function openActivate(v: ToolVersionSummary) {
		confirmActivate = v;
		activateDialogOpen = true;
	}

	let showNewScript = $state(false);
	let newName = $state('');
	let newLabel = $state('');
	let newDescription = $state('');
	let creatingScript = $state(false);

	let metaLabel = $state('');
	let metaDescription = $state('');
	let savingMeta = $state(false);

	$effect(() => {
		if (me.status !== 'ready' || !me.can('admin')) return;
		void refreshList();
	});

	async function refreshList() {
		loading = true;
		try {
			scripts = await listToolScripts();
			loadError = '';
		} catch (e) {
			loadError = apiMessage(e);
		} finally {
			loading = false;
		}
	}

	async function selectScript(id: string) {
		validation = null;
		selectedVersion = null;
		lintFindings = [];
		try {
			const [d, a] = await Promise.all([getToolScript(id), listToolActivations(id)]);
			detail = d;
			activations = a;
			metaLabel = d.label;
			metaDescription = d.description ?? '';
			const active = d.versions.find((v) => v.active) ?? d.versions[0];
			if (active) await selectVersion(active.id);
			else {
				selectedVersion = null;
				scriptText = '';
				entryFunction = 'tool';
				manifestText = '';
				testCasesText = '';
			}
		} catch (e) {
			toastStore.error(apiMessage(e));
		}
	}

	async function selectVersion(versionId: string) {
		if (!detail) return;
		validation = null;
		lintFindings = [];
		try {
			const v = await getToolVersion(detail.id, versionId);
			selectedVersion = v;
			scriptText = v.script;
			entryFunction = v.entry_function;
			manifestText = JSON.stringify(v.manifest, null, 2);
			testCasesText = JSON.stringify(v.test_cases, null, 2);
			manifestError = '';
			testCasesError = '';
		} catch (e) {
			toastStore.error(apiMessage(e));
		}
	}

	function checkJson(text: string, required: boolean): string {
		if (!text.trim()) return required ? 'Required' : '';
		try {
			JSON.parse(text);
			return '';
		} catch (e) {
			return e instanceof Error ? e.message : 'Invalid JSON';
		}
	}

	async function saveNewVersion() {
		if (!detail) return;
		manifestError = checkJson(manifestText, true);
		testCasesError = checkJson(testCasesText, false);
		if (manifestError || testCasesError) return;
		savingVersion = true;
		lintFindings = [];
		try {
			const res = await createToolVersion(detail.id, {
				script: scriptText,
				entry_function: entryFunction.trim() || 'tool',
				manifest: JSON.parse(manifestText),
				...(testCasesText.trim() ? { test_cases: JSON.parse(testCasesText) } : {}),
				...(me.data?.email ? { created_by: me.data.email } : {}),
			});
			toastStore.success(`Saved version ${res.version.version_no}`);
			await selectScript(detail.id);
			await refreshList();
		} catch (e) {
			const findings = toolLintFindings(e);
			if (findings) lintFindings = findings;
			else toastStore.error(apiMessage(e));
		} finally {
			savingVersion = false;
		}
	}

	async function runValidate(v: ToolVersionSummary) {
		if (!detail) return;
		validatingId = v.id;
		validation = null;
		try {
			validation = await validateToolVersion(detail.id, v.id);
			await selectScript(detail.id);
			if (selectedVersion?.id !== v.id) await selectVersion(v.id);
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			validatingId = null;
		}
	}

	function isRollback(v: ToolVersionSummary): boolean {
		return detail?.active_version_no != null && v.version_no < detail.active_version_no;
	}

	async function doActivate() {
		if (!detail || !confirmActivate) return;
		activating = true;
		try {
			await activateToolVersion(detail.id, confirmActivate.id, me.data?.email ?? undefined);
			toastStore.success(
				`Version ${confirmActivate.version_no} is now active for ${detail.name}`,
			);
			activateDialogOpen = false;
			confirmActivate = null;
			await selectScript(detail.id);
			await refreshList();
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			activating = false;
		}
	}

	async function saveMeta() {
		if (!detail) return;
		savingMeta = true;
		try {
			await updateToolScript(detail.id, {
				label: metaLabel,
				description: metaDescription || undefined,
			});
			toastStore.success('Saved');
			await refreshList();
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			savingMeta = false;
		}
	}

	async function doCreateScript() {
		creatingScript = true;
		try {
			const s = await createToolScript({
				name: newName.trim(),
				label: newLabel.trim() || newName.trim(),
				...(newDescription.trim() ? { description: newDescription.trim() } : {}),
				...(me.data?.email ? { created_by: me.data.email } : {}),
			});
			showNewScript = false;
			newName = '';
			newLabel = '';
			newDescription = '';
			await refreshList();
			await selectScript(s.id);
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			creatingScript = false;
		}
	}
</script>

<svelte:head><title>Manage Tools | River Data</title></svelte:head>

{#if me.status === 'ready' && !me.can('admin')}
	<p class="text-sm text-brand-muted">Tool script authoring requires the Administrator role.</p>
{:else}
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<h2 class="text-xl font-semibold">Manage Tools</h2>
			<Button variant="primary" size="sm" onclick={() => (showNewScript = true)}>New script</Button>
		</div>
		<p class="text-sm text-brand-muted">
			Versioned R scripts behind the analytical tools. Versions are immutable: saving appends a
			new one, activation flips which version <a href="{base}/tools" class="text-brand-primary hover:underline">Tools</a> serves,
			and activating an older version is the rollback. A version activates only after its test
			cases pass.
		</p>

		{#if loadError}
			<ErrorNotice message={loadError} />
		{:else if loading}
			<p class="text-sm text-brand-muted">Loading…</p>
		{:else}
			<div class="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4">
				<!-- Script list -->
				<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden self-start">
					<table class="w-full text-sm">
						<thead>
							<tr class="bg-brand-bg border-b border-brand-divider text-left text-xs">
								<th class="px-3 py-2 font-semibold">Tool</th>
								<th class="px-3 py-2 font-semibold">Active</th>
								<th class="px-3 py-2 font-semibold text-right">Versions</th>
							</tr>
						</thead>
						<tbody>
							{#each scripts as s (s.id)}
								<tr
									class="border-b border-brand-divider last:border-b-0 cursor-pointer {detail?.id === s.id ? 'bg-brand-primary/5' : 'hover:bg-brand-bg/50'}"
									onclick={() => selectScript(s.id)}
								>
									<td class="px-3 py-2">
										<span class="font-medium">{s.label}</span>
										<span class="font-mono text-xs text-brand-muted"> {s.name}</span>
									</td>
									<td class="px-3 py-2 text-xs">
										{#if s.active_version_no != null}
											<Badge variant="ok">v{s.active_version_no}</Badge>
										{:else}
											<Badge variant="muted">none</Badge>
										{/if}
									</td>
									<td class="px-3 py-2 text-right font-mono text-xs">{s.version_count}</td>
								</tr>
							{/each}
							{#if scripts.length === 0}
								<tr><td colspan="3" class="px-3 py-6 text-center text-brand-muted">No tool scripts</td></tr>
							{/if}
						</tbody>
					</table>
				</div>

				<!-- Detail -->
				{#if detail}
					<div class="space-y-4">
						<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3">
							<div class="flex items-baseline gap-2">
								<h3 class="text-base font-semibold">{detail.name}</h3>
								{#if detail.active_version_no != null}
									<span class="text-xs text-brand-muted">active v{detail.active_version_no}</span>
								{/if}
							</div>
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
								<div class="flex flex-col gap-1">
									<label for="tm-label" class="text-sm font-medium">Label</label>
									<input id="tm-label" type="text" bind:value={metaLabel} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
								</div>
								<div class="flex flex-col gap-1">
									<label for="tm-desc" class="text-sm font-medium">Description</label>
									<input id="tm-desc" type="text" bind:value={metaDescription} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
								</div>
							</div>
							<Button size="sm" onclick={saveMeta} disabled={savingMeta}>{savingMeta ? 'Saving…' : 'Save label'}</Button>
						</div>

						<!-- Version history -->
						<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
							<table class="w-full text-sm">
								<thead>
									<tr class="bg-brand-bg border-b border-brand-divider text-left text-xs">
										<th class="px-3 py-2 font-semibold">Version</th>
										<th class="px-3 py-2 font-semibold">Created</th>
										<th class="px-3 py-2 font-semibold">Validated</th>
										<th class="px-3 py-2 font-semibold">Status</th>
										<th class="px-3 py-2"></th>
									</tr>
								</thead>
								<tbody>
									{#each detail.versions as v (v.id)}
										<tr class="border-b border-brand-divider last:border-b-0 {selectedVersion?.id === v.id ? 'bg-brand-primary/5' : ''}">
											<td class="px-3 py-2">
												<button onclick={() => selectVersion(v.id)} class="text-brand-primary bg-transparent border-none cursor-pointer hover:underline font-medium">
													v{v.version_no}
												</button>
												<span class="font-mono text-xs text-brand-muted" title={v.content_hash}>{v.content_hash.slice(0, 8)}</span>
											</td>
											<td class="px-3 py-2 text-xs text-brand-muted">
												{formatDateTime(v.created_at)}{#if v.created_by}<span> · {v.created_by}</span>{/if}
											</td>
											<td class="px-3 py-2 text-xs text-brand-muted">{v.validated_at ? formatDateTime(v.validated_at) : 'Not validated'}</td>
											<td class="px-3 py-2">
												{#if v.active}<Badge variant="ok">active</Badge>{/if}
											</td>
											<td class="px-3 py-2 text-right whitespace-nowrap">
												<Button size="sm" onclick={() => runValidate(v)} disabled={validatingId === v.id}>
													{validatingId === v.id ? 'Validating…' : 'Validate'}
												</Button>
												{#if !v.active}
													<Button
														size="sm"
														variant={isRollback(v) ? 'danger' : 'primary'}
														disabled={!v.validated_at}
														title={v.validated_at ? undefined : 'Validate this version first'}
														onclick={() => openActivate(v)}
													>{isRollback(v) ? 'Rollback to this' : 'Activate'}</Button>
												{/if}
											</td>
										</tr>
									{/each}
									{#if detail.versions.length === 0}
										<tr><td colspan="5" class="px-3 py-4 text-center text-brand-muted">No versions yet; save one below.</td></tr>
									{/if}
								</tbody>
							</table>
						</div>

						{#if validation}
							<div class="rounded-md border {validation.passed ? 'border-severity-ok/40' : 'border-severity-alarm/40'} bg-brand-surface p-3 space-y-1.5">
								<div class="text-sm font-semibold">
									Validation {validation.passed ? 'passed' : 'failed'}
								</div>
								{#each validation.cases as c}
									<div class="text-xs">
										<Badge variant={c.passed ? 'ok' : 'alarm'}>{c.passed ? 'pass' : 'fail'}</Badge>
										<span class="font-medium ml-1">{c.name}</span>
										{#if c.error}
											<div class="font-mono text-severity-alarm mt-0.5">{c.error}</div>
										{/if}
										{#each c.failures as f}
											<div class="font-mono text-brand-muted mt-0.5">{f}</div>
										{/each}
									</div>
								{/each}
							</div>
						{/if}

						<!-- Editor -->
						<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3">
							<div class="flex items-baseline justify-between">
								<h4 class="text-sm font-semibold">
									Editor
									{#if selectedVersion}
										<span class="text-brand-muted font-normal">(seeded from v{selectedVersion.version_no})</span>
									{/if}
								</h4>
								<div class="flex flex-col gap-1">
									<label for="tm-entry" class="sr-only">Entry function</label>
									<input id="tm-entry" type="text" bind:value={entryFunction} placeholder="entry function" class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs font-mono w-40" />
								</div>
							</div>
							<div class="flex flex-col gap-1">
								<label for="tm-script" class="text-sm font-medium">R script</label>
								<textarea
									id="tm-script"
									rows="16"
									bind:value={scriptText}
									spellcheck="false"
									class="px-3 py-2 border border-brand-divider rounded-md bg-brand-bg text-xs font-mono leading-5 focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
								></textarea>
							</div>
							{#if lintFindings.length > 0}
								<div class="rounded-md border border-severity-alarm/40 bg-severity-alarm-soft p-2.5 space-y-0.5">
									<p class="text-sm font-medium text-severity-alarm">The script did not pass the safety lint:</p>
									{#each lintFindings as f}
										<p class="text-xs font-mono">line {f.line}: {f.message}</p>
									{/each}
								</div>
							{/if}
							<div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
								<div class="flex flex-col gap-1">
									<label for="tm-manifest" class="text-sm font-medium">Manifest (JSON)</label>
									<textarea
										id="tm-manifest"
										rows="12"
										bind:value={manifestText}
										spellcheck="false"
										oninput={() => (manifestError = checkJson(manifestText, true))}
										class="px-3 py-2 border {manifestError ? 'border-severity-alarm' : 'border-brand-divider'} rounded-md bg-brand-bg text-xs font-mono leading-5"
									></textarea>
									{#if manifestError}<p class="text-xs text-severity-alarm">{manifestError}</p>{/if}
								</div>
								<div class="flex flex-col gap-1">
									<label for="tm-cases" class="text-sm font-medium">Test cases (JSON)</label>
									<textarea
										id="tm-cases"
										rows="12"
										bind:value={testCasesText}
										spellcheck="false"
										oninput={() => (testCasesError = checkJson(testCasesText, false))}
										class="px-3 py-2 border {testCasesError ? 'border-severity-alarm' : 'border-brand-divider'} rounded-md bg-brand-bg text-xs font-mono leading-5"
									></textarea>
									{#if testCasesError}<p class="text-xs text-severity-alarm">{testCasesError}</p>{/if}
								</div>
							</div>
							<Button variant="primary" onclick={saveNewVersion} disabled={savingVersion || !scriptText.trim()}>
								{savingVersion ? 'Saving…' : 'Save as new version'}
							</Button>
						</div>

						<!-- Activation audit -->
						<div class="rounded-md border border-brand-divider bg-brand-surface p-4">
							<h4 class="text-sm font-semibold mb-2">Activation history</h4>
							{#if activations.length === 0}
								<p class="text-sm text-brand-muted">No activations recorded.</p>
							{:else}
								<div class="space-y-1">
									{#each activations as a}
										<div class="text-xs text-brand-muted">
											{formatDateTime(a.activated_at)}:
											{#if a.from_version_no != null}v{a.from_version_no} →{/if}
											<span class="font-medium text-brand-text">v{a.to_version_no}</span>
											{#if a.activated_by}<span> by {a.activated_by}</span>{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{:else}
					<div class="rounded-md border border-brand-divider bg-brand-surface p-6 text-sm text-brand-muted self-start">
						Select a tool script to view its versions.
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<Dialog bind:open={showNewScript} title="New tool script" maxWidth="xs">
	{#snippet children()}
		<div class="space-y-3">
			<div class="flex flex-col gap-1">
				<label for="tm-new-name" class="text-sm font-medium">Name <span class="text-severity-alarm">*</span></label>
				<input id="tm-new-name" type="text" bind:value={newName} placeholder="a-z, 0-9, underscore" class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm font-mono" />
			</div>
			<div class="flex flex-col gap-1">
				<label for="tm-new-label" class="text-sm font-medium">Label</label>
				<input id="tm-new-label" type="text" bind:value={newLabel} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
			</div>
			<div class="flex flex-col gap-1">
				<label for="tm-new-desc" class="text-sm font-medium">Description</label>
				<input id="tm-new-desc" type="text" bind:value={newDescription} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
			</div>
			<p class="text-xs text-brand-muted">
				The tool lists on the Tools page once a version is saved, validated and activated.
			</p>
		</div>
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => (showNewScript = false)}>Cancel</Button>
		<Button variant="primary" onclick={doCreateScript} disabled={creatingScript || !newName.trim()}>
			{creatingScript ? 'Creating…' : 'Create'}
		</Button>
	{/snippet}
</Dialog>

<Dialog
	bind:open={activateDialogOpen}
	title={confirmActivate && isRollback(confirmActivate) ? 'Rollback' : 'Activate version'}
	maxWidth="xs"
>
	{#snippet children()}
		{#if confirmActivate}
			<p class="text-sm">
				{#if isRollback(confirmActivate)}
					Roll {detail?.name} back to version {confirmActivate.version_no}? The currently active
					version {detail?.active_version_no} stops serving calculations immediately.
				{:else}
					Make version {confirmActivate.version_no} the one {detail?.name} serves? Every
					calculation from now on runs this version.
				{/if}
			</p>
		{/if}
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => (activateDialogOpen = false)}>Cancel</Button>
		<Button
			variant={confirmActivate && isRollback(confirmActivate) ? 'danger' : 'primary'}
			onclick={doActivate}
			disabled={activating}
		>{activating ? 'Activating…' : confirmActivate && isRollback(confirmActivate) ? 'Rollback' : 'Activate'}</Button>
	{/snippet}
</Dialog>
