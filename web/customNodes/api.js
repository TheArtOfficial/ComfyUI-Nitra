import * as state from '../core/state.js';

let customNodesCache = null;

export async function fetchCustomNodesLibrary() {
    if (customNodesCache) return customNodesCache;

    try {
        const response = await fetch('/nitra/custom-nodes', {
            headers: {
                'Authorization': `Bearer ${state.currentUser?.apiToken || ''}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            customNodesCache = Array.isArray(data) ? data : [];
            return customNodesCache;
        }
    } catch (error) {
        console.error("Nitra: Failed to fetch custom nodes library", error);
    }
    return [];
}

let nodeMappingsCache = null;

export async function fetchNodeMappings() {
    if (nodeMappingsCache) return nodeMappingsCache;

    try {
        const response = await fetch('/nitra/node-mappings');
        if (response.ok) {
            nodeMappingsCache = await response.json();
            return nodeMappingsCache;
        }
    } catch (error) {
        console.error("Nitra: Failed to fetch node mappings", error);
    }
    return {};
}
