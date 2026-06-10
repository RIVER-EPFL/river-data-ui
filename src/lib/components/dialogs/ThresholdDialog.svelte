<script lang="ts">
	import { api, type AlarmThreshold } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	let {
		open = $bindable(false),
		siteId,
		parameterId,
		parameterName,
		existing,
		parameterOptions = [],
		siteOptions = [],
		onsuccess,
	}: {
		open: boolean;
		siteId: string | null;
		parameterId?: string;
		parameterName?: string;
		existing?: AlarmThreshold | null;
		/** Parameter picker options, used only in create mode when no `parameterId` is given. */
		parameterOptions?: Array<{ value: string; label: string }>;
		/** Site picker options, used only in create mode when no `parameterId` is given. */
		siteOptions?: Array<{ value: string; label: string }>;
		onsuccess?: () => void;
	} = $props();

	// Create mode with pickers: no existing row AND no fixed parameter.
	const showPickers = $derived(existing == null && !parameterId);

	let warningMin = $state(existing?.warning_min?.toString() ?? '');
	let warningMax = $state(existing?.warning_max?.toString() ?? '');
	let alarmMin = $state(existing?.alarm_min?.toString() ?? '');
	let alarmMax = $state(existing?.alarm_max?.toString() ?? '');
	let pickedParameterId = $state('');
	let pickedSiteId = $state('');
	let saving = $state(false);
	let deleting = $state(false);

	const isDisabled = $derived(
		existing != null
		&& existing.warning_min == null && existing.warning_max == null
		&& existing.alarm_min == null && existing.alarm_max == null
	);

	const dialogTitle = $derived(
		showPickers ? 'New threshold' : `Thresholds: ${parameterName ?? ''}`,
	);

	$effect(() => {
		// Reset all fields whenever the dialog is (re)opened, so create vs edit don't leak state.
		if (open) {
			warningMin = existing?.warning_min?.toString() ?? '';
			warningMax = existing?.warning_max?.toString() ?? '';
			alarmMin = existing?.alarm_min?.toString() ?? '';
			alarmMax = existing?.alarm_max?.toString() ?? '';
			pickedParameterId = '';
			pickedSiteId = '';
		}
	});

	function num(s: string): number | null { return s === '' ? null : Number(s); }

	// Resolved target keys: edit mode uses the existing row; otherwise the fixed props or picks.
	function resolveSiteId(): string | null {
		if (existing) return existing.site_id;
		if (showPickers) return pickedSiteId || null;
		return siteId;
	}
	function resolveParameterId(): string | null {
		if (existing) return existing.parameter_id;
		if (showPickers) return pickedParameterId || null;
		return parameterId ?? null;
	}

	async function handleSave() {
		const targetParameterId = resolveParameterId();
		if (!targetParameterId) {
			toastStore.error('Select a parameter');
			return;
		}
		saving = true;
		try {
			const payload = {
				site_id: resolveSiteId(),
				parameter_id: targetParameterId,
				warning_min: num(warningMin),
				warning_max: num(warningMax),
				alarm_min: num(alarmMin),
				alarm_max: num(alarmMax),
			};
			if (existing) {
				await api.alarmThresholds.update(existing.id, payload);
			} else {
				await api.alarmThresholds.create(payload);
			}
			toastStore.success('Thresholds saved');
			open = false;
			onsuccess?.();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Save failed');
		} finally { saving = false; }
	}

	async function handleResetToDefaults() {
		if (!existing) return;
		deleting = true;
		try {
			await api.alarmThresholds.remove(existing.id);
			toastStore.success('Reset to parameter defaults');
			open = false;
			onsuccess?.();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Reset failed');
		} finally { deleting = false; }
	}

	async function handleDisable() {
		const targetParameterId = resolveParameterId();
		if (!targetParameterId) {
			toastStore.error('Select a parameter');
			return;
		}
		saving = true;
		try {
			const payload = {
				site_id: resolveSiteId(),
				parameter_id: targetParameterId,
				warning_min: null,
				warning_max: null,
				alarm_min: null,
				alarm_max: null,
			};
			if (existing) {
				await api.alarmThresholds.update(existing.id, payload);
			} else {
				await api.alarmThresholds.create(payload);
			}
			toastStore.success('Alarms disabled for this parameter');
			open = false;
			onsuccess?.();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to disable alarms');
		} finally { saving = false; }
	}
</script>

<Dialog bind:open title={dialogTitle} maxWidth="sm">
	{#snippet children()}
		<div class="space-y-4">
			{#if showPickers}
				<div class="flex flex-col gap-1">
					<label for="thr-param" class="text-xs text-brand-muted">Parameter</label>
					<select id="thr-param" bind:value={pickedParameterId} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
						<option value="">Select a parameter…</option>
						{#each parameterOptions as opt}<option value={opt.value}>{opt.label}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1">
					<label for="thr-site" class="text-xs text-brand-muted">Site</label>
					<select id="thr-site" bind:value={pickedSiteId} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
						<option value="">Global default (all sites)</option>
						{#each siteOptions as opt}<option value={opt.value}>{opt.label}</option>{/each}
					</select>
				</div>
			{/if}
			<div>
				<div class="text-sm font-medium text-severity-warning mb-2">Warning</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-1">
						<label for="wmin" class="text-xs text-brand-muted">Min</label>
						<input id="wmin" type="number" step="any" bind:value={warningMin} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
					<div class="flex flex-col gap-1">
						<label for="wmax" class="text-xs text-brand-muted">Max</label>
						<input id="wmax" type="number" step="any" bind:value={warningMax} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
				</div>
			</div>
			<div>
				<div class="text-sm font-medium text-severity-alarm mb-2">Alarm</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-1">
						<label for="amin" class="text-xs text-brand-muted">Min</label>
						<input id="amin" type="number" step="any" bind:value={alarmMin} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
					<div class="flex flex-col gap-1">
						<label for="amax" class="text-xs text-brand-muted">Max</label>
						<input id="amax" type="number" step="any" bind:value={alarmMax} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					</div>
				</div>
			</div>
		</div>
	{/snippet}
	{#snippet actions()}
		<div class="flex items-center gap-2 w-full">
			<div class="flex items-center gap-2">
				{#if existing}
					<Button onclick={handleResetToDefaults} disabled={deleting || saving} class="text-brand-muted">{deleting ? 'Resetting…' : 'Reset to defaults'}</Button>
				{/if}
				{#if !isDisabled}
					<Button onclick={handleDisable} disabled={saving || deleting} class="border-severity-alarm-border text-severity-alarm">Disable alarms</Button>
				{/if}
			</div>
			<div class="flex-1"></div>
			<Button onclick={() => open = false}>Cancel</Button>
			<Button variant="primary" onclick={handleSave} disabled={saving || deleting}>{saving ? 'Saving…' : 'Save'}</Button>
		</div>
	{/snippet}
</Dialog>
