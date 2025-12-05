// License status management
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import * as state from '../core/state.js';
import { API_ENDPOINTS } from '../core/constants.js';
import { updateLicenseStatusDisplay } from './ui.js';
import { fetchRegisteredDevices } from '../device/api.js';
import { logoutWebsite } from '../auth/logout.js';

const LICENSE_CACHE_KEY = 'nitra_license_status';
const LICENSE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function readLicenseCache() {
    if (typeof window === 'undefined' || !window.localStorage) {
        return null;
    }
    try {
        const raw = window.localStorage.getItem(LICENSE_CACHE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !parsed.data) {
            return null;
        }
        if (parsed.timestamp && Date.now() - parsed.timestamp > LICENSE_CACHE_TTL_MS) {
            window.localStorage.removeItem(LICENSE_CACHE_KEY);
            return null;
        }
        return parsed.data;
    } catch (error) {
        console.warn('Nitra: Failed to parse cached license status', error);
        window.localStorage.removeItem(LICENSE_CACHE_KEY);
        return null;
    }
}

function persistLicenseCache(subscriptionData) {
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }
    try {
        window.localStorage.setItem(
            LICENSE_CACHE_KEY,
            JSON.stringify({
                timestamp: Date.now(),
                data: subscriptionData,
            }),
        );
    } catch (error) {
        console.warn('Nitra: Failed to persist license cache', error);
    }
}

export function clearLicenseCache() {
    if (typeof window === 'undefined' || !window.localStorage) {
        return;
    }
    window.localStorage.removeItem(LICENSE_CACHE_KEY);
}

export async function fetchLicenseStatus() {
    if (!state.isAuthenticated || !state.currentUser || !state.currentUser.apiToken) {
        return null;
    }

    try {
        const response = await fetch(API_ENDPOINTS.licenseStatus, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.currentUser.apiToken}`,
            },
            body: JSON.stringify({
                userId: state.currentUser.id,
            }),
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                console.warn('Nitra: Subscription check unauthorized, clearing cached session.');
                clearLicenseCache();
                state.setCurrentLicenseStatus(null);
                updateLicenseStatusDisplay();
                try {
                    await logoutWebsite();
                } catch (logoutError) {
                    console.error('Nitra: Failed to logout after license auth failure', logoutError);
                }
            } else {
                const errorText = await response.text();
                console.error('Nitra: Subscription check failed:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText,
                });
            }
            return null;
        }

        const subscriptionData = await response.json();
        persistLicenseCache(subscriptionData);
        await applyLicenseStatus(subscriptionData);
        return subscriptionData;
    } catch (error) {
        console.error('Nitra: Error fetching subscription status:', error);
        return null;
    }
}

async function applyLicenseStatus(subscriptionData) {
    state.setCurrentLicenseStatus(subscriptionData);
    formatLicenseStatus(subscriptionData);
    const event = new CustomEvent('nitra:license-status-updated', {
        detail: { subscriptionData },
    });
    window.dispatchEvent(event);
    try {
        await fetchRegisteredDevices();
    } catch (error) {
        console.warn('Nitra: Unable to refresh device registrations', error);
    }
    updateLicenseStatusDisplay();
}

export async function initializeLicenseStatus() {
    const cached = readLicenseCache();
    if (cached) {
        await applyLicenseStatus(cached);
    }
    return fetchLicenseStatus();
}

export function formatLicenseStatus(subscriptionData) {
    if (!subscriptionData) {
        return {
            message: "Subscription status unavailable",
            style: "color: #bdbdbd; font-style: italic;",
            showPurchaseLink: false
        };
    }
    
    
    // Handle your website's subscription data format
    const hasPaidSubscription = subscriptionData.has_paid_subscription || false;
    const subscriptionType = subscriptionData.subscription_type || "none";
    const status = subscriptionData.status || "none";
    const endDate = subscriptionData.end_date;
    const subscriptionId = subscriptionData.subscription_id;
    const productId = subscriptionData.product_id;
    
    
    let details = [];
    if (endDate) {
        const endDateObj = new Date(endDate);
        details.push(`Expires: ${endDateObj.toLocaleDateString()}`);
    }
    
    let fullMessage = "";
    let style = "";
    let showPurchaseLink = false;
    
    if (subscriptionType === "none" || status === "none") {
        fullMessage = ` No Subscription Found`;
        style = "color: #bdbdbd; font-weight: 500;";
        showPurchaseLink = true;
    } else if ((hasPaidSubscription && status === "active") || status === "paid") {
        fullMessage = ` Premium Subscription`;
        style = "color: #4ade80; font-weight: 600;";
        showPurchaseLink = false;
    } else if (status === "cancelled") {
        fullMessage = ` Subscription Cancelled`;
        style = "color: #ffffff; font-weight: 500;";
        showPurchaseLink = true;
    } else if (subscriptionType === "free" && status === "active") {
        fullMessage = ` Free Version`;
        style = "color: #ef4444; font-weight: 600;";
        showPurchaseLink = true;
    } else {
        fullMessage = `❓ Subscription Status: ${status} (Type: ${subscriptionType})`;
        style = "color: #ffffff; font-weight: 500;";
        showPurchaseLink = true;
    }
    
    if (details.length > 0) {
        fullMessage += `<br><span style="color: #bdbdbd; font-weight: 500; font-size: 0.95em;">${details.join(' • ')}</span>`;
    }
    
    const result = {
        message: fullMessage,
        style: style,
        showPurchaseLink: showPurchaseLink
    };
    
    return result;
}

