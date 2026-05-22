<script lang="ts">
	import '../app.css';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '$auth/keycloak.svelte';
	import { onMount } from 'svelte';
	import ToastContainer from '$components/ui/ToastContainer.svelte';
	import SearchBar from '$components/SearchBar.svelte';
	import AlarmPanel from '$components/AlarmPanel.svelte';

	let { children } = $props();
	let sidebarCollapsed = $state(false);
	let alarmPanelOpen = $state(false);

	onMount(() => {
		auth.init();
	});

	const navSections = [
		{
			label: 'Monitor',
			items: [
				{ href: `${base}/sites`, label: 'Sites', icon: 'pin' },
				{ href: `${base}/sensors`, label: 'Sensors', icon: 'cpu' },
				{ href: `${base}/sensor-deployments`, label: 'Deployments', icon: 'pin' },
				{ href: `${base}/sensor-calibrations`, label: 'Calibrations', icon: 'cpu' },
				{ href: `${base}/streams`, label: 'Streams', icon: 'rss' },
			],
		},
		{
			label: 'Field Work',
			items: [
				{ href: `${base}/grab-samples`, label: 'Grab Samples', icon: 'flask' },
				{ href: `${base}/upload`, label: 'Upload', icon: 'upload' },
			],
		},
		{
			label: 'Analyze',
			items: [
				{ href: `${base}/compare`, label: 'Compare Sites', icon: 'arrows-lr' },
				{ href: `${base}/tools`, label: 'Tools', icon: 'wrench' },
			],
		},
		{
			label: 'Configure',
			items: [
				{ href: `${base}/parameters`, label: 'Parameters', icon: 'sliders' },
				{ href: `${base}/derived`, label: 'Derived', icon: 'function' },
				{ href: `${base}/standard-curves`, label: 'Standard Curves', icon: 'chart' },
				{ href: `${base}/alarm-thresholds`, label: 'Alarm Thresholds', icon: 'bell' },
				{ href: `${base}/constants`, label: 'Constants', icon: 'hash' },
				{ href: `${base}/projects`, label: 'Projects', icon: 'folder' },
				{ href: `${base}/users`, label: 'Users', icon: 'users' },
				{ href: `${base}/jobs`, label: 'Jobs', icon: 'clock' },
				{ href: `${base}/system`, label: 'System', icon: 'settings' },
			],
		},
	];

	function isActive(href: string): boolean {
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	}
</script>

{#if auth.state.status === 'loading'}
	<div class="flex h-screen items-center justify-center flex-col text-brand-muted">
		<p class="text-lg">Loading River Data Admin...</p>
		<p class="text-sm mt-2">Initializing...</p>
	</div>
{:else if auth.state.status === 'error'}
	<div class="flex h-screen items-center justify-center flex-col text-center px-5">
		<p class="text-lg text-severity-alarm">Authentication Error</p>
		<p class="text-sm mt-2 text-brand-muted max-w-[400px]">{auth.state.message}</p>
		<button
			onclick={() => window.location.reload()}
			class="mt-5 px-5 py-2.5 bg-brand-primary text-white rounded-md cursor-pointer border-none"
		>
			Retry
		</button>
	</div>
{:else}
	<div class="flex h-screen overflow-hidden">
		<!-- Sidebar -->
		<nav
			class="flex flex-col bg-brand-surface border-r border-brand-divider overflow-y-auto shrink-0 transition-[width] duration-200"
			style:width={sidebarCollapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)'}
		>
			<!-- Logo / title -->
			<div class="flex items-center h-12 px-4 border-b border-brand-divider shrink-0">
				{#if !sidebarCollapsed}
					<a href={base} class="font-semibold text-brand-primary no-underline text-[0.95rem]">
						River Data
					</a>
				{/if}
				<button
					onclick={() => (sidebarCollapsed = !sidebarCollapsed)}
					class="ml-auto p-1 text-brand-muted hover:text-brand-text cursor-pointer bg-transparent border-none"
					title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
				>
					{sidebarCollapsed ? '▶' : '◀'}
				</button>
			</div>

			<!-- Dashboard link -->
			<a
				href={base}
				class="flex items-center gap-2 px-4 py-2 text-sm no-underline {page.url.pathname === base || page.url.pathname === base + '/'
					? 'text-brand-primary bg-brand-primary/5 font-semibold'
					: 'text-brand-text hover:bg-brand-bg'}"
			>
				{#if !sidebarCollapsed}Dashboard{/if}
			</a>

			<!-- Nav sections -->
			{#each navSections as section}
				{#if !sidebarCollapsed}
					<div class="px-4 pt-4 pb-1 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-brand-muted">
						{section.label}
					</div>
				{:else}
					<div class="h-px bg-brand-divider mx-2 my-2"></div>
				{/if}
				{#each section.items as item}
					<a
						href={item.href}
						class="flex items-center gap-2 px-4 py-1.5 text-sm no-underline transition-colors {isActive(item.href)
							? 'text-brand-primary bg-brand-primary/5 font-semibold'
							: 'text-brand-text hover:bg-brand-bg'}"
						title={sidebarCollapsed ? item.label : undefined}
					>
						{#if !sidebarCollapsed}
							{item.label}
						{/if}
					</a>
				{/each}
			{/each}
		</nav>

		<!-- Main content -->
		<div class="flex flex-col flex-1 overflow-hidden">
			<!-- Top bar -->
			<header class="flex items-center h-12 px-4 bg-brand-primary text-white shrink-0 gap-3">
				<h1 class="text-[0.95rem] font-semibold">River Data: Admin</h1>
				<div class="flex-1"></div>
				<SearchBar />
				<button
					onclick={() => alarmPanelOpen = true}
					class="relative p-1 text-white/80 hover:text-white bg-transparent border-none cursor-pointer"
					title="Alarm notifications"
				>
					&#128276;
				</button>
				{#if auth.identity}
					<span class="text-sm opacity-80">{auth.identity.fullName}</span>
				{/if}
				{#if auth.state.status === 'authenticated'}
					<button
						onclick={() => auth.logout()}
						class="text-sm text-white/80 hover:text-white bg-transparent border-none cursor-pointer"
					>
						Logout
					</button>
				{/if}
			</header>
			<AlarmPanel bind:open={alarmPanelOpen} />

			<!-- Page content -->
			<main class="flex-1 overflow-y-auto p-[var(--spacing-page-gutter)]">
				{@render children()}
			</main>
		</div>
	</div>
	<ToastContainer />
{/if}
