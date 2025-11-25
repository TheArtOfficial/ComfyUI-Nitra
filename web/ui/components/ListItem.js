// List item component
// NEW CODE - Component library

import { div, input, span } from './core.js';

export function ListItem({ 
    id, 
    title, 
    description, 
    meta, 
    tags = [], 
    checked = false,
    onChange 
}) {
    const checkbox = input({
        type: 'checkbox',
        id: `item-${id}`,
        value: id,
        checked,
        style: { marginRight: '12px' },
        onClick: (e) => {
            e.stopPropagation();
            if (onChange) onChange(e.target.checked);
        }
    });
    
    const content = div(
        { style: { flex: 1 } },
        div({ className: 'nitra-list-item-title' }, title || 'Unnamed Item'),
        div({ className: 'nitra-list-item-description' }, description || 'No description available'),
        meta && div({ className: 'nitra-list-item-meta' }, meta),
        tags.length > 0 && div(
            { style: { marginTop: '4px' } },
            ...tags.map(tag => span({ className: 'nitra-tag' }, tag))
        )
    );
    
    return div(
        {
            className: 'nitra-list-item',
            onClick: () => document.getElementById(`item-${id}`).click()
        },
        checkbox,
        content
    );
}










