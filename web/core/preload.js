import * as state from './state.js';
import { loadWorkflows } from '../workflows/api.js';
import { loadModels } from '../models/api.js';

let preloadPromise = null;

export function ensureDataPrefetch() {
    if (!state.isAuthenticated || !state.currentUser?.apiToken) {
        return null;
    }
    if (preloadPromise) {
        return preloadPromise;
    }
    preloadPromise = Promise.all([
        loadWorkflows({ backgroundRefresh: true }).catch((error) => {
            console.warn('Nitra: Background workflow load skipped', error);
        }),
        loadModels({ backgroundRefresh: true }).catch((error) => {
            console.warn('Nitra: Background model load skipped', error);
        }),
    ]).finally(() => {
        preloadPromise = null;
    });
    return preloadPromise;
}

