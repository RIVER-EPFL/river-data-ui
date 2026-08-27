<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
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
		inspectToolScript,
		toolLintFindings,
		type ToolScriptSummary,
		type ToolScriptDetail,
		type ToolVersionSummary,
		type ToolVersionDetail,
		type ToolLintFinding,
		type ToolValidateResponse,
		type ToolActivationRecord,
		type ToolInspectResponse,
		type ToolManifest,
		type ToolTestCase,
		type ToolTestCases,
	} from '$api/service';
	import { api, type Constant, type Parameter } from '$api/crud';
	import { listAll } from '$api/paged';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import { apiMessage } from '$lib/standardCurves';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import ManifestParamsEditor from '$components/tools/ManifestParamsEditor.svelte';
	import ManifestOutputsEditor from '$components/tools/ManifestOutputsEditor.svelte';
	import ManifestConstantsEditor from '$components/tools/ManifestConstantsEditor.svelte';
	import ManifestCurvesEditor from '$components/tools/ManifestCurvesEditor.svelte';
	import ScriptDetectionPanel from '$components/tools/ScriptDetectionPanel.svelte';
	import ToolScriptSelect from '$components/tools/ToolScriptSelect.svelte';
	import RScriptEditor from '$components/tools/RScriptEditor.svelte';
	import { describeScript } from '$components/tools/preludeBoundary';
	import JsonEditor from '$components/tools/JsonEditor.svelte';
	import DraftRunPanel from '$components/tools/DraftRunPanel.svelte';
	import TestCasesEditor from '$components/tools/TestCasesEditor.svelte';
	import ValidationReport from '$components/tools/ValidationReport.svelte';
	import { DEFAULT_TOLERANCE, runTestCase, type CaseRun } from '$lib/tools/draft';
	import type { ToolFormSpec } from '$lib/tools/form';
	import {
		LABEL_FIELD,
		SCRIPT_FIELD,
		countSection,
		fieldMarks,
		focusTarget,
		markClass,
		validate,
		type Finding,
		type SectionCount,
		type SectionId,
	} from '$lib/tools/validation';
	import {
		blankCurve,
		blankOutput,
		blankParam,
		emptyManifest,
		fromManifest,
		outputStorage,
		parseTestCases,
		toWireManifest,
		type BuilderManifest,
	} from '$components/tools/manifest';
	import {
		insertAt,
		insertionIndex,
		repLabel,
		replicateFamilies,
		splitRepName,
	} from '$lib/tools/replicates';

	let scripts = $state<ToolScriptSummary[]>([]);
	let loading = $state(true);
	let loadError = $state('');

	let detail = $state<ToolScriptDetail | null>(null);
	let activations = $state<ToolActivationRecord[]>([]);
	let selectedVersion = $state<ToolVersionDetail | null>(null);

	// Editor buffers; seeded from the selected version, saved as a NEW immutable version.
	let scriptText = $state('');
	// No UI: every script defines `tool`, and a loaded version's own value is carried through so
	// re-saving cannot rename its entry point.
	let entryFunction = $state('tool');
	// What the source is made of, for the header beside the editor: how much of it is the vendored
	// portal prelude, and where the function the runner calls is defined.
	const scriptStructure = $derived(describeScript(scriptText, entryFunction || 'tool'));
	let manifest = $state<BuilderManifest>(emptyManifest());
	let testCases = $state<ToolTestCases>({ cases: [] });
	let note = $state('');
	/** Per output row: the author chose not to store it. Intent the manifest cannot carry. */
	let notStored = $state<boolean[]>([]);
	/** Per param row: why its default text does not parse, empty when it does. */
	let defaultErrors = $state<string[]>([]);
	let lintFindings = $state<ToolLintFinding[]>([]);
	let runLint = $state<ToolLintFinding[]>([]);
	let savingVersion = $state(false);
	// Testing, history and the raw view are separate activities from authoring, so they start folded
	// and open on the event that makes them relevant.
	let showPreview = $state(false);
	let showRaw = $state(false);
	let showTesting = $state(false);
	let showVersions = $state(false);
	let showActivations = $state(false);
	let showMeta = $state(false);
	let showAux = $state(false);
	let runState = $state<'idle' | 'ok' | 'failed'>('idle');
	// Bumped whenever the manifest is replaced from outside the builder, so the row editors reseed
	// the text buffers they keep for defaults and enum variants.
	let builderSeed = $state(0);
	// Bumped only when a different version is loaded. The preview and the case table keep their own
	// buffers and their own run results, which survive an edit to the manifest but not a new version.
	let versionSeed = $state(0);

	// A field is marked once the author has visited it, so a row added a second ago does not read as
	// failing before it could be filled. The save bar and the section counts are not gated this way.
	let touched = $state<Record<string, boolean>>({});
	const touch = (target: string) => (touched = { ...touched, [target]: true });

	let inspection = $state<ToolInspectResponse | null>(null);
	let inspecting = $state(false);
	let inspectError = $state('');
	let reconciliationSkipped = $state(false);
	let inspectSeq = 0;

	let constantsCatalog = $state<Constant[]>([]);
	let parameterCatalog = $state<Parameter[]>([]);

	let validation = $state<ToolValidateResponse | null>(null);
	let validationRuns = $state<Record<string, CaseRun>>({});
	let validationReplaying = $state(false);
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
		void refreshList().then(applyDeepLink);
		void loadCatalogs();
	});

	// Arrived at from elsewhere: `?script=` names the tool and `?version=` a version number, the
	// pair the provenance card and the tool page link with. Applied once, so a later reload of the
	// list does not pull the author back off whatever they since selected.
	let deepLinkApplied = false;

	async function applyDeepLink() {
		if (deepLinkApplied) return;
		deepLinkApplied = true;
		const wanted = page.url.searchParams.get('script');
		if (!wanted) return;
		const match = scripts.find((s) => s.name === wanted || s.id === wanted);
		if (!match) return;
		await selectScript(match.id);
		const wantedVersion = Number(page.url.searchParams.get('version'));
		if (!Number.isInteger(wantedVersion) || wantedVersion <= 0) return;
		const version = detail?.versions.find((v) => v.version_no === wantedVersion);
		if (version && version.id !== selectedVersion?.id) await selectVersion(version.id);
	}

	// Paged to completion: an output is linked by picking from the whole catalog, and a single page
	// silently stops offering entries once the table outgrows it.
	async function loadCatalogs() {
		try {
			const [constants, parameters] = await Promise.all([
				api.constants.list({ perPage: 500, sort: ['name', 'ASC'] }),
				listAll(api.parameters, { perPage: 500, sort: ['code', 'ASC'] }),
			]);
			constantsCatalog = constants.data;
			parameterCatalog = parameters;
		} catch {
			// The constants catalog only feeds suggestions; authoring works without it.
		}
	}

	/** A parameter created from inside the outputs editor is not in the list loaded on open. */
	function noteCatalogParameter(parameter: Parameter) {
		if (!parameterCatalog.some((p) => p.id === parameter.id))
			parameterCatalog = [...parameterCatalog, parameter];
	}

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
		validationRuns = {};
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
				manifest = emptyManifest(d.label);
				testCases = { cases: [] };
				note = '';
				seedRowState();
			}
		} catch (e) {
			toastStore.error(apiMessage(e));
		}
	}

	/** Row state the manifest cannot carry, read back from the manifest that was just loaded. */
	function seedRowState() {
		notStored = manifest.outputs.map((o) => outputStorage(o) === 'not_stored');
		defaultErrors = manifest.params.map(() => '');
		touched = {};
		runState = 'idle';
		runLint = [];
		builderSeed++;
		versionSeed++;
	}

	async function selectVersion(versionId: string) {
		if (!detail) return;
		validation = null;
		validationRuns = {};
		lintFindings = [];
		try {
			const v = await getToolVersion(detail.id, versionId);
			selectedVersion = v;
			scriptText = v.script;
			entryFunction = v.entry_function;
			manifest = fromManifest(v.manifest);
			testCases = parseTestCases(v.test_cases);
			note = '';
			// A folded section that already holds something is opened, so nothing loaded is hidden.
			showAux = manifest.constants.length > 0 || manifest.curves.length > 0;
			seedRowState();
		} catch (e) {
			toastStore.error(apiMessage(e));
		}
	}

	// Live inspection. The runner parses the script and never evaluates it, so inspecting on every
	// keystroke is safe; the debounce is about call volume, not risk.
	$effect(() => {
		const script = scriptText;
		const entry = entryFunction.trim() || 'tool';
		const wire = toWireManifest($state.snapshot(manifest) as BuilderManifest);
		if (!script.trim()) {
			inspection = null;
			inspectError = '';
			return;
		}
		const timer = setTimeout(() => void runInspect(script, entry, wire), 400);
		return () => clearTimeout(timer);
	});

	async function runInspect(script: string, entry: string, wire: ToolManifest) {
		const seq = ++inspectSeq;
		inspecting = true;
		try {
			const res = await inspectToolScript({ script, entry_function: entry, manifest: wire });
			if (seq !== inspectSeq) return;
			inspection = res;
			inspectError = '';
			reconciliationSkipped = false;
		} catch {
			// A manifest under construction is refused by the server; the script still has symbols
			// worth showing, so retry without it and say the comparison is paused.
			try {
				const res = await inspectToolScript({ script, entry_function: entry });
				if (seq !== inspectSeq) return;
				inspection = res;
				inspectError = '';
				reconciliationSkipped = true;
			} catch (e2) {
				if (seq === inspectSeq) inspectError = apiMessage(e2);
			}
		} finally {
			if (seq === inspectSeq) inspecting = false;
		}
	}

	/**
	 * A detected `{base}_rep_{letter}` whose family is already declared joins that family, in the
	 * family's position and with its kind and units, rather than landing as a stray row at the end.
	 */
	function addParam(name: string, kind: string) {
		const split = splitRepName(name);
		const family = split
			? replicateFamilies(manifest.params).families.find((f) => f.base === split.base)
			: undefined;
		if (split && family) {
			const first = family.members[0].param;
			const at = insertionIndex(manifest.params, family.base, split.letter);
			manifest.params = insertAt(manifest.params, at, {
				...first,
				name,
				label: repLabel(family.label, split.letter, first.label),
			});
			defaultErrors = insertAt(defaultErrors, at, '');
		} else {
			manifest.params = [...manifest.params, blankParam(name, kind)];
			defaultErrors = [...defaultErrors, ''];
		}
		builderSeed++;
	}

	function addOutput(key: string, perReplicate = false) {
		manifest.outputs = [...manifest.outputs, blankOutput(key, perReplicate)];
		notStored = [...notStored, false];
	}

	function addConstant(name: string) {
		manifest.constants = [...manifest.constants, name];
		showAux = true;
	}

	function addCurve(name: string) {
		manifest.curves = [...manifest.curves, blankCurve(name)];
		showAux = true;
	}

	function removeParam(name: string) {
		const index = manifest.params.findIndex((p) => p.name === name);
		manifest.params = manifest.params.filter((p) => p.name !== name);
		defaultErrors = defaultErrors.filter((_, i) => i !== index);
		builderSeed++;
	}

	function removeConstant(name: string) {
		manifest.constants = manifest.constants.filter((c) => c !== name);
	}

	function removeCurve(name: string) {
		manifest.curves = manifest.curves.filter((c) => c.name !== name);
	}

	function applyRawManifest(parsed: unknown) {
		manifest = fromManifest(parsed);
		// Every row editor keeps buffers keyed by row index, and a raw edit can replace any of them.
		seedRowState();
	}

	function applyRawTestCases(parsed: unknown) {
		testCases = parseTestCases(parsed);
	}

	const hasTestCases = $derived((testCases.cases ?? []).length > 0);
	/** Marked in the editor gutter, the way a syntax error is marked in an IDE. */
	const parseErrorLine = $derived(inspection?.parse_error?.line ?? null);

	// What the preview, the draft run and every case run are driven by: the manifest as it stands
	// in the builder, in the shape the form renderer and the API both read.
	const wireManifest = $derived(toWireManifest(manifest));
	const previewSpec = $derived<ToolFormSpec>({
		name: detail?.name ?? 'draft',
		params: manifest.params,
		curves: manifest.curves,
	});

	function addTestCase(testCase: ToolTestCase) {
		testCases = { ...testCases, cases: [...(testCases.cases ?? []), testCase] };
		showTesting = true;
		toastStore.success('Saved as a test case');
	}

	// One model, read by the save gate, by every section header and by every marked field.
	const catalogById = $derived(new Map(parameterCatalog.map((p) => [p.id, p])));
	const catalogByCode = $derived(new Map(parameterCatalog.map((p) => [p.code.toLowerCase(), p])));
	const findings = $derived(
		validate({
			script: scriptText,
			inspection,
			lint: [...lintFindings, ...runLint],
			manifest,
			notStored,
			defaultErrors,
			catalogById,
			catalogByCode,
			caseCount: (testCases.cases ?? []).length,
		}),
	);
	const marks = $derived(fieldMarks(findings, touched));
	const blocking = $derived(findings.filter((f) => f.severity === 'blocking'));
	const advisory = $derived(findings.filter((f) => f.severity === 'advisory'));

	const counts = (...sections: SectionId[]): SectionCount => countSection(findings, ...sections);

	function goToFinding(f: Finding) {
		if (!f.target) return;
		touch(f.target);
		if (f.section === 'aux') showAux = true;
		if (f.section === 'cases') showTesting = true;
		focusTarget(f.target);
	}

	async function saveNewVersion() {
		if (!detail || blocking.length > 0) return;
		savingVersion = true;
		lintFindings = [];
		try {
			const res = await createToolVersion(detail.id, {
				script: scriptText,
				entry_function: entryFunction.trim() || 'tool',
				manifest: toWireManifest(manifest),
				...(hasTestCases ? { test_cases: testCases } : {}),
				...(note.trim() ? { note: note.trim() } : {}),
			});
			toastStore.success(`Saved version ${res.version.version_no}`);
			await selectScript(detail.id);
			await refreshList();
		} catch (e) {
			const found = toolLintFindings(e);
			if (found) lintFindings = found;
			else toastStore.error(apiMessage(e));
		} finally {
			savingVersion = false;
		}
	}

	async function runValidate(v: ToolVersionSummary) {
		if (!detail) return;
		validatingId = v.id;
		validation = null;
		validationRuns = {};
		showTesting = true;
		try {
			// Assigned after the reload: selecting a script clears the last result, so a result
			// assigned before it would be thrown away by its own refresh.
			const result = await validateToolVersion(detail.id, v.id);
			await selectScript(detail.id);
			if (selectedVersion?.id !== v.id) await selectVersion(v.id);
			validation = result;
			await replayValidationCases();
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			validatingId = null;
		}
	}

	/**
	 * The validate response carries pass or fail and the mismatching keys of a failing case, so a
	 * passing case's values are not in it. Replaying each case against the runner recovers them for
	 * the record; the verdict shown stays the server's.
	 */
	async function replayValidationCases() {
		const cases = testCases.cases ?? [];
		if (cases.length === 0 || !scriptText.trim()) return;
		validationReplaying = true;
		try {
			const next: Record<string, CaseRun> = {};
			for (const [i, testCase] of cases.entries()) {
				next[testCase.name || `Case ${i + 1}`] = await runTestCase({
					script: scriptText,
					entryFunction,
					manifest: wireManifest,
					testCase,
					tolerance: testCases.tolerance ?? DEFAULT_TOLERANCE,
				});
			}
			validationRuns = next;
		} finally {
			validationReplaying = false;
		}
	}

	function isRollback(v: ToolVersionSummary): boolean {
		return detail?.active_version_no != null && v.version_no < detail.active_version_no;
	}

	async function doActivate() {
		if (!detail || !confirmActivate) return;
		activating = true;
		try {
			await activateToolVersion(detail.id, confirmActivate.id);
			toastStore.success(`Version ${confirmActivate.version_no} is now active for ${detail.name}`);
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

{#snippet countChips(c: SectionCount)}
	{#if c.blocking > 0}
		<Badge variant="alarm">{c.blocking} to fix</Badge>
	{/if}
	{#if c.advisory > 0}
		<Badge variant="warning">{c.advisory} to check</Badge>
	{/if}
{/snippet}

{#if me.status === 'ready' && !me.can('admin')}
	<p class="text-sm text-brand-muted">Tool script authoring requires the Administrator role.</p>
{:else}
	<div class="space-y-3">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 class="text-xl font-semibold">Manage Tools</h2>
			<a href="{base}/tools" class="text-sm text-brand-primary hover:underline">Tools</a>
		</div>

		{#if loadError}
			<ErrorNotice message={loadError} />
		{:else if loading}
			<p class="text-sm text-brand-muted">Loading…</p>
		{:else}
			<div class="flex items-center gap-2">
				<ToolScriptSelect {scripts} selectedId={detail?.id ?? null} onSelect={selectScript} />
				<Button variant="primary" size="sm" onclick={() => (showNewScript = true)}>New script</Button>
			</div>
			{#if scripts.length === 0}
				<p class="text-sm text-brand-muted">No tool scripts.</p>
			{/if}

			{#if detail}
				<div class="space-y-3 min-w-0">
					<!-- Kept in view: a version is saved from wherever the author is on the page -->
					<div class="sticky top-0 z-20 rounded-md border border-brand-divider bg-brand-surface p-3 space-y-2">
						<div class="flex flex-wrap items-end gap-3">
							<div class="min-w-0">
								<div class="flex items-baseline gap-2">
									<h3 class="text-base font-semibold">{detail.name}</h3>
									{#if detail.active_version_no != null}
										<span class="text-xs text-brand-muted">Active version {detail.active_version_no}</span>
									{/if}
								</div>
								<p class="text-xs text-brand-muted">
									{#if selectedVersion}
										Editing from version {selectedVersion.version_no}
									{:else}
										No version loaded yet
									{/if}
								</p>
							</div>
							<div class="flex flex-col gap-1 grow min-w-48">
								<label for="tm-note" class="text-xs font-medium">Note</label>
								<input
									id="tm-note"
									type="text"
									bind:value={note}
									placeholder="What changed in this version"
									class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
								/>
							</div>
							<Button
								variant="primary"
								onclick={saveNewVersion}
								disabled={savingVersion || blocking.length > 0}
							>{savingVersion ? 'Saving…' : 'Save as new version'}</Button>
						</div>

						{#if blocking.length > 0 || advisory.length > 0}
							<div class="flex flex-wrap gap-x-4 gap-y-1">
								{#if blocking.length > 0}
									<div class="min-w-0">
										<p class="text-xs font-medium text-severity-alarm">
											{blocking.length} to fix before saving
										</p>
										<ul class="text-xs">
											{#each blocking.slice(0, 6) as f}
												<li>
													<button
														type="button"
														title={f.message}
														class="block max-w-3xl truncate text-left bg-transparent border-none p-0 cursor-pointer text-severity-alarm hover:underline"
														onclick={() => goToFinding(f)}>{f.message}</button
													>
												</li>
											{/each}
											{#if blocking.length > 6}
												<li class="text-brand-muted">And {blocking.length - 6} more.</li>
											{/if}
										</ul>
									</div>
								{/if}
								{#if advisory.length > 0}
									<div class="min-w-0">
										<p class="text-xs font-medium text-severity-warning-text">
											{advisory.length} to check
										</p>
										<ul class="text-xs">
											{#each advisory.slice(0, 4) as f}
												<li>
													<button
														type="button"
														title={f.message}
														class="block max-w-lg truncate text-left bg-transparent border-none p-0 cursor-pointer hover:underline"
														onclick={() => goToFinding(f)}>{f.message}</button
													>
												</li>
											{/each}
											{#if advisory.length > 4}
												<li class="text-brand-muted">And {advisory.length - 4} more.</li>
											{/if}
										</ul>
									</div>
								{/if}
							</div>
						{/if}
					</div>

					<!-- The R source at full width: these wrappers carry long calls, and a half-width
					     editor wraps almost every line -->
					<div class="rounded-md border border-brand-divider bg-brand-surface p-3 space-y-2">
						<div class="flex flex-wrap items-center gap-2">
							<h4 class="text-sm font-semibold">Source</h4>
							{@render countChips(counts('script'))}
							<span class="text-xs text-brand-muted">
								{#if scriptStructure.preludeEnd != null}
									{scriptStructure.preludeLines} shared lines, {scriptStructure.authoredLines} authored
								{:else}
									{scriptStructure.totalLines} lines, no shared prelude
								{/if}
								{#if scriptStructure.entryLine != null}
									· {entryFunction || 'tool'}() on line {scriptStructure.entryLine}
								{:else}
									· defines no {entryFunction || 'tool'}()
								{/if}
							</span>
							<span class="grow"></span>
							{#if inspection?.parse_error}
								<span class="text-xs text-severity-alarm font-mono truncate max-w-full">
									{#if inspection.parse_error.line != null}Line {inspection.parse_error.line}: {/if}
									{inspection.parse_error.message}
								</span>
							{/if}
						</div>
						<div id={SCRIPT_FIELD} class="h-[46vh] min-h-72">
							<RScriptEditor
								bind:value={scriptText}
								errorLine={parseErrorLine}
								entryFunction={entryFunction || 'tool'}
							/>
						</div>
					</div>

					<!-- What the script declares, beside what the script was read to contain -->
					<div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_20rem] gap-3 items-start">
						<div class="space-y-3 min-w-0">
							<div class="rounded-md border border-brand-divider bg-brand-surface">
								<div class="flex flex-wrap items-end gap-3 px-3 py-2 border-b border-brand-divider">
									<div class="flex flex-col gap-1 grow min-w-40">
										<label for={LABEL_FIELD} class="text-xs font-medium">Label</label>
										<input
											id={LABEL_FIELD}
											type="text"
											bind:value={manifest.label}
											onblur={() => touch(LABEL_FIELD)}
											class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs {markClass(
												marks[LABEL_FIELD],
											)}"
										/>
									</div>
									<div class="flex flex-col gap-1 grow min-w-40">
										<label for="tm-mdesc" class="text-xs font-medium">Description</label>
										<input
											id="tm-mdesc"
											type="text"
											bind:value={manifest.description}
											class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs"
										/>
									</div>
									{@render countChips(counts('declaration'))}
								</div>

								<div class="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-brand-divider">
									<h5 class="text-sm font-semibold">Params</h5>
									<span class="text-xs text-brand-muted">({manifest.params.length})</span>
									{@render countChips(counts('params'))}
								</div>
								{#key builderSeed}
									<ManifestParamsEditor
										bind:params={manifest.params}
										bind:defaultErrors
										{marks}
										onTouch={touch}
									/>
								{/key}

								<div class="flex flex-wrap items-center gap-2 px-3 py-2 border-y border-brand-divider">
									<h5 class="text-sm font-semibold">Outputs</h5>
									<span class="text-xs text-brand-muted">({manifest.outputs.length})</span>
									{@render countChips(counts('outputs'))}
								</div>
								<ManifestOutputsEditor
									bind:outputs={manifest.outputs}
									bind:notStored
									catalog={parameterCatalog}
									{marks}
									onTouch={touch}
									onCatalogChanged={noteCatalogParameter}
								/>
							</div>

							<details bind:open={showAux} class="rounded-md border border-brand-divider bg-brand-surface">
								<summary class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm font-medium cursor-pointer">
									Curve slots and constants
									<span class="font-normal text-xs text-brand-muted">
										({manifest.curves.length}, {manifest.constants.length})
									</span>
									{@render countChips(counts('aux'))}
								</summary>
								<div class="p-3 space-y-3">
									<ManifestCurvesEditor bind:curves={manifest.curves} />
									<ManifestConstantsEditor bind:constants={manifest.constants} catalog={constantsCatalog} />
								</div>
							</details>
						</div>

						<div class="space-y-3 min-w-0">
							<div>
								<div class="flex flex-wrap items-center gap-2 pb-1">
									{@render countChips(counts('detection'))}
								</div>
								<ScriptDetectionPanel
									{inspection}
									{inspecting}
									error={inspectError}
									{reconciliationSkipped}
									declaredOutputKeys={manifest.outputs.map((o) => o.key)}
									onAddParam={addParam}
									onAddOutput={addOutput}
									onAddConstant={addConstant}
									onAddCurve={addCurve}
									onRemoveParam={removeParam}
									onRemoveConstant={removeConstant}
									onRemoveCurve={removeCurve}
								/>
							</div>

							<!-- Version history one click away: picking a version is how the editor is seeded -->
							<details bind:open={showVersions} class="rounded-md border border-brand-divider bg-brand-surface">
								<summary class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm font-medium cursor-pointer">
									Versions
									<span class="font-normal text-xs text-brand-muted">({detail.versions.length})</span>
									{#if detail.active_version_no == null}
										<Badge variant="warning">none active</Badge>
									{/if}
								</summary>
								{#if detail.versions.length === 0}
									<p class="px-3 py-3 text-sm text-brand-muted">None yet.</p>
								{:else}
									<ul class="divide-y divide-brand-divider">
										{#each detail.versions as v (v.id)}
											<li class="px-3 py-2 space-y-1 {selectedVersion?.id === v.id ? 'bg-brand-primary/5' : ''}">
												<div class="flex flex-wrap items-center gap-1.5">
													<button
														onclick={() => selectVersion(v.id)}
														class="text-brand-primary bg-transparent border-none p-0 cursor-pointer hover:underline text-sm font-medium"
													>Version {v.version_no}</button>
													{#if v.active}<Badge variant="ok">active</Badge>{/if}
													{#if v.validated_at}
														<Badge variant="muted">validated</Badge>
													{:else}
														<Badge variant="warning">not validated</Badge>
													{/if}
												</div>
												<p class="text-xs text-brand-muted">
													{formatDateTime(v.created_at)}{#if v.created_by}<span> · {v.created_by}</span>{/if}
												</p>
												{#if v.note}<p class="text-xs">{v.note}</p>{/if}
												<div class="flex flex-wrap gap-1 pt-0.5">
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
												</div>
											</li>
										{/each}
									</ul>
								{/if}
							</details>
						</div>
					</div>

					<!-- The manifest as the form it produces, run as it stands -->
					<details bind:open={showPreview} class="rounded-md border border-brand-divider bg-brand-surface">
						<summary class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm font-medium cursor-pointer">
							Preview
							<span class="font-normal text-xs text-brand-muted">Values in, values out</span>
							{#if runState === 'failed'}
								<Badge variant="alarm">run failed</Badge>
							{:else if runState === 'ok'}
								<Badge variant="ok">ran</Badge>
							{/if}
						</summary>
						{#key versionSeed}
							<DraftRunPanel
								spec={previewSpec}
								script={scriptText}
								{entryFunction}
								manifest={wireManifest}
								caseCount={(testCases.cases ?? []).length}
								onSaveAsCase={addTestCase}
								onRun={() => (showPreview = true)}
								bind:runState
								bind:runLint
							/>
						{/key}
					</details>

					<!-- Stored cases: a saved version's own regression set, run after the authoring loop -->
					<details bind:open={showTesting} class="rounded-md border border-brand-divider bg-brand-surface">
						<summary class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm font-medium cursor-pointer">
							Test cases and validation
							<span class="font-normal text-xs text-brand-muted">
								({(testCases.cases ?? []).length})
							</span>
							{#if validation && !validation.passed}
								<Badge variant="alarm">validation failed</Badge>
							{:else if validation}
								<Badge variant="ok">validation passed</Badge>
							{/if}
							{@render countChips(counts('cases'))}
						</summary>
						<div class="p-3 space-y-3">
							{#if validation}
								<ValidationReport
									{validation}
									cases={testCases.cases ?? []}
									params={manifest.params}
									tolerance={testCases.tolerance ?? DEFAULT_TOLERANCE}
									toolName={detail.name}
									versionNo={selectedVersion?.version_no ?? null}
									runs={validationRuns}
									rerunning={validationReplaying}
								/>
							{/if}

							{#key versionSeed}
								<TestCasesEditor
									bind:testCases
									spec={previewSpec}
									script={scriptText}
									{entryFunction}
									manifest={wireManifest}
									outputKeys={manifest.outputs.map((o) => o.key)}
									declaredConstants={manifest.constants}
								/>
							{/key}
						</div>
					</details>

					<details bind:open={showRaw} class="rounded-md border border-brand-divider bg-brand-surface">
						<summary class="px-3 py-2 text-sm font-medium cursor-pointer">
							Raw JSON (manifest and test cases)
						</summary>
						<div class="p-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
							<JsonEditor
								id="tm-manifest"
								label="Manifest"
								value={toWireManifest(manifest)}
								onapply={applyRawManifest}
							/>
							<JsonEditor
								id="tm-cases"
								label="Test cases"
								value={testCases}
								onapply={applyRawTestCases}
							/>
						</div>
					</details>

					<details bind:open={showMeta} class="rounded-md border border-brand-divider bg-brand-surface">
						<summary class="px-3 py-2 text-sm font-medium cursor-pointer">
							Tool label and description
						</summary>
						<div class="p-3 space-y-3">
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
					</details>

					<details bind:open={showActivations} class="rounded-md border border-brand-divider bg-brand-surface">
						<summary class="px-3 py-2 text-sm font-medium cursor-pointer">
							Activation history
							<span class="font-normal text-xs text-brand-muted">({activations.length})</span>
						</summary>
						<div class="p-3">
							{#if activations.length === 0}
								<p class="text-sm text-brand-muted">None recorded.</p>
							{:else}
								<div class="space-y-1">
									{#each activations as a}
										<div class="text-xs text-brand-muted">
											{formatDateTime(a.activated_at)}: version
											{#if a.from_version_no != null}{a.from_version_no} →{/if}
											<span class="font-medium text-brand-text">{a.to_version_no}</span>
											{#if a.activated_by}<span> by {a.activated_by}</span>{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</details>
				</div>
			{:else}
				<div class="rounded-md border border-brand-divider bg-brand-surface p-6 text-sm text-brand-muted">
					Select a tool script to author its script, manifest and test cases.
				</div>
			{/if}
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
