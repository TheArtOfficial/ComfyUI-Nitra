// Workflow API interactions
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { getWebsiteBaseUrl } from '../core/config.js';

// Caches to avoid re-fetching workflow/subgraph data and installed models
const workflowDetailsCache = new Map(); // workflowId -> workflow data (with dependencies)
const subgraphDependenciesCache = new Map(); // subgraphId -> dependencies object
let existingModelsCache = null; // array of installed model IDs
let existingModelsCacheTimestamp = 0;
const EXISTING_MODELS_CACHE_TTL_MS = 60 * 1000; // 1 minute
let workflowsFetchPromise = null;
let workflowsFetchSilent = true;
const MEDIA_REFRESH_SAFETY_MS = 2 * 60 * 1000;
let mediaRefreshTimer = null;

function shouldRefreshWorkflows(cacheInfo, hasSubscription) {
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

function clearWorkflowCaches() {
    workflowDetailsCache.clear();
    subgraphDependenciesCache.clear();
    existingModelsCache = null;
    existingModelsCacheTimestamp = 0;
    clearMediaRefreshTimer();
}

function seedWorkflowCache(workflows) {
    if (!Array.isArray(workflows)) return;
    workflows.forEach(workflow => {
        if (workflow && workflow.id && workflow.dependencies) {
            workflowDetailsCache.set(workflow.id, workflow);
        }
    });
}

function fetchWorkflowsErrorMessage() {
    return '<div class="nitra-centered-placeholder" style="color:#ff7777;">Failed to load workflows, check that:<br>1. your premium subscription is active.<br>2. your device is registered in "User Configuration".</div>';
}

async function fetchAndPersistWorkflows(hasSubscription, { silent } = {}) {
    if (workflowsFetchPromise) {
        if (!silent) {
            workflowsFetchSilent = false;
        }
        return workflowsFetchPromise;
    }

    workflowsFetchSilent = silent;
    workflowsFetchPromise = (async () => {
        try {
            // Always use metadata endpoint for initial load to ensure fast response time
            // Full details (media, signed URLs, dependencies) will be hydrated lazily via IntersectionObserver
            const endpoint = '/nitra/workflows-metadata';
            const previewMode = !hasSubscription;

            const response = await fetch(endpoint, {
                headers: {
                    'Authorization': `Bearer ${state.currentUser.apiToken}`,
                    'Content-Type': 'application/json',
                    'X-User-Email': state.currentUser.email,
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch workflows: ${response.status}`);
            }

            const data = await response.json();

            if (previewMode && Array.isArray(data)) {
                data.forEach((w) => (w._previewMode = true));
            }

            const cacheInfo =
                typeof state.getWorkflowsCacheInfo === 'function' ? state.getWorkflowsCacheInfo() : null;
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
                clearWorkflowCaches();
                seedWorkflowCache(data);
                state.setWorkflowsData(data, { mode });
            } else {
                state.setWorkflowsData(state.workflowsData, { mode });
            }
            scheduleMediaRefresh(state.workflowsData);

            return true;
        } catch (error) {
            if (workflowsFetchSilent) {
                console.warn('Nitra: Background workflow refresh failed', error);
            } else {
                console.error('Error loading workflows:', error);
                const workflowsList = document.getElementById('nitra-workflows-list');
                if (workflowsList) {
                    workflowsList.innerHTML = fetchWorkflowsErrorMessage();
                }
            }
            return false;
        } finally {
            workflowsFetchPromise = null;
            workflowsFetchSilent = true;
        }
    })();

    return workflowsFetchPromise;
}

function extractDynamoValue(value) {
    if (!value) return null;
    if (value.S) return value.S;
    if (value.N) return parseFloat(value.N);
    if (value.L) return value.L.map(item => extractDynamoValue(item));
    if (value.M) {
        const result = {};
        for (const [key, val] of Object.entries(value.M)) {
            result[key] = extractDynamoValue(val);
        }
        return result;
    }
    return value;
}

export async function fetchWorkflowDetails(workflowId, options = {}) {
    const { refresh = false } = options;

    // Return cached workflow if we already have dependencies for it
    if (!refresh && workflowDetailsCache.has(workflowId)) {
        return workflowDetailsCache.get(workflowId);
    }

    // Try to find it in the workflows list loaded earlier
    if (!refresh) {
        const fromState = Array.isArray(state.workflowsData)
            ? state.workflowsData.find(w => w && w.id === workflowId && w.dependencies)
            : null;
        if (fromState) {
            workflowDetailsCache.set(workflowId, fromState);
            return fromState;
        }
    }

    // Fallback to fetching from the local server
    try {
        const response = await fetch(`/nitra/workflows/${workflowId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.currentUser.apiToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`Failed to fetch workflow ${workflowId}: ${response.status}`);
            return null;
        }

        const workflow = await response.json();
        workflowDetailsCache.set(workflowId, workflow);
        return workflow;
    } catch (error) {
        console.error(`Error fetching workflow ${workflowId}:`, error);
        return null;
    }
}

async function fetchSubgraphDependencies(subgraphId) {
    if (subgraphDependenciesCache.has(subgraphId)) {
        return subgraphDependenciesCache.get(subgraphId);
    }

    try {
        const subgraphResponse = await fetch(`${getWebsiteBaseUrl()}/api/subgraphs/${subgraphId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.currentUser.apiToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!subgraphResponse.ok) {
            console.error(`Failed to fetch subgraph ${subgraphId}: ${subgraphResponse.status}`);
            return null;
        }

        const subgraphData = await subgraphResponse.json();
        const subgraphDependencies = extractDynamoValue(subgraphData.dependencies);
        subgraphDependenciesCache.set(subgraphId, subgraphDependencies);
        return subgraphDependencies;
    } catch (error) {
        console.error(`Error fetching subgraph ${subgraphId}:`, error);
        return null;
    }
}

export async function loadWorkflows(options = {}) {
    const { backgroundRefresh = true, force = false } = options;
    const cacheInfo = typeof state.getWorkflowsCacheInfo === 'function' ? state.getWorkflowsCacheInfo() : null;
    const hasCached = cacheInfo && Array.isArray(cacheInfo.data) && cacheInfo.data.length > 0;

    const hasSubscription =
        state.currentLicenseStatus &&
        (state.currentLicenseStatus.has_paid_subscription || state.currentLicenseStatus.status === 'paid');

    const needsRefresh = force || shouldRefreshWorkflows(cacheInfo, hasSubscription);

    if (!state.currentUser || !state.currentUser.apiToken) {
        console.warn('Nitra: Cannot load workflows without an authenticated user');
        return hasCached;
    }

    if (!needsRefresh) {
        if (backgroundRefresh) {
            return fetchAndPersistWorkflows(hasSubscription, { silent: true });
        }
        return true;
    }

    return fetchAndPersistWorkflows(hasSubscription, { silent: backgroundRefresh });
}

export async function getExistingModels() {
    const now = Date.now();
    if (existingModelsCache && (now - existingModelsCacheTimestamp) < EXISTING_MODELS_CACHE_TTL_MS) {
        return new Set(existingModelsCache);
    }

    try {
        const response = await fetch('/nitra/models/check-existing', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.currentUser.apiToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            const models = data.existingModels || [];
            existingModelsCache = Array.from(models);
            existingModelsCacheTimestamp = now;
            return new Set(models);
        }
    } catch (error) {
        console.error('Error checking existing models:', error);
    }
    
    return new Set(); // Return empty set if check fails
}

export async function calculateTotalWorkflowSize(selectedWorkflowIds) {
    let totalSize = 0;
    const uniqueModels = new Map(); // model_id -> model_data
    const existingModels = await getExistingModels();
    
    // Helper function to collect models from dependencies
    const collectModelsFromDependencies = async (dependencies, source = 'workflow') => {
        if (!dependencies) return;
        
        // Process direct model dependencies
        if (dependencies.models && Array.isArray(dependencies.models)) {
            dependencies.models.forEach(dep => {
                const modelId = dep.id;
                const modelSize = dep.size || 0;
                const modelName = dep.name || '';
                const modelUrl = dep.url || '';
                
                if (modelId && !uniqueModels.has(modelId)) {
                    // Check if model is already installed
                    if (!existingModels.has(modelId)) {
                        uniqueModels.set(modelId, {
                            id: modelId,
                            name: modelName,
                            size: modelSize,
                            url: modelUrl
                        });
                    }
                }
            });
        }
        
        // Process subgraph dependencies
        if (dependencies.subgraphs && Array.isArray(dependencies.subgraphs)) {
            for (const subgraph of dependencies.subgraphs) {
                const subgraphId = subgraph.id;
                if (subgraphId) {
                    const subgraphDependencies = await fetchSubgraphDependencies(subgraphId);
                    if (subgraphDependencies) {
                        await collectModelsFromDependencies(subgraphDependencies, `subgraph-${subgraphId}`);
                    }
                }
            }
        }
    };
    
    for (const workflowId of selectedWorkflowIds) {
        const workflow = await fetchWorkflowDetails(workflowId);
        if (!workflow) {
            continue;
        }

        // Extract dependencies from DynamoDB format (workflow data may be stored that way)
        const dependencies = extractDynamoValue(workflow.dependencies);
        
        // Collect all models from workflow dependencies (including subgraph dependencies)
        await collectModelsFromDependencies(dependencies, `workflow-${workflowId}`);
    }
    
    // Calculate total size from unique models
    uniqueModels.forEach((model, modelId) => {
        if (model.size && model.size > 0) {
            totalSize += model.size;
        }
    });
    
    return {
        totalSize: totalSize,
        uniqueModelsCount: uniqueModels.size,
        uniqueModels: Array.from(uniqueModels.values())
    };
}

export async function checkWorkflowsForHFTokenRequirement() {
    let requiresHFToken = false;
    
    for (const workflowId of state.selectedWorkflows) {
        const workflow = await fetchWorkflowDetails(workflowId);
        if (!workflow) {
            continue;
        }
        
        const dependencies = extractDynamoValue(workflow.dependencies);
        const models = dependencies && dependencies.models;
        if (models && Array.isArray(models)) {
            for (const model of models) {
                if (model && model.hfTokenRequired === true) {
                    requiresHFToken = true;
                    break;
                }
            }
        }
        
        if (requiresHFToken) break;
    }
    
    return requiresHFToken;
}

function extractWorkflowInstallMessage(workflow) {
    if (!workflow || typeof workflow !== 'object') {
        return null;
    }

    const candidateKeys = [
        'workflowInstallMessage',
        'installMessage',
        'install_message',
        'workflow_message',
        'workflow_install_message',
    ];

    for (const key of candidateKeys) {
        const value = workflow[key];
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed) {
                return trimmed;
            }
        }
    }

    return null;
}

export async function collectWorkflowInstallMessages(workflowIds) {
    if (!Array.isArray(workflowIds) || workflowIds.length === 0) {
        return [];
    }

    const details = await Promise.all(
        workflowIds.map(async (workflowId) => {
            const workflow = await fetchWorkflowDetails(workflowId);
            if (!workflow) {
                return null;
            }
            const message = extractWorkflowInstallMessage(workflow);
            if (!message) {
                return null;
            }
            const name = workflow.name || workflow.workflowName || 'Workflow';
            return {
                id: workflowId,
                name,
                message,
            };
        })
    );

    return details.filter(Boolean);
}

function clearMediaRefreshTimer() {
    if (mediaRefreshTimer) {
        clearTimeout(mediaRefreshTimer);
        mediaRefreshTimer = null;
    }
}

function scheduleMediaRefresh(workflows) {
    clearMediaRefreshTimer();
    if (!Array.isArray(workflows) || workflows.length === 0) {
        return;
    }

    let soonestExpiry = null;
    workflows.forEach((workflow) => {
        if (!workflow || !Array.isArray(workflow.media)) {
            return;
        }
        workflow.media.forEach((mediaItem) => {
            if (!mediaItem) {
                return;
            }
            const expiresAt = mediaItem.fileUrlExpiresAt || mediaItem.file_url_expires_at;
            if (!expiresAt) {
                return;
            }
            const timestamp = Date.parse(expiresAt);
            if (Number.isNaN(timestamp)) {
                return;
            }
            if (soonestExpiry === null || timestamp < soonestExpiry) {
                soonestExpiry = timestamp;
            }
        });
    });

    if (!soonestExpiry) {
        return;
    }

    const delay = Math.max(0, soonestExpiry - MEDIA_REFRESH_SAFETY_MS - Date.now());
    mediaRefreshTimer = setTimeout(() => {
        mediaRefreshTimer = null;
        loadWorkflows({ backgroundRefresh: true, force: true });
    }, delay);
}










