// Model API interactions
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';

let modelsFetchPromise = null;
let modelsFetchController = null;
let modelsFetchSilent = true;

export function cancelModelsFetch() {
    if (modelsFetchController) {
        modelsFetchController.abort();
        modelsFetchController = null;
    }
}

function shouldRefreshModels(cacheInfo, hasSubscription) {
    if (!cacheInfo) {
        return true;
    }
    if (!Array.isArray(cacheInfo.data) || cacheInfo.data.length === 0) {
        return true;
    }
    if (cacheInfo.isExpired) {
        return true;
    }
    if (hasSubscription && cacheInfo.mode === 'preview') {
        return true;
    }
    return false;
}

function modelsErrorMessage() {
    return '<div style="text-align: center; padding: 20px; color: #ff4444;">Failed to load models, check that:<br>1. your premium subscription is active.<br>2. your device is registered in "User Configuration".</div>';
}

async function fetchAndPersistModels(hasSubscription, { silent } = {}) {
    if (modelsFetchPromise) {
        if (!silent) {
            modelsFetchSilent = false;
        }
        return modelsFetchPromise;
    }

    modelsFetchSilent = silent;
    modelsFetchPromise = (async () => {
        try {
            if (modelsFetchController) {
                modelsFetchController.abort();
            }
            modelsFetchController = new AbortController();
            const signal = modelsFetchController.signal;

            let endpoint;
            let previewMode;
            if (hasSubscription) {
                endpoint = '/nitra/models';
                previewMode = false;
            } else {
                endpoint = '/nitra/models-metadata';
                previewMode = true;
            }

            const response = await fetch(endpoint, {
                headers: {
                    'Authorization': `Bearer ${state.currentUser.apiToken}`,
                    'Content-Type': 'application/json',
                    'X-User-Email': state.currentUser.email,
                },
                signal,
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.status}`);
            }

            const data = await response.json();

            if (previewMode && Array.isArray(data)) {
                data.forEach((m) => (m._previewMode = true));
            }

            const cacheInfo =
                typeof state.getModelsCacheInfo === 'function' ? state.getModelsCacheInfo() : null;
            const previousVersion = cacheInfo ? cacheInfo.version : null;
            const newVersion =
                typeof state.getLatestDataVersion === 'function' ? state.getLatestDataVersion(data) : null;
            const mode = previewMode ? 'preview' : 'full';
            const versionChanged =
                !previousVersion ||
                !newVersion ||
                previousVersion !== newVersion ||
                (cacheInfo && cacheInfo.mode !== mode);

            if (versionChanged) {
                state.setModelsData(data, { mode });
            } else {
                state.setModelsData(state.modelsData, { mode });
            }

            return true;
        } catch (error) {
            if (error.name === 'AbortError') {
                return false;
            }
            if (modelsFetchSilent) {
                console.warn('Nitra: Background model refresh failed', error);
            } else {
                console.error('Error loading models:', error);
                const modelsList = document.getElementById('nitra-models-list');
                if (modelsList) {
                    modelsList.innerHTML = modelsErrorMessage();
                }
            }
            return false;
        } finally {
            modelsFetchPromise = null;
            modelsFetchController = null;
            modelsFetchSilent = true;
        }
    })();

    return modelsFetchPromise;
}

export async function loadModels(options = {}) {
    const { backgroundRefresh = true, force = false } = options;
    const cacheInfo = typeof state.getModelsCacheInfo === 'function' ? state.getModelsCacheInfo() : null;
    const hasCached = cacheInfo && Array.isArray(cacheInfo.data) && cacheInfo.data.length > 0;
    const modelsList = document.getElementById('nitra-models-list');
    if (modelsList && !hasCached) {
        modelsList.innerHTML =
            '<div style="text-align: center; padding: 20px; color: var(--comfy-input-text);">Loading models...</div>';
    }

    const hasSubscription =
        state.currentLicenseStatus &&
        (state.currentLicenseStatus.has_paid_subscription || state.currentLicenseStatus.status === 'paid');

    const needsRefresh = force || shouldRefreshModels(cacheInfo, hasSubscription);

    if (!state.currentUser || !state.currentUser.apiToken) {
        console.warn('Nitra: Cannot load models without an authenticated user');
        return hasCached;
    }

    if (!needsRefresh) {
        if (backgroundRefresh) {
            fetchAndPersistModels(hasSubscription, { silent: true }).catch(() => {});
        }
        return true;
    }

    return fetchAndPersistModels(hasSubscription, { silent: !backgroundRefresh });
}










