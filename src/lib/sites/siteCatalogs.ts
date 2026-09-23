import {
	api,
	type AlarmThreshold,
	type ParameterGroup,
	type ParameterGroupMember,
	type SensorDeployment,
	type SiteParameter,
} from '$api/crud';
import { listAll } from '$api/paged';

/** Every slot of the site, the page's load and each reload alike. */
export function siteSlots(siteId: string): Promise<SiteParameter[]> {
	return listAll(api.siteParameters, { filter: { site_id: siteId } });
}

/** Every deployment at the site, open and closed. */
export function siteDeployments(siteId: string): Promise<SensorDeployment[]> {
	return listAll(api.sensorDeployments, { filter: { site_id: siteId } });
}

/** Every threshold row, the parameter's own and each site's override, for the editor's lookups. */
export function allThresholds(): Promise<AlarmThreshold[]> {
	return listAll(api.alarmThresholds);
}

/** Every parameter group, in ordinal order, for the apply-group picker. */
export function allParameterGroups(): Promise<ParameterGroup[]> {
	return listAll(api.parameterGroups, { sort: ['ordinal', 'ASC'] });
}

/** Every group membership, or with `groupId` every member of that group. */
export function parameterGroupMembers(groupId?: string): Promise<ParameterGroupMember[]> {
	return listAll(api.parameterGroupMembers, groupId ? { filter: { group_id: groupId } } : {});
}
