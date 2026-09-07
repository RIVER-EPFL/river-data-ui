<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, type Parameter, type ParameterGroup, type ParameterGroupMember } from '$api/crud';
	import { getGroupDefinition, type GroupDefinitionMember } from '$api/service';
	import { assignmentError, roleLabel, MEMBER_ROLES } from '$lib/parameters/groups';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Breadcrumbs from '$components/ui/Breadcrumbs.svelte';
	import Button from '$components/ui/Button.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	const groupId = page.params.id!;

	let group = $state<ParameterGroup | null>(null);
	let groups = $state<ParameterGroup[]>([]);
	let columns = $state<GroupDefinitionMember[]>([]);
	let members = $state<ParameterGroupMember[]>([]);
	let parameters = $state<Parameter[]>([]);
	let loading = $state(true);
	let error = $state('');
	let assignError = $state('');
	let busy = $state(false);

	let assignParameterId = $state('');
	let assignRole = $state<string>('measured');

	// The definition is the server's own column order; the member rows carry the ids a reorder patches.
	async function load() {
		const [g, all, definition, memberRows, catalog] = await Promise.all([
			api.parameterGroups.get(groupId),
			api.parameterGroups.list({ perPage: 200, sort: ['ordinal', 'ASC'] }),
			getGroupDefinition(groupId),
			api.parameterGroupMembers.list({ perPage: 500, filter: { group_id: groupId } }),
			api.parameters.list({ perPage: 1000, sort: ['code', 'ASC'] }),
		]);
		group = g;
		groups = all.data;
		columns = definition.members;
		members = memberRows.data;
		parameters = catalog.data;
	}

	onMount(async () => {
		try {
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load group';
		} finally {
			loading = false;
		}
	});

	function memberOf(parameterId: string): ParameterGroupMember | undefined {
		return members.find((m) => m.parameter_id === parameterId);
	}

	const unassigned = $derived(
		parameters.filter((p) => !members.some((m) => m.parameter_id === p.id)),
	);

	async function assign() {
		if (!assignParameterId) return;
		assignError = '';
		busy = true;
		try {
			const nextOrdinal = members.reduce((max, m) => Math.max(max, m.ordinal), -1) + 1;
			await api.parameterGroupMembers.create({
				group_id: groupId,
				parameter_id: assignParameterId,
				role: assignRole,
				ordinal: nextOrdinal,
			});
			assignParameterId = '';
			await load();
		} catch (e) {
			assignError = assignmentError(e, groups);
		} finally {
			busy = false;
		}
	}

	// Reorder is the member ordinal, patched: the pair swaps the two values it already holds.
	async function move(parameterId: string, delta: number) {
		const order = columns.map((c) => memberOf(c.parameter_id)).filter((m) => m !== undefined);
		const index = order.findIndex((m) => m.parameter_id === parameterId);
		const target = index + delta;
		if (index < 0 || target < 0 || target >= order.length) return;
		busy = true;
		try {
			await api.parameterGroupMembers.update(order[index].id, { ordinal: order[target].ordinal });
			await api.parameterGroupMembers.update(order[target].id, { ordinal: order[index].ordinal });
			await load();
		} catch (e) {
			toastStore.error(assignmentError(e, groups));
		} finally {
			busy = false;
		}
	}

	async function setRole(member: ParameterGroupMember, role: string) {
		busy = true;
		try {
			await api.parameterGroupMembers.update(member.id, { role });
			await load();
		} catch (e) {
			toastStore.error(assignmentError(e, groups));
		} finally {
			busy = false;
		}
	}

	async function unassign(member: ParameterGroupMember) {
		busy = true;
		try {
			await api.parameterGroupMembers.remove(member.id);
			await load();
		} catch (e) {
			toastStore.error(assignmentError(e, groups));
		} finally {
			busy = false;
		}
	}

	async function removeGroup() {
		busy = true;
		try {
			await api.parameterGroups.remove(groupId);
			goto(`${base}/parameters?tab=groups`);
		} catch (e) {
			error = assignmentError(e, groups);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>{group?.label ?? 'Parameter group'} | RIVER Data</title></svelte:head>

{#if loading}
	<p class="text-brand-muted">Loading…</p>
{:else if error && !group}
	<ErrorNotice message={error} />
{:else if group}
	<div class="space-y-4">
		<Breadcrumbs
			items={[
				{ label: 'Parameters', href: `${base}/parameters?tab=groups` },
				{ label: group.label },
			]}
		/>

		<div class="flex items-start justify-between gap-3">
			<div>
				<h2 class="text-xl font-semibold">{group.label}</h2>
				<p class="text-sm text-brand-muted">
					{group.code} · order {group.ordinal}{group.description ? ` · ${group.description}` : ''}
				</p>
			</div>
			<ConfirmPopover
				message="Delete this group? A group with members is refused; move them out first."
				confirmLabel="Delete"
				onconfirm={removeGroup}
			>
				<Button variant="danger" size="sm" disabled={busy}>Delete group</Button>
			</ConfirmPopover>
		</div>

		{#if error}<ErrorNotice message={error} />{/if}

		<div class="border border-brand-divider rounded-md overflow-hidden">
			<table class="w-full text-sm">
				<thead class="bg-brand-bg text-brand-muted">
					<tr>
						<th class="text-left px-3 py-2 font-medium">Order</th>
						<th class="text-left px-3 py-2 font-medium">Parameter</th>
						<th class="text-left px-3 py-2 font-medium">Units</th>
						<th class="text-left px-3 py-2 font-medium">Role</th>
						<th class="text-right px-3 py-2 font-medium">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each columns as column, index (column.parameter_id)}
						{@const member = memberOf(column.parameter_id)}
						<tr class="border-t border-brand-divider">
							<td class="px-3 py-2 text-brand-muted">{index + 1}</td>
							<td class="px-3 py-2">
								<a href="{base}/parameters/{column.parameter_id}" class="no-underline text-brand-text hover:text-brand-primary">{column.label}</a>
								<span class="text-brand-muted"> · {column.code}</span>
								{#if column.statistics}<Badge variant="accent">replicated</Badge>{/if}
							</td>
							<td class="px-3 py-2 text-brand-muted">{column.units ?? '—'}</td>
							<td class="px-3 py-2">
								{#if member}
									<select
										class="border border-brand-divider rounded px-2 py-1 bg-brand-surface"
										value={member.role}
										disabled={busy}
										onchange={(e) => setRole(member, e.currentTarget.value)}
									>
										{#each MEMBER_ROLES as role}
											<option value={role}>{roleLabel(role)}</option>
										{/each}
									</select>
								{:else}
									{roleLabel(column.role)}
								{/if}
							</td>
							<td class="px-3 py-2 text-right whitespace-nowrap">
								<Button size="sm" variant="ghost" disabled={busy || index === 0} onclick={() => move(column.parameter_id, -1)}>Up</Button>
								<Button size="sm" variant="ghost" disabled={busy || index === columns.length - 1} onclick={() => move(column.parameter_id, 1)}>Down</Button>
								{#if member}
									<ConfirmPopover
										message="Remove {column.code} from this group?"
										confirmLabel="Remove"
										onconfirm={() => unassign(member)}
									>
										<Button size="sm" variant="ghost" disabled={busy}>Remove</Button>
									</ConfirmPopover>
								{/if}
							</td>
						</tr>
					{:else}
						<tr><td colspan="5" class="px-3 py-4 text-brand-muted">No parameters in this group yet.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="border border-brand-divider rounded-md p-3 space-y-2">
			<h3 class="font-semibold text-sm">Assign a parameter</h3>
			<div class="flex flex-wrap items-end gap-2">
				<label class="text-sm">
					<span class="block text-brand-muted mb-1">Parameter</span>
					<select bind:value={assignParameterId} class="border border-brand-divider rounded px-2 py-1 bg-brand-surface min-w-64">
						<option value="">Select a parameter…</option>
						{#each unassigned as parameter}
							<option value={parameter.id}>{parameter.name} ({parameter.code})</option>
						{/each}
					</select>
				</label>
				<label class="text-sm">
					<span class="block text-brand-muted mb-1">Role</span>
					<select bind:value={assignRole} class="border border-brand-divider rounded px-2 py-1 bg-brand-surface">
						{#each MEMBER_ROLES as role}
							<option value={role}>{roleLabel(role)}</option>
						{/each}
					</select>
				</label>
				<Button variant="primary" loading={busy} disabled={!assignParameterId} onclick={assign}>Assign</Button>
			</div>
			<p class="text-xs text-brand-muted">A parameter belongs to one group; assigning one that is already grouped is refused, naming the group that holds it.</p>
			{#if assignError}<ErrorNotice message={assignError} />{/if}
		</div>
	</div>
{/if}
