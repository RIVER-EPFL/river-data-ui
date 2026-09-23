/**
 * Where the retired /logs URL lands on the System page: its `tab` folded onto Jobs or Logs, and
 * every other parameter (a token or service filter, a job id) carried as it came.
 */
export function logsRedirectTarget(params: URLSearchParams): string {
	const target = new URLSearchParams({ tab: params.get('tab') === 'jobs' ? 'jobs' : 'logs' });
	for (const [key, value] of params) if (key !== 'tab') target.append(key, value);
	return `/system?${target}`;
}
