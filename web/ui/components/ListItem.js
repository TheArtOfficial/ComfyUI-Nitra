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
    disabled = false,
    onChange,
    rightContent
}) {
    const checkboxId = `item-${id}`;

    // Fix for core.js setAttribute behavior with booleans
    // Only pass the prop if it is true.
    const inputProps = {
        type: 'checkbox',
        id: checkboxId,
        value: id,
        style: { marginRight: '15px', transform: 'scale(1.1)', cursor: disabled ? 'default' : 'pointer' },
        onClick: (e) => {
            e.stopPropagation();
            if (!disabled && onChange) onChange(e.target.checked);
        }
    };

    if (checked) inputProps.checked = 'checked';
    if (disabled) inputProps.disabled = 'disabled';

    const checkbox = input(inputProps);
    
    // Title row with space-between
    const titleRow = div(
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' } },
        div({ className: 'nitra-list-item-title', style: { fontSize: '1.1em', fontWeight: 'bold' } }, title || 'Unnamed Item'),
        rightContent && div({ className: 'nitra-list-item-right', style: { marginLeft: '10px', fontSize: '0.95em', opacity: 0.8 } }, rightContent)
    );
    
    const content = div(
        { style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' } },
        titleRow,
        description && div({ className: 'nitra-list-item-description' }, description),
        meta && div({ className: 'nitra-list-item-meta' }, meta),
        tags.length > 0 && div(
            { style: { marginTop: '4px' } },
            ...tags.map(tag => span({ className: 'nitra-tag' }, tag))
        )
    );
    
    return div(
        {
            className: 'nitra-list-item',
            style: {
                opacity: disabled ? 0.6 : 1,
                cursor: disabled ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '12px 16px'
            },
            onClick: () => {
                if (disabled) return;
                const el = document.getElementById(checkboxId);
                if (el) el.click();
            }
        },
        checkbox,
        content
    );
}
