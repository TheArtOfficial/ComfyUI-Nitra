// Comfy Config API functions
// Handles fetching and managing comfy configs for dynamic optimizer buttons

import * as state from '../core/state.js';
import { getWebsiteBaseUrl } from '../core/config.js';

/**
 * Fetch all comfy configs from the API
 */
export async function fetchComfyConfigs() {
    try {
        const websiteUrl = getWebsiteBaseUrl();
        
        if (!websiteUrl) {
            throw new Error('Website base URL not configured. Config must be fetched first.');
        }
        
        const apiUrl = `${websiteUrl}/api/comfy-configs`;
        
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.currentUser.apiToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch comfy configs: ${response.status}`);
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching comfy configs:', error);
        return [];
    }
}

/**
 * Fetch comfy configs grouped by category
 */
export async function fetchComfyConfigsByCategory() {
    try {
        const configs = await fetchComfyConfigs();
        
        // Group configs by category
        const groupedConfigs = {};
        
        if (Array.isArray(configs)) {
            configs.forEach((config) => {
                const category = config.category || 'Other';
                if (!groupedConfigs[category]) {
                    groupedConfigs[category] = [];
                }
                groupedConfigs[category].push(config);
            });
        }
        
        return groupedConfigs;
    } catch (error) {
        console.error('Error grouping comfy configs:', error);
        return {};
    }
}
/**
 * Get alternating button styling based on index
 */
export function getAlternatingButtonStyle(index) {
    const alternatingStyles = [
        {
            background: '#F0F0F0', // Offwhite
            color: '#202C39',
            shadowColor: 'rgba(240, 240, 240, 0.3)',
            hoverShadowColor: 'rgba(240, 240, 240, 0.5)',
            icon: '⚡'
        },
        {
            background: '#202C39', // Navy
            color: '#F0F0F0',
            shadowColor: 'rgba(32, 44, 57, 0.3)',
            hoverShadowColor: 'rgba(32, 44, 57, 0.4)',
            icon: '🧠'
        },
        {
            background: '#A0BBC4', // Light blue
            color: '#202C39',
            shadowColor: 'rgba(160, 187, 196, 0.3)',
            hoverShadowColor: 'rgba(160, 187, 196, 0.4)',
            icon: '🔧'
        },
        {
            background: '#D14E72', // Pink
            color: '#F0F0F0',
            shadowColor: 'rgba(209, 78, 114, 0.3)',
            hoverShadowColor: 'rgba(209, 78, 114, 0.4)',
            icon: '🚀'
        }
    ];
    
    return alternatingStyles[index % alternatingStyles.length];
}

/**
 * Get button styling for different categories
 */
export function getCategoryButtonStyle(category, index = 0) {
    const categoryStyles = {
        'optimizer': {
            background: '#D14E72',
            color: '#F0F0F0',
            shadowColor: 'rgba(209, 78, 114, 0.3)',
            hoverShadowColor: 'rgba(209, 78, 114, 0.4)',
            icon: '⚡'
        },
        'model': {
            background: '#A0BBC4',
            color: '#202C39',
            shadowColor: 'rgba(160, 187, 196, 0.3)',
            hoverShadowColor: 'rgba(160, 187, 196, 0.4)',
            icon: '🧠'
        },
        'utility': {
            background: '#F0F0F0',
            color: '#202C39',
            shadowColor: 'rgba(240, 240, 240, 0.3)',
            hoverShadowColor: 'rgba(240, 240, 240, 0.5)',
            icon: '🔧'
        },
        'performance': {
            background: '#202C39',
            color: '#F0F0F0',
            shadowColor: 'rgba(32, 44, 57, 0.3)',
            hoverShadowColor: 'rgba(32, 44, 57, 0.4)',
            icon: '🚀'
        },
        'default': {
            background: '#6B73FF',
            color: '#F0F0F0',
            shadowColor: 'rgba(107, 115, 255, 0.3)',
            hoverShadowColor: 'rgba(107, 115, 255, 0.4)',
            icon: '📦'
        }
    };
    
    const style = categoryStyles[category.toLowerCase()] || categoryStyles['default'];
    
    return {
        ...style,
        id: `nitra-comfy-config-${category.toLowerCase()}-${index}`,
        className: 'nitra-comfy-config-btn'
    };
}

/**
 * Create a button element for a comfy config
 */
export function createComfyConfigButton(config, index = 0) {
    const style = getAlternatingButtonStyle(index);
    
    const button = document.createElement('button');
    button.id = `nitra-comfy-config-${config.id}`;
    button.className = 'p-button nitra-comfy-config-btn';
    button.setAttribute('data-config-id', config.id);
    button.setAttribute('data-category', config.category);
    button.setAttribute('data-package-source', config.packageSource);
    
    // Set button text with icon
    button.innerHTML = `${style.icon} ${config.packageSource}`;
    
    // Apply styling
    button.style.cssText = `
        width: 100%;
        padding: 16px 20px;
        background: ${style.background};
        color: ${style.color};
        border: none;
        border-radius: 10px;
        cursor: pointer;
        font-weight: 600;
        font-size: 1.1em;
        margin-bottom: 12px;
        transition: all 0.3s ease;
        box-shadow: 0 4px 15px ${style.shadowColor};
    `;
    
    // Add hover effects
    button.addEventListener('mouseover', function() {
        this.style.transform = 'translateY(-2px)';
        this.style.boxShadow = `0 8px 25px ${style.hoverShadowColor}`;
    });
    
    button.addEventListener('mouseout', function() {
        this.style.transform = 'translateY(0)';
        this.style.boxShadow = `0 4px 15px ${style.shadowColor}`;
    });
    
    return button;
}

/**
 * Create a category section with title and buttons
 */
export function createCategorySection(category, configs) {
    const section = document.createElement('div');
    section.className = 'nitra-category-section';
    section.setAttribute('data-category', category);
    
    // Create category title
    const title = document.createElement('h3');
    title.className = 'nitra-category-title';
    title.textContent = `${getCategoryButtonStyle(category).icon} ${category}`;
    title.style.cssText = `
        color: #F0F0F0;
        font-size: 1.2em;
        font-weight: 600;
        margin: 20px 0 12px 0;
        padding-bottom: 8px;
        border-bottom: 2px solid #333;
    `;
    
    section.appendChild(title);
    
    // Create buttons for each config in this category
    configs.forEach((config, index) => {
        const button = createComfyConfigButton(config, index);
        section.appendChild(button);
    });
    
    return section;
}

