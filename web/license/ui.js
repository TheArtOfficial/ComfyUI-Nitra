// License UI updates
// Extracted from nitra.js - DO NOT MODIFY BEHAVIOR

import { formatLicenseStatus } from './status.js';
import * as state from '../core/state.js';

const LICENSE_STATUS_MAX_RETRIES = 40; // ~6s at 150ms intervals
const LICENSE_STATUS_RETRY_DELAY = 150;

export function updateLicenseStatusDisplay(retryCount = 0) {
    const licenseStatusElement = document.getElementById('nitra-license-status');
    const purchaseLinkElement = document.getElementById('nitra-purchase-link');
    
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










