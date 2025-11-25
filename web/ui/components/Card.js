// Card component
// NEW CODE - Component library

import { div } from './core.js';

export function Card({ title, children, bordered = false }) {
    const className = bordered ? 'nitra-card-bordered' : 'nitra-card';
    
    return div(
        { className },
        title && div({ style: { fontWeight: 'bold', marginBottom: '12px' } }, title),
        ...children
    );
}










