import * as state from './state.js';
import { loadWorkflows } from '../workflows/api.js';
import { loadModels } from '../models/api.js';
// import { fetchLicenseStatus } from '../license/status.js';

let preloadPromise = null;

export function ensureDataPrefetch() {
    // Data prefetching is now handled by the UI initialization to ensure
    // license status is known before fetching content (avoiding locked/unlocked race conditions).
    return Promise.resolve();
}

