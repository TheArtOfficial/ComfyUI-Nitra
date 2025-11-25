// Global state management for Nitra
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

// Dialog references
export let openNitraDialog = null;
export let nitraDialog = null;

// Authentication state
export let isAuthenticated = false;
export let currentUser = null;

// Update state
export let updateInProgress = false;

// License state
export let currentLicenseStatus = null;

// Workflows state + caching
const WORKFLOWS_CACHE_KEY = 'nitra_cached_workflows';
const MODELS_CACHE_KEY = 'nitra_cached_models';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CACHE_DEFAULT_MODE = 'full';
const VERSION_KEYS = [
    'dateUpdated',
    'updated_at',
    'updatedAt',
    'updated',
    'date_updated',
    'lastUpdated',
    'modifiedAt',
];

function readCacheRecord(key) {
    if (typeof window === 'undefined' || !window.localStorage) {
        return null;
    }
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
    } catch (error) {
        console.warn('Nitra: Failed to parse cache entry', key, error);
        window.localStorage.removeItem(key);
        return null;
    }
}

function computeLatestTimestamp(list) {
    if (!Array.isArray(list)) {
        return null;
    }
    let latest = null;
    for (const item of list) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        for (const key of VERSION_KEYS) {
            const value = item[key];
            if (typeof value === 'string' && value.trim()) {
                const parsed = Date.parse(value);
                if (!Number.isNaN(parsed) && (latest === null || parsed > latest)) {
                    latest = parsed;
                }
            }
        }
    }
    return latest;
}

function buildCacheInfo(record) {
    const data = Array.isArray(record?.data) ? record.data : [];
    const version = typeof record?.version === 'number' ? record.version : null;
    const timestamp = typeof record?.timestamp === 'number' ? record.timestamp : 0;
    const mode = typeof record?.mode === 'string' ? record.mode : CACHE_DEFAULT_MODE;
    const isExpired = !timestamp || (Date.now() - timestamp > CACHE_TTL_MS);
    return { data, version, timestamp, mode, isExpired };
}

function createInitialCacheInfo(key) {
    const record = readCacheRecord(key);
    if (record) {
        return buildCacheInfo(record);
    }
    return {
        data: [],
        version: null,
        timestamp: 0,
        mode: CACHE_DEFAULT_MODE,
        isExpired: true,
    };
}

function persistCache(key, info) {
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }
    try {
        const payload = {
            timestamp: info.timestamp || Date.now(),
            version: typeof info.version === 'number' ? info.version : null,
            mode: info.mode || CACHE_DEFAULT_MODE,
            data: Array.isArray(info.data) ? info.data : [],
        };
        window.localStorage.setItem(key, JSON.stringify(payload));
    } catch (error) {
        console.warn('Nitra: Failed to store cache entry', key, error);
    }
}

let workflowsCacheInfo = createInitialCacheInfo(WORKFLOWS_CACHE_KEY);
let modelsCacheInfo = createInitialCacheInfo(MODELS_CACHE_KEY);

export let workflowsData = workflowsCacheInfo.data;
export let modelsData = modelsCacheInfo.data;
export let selectedWorkflows = new Set();
export let selectedModels = new Set();

// Operation state
export let ongoingWorkflowInstall = false;
export let ongoingModelDownload = false;

// Polling intervals
export let workflowPollInterval = null;
export let modelPollInterval = null;

// Setters (to maintain encapsulation for future)
export function setOpenNitraDialog(value) { openNitraDialog = value; }
export function setNitraDialog(dialog) { nitraDialog = dialog; }
export function setAuthenticated(value) { isAuthenticated = value; }
export function setCurrentUser(user) { currentUser = user; }
export function setUpdateInProgress(value) { updateInProgress = value; }
export function setCurrentLicenseStatus(status) { currentLicenseStatus = status; }
export function setWorkflowsData(data, options = {}) {
    workflowsData = Array.isArray(data) ? data : [];
    const version = computeLatestTimestamp(workflowsData);
    const timestamp = Date.now();
    const mode = options.mode === 'preview' ? 'preview' : CACHE_DEFAULT_MODE;
    workflowsCacheInfo = {
        data: workflowsData,
        version,
        timestamp,
        mode,
        isExpired: false,
    };
    persistCache(WORKFLOWS_CACHE_KEY, workflowsCacheInfo);
}
export function setModelsData(data, options = {}) {
    modelsData = Array.isArray(data) ? data : [];
    const version = computeLatestTimestamp(modelsData);
    const timestamp = Date.now();
    const mode = options.mode === 'preview' ? 'preview' : CACHE_DEFAULT_MODE;
    modelsCacheInfo = {
        data: modelsData,
        version,
        timestamp,
        mode,
        isExpired: false,
    };
    persistCache(MODELS_CACHE_KEY, modelsCacheInfo);
}
export function setOngoingWorkflowInstall(value) { ongoingWorkflowInstall = value; }
export function setOngoingModelDownload(value) { ongoingModelDownload = value; }
export function setWorkflowPollInterval(interval) { workflowPollInterval = interval; }
export function setModelPollInterval(interval) { modelPollInterval = interval; }

export function getWorkflowsCacheInfo() {
    return { ...workflowsCacheInfo };
}

export function getModelsCacheInfo() {
    return { ...modelsCacheInfo };
}

export function getLatestDataVersion(list) {
    return computeLatestTimestamp(list);
}

