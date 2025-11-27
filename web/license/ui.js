// License UI updates
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import { formatLicenseStatus } from './status.js';
import * as state from '../core/state.js';
import { isCurrentDeviceRegistered } from '../device/api.js';

const LICENSE_STATUS_MAX_RETRIES = 40; // ~6s at 150ms intervals
const LICENSE_STATUS_RETRY_DELAY = 150;

export function updateLicenseStatusDisplay(retryCount = 0) {
    const licenseStatusElement = document.getElementById('nitra-license-status');
    const purchaseLinkElement = document.getElementById('nitra-purchase-link');
    const deviceWarningElement = document.getElementById('nitra-device-warning');
    const deviceWarningSubtext = document.getElementById('nitra-device-warning-subtext');
    
    if (licenseStatusElement) {
        const licenseStatus = formatLicenseStatus(state.currentLicenseStatus);
        
        // Update content
        licenseStatusElement.innerHTML = licenseStatus.message;
        
        const baseStyle = licenseStatusElement.dataset.baseStyle || '';
        const combinedStyle = [baseStyle, licenseStatus.style].filter(Boolean).join('; ');
        licenseStatusElement.style.cssText = combinedStyle;
        
        if (purchaseLinkElement) {
            purchaseLinkElement.style.display = licenseStatus.showPurchaseLink ? 'block' : 'none';
        }

        if (deviceWarningElement) {
            const registeredState = isCurrentDeviceRegistered();
            if (registeredState !== null) {
                const isRegistered = !!registeredState;
                deviceWarningElement.textContent = isRegistered ? '' : 'Device not registered';
                deviceWarningElement.style.display = isRegistered ? 'none' : 'block';
                if (deviceWarningSubtext) {
                    deviceWarningSubtext.style.display = isRegistered ? 'none' : 'block';
                }
            }
        }
        
        const loadingElement = document.getElementById('nitra-license-loading');
        if (loadingElement) {
            loadingElement.remove();
        }
    } else if (retryCount < LICENSE_STATUS_MAX_RETRIES) {
        // Element doesn't exist yet, retry after a short delay
        setTimeout(() => {
            updateLicenseStatusDisplay(retryCount + 1);
        }, LICENSE_STATUS_RETRY_DELAY);
    } else {
        console.warn('Nitra: License status element not found after retries');
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('nitra:device-registration-state-changed', () => {
        updateLicenseStatusDisplay();
    });
    window.addEventListener('nitra:device-registered', () => {
        updateLicenseStatusDisplay();
    });
}










