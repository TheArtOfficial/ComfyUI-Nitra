// Alert component
// NEW CODE - Component library

import { div } from './core.js';

export function Alert({ 
    type = 'info',  // 'info', 'warning', 'success', 'error'
    title,
    children
}) {
    return div(
        { className: `nitra-alert nitra-alert-${type}` },
        title && div({ className: 'nitra-alert-title' }, title),
        div({ className: 'nitra-alert-content' }, ...children)
    );
}









