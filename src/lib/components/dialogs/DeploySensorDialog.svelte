<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type Sensor } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	let {
		open = $bindable(false),
		siteId,
		siteName,
		onsuccess,
	}: {
		open: boolean;
		siteId: string;
		siteName: string;
		onsuccess?: () => void;
	} = $props();

	let sensors = $state<Sensor[]>([]);
	let selectedSensorId = $state('');
	let deployedFrom = $state(new Date().toISOString().slice(0, 16));
	let deploying = $state(false);

	onMount(async () => {
		const result = await api.sensors.list({ perPage: 200, filter: { is_active: true } });
		sensors = result.data;
	});

	async function handleDeploy() {
		if (!selectedSensorId || !deployedFrom) return;
		deploying = true;
		try {
			await api.sensorDeployments.create({
				sensor_id: selectedSensorId,
				site_id: siteId,
				deployed_from: new Date(deployedFrom).toISOString(),
			});
			toastStore.success('Sensor deployed');
			open = false;
			onsuccess?.();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Deploy failed');
		} finally { deploying = false; }
	}
</script>

<Dialog bind:open title="Deploy Sensor to {siteName}" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<div class="flex flex-col gap-1">
				<label for="sensor" class="text-sm font-medium">Sensor</label>
				<select id="sensor" bind:value={selectedSensorId} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
					<option value="">— Select sensor —</option>
					{#each sensors as s}
						<option value={s.id}>{s.serial_number ?? s.name ?? s.id}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-col gap-1">
				<label for="from" class="text-sm font-medium">Deployed From</label>
				<input id="from" type="datetime-local" bind:value={deployedFrom} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
			</div>
		</div>
	{/snippet}
	{#snippet actions()}
		<button onclick={() => open = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Cancel</button>
		<button onclick={handleDeploy} disabled={deploying || !selectedSensorId} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none disabled:opacity-50">{deploying ? 'Deploying...' : 'Deploy'}</button>
	{/snippet}
</Dialog>
