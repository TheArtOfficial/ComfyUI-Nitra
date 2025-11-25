// Version Check component
// NEW CODE - Component library

import { div, span } from './core.js';

export function VersionCheckItem({ label, installed, version, isWarning = false }) {
    // Determine status color - warning if update available (contains →) or not installed
    let statusColor = 'warning';
    let statusText = '⚠ Not Installed';
    
    if (installed) {
        if (isWarning) {
            // Force warning status even if installed (e.g., CPU version when GPU should be used)
            statusColor = 'warning';
            statusText = version ? `⚠ v${version}` : '⚠ Installed (should be removed)';
        } else if (version) {
            // If version contains arrow, it means update is available
            if (typeof version === 'string' && version.includes('→')) {
                statusColor = 'warning';
                statusText = version;
            } else {
                statusColor = 'success';
                statusText = `v${version}`;
            }
        } else {
            statusColor = 'success';
            statusText = '✓ Installed';
        }
    }
    
    return div(
        { className: 'nitra-version-item' },
        span({ className: 'nitra-version-label' }, label),
        span({ className: `nitra-version-status nitra-version-status-${statusColor}` }, statusText)
    );
}

export function VersionCheckGroup({ children }) {
    return div(
        { className: 'nitra-version-group' },
        ...children
    );
}

