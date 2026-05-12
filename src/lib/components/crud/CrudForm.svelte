<script lang="ts">
	import { goto } from '$app/navigation';
	import { toastStore } from '$lib/stores/toast.svelte';
	import type { CrudClient } from '$api/crud';

	export interface Field {
		key: string;
		label: string;
		type?: 'text' | 'number' | 'textarea' | 'select' | 'boolean' | 'datetime' | 'email' | 'password';
		required?: boolean;
		placeholder?: string;
		helperText?: string;
		options?: Array<{ value: string; label: string }>;
		defaultValue?: unknown;
		disabled?: boolean;
		step?: string;
	}

	let {
		client,
		fields,
		entityId = undefined,
		title,
		backHref,
		onSuccess,
	}: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		client: CrudClient<any>;
		fields: Field[];
		entityId?: string;
		title: string;
		backHref: string;
		onSuccess?: (data: Record<string, unknown>) => void;
	} = $props();

	let values = $state<Record<string, unknown>>({});
	let loading = $state(!!entityId);
	let saving = $state(false);
	let errors = $state<Record<string, string>>({});

	// Initialize defaults
	for (const f of fields) {
		if (f.defaultValue !== undefined) values[f.key] = f.defaultValue;
		else if (f.type === 'boolean') values[f.key] = false;
		else if (f.type === 'number') values[f.key] = null;
		else values[f.key] = '';
	}

	// Load existing entity for edit mode
	if (entityId) {
		client.get(entityId).then((data) => {
			for (const f of fields) {
				if (data[f.key] !== undefined) values[f.key] = data[f.key];
			}
			loading = false;
		}).catch((e) => {
			toastStore.error(`Failed to load: ${e.message}`);
			loading = false;
		});
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errors = {};

		for (const f of fields) {
			if (f.required && (values[f.key] === '' || values[f.key] == null)) {
				errors[f.key] = `${f.label} is required`;
			}
		}
		if (Object.keys(errors).length > 0) return;

		saving = true;
		try {
			const payload: Record<string, unknown> = {};
			for (const f of fields) {
				if (!f.disabled) {
					let v = values[f.key];
					if (f.type === 'number' && v !== null && v !== '') v = Number(v);
					if (v === '') v = null;
					payload[f.key] = v;
				}
			}

			let result: Record<string, unknown>;
			if (entityId) {
				result = await client.update(entityId, payload);
				toastStore.success('Updated successfully');
			} else {
				result = await client.create(payload);
				toastStore.success('Created successfully');
			}

			if (onSuccess) {
				onSuccess(result);
			} else {
				goto(backHref);
			}
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Save failed';
			toastStore.error(msg);
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-4 max-w-2xl">
	<div class="flex items-center gap-2 text-sm text-brand-muted">
		<a href={backHref} class="hover:text-brand-primary no-underline">&larr; Back</a>
	</div>
	<h2 class="text-xl font-semibold">{title}</h2>

	{#if loading}
		<p class="text-brand-muted">Loading...</p>
	{:else}
		<form onsubmit={handleSubmit} class="space-y-4">
			{#each fields as field}
				<div class="flex flex-col gap-1">
					<label for={field.key} class="text-sm font-medium">
						{field.label}
						{#if field.required}<span class="text-severity-alarm">*</span>{/if}
					</label>

					{#if field.type === 'textarea'}
						<textarea
							id={field.key}
							bind:value={values[field.key]}
							placeholder={field.placeholder}
							disabled={field.disabled}
							rows="3"
							class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30 disabled:opacity-50"
						></textarea>
					{:else if field.type === 'select'}
						<select
							id={field.key}
							bind:value={values[field.key]}
							disabled={field.disabled}
							class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
						>
							<option value="">— Select —</option>
							{#each field.options ?? [] as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					{:else if field.type === 'boolean'}
						<label class="flex items-center gap-2 cursor-pointer">
							<input
								type="checkbox"
								checked={!!values[field.key]}
								onchange={(e) => values[field.key] = (e.target as HTMLInputElement).checked}
								disabled={field.disabled}
								class="w-4 h-4"
							/>
							<span class="text-sm">{field.helperText ?? ''}</span>
						</label>
					{:else}
						<input
							id={field.key}
							type={field.type ?? 'text'}
							bind:value={values[field.key]}
							placeholder={field.placeholder}
							disabled={field.disabled}
							step={field.step}
							class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30 disabled:opacity-50"
						/>
					{/if}

					{#if field.helperText && field.type !== 'boolean'}
						<span class="text-xs text-brand-muted">{field.helperText}</span>
					{/if}
					{#if errors[field.key]}
						<span class="text-xs text-severity-alarm">{errors[field.key]}</span>
					{/if}
				</div>
			{/each}

			<div class="flex gap-2 pt-2">
				<button
					type="submit"
					disabled={saving}
					class="px-4 py-1.5 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none hover:bg-brand-primary-dark disabled:opacity-50"
				>
					{saving ? 'Saving...' : entityId ? 'Save' : 'Create'}
				</button>
				<a href={backHref} class="px-4 py-1.5 border border-brand-divider rounded-md text-sm no-underline text-brand-text hover:bg-brand-bg">
					Cancel
				</a>
			</div>
		</form>
	{/if}
</div>
