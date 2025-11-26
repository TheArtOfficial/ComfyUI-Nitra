import { ensureFreshAccessToken } from '../auth/session.js';
import {
    getActiveApiToken,
    getStoredUserId,
    getStoredUserEmail,
} from '../auth/storage.js';

let cachedIdentity = null;

function buildAuthHeaders({ json = false } = {}) {
    const token = getActiveApiToken();
    if (!token) {
        return null;
    }

    const headers = {
        'Authorization': `Bearer ${token}`
    };

    const userId = getStoredUserId();
    const email = getStoredUserEmail();
    if (userId) {
        headers['X-User-Id'] = userId;
    }
    if (email) {
        headers['X-User-Email'] = email;
    }

    if (json) {
        headers['Content-Type'] = 'application/json';
    }

    return headers;
}

async function parseResponse(response) {
    const text = await response.text();
    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        console.warn('Nitra: Failed to parse JSON response', error);
        return { message: text };
    }
}

export function invalidateDeviceIdentityCache() {
    cachedIdentity = null;
}

export function setDeviceRegistrationState(isRegistered) {
    window.__nitraDeviceRegistered = !!isRegistered;
}

export function isCurrentDeviceRegistered() {
    return Boolean(window.__nitraDeviceRegistered);
}

export async function getDeviceIdentity(forceRefresh = false) {
    if (!forceRefresh && cachedIdentity) {
        return cachedIdentity;
    }

    const response = await fetch('/nitra/device/identity');
    if (!response.ok) {
        throw new Error('Failed to collect device identity');
    }

    const data = await response.json();
    cachedIdentity = data;
    return data;
}

export async function fetchRegisteredDevices() {
    await ensureFreshAccessToken();
    const headers = buildAuthHeaders();
    if (!headers) {
        throw new Error('Authentication required');
    }

    const response = await fetch('/nitra/device/registrations', { headers });
    const data = await parseResponse(response);

    if (!response.ok) {
        const errorMessage = data?.error || 'Failed to load device registrations';
        throw new Error(errorMessage);
    }

    const devices = Array.isArray(data?.devices) ? data.devices : [];
    const currentHash = cachedIdentity?.fingerprint_hash || cachedIdentity?.fingerprintHash;
    const isRegistered = devices.some(device =>
        currentHash && device.fingerprintHash && currentHash === device.fingerprintHash
    );
    setDeviceRegistrationState(isRegistered);

    return data;
}

export async function registerCurrentDevice({
    deviceLabel,
    replaceDeviceId = null,
    mode = 'manual',
    clientTimestamp = new Date().toISOString(),
} = {}) {
    await ensureFreshAccessToken();
    const headers = buildAuthHeaders({ json: true });
    if (!headers) {
        throw new Error('Authentication required');
    }

    const payload = {
        device_label: deviceLabel,
        replace_device_id: replaceDeviceId,
        mode,
        client_timestamp: clientTimestamp,
        source: 'comfyui-nitra',
    };

    const response = await fetch('/nitra/device/register', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });

    const data = await parseResponse(response);

    if (!response.ok) {
        const error = new Error(data?.error || 'Device registration failed');
        error.response = data;
        error.status = response.status;
        throw error;
    }

    invalidateDeviceIdentityCache();
    return data;
}

export async function autoSyncDeviceRegistration() {
    try {
        await ensureFreshAccessToken();
        await registerCurrentDevice({
            mode: 'auto',
            clientTimestamp: new Date().toISOString(),
        });
    } catch (error) {
        if (error?.status === 409) {
            console.info('Nitra: Device limit reached during auto-sync. User action required.');
            return;
        }
        console.warn('Nitra: Auto device registration skipped', error?.message || error);
    }
}

export async function sendLoginTelemetry(context = {}) {
    await ensureFreshAccessToken();
    const headers = buildAuthHeaders({ json: true });
    if (!headers) {
        return;
    }

    try {
        await fetch('/nitra/telemetry/login', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                client_timestamp: new Date().toISOString(),
                source: 'comfyui-nitra',
                context,
            }),
        });
    } catch (error) {
        console.warn('Nitra: Failed to record login telemetry', error);
    }
}


