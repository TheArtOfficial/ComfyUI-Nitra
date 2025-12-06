import * as state from './state.js';
import { loadWorkflows, getExistingModels } from '../workflows/api.js';
import { loadModels } from '../models/api.js';
import { fetchLicenseStatus } from '../license/status.js';

let preloadPromise = null;

async function runPrefetch() {
    if (!state.isAuthenticated || !state.currentUser?.apiToken) {
        return;
    }
    await fetchLicenseStatus().catch(() => null);
    await getExistingModels().catch(() => null);
    await loadWorkflows({ backgroundRefresh: true, force: false }).catch(() => null);
    await loadModels({ backgroundRefresh: true, force: false }).catch(() => null);
}

export function ensureDataPrefetch() {
    if (preloadPromise) {
        return preloadPromise;
    }
    preloadPromise = runPrefetch().finally(() => {
        preloadPromise = null;
    });
    return preloadPromise;
}

