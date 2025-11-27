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

function ensureDeviceRegistrationState() {
    if (!window.__nitraDeviceRegistered) {
        window.__nitraDeviceRegistered = {
            registered: null,
            timestamp: null
        };
    }
    return window.__nitraDeviceRegistered;
}

export function setDeviceRegistrationState(isRegistered) {
    const state = ensureDeviceRegistrationState();
    state.registered = typeof isRegistered === 'boolean' ? isRegistered : null;
    state.timestamp = Date.now();
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('nitra:device-registration-state-changed', {
            detail: { registered: state.registered }
        }));
    }
}

export function isCurrentDeviceRegistered() {
    const state = ensureDeviceRegistrationState();
    return state.registered;
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

    const identity = await getDeviceIdentity();

    const response = await fetch('/nitra/device/registrations', { headers });
    const data = await parseResponse(response);

    if (!response.ok) {
        const errorMessage = data?.error || 'Failed to load device registrations';
        throw new Error(errorMessage);
    }

    const devices = Array.isArray(data?.devices) ? data.devices : [];
    const currentHash = identity?.fingerprint_hash || identity?.fingerprintHash;
    const currentDevice = devices.find(device =>
        currentHash && device.fingerprintHash && currentHash === device.fingerprintHash
    );
    const isRegistered = Boolean(currentDevice);
    setDeviceRegistrationState(isRegistered);

    if (!isRegistered) {
        const hasFreeSlot = typeof data?.maxSlots === 'number'
            ? devices.length < data.maxSlots
            : true;
        if (hasFreeSlot) {
            try {
                await registerCurrentDevice({
                    mode: 'auto',
                    clientTimestamp: new Date().toISOString(),
                });
                invalidateDeviceIdentityCache();
                return fetchRegisteredDevices();
            } catch (error) {
                console.warn('Nitra: Auto-registration skipped', error?.message || error);
            }
        } else {
            setDeviceRegistrationState(false);
        }
    }

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
    setDeviceRegistrationState(true);
    const event = new CustomEvent('nitra:device-registered', {
        detail: {
            deviceLabel,
            replaceDeviceId,
            mode,
            timestamp: clientTimestamp,
        },
    });
    window.dispatchEvent(event);
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


