export type AuthStatus = 'loading' | 'no-auth' | 'anonymous' | 'authenticated' | 'error';
export type ShellBranch = 'loading' | 'error' | 'landing' | 'unauthorized' | 'app';

// Which full-screen branch the root layout renders for an auth state and resolved role.
export function shellBranch(status: AuthStatus, role: string | false): ShellBranch {
	if (status === 'loading') return 'loading';
	if (status === 'error') return 'error';
	if (status === 'anonymous') return 'landing';
	if (role === false) return 'unauthorized';
	return 'app';
}
