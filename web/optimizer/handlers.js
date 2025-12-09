// Optimizer installation handlers
// Extracted from ui/updateInterface.js

import * as state from '../core/state.js';
import { getWebsiteBaseUrl } from '../core/config.js';
import { Modal } from '../ui/components/Modal.js';
import { VersionCheckItem, VersionCheckGroup } from '../ui/components/VersionCheck.js';
import { Alert } from '../ui/components/Alert.js';
import { Button } from '../ui/components/Button.js';
import { div, h3, p, strong } from '../ui/components/core.js';
import { fetchComfyConfigsByCategory, createCategorySection, createComfyConfigButton, getCategoryButtonStyle, getAlternatingButtonStyle } from './comfy-config-api.js';
import { showSageAttentionModal } from './package-modals.js';
import { showRestartPrompt, showRefreshPrompt, showConfirmRestart, showConfirmRefresh } from '../ui/systemPrompts.js';

// Cache for package information to avoid repeated API calls
const packageInfoCache = new Map();
const systemVersionsCache = { cached: false, data: null };

// Clear all caches (useful for debugging or when system changes)
export function clearPackageCaches() {
    packageInfoCache.clear();
    systemVersionsCache.cached = false;
    systemVersionsCache.data = null;
    console.log('Nitra: All package caches cleared');
}

// Preload package information in background
async function preloadPackageInformation(configsByCategory) {
    try {
        console.log('Nitra: Preloading system versions...');
        
        // Preload system versions first
        if (!systemVersionsCache.cached) {
            systemVersionsCache.data = await getCurrentSystemVersions();
            systemVersionsCache.cached = true;
            console.log('Nitra: System versions cached:', systemVersionsCache.data);
        }
        
        // Get all unique package names first
        const uniquePackages = new Set();
        Object.values(configsByCategory).forEach(configs => {
            configs.forEach(config => {
                uniquePackages.add(config.packageSource);
            });
        });
        
        console.log(`Nitra: Found ${uniquePackages.size} unique packages to check`);
        
        // Make a single API call to get all package info at once
        try {
            const response = await fetch('/nitra/check-versions');
            if (response.ok) {
                const allPackageData = await response.json();
                console.log('Nitra: Got all package data in one call:', allPackageData);
                
                // Cache all package info at once
                uniquePackages.forEach(packageName => {
                    if (!packageInfoCache.has(packageName)) {
                        const packageInfo = extractPackageInfo(packageName, allPackageData);
                        packageInfoCache.set(packageName, packageInfo);
                        console.log(`Nitra: Cached package info for ${packageName}:`, packageInfo);
                    }
                });
                
                console.log('Nitra: Background preloading completed with single API call');
            } else {
                console.warn('Nitra: Failed to get package data, using fallback');
                // Fallback to individual calls only for packages that aren't cached
                await fallbackPackagePreloading(uniquePackages);
            }
        } catch (error) {
            console.warn('Nitra: Single API call failed, using fallback:', error);
            await fallbackPackagePreloading(uniquePackages);
        }
        
    } catch (error) {
        console.error('Nitra: Background preloading failed:', error);
    }
}

// Extract package info from the single API response
function extractPackageInfo(packageName, allPackageData) {
    let packageInfo = {
        installed: false,
        version: null,
        latest: null
    };
    
    // Map package names to response fields
    if (packageName === 'torch') {
        packageInfo.installed = allPackageData.torch?.installed;
        packageInfo.version = allPackageData.torch?.version;
    } else if (packageName === 'triton-windows') {
        packageInfo.installed = allPackageData.windows_triton?.installed;
        packageInfo.version = allPackageData.windows_triton?.version;
        packageInfo.latest = allPackageData.windows_triton?.latest_version;
    } else if (packageName.includes('sageattention') || packageName.includes('SageAttention')) {
        packageInfo.installed = allPackageData.sageattention?.installed;
        packageInfo.version = allPackageData.sageattention?.version;
        packageInfo.latest = allPackageData.sageattention?.latest_version;
    } else if (packageName === 'onnxruntime-gpu') {
        packageInfo.installed = allPackageData.onnxruntime_gpu?.installed;
        packageInfo.version = allPackageData.onnxruntime_gpu?.version;
        packageInfo.latest = allPackageData.onnxruntime_gpu?.latest_version;
    } else if (packageName === 'onnx') {
        packageInfo.installed = allPackageData.onnx?.installed;
        packageInfo.version = allPackageData.onnx?.version;
        packageInfo.latest = allPackageData.onnx?.latest_version;
    } else if (packageName === 'onnxruntime') {
        packageInfo.installed = allPackageData.onnxruntime?.installed;
        packageInfo.version = allPackageData.onnxruntime?.version;
    }
    
    return packageInfo;
}

// Fallback to individual package checks if single API call fails
async function fallbackPackagePreloading(uniquePackages) {
    const preloadPromises = [];
    
    uniquePackages.forEach(packageName => {
        if (!packageInfoCache.has(packageName)) {
            console.log(`Nitra: Fallback preloading package info for ${packageName}`);
            const promise = checkPackageInstallation(packageName)
                .then(packageInfo => {
                    packageInfoCache.set(packageName, packageInfo);
                    console.log(`Nitra: Cached package info for ${packageName}:`, packageInfo);
                })
                .catch(error => {
                    console.warn(`Nitra: Failed to preload ${packageName}:`, error);
                    packageInfoCache.set(packageName, {
                        installed: false,
                        version: null,
                        latest: null
                    });
                });
            preloadPromises.push(promise);
        }
    });
    
    // Run fallback preloads in parallel
    await Promise.allSettled(preloadPromises);
    console.log('Nitra: Fallback preloading completed');
}

// Show popup for all configs in a category
export async function showCategoryPopup(category, button) {
    try {
        console.log('Nitra: showCategoryPopup called for category:', category);
        
        // Check if this is a PyTorch category and show special interface
        if (category.toLowerCase() === 'pytorch' || category.toLowerCase() === 'torch') {
            console.log('Nitra: PyTorch category detected, showing special interface');
            await showPyTorchCategoryPopup(category, button);
            return;
        }
        
        // Use cached system versions if available, otherwise get them
        let systemVersions;
        if (systemVersionsCache.cached) {
            systemVersions = systemVersionsCache.data;
            console.log('Nitra: Using cached system versions:', systemVersions);
        } else {
            console.log('Nitra: Getting system versions (not cached)');
            systemVersions = await getCurrentSystemVersions();
            systemVersionsCache.data = systemVersions;
            systemVersionsCache.cached = true;
        }
        
        // Fetch all configs to get the ones for this category
        const configsByCategory = await fetchComfyConfigsByCategory();
        const configs = configsByCategory[category];
        if (!configs) {
            alert(`No configs found for category: ${category}`);
            return;
        }
        
        if (configs.length === 0) {
            alert(`No configs found for category: ${category}`);
            return;
        }
        
        // Find the matching config based on current versions
        const matchingConfig = findMatchingConfig(configs, systemVersions);
        
        if (!matchingConfig) {
            // Show popup explaining no compatible version found
            showNoCompatibleVersionPopup(category, configs, systemVersions, button);
            return;
        }
        
        // Use cached package info if available, otherwise get it
        let packageInfo;
        if (packageInfoCache.has(matchingConfig.packageSource)) {
            packageInfo = packageInfoCache.get(matchingConfig.packageSource);
            console.log('Nitra: Using cached package info for', matchingConfig.packageSource, ':', packageInfo);
        } else {
            console.log('Nitra: Package info not cached, getting it now for:', matchingConfig.packageSource);
            try {
                packageInfo = await checkPackageInstallation(matchingConfig.packageSource);
                packageInfoCache.set(matchingConfig.packageSource, packageInfo);
                console.log('Nitra: Package info result:', packageInfo);
            } catch (error) {
                console.warn('Failed to check package installation, assuming not installed:', error);
                packageInfo = {
                    installed: false,
                    version: null,
                    latest: null
                };
                packageInfoCache.set(matchingConfig.packageSource, packageInfo);
            }
        }
        
        // Show popup with only the matching config (should be instant now)
        console.log('Nitra: Showing popup instantly with cached data');
        showComfyConfigCategoryPopup(category, [matchingConfig], systemVersions, packageInfo, button);
        
    } catch (error) {
        console.error("Error fetching category configs:", error);
        alert(`Failed to load configs for category: ${category}`);
    }
}

// Show popup when no compatible version is found
function showNoCompatibleVersionPopup(category, configs, systemVersions, button) {
    const style = getCategoryButtonStyle(category);
    
    // Build OS detection section with current versions
    const osSection = Alert({
        type: 'warning',
        children: [
            p({}, `⚠️ No compatible ${category} package found for your system`),
            p({}, `Current Python: ${systemVersions.python}`),
            p({}, `Current PyTorch: ${systemVersions.torch}`),
            p({}, `Current CUDA: ${systemVersions.cuda}`)
        ]
    });
    
    // Build simple message section
    const packagesSection = div(
        {},
        h3({ style: { margin: '0 0 12px 0', color: '#F0F0F0', fontSize: '1.1em' } }, 'No Compatible Version'),
        p({ style: { color: '#A0BBC4', margin: '8px 0' } }, 
            `No ${category} package was found that matches your current system versions.`)
    );
    
    // Build alert section
    const alertSection = Alert({
        type: 'info',
        title: '📦 No Compatible Version',
        children: [
            p(
                {},
                `No ${category} package was found that matches your current system versions. `,
                'You may need to update your Python, PyTorch, or CUDA installation to use these packages.'
            )
        ]
    });
    
    // Build button group
    const buttonGroup = div(
        { className: 'nitra-button-group' },
        Button({
            text: 'Close',
            onClick: closeModal,
            variant: 'secondary'
        })
    );
    
    // Create and show modal
    const modal = Modal({
        title: `${style.icon} ${category} - No Compatible Version`,
        subtitle: `No compatible package found for your system`,
        onClose: closeModal,
        maxWidth: '600px',
        children: [
            osSection,
            packagesSection,
            alertSection,
            buttonGroup
        ]
    });
    
    document.body.appendChild(modal);
    
    function closeModal() {
        if (modal.parentElement) {
            document.body.removeChild(modal);
        }
    }
}

// Show popup with all configs in a category
function showComfyConfigCategoryPopup(category, configs, systemVersions, packageInfo, button) {
    const style = getCategoryButtonStyle(category);
    const matchingConfig = configs[0]; // Only one config now
    
    // Build OS detection section with current versions
    const osSection = Alert({
        type: 'success',
        children: [
            p({}, `✓ ${category} category detected - compatible version found`),
            p({}, `Current Python: ${systemVersions.python}`),
            p({}, `Current PyTorch: ${systemVersions.torch}`),
            p({}, `Current CUDA: ${systemVersions.cuda}`)
        ]
    });
    
    // Build package info section (only show the matching package)
    const infoSection = div(
        {},
        h3({ style: { margin: '0 0 12px 0', color: '#F0F0F0', fontSize: '1.1em' } }, 'Compatible Package Found'),
        VersionCheckItem({
            label: 'Package',
            current: matchingConfig.packageSource,
            required: matchingConfig.packageSource,
            status: 'match'
        }),
        matchingConfig.version ? VersionCheckItem({
            label: 'Version',
            current: matchingConfig.version,
            required: matchingConfig.version,
            status: 'match'
        }) : null,
        VersionCheckItem({
            label: 'Installation Status',
            current: packageInfo.installed ? `Installed (${packageInfo.version})` : 'Not installed',
            required: packageInfo.installed ? 'Already installed' : 'Will be installed',
            status: packageInfo.installed ? 'match' : 'mismatch'
        })
    );
    
    // Build requirements section (show actual requirements from matching config)
    const allRequirements = [];
    
    // Show Python version requirement if specified
    if (matchingConfig.pythonVersion && matchingConfig.pythonVersion.trim() !== '') {
        const pythonMatch = versionMatches(systemVersions.python, matchingConfig.pythonVersion);
        allRequirements.push(VersionCheckItem({
            label: 'Python Version',
            current: systemVersions.python,
            required: matchingConfig.pythonVersion,
            status: pythonMatch ? 'match' : 'mismatch'
        }));
    }
    
    // Show Operating System requirement if specified
    if (matchingConfig.operatingSystem && matchingConfig.operatingSystem.trim() !== '' && matchingConfig.operatingSystem !== 'Any') {
        allRequirements.push(VersionCheckItem({
            label: 'Operating System',
            current: 'Current system',
            required: matchingConfig.operatingSystem,
            status: 'check'
        }));
    }
    
    // Show PyTorch version requirement if specified (skip for PyTorch configs since they are foundation packages)
    const isPyTorchConfig = matchingConfig.packageSource && matchingConfig.packageSource.toLowerCase().includes('torch');
    if (matchingConfig.torchVersion && matchingConfig.torchVersion.trim() !== '' && !isPyTorchConfig) {
        const torchMatch = versionMatches(systemVersions.torch, matchingConfig.torchVersion);
        allRequirements.push(VersionCheckItem({
            label: 'PyTorch Version',
            current: systemVersions.torch,
            required: matchingConfig.torchVersion,
            status: torchMatch ? 'match' : 'mismatch'
        }));
    } else if (isPyTorchConfig) {
        // For PyTorch configs, show that any PyTorch version can be installed
        allRequirements.push(VersionCheckItem({
            label: 'PyTorch Version',
            current: systemVersions.torch,
            required: 'Any version (foundation package)',
            status: 'match'
        }));
    }
    
    // Show CUDA version requirement if specified
    if (matchingConfig.cudaVersion && matchingConfig.cudaVersion.trim() !== '') {
        const cudaMatch = versionMatches(systemVersions.cuda, matchingConfig.cudaVersion);
        allRequirements.push(VersionCheckItem({
            label: 'CUDA Version',
            current: systemVersions.cuda,
            required: matchingConfig.cudaVersion,
            status: cudaMatch ? 'match' : 'mismatch'
        }));
    }
    
    const requirementsSection = allRequirements.length > 0 ? div(
        {},
        h3({ style: { margin: '0 0 12px 0', color: '#F0F0F0', fontSize: '1.1em' } }, 'System Requirements'),
        VersionCheckGroup({
            children: allRequirements
        })
    ) : null;
    
    // Build dependencies section (show only matching config's dependencies)
    const dependenciesSection = matchingConfig.dependencies && matchingConfig.dependencies.length > 0 ? div(
        {},
        h3({ style: { margin: '0 0 12px 0', color: '#F0F0F0', fontSize: '1.1em' } }, 'Dependencies'),
        div(
            { style: { marginLeft: '16px' } },
            ...matchingConfig.dependencies.map(dep => {
                const depText = typeof dep === 'string' ? dep : dep.S;
                return p({ style: { margin: '4px 0', color: '#A0BBC4' } }, `• ${depText}`);
            })
        )
    ) : null;
    
    // Build alert section
    const alertSection = Alert({
        type: packageInfo.installed ? 'warning' : 'info',
        title: packageInfo.installed ? '📦 Package Update' : '📦 Package Installation',
        children: [
            p(
                {},
                packageInfo.installed 
                    ? `This will update the existing ${category} package (${matchingConfig.packageSource}) that matches your current Python ${systemVersions.python} and PyTorch ${systemVersions.torch} installation. The installation process may take several minutes.`
                    : `This will install the compatible ${category} package version (${matchingConfig.packageSource}) that matches your current Python ${systemVersions.python} and PyTorch ${systemVersions.torch} installation. The installation process may take several minutes.`
            )
        ]
    });
    
    // Build button group
    const buttonGroup = div(
        { className: 'nitra-button-group' },
        Button({
            text: 'Cancel',
            onClick: closeModal,
            variant: 'secondary'
        }),
        Button({
            text: packageInfo.installed 
                ? `Update ${matchingConfig.packageSource}` 
                : `Install ${matchingConfig.packageSource}`,
            onClick: async () => {
                closeModal();
                await installMatchingConfig(matchingConfig, button);
            },
            variant: 'primary',
            large: true
        })
    );
    
    // Create and show modal
    const modal = Modal({
        title: `${style.icon} ${category} ${packageInfo.installed ? 'Package Update' : 'Package Installation'}`,
        subtitle: packageInfo.installed 
            ? `Update ${matchingConfig.packageSource} (${packageInfo.version} → ${matchingConfig.version})`
            : `Install ${matchingConfig.packageSource}`,
        onClose: closeModal,
        maxWidth: '600px',
        children: [
            osSection,
            infoSection,
            requirementsSection,
            dependenciesSection,
            alertSection,
            buttonGroup
        ].filter(Boolean) // Remove null/undefined children
    });
    
    document.body.appendChild(modal);
    
    function closeModal() {
        if (modal.parentElement) {
            document.body.removeChild(modal);
        }
    }
}

// Install the matching config based on current system versions
async function installMatchingConfig(matchingConfig, button) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Installing compatible version...";
    
    try {
        console.log('Installing matching config:', matchingConfig);
        
        // Install the matching config
        await installComfyConfig(matchingConfig.id, button);
        
        // Invalidate cache for this package since it's now installed/updated
        packageInfoCache.delete(matchingConfig.packageSource);
        console.log('Nitra: Invalidated cache for', matchingConfig.packageSource);
        
        button.textContent = "Installation Complete";
        setTimeout(() => {
            button.textContent = originalText;
            button.disabled = false;
        }, 2000);
        
    } catch (error) {
        console.error("Error installing config:", error);
        button.textContent = "Installation Failed";
        setTimeout(() => {
            button.textContent = originalText;
            button.disabled = false;
        }, 2000);
    }
}

// Check if a package is already installed and get its version
async function checkPackageInstallation(packageName) {
    try {
        // Use GET request with package name as query parameter
        const response = await fetch(`/nitra/check-versions?package=${encodeURIComponent(packageName)}`);
        
        if (response.ok) {
            const data = await response.json();
            
            // Extract package-specific info from the response
            let packageInfo = {
                installed: false,
                version: null,
                latest: null
            };
            
            // Map common package names to response fields
            if (packageName === 'torch') {
                packageInfo.installed = data.torch?.installed;
                packageInfo.version = data.torch?.version;
            } else if (packageName === 'triton-windows') {
                packageInfo.installed = data.windows_triton?.installed;
                packageInfo.version = data.windows_triton?.version;
                packageInfo.latest = data.windows_triton?.latest_version;
            } else if (packageName.includes('sageattention') || packageName.includes('SageAttention')) {
                packageInfo.installed = data.sageattention?.installed;
                packageInfo.version = data.sageattention?.version;
                packageInfo.latest = data.sageattention?.latest_version;
            } else if (packageName === 'onnxruntime-gpu') {
                packageInfo.installed = data.onnxruntime_gpu?.installed;
                packageInfo.version = data.onnxruntime_gpu?.version;
                packageInfo.latest = data.onnxruntime_gpu?.latest_version;
            } else if (packageName === 'onnx') {
                packageInfo.installed = data.onnx?.installed;
                packageInfo.version = data.onnx?.version;
                packageInfo.latest = data.onnx?.latest_version;
            } else if (packageName === 'onnxruntime') {
                packageInfo.installed = data.onnxruntime?.installed;
                packageInfo.version = data.onnxruntime?.version;
            } else {
                // For unknown packages, assume not installed
                console.log(`Package ${packageName} not recognized, assuming not installed`);
            }
            
            return packageInfo;
        } else {
            console.warn(`Failed to check package ${packageName}: ${response.status}`);
            return {
                installed: false,
                version: null,
                latest: null
            };
        }
    } catch (error) {
        console.error(`Error checking package ${packageName}:`, error);
        return {
            installed: false,
            version: null,
            latest: null
        };
    }
}

// Get current system versions
async function getCurrentSystemVersions() {
    try {
        // Get Python version
        const pythonVersion = await getPythonVersion();
        
        // Get PyTorch version
        const torchVersion = await getPyTorchVersion();
        
        // Extract CUDA version from PyTorch version (e.g., 2.8.0+cu128 -> 12.8)
        let cudaVersion = null;
        let cleanTorchVersion = torchVersion;
        if (torchVersion) {
            const cudaMatch = torchVersion.match(/\+cu(\d+)/);
            if (cudaMatch) {
                const cudaCode = cudaMatch[1];
                // Convert CUDA code to version: 128 -> 12.8, 118 -> 11.8, etc.
                const major = cudaCode.substring(0, cudaCode.length - 1);
                const minor = cudaCode.substring(cudaCode.length - 1);
                cudaVersion = `${major}.${minor}`;
                
                // Clean the torch version to remove CUDA suffix
                cleanTorchVersion = torchVersion.replace(/\+cu\d+.*$/, '');
            }
        }
        
        // If no CUDA in PyTorch version, try to get it directly
        if (!cudaVersion) {
            cudaVersion = await getCudaVersion();
        }
        
        return {
            python: pythonVersion,
            torch: cleanTorchVersion,
            cuda: cudaVersion
        };
    } catch (error) {
        console.error('Error getting system versions:', error);
        return {
            python: null,
            torch: null,
            cuda: null
        };
    }
}

// Get Python version
async function getPythonVersion() {
    try {
        const response = await fetch('/nitra/check-versions');
        const data = await response.json();
        const pythonVersion = data.python?.version;
        console.log('Detected Python version:', pythonVersion);
        return pythonVersion;
    } catch (error) {
        console.error('Error getting Python version:', error);
        return null;
    }
}

// Get PyTorch version
async function getPyTorchVersion() {
    try {
        const response = await fetch('/nitra/check-versions');
        const data = await response.json();
        const torchVersion = data.torch?.version;
        console.log('Detected PyTorch version:', torchVersion);
        return torchVersion;
    } catch (error) {
        console.error('Error getting PyTorch version:', error);
        return null;
    }
}

// Get CUDA version
async function getCudaVersion() {
    try {
        const response = await fetch('/nitra/check-versions');
        const data = await response.json();
        const cudaVersion = data.cuda?.version;
        console.log('Detected CUDA version:', cudaVersion);
        return cudaVersion;
    } catch (error) {
        console.error('Error getting CUDA version:', error);
        return null;
    }
}

// Find the config that matches current system versions
function findMatchingConfig(configs, systemVersions) {
    console.log('Finding matching config for detected versions:', systemVersions);
    console.log('Available configs:', configs.map(c => ({
        id: c.id,
        packageSource: c.packageSource,
        pythonVersion: c.pythonVersion,
        torchVersion: c.torchVersion,
        cudaVersion: c.cudaVersion
    })));
    
    // Find config that matches current versions
    for (const config of configs) {
        let matches = true;
        
        // Check Python version match (exact match or version range)
        if (config.pythonVersion && config.pythonVersion.trim() !== '') {
            if (!systemVersions.python || !versionMatches(config.pythonVersion, systemVersions.python)) {
                matches = false;
                console.log(`❌ Python version mismatch: config requires ${config.pythonVersion}, system has ${systemVersions.python}`);
            } else {
                console.log(`✅ Python version match: config requires ${config.pythonVersion}, system has ${systemVersions.python}`);
            }
        }
        
        // For PyTorch configs, skip PyTorch version matching since PyTorch is the foundation package
        // that other packages depend on, so we can upgrade to any PyTorch version
        const isPyTorchConfig = config.packageSource && config.packageSource.toLowerCase().includes('torch');
        if (!isPyTorchConfig && config.torchVersion && config.torchVersion.trim() !== '') {
            if (!systemVersions.torch || !versionMatches(config.torchVersion, systemVersions.torch)) {
                matches = false;
                console.log(`❌ PyTorch version mismatch: config requires ${config.torchVersion}, system has ${systemVersions.torch}`);
            } else {
                console.log(`✅ PyTorch version match: config requires ${config.torchVersion}, system has ${systemVersions.torch}`);
            }
        } else if (isPyTorchConfig) {
            console.log(`🔥 PyTorch config detected - skipping PyTorch version matching (foundation package)`);
        }
        
        // Check CUDA version match (exact match or version range)
        if (config.cudaVersion && config.cudaVersion.trim() !== '') {
            if (!systemVersions.cuda || !versionMatches(config.cudaVersion, systemVersions.cuda)) {
                matches = false;
                console.log(`❌ CUDA version mismatch: config requires ${config.cudaVersion}, system has ${systemVersions.cuda}`);
            } else {
                console.log(`✅ CUDA version match: config requires ${config.cudaVersion}, system has ${systemVersions.cuda}`);
            }
        }
        
        if (matches) {
            console.log(`🎯 Found matching config: ${config.packageSource} (ID: ${config.id})`);
            return config;
        }
    }
    
    console.log('❌ No matching config found for current system versions');
    return null;
}

// Check if version matches (supports version ranges like ">=3.8", "==2.0.1", etc.)
function versionMatches(required, current) {
    if (!required || !current) return false;
    
    // Remove any whitespace
    required = required.trim();
    current = current.trim();
    
    // Handle exact match
    if (required === current) return true;
    
    // Handle version operators
    if (required.startsWith('>=')) {
        const minVersion = required.substring(2);
        return compareVersions(current, minVersion) >= 0;
    }
    
    if (required.startsWith('>')) {
        const minVersion = required.substring(1);
        return compareVersions(current, minVersion) > 0;
    }
    
    if (required.startsWith('<=')) {
        const maxVersion = required.substring(2);
        return compareVersions(current, maxVersion) <= 0;
    }
    
    if (required.startsWith('<')) {
        const maxVersion = required.substring(1);
        return compareVersions(current, maxVersion) < 0;
    }
    
    if (required.startsWith('==')) {
        const exactVersion = required.substring(2);
        return exactVersion === current;
    }
    
    // Default to exact match
    return required === current;
}

// Simple version comparison (handles basic semantic versioning)
function compareVersions(version1, version2) {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);
    
    const maxLength = Math.max(v1Parts.length, v2Parts.length);
    
    for (let i = 0; i < maxLength; i++) {
        const v1Part = v1Parts[i];
        const v2Part = v2Parts[i];
        
        if (v1Part > v2Part) return 1;
        if (v1Part < v2Part) return -1;
    }
    
    return 0;
}

// Unified comfy config installer with popup
export async function installComfyConfig(configId, button) {
    // First fetch the comfy config to show requirements popup
    try {
        const configResponse = await fetch(`${getWebsiteBaseUrl()}/api/comfy-configs/${configId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.currentUser.apiToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!configResponse.ok) {
            throw new Error(`Failed to fetch config: ${configResponse.status}`);
        }
        
        const config = await configResponse.json();
        
        // Show popup with requirements
        showComfyConfigPopup(config, button);
        
    } catch (error) {
        console.error("Error fetching comfy config:", error);
        alert(`Failed to load package information: ${error.message}`);
    }
}

// Show comfy config popup with requirements
function showComfyConfigPopup(config, button) {
    // Handle DynamoDB format - extract values from nested objects
    const packageSource = config.packageSource?.S || config.packageSource;
    const version = config.version?.S || config.version;
    const category = config.category?.S || config.category;
    
    // Check if this is a PyTorch config and show special interface
    const isPyTorchPackage = packageSource && (
        packageSource.toLowerCase() === 'torch' || 
        packageSource.toLowerCase().includes('torch')
    );
    
    console.log('PyTorch detection:', {
        packageSource,
        isPyTorchPackage,
        category
    });
    
    if (isPyTorchPackage) {
        showPyTorchConfigPopup(config, button);
        return;
    }
    
    // Build OS detection section
    const osSection = Alert({
        type: 'success',
        children: [
            p({}, `✓ ${category} package detected`)
        ]
    });
    
    // Build package info section
    const infoSection = div(
        {},
        h3({ style: { margin: '0 0 12px 0', color: '#F0F0F0', fontSize: '1.1em' } }, 'Package Information'),
        VersionCheckItem({
            label: 'Package Source',
            current: packageSource,
            required: packageSource,
            status: 'match'
        }),
        version ? VersionCheckItem({
            label: 'Version',
            current: version,
            required: version,
            status: 'match'
        }) : null
    );
    
    // Build requirements section (only show non-empty requirements)
    const requirements = [];
    
    if (config.pythonVersion) {
        requirements.push(VersionCheckItem({
            label: 'Python Version',
            current: 'Current system version',
            required: config.pythonVersion,
            status: 'check'
        }));
    }
    
    if (config.operatingSystem && config.operatingSystem !== 'Any') {
        requirements.push(VersionCheckItem({
            label: 'Operating System',
            current: 'Current system',
            required: config.operatingSystem,
            status: 'check'
        }));
    }
    
    // Handle PyTorch version requirement differently for PyTorch configs
    const isPyTorchPackageConfig = config.packageSource && config.packageSource.toLowerCase().includes('torch');
    if (config.torchVersion && !isPyTorchPackageConfig) {
        requirements.push(VersionCheckItem({
            label: 'PyTorch Version',
            current: 'Current installation',
            required: config.torchVersion,
            status: 'check'
        }));
    } else if (isPyTorchPackageConfig) {
        // For PyTorch configs, show that any version can be installed
        requirements.push(VersionCheckItem({
            label: 'PyTorch Version',
            current: 'Current installation',
            required: 'Any version (foundation package)',
            status: 'match'
        }));
    }
    
    if (config.cudaVersion) {
        requirements.push(VersionCheckItem({
            label: 'CUDA Version',
            current: 'Current installation',
            required: config.cudaVersion,
            status: 'check'
        }));
    }
    
    const requirementsSection = requirements.length > 0 ? div(
        {},
        h3({ style: { margin: '0 0 12px 0', color: '#F0F0F0', fontSize: '1.1em' } }, 'System Requirements'),
        VersionCheckGroup({
            children: requirements
        })
    ) : null;
    
    // Build dependencies section (only show if there are dependencies)
    const dependenciesSection = config.dependencies && config.dependencies.length > 0 ? div(
        {},
        h3({ style: { margin: '0 0 12px 0', color: '#F0F0F0', fontSize: '1.1em' } }, 'Dependencies'),
        div(
            { style: { marginLeft: '16px' } },
            ...config.dependencies.map(dep => p({ style: { margin: '4px 0', color: '#A0BBC4' } }, `• ${dep}`))
        )
    ) : null;
    
    // Build alert section
    const alertSection = Alert({
        type: 'info',
        title: '📦 Package Installation',
        children: [
            p(
                {},
                `This will install ${packageSource}${version ? ` ${version}` : ''} and its dependencies. `,
                'The installation process may take several minutes.'
            )
        ]
    });
    
    // Build button group
    const buttonGroup = div(
        { className: 'nitra-button-group' },
        Button({
            text: 'Cancel',
            onClick: closeModal,
            variant: 'secondary'
        }),
        Button({
            text: 'Install Package',
            onClick: async () => {
                closeModal();
                await runComfyConfigInstall(config.id, button);
            },
            variant: 'primary',
            large: true
        })
    );
    
    // Create and show modal
    const modal = Modal({
        title: `${category} Package Installation`,
        subtitle: `Install ${packageSource}${version ? ` ${version}` : ''}`,
        onClose: closeModal,
        maxWidth: '600px',
        children: [
            osSection,
            infoSection,
            requirementsSection,
            dependenciesSection,
            alertSection,
            buttonGroup
        ].filter(Boolean) // Remove null/undefined children
    });
    
    document.body.appendChild(modal);
    
    function closeModal() {
        if (modal.parentElement) {
            document.body.removeChild(modal);
        }
    }
}

// Run the actual comfy config installation
async function runComfyConfigInstall(configId, button) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Installing...";
    
    try {
        const response = await fetch('/nitra/install/comfy-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.currentUser.apiToken}`
            },
            body: JSON.stringify({
                config_id: configId,
                user_id: state.currentUser.id,
                user_email: state.currentUser.email
            })
        });
        
        if (!response.ok) {
            throw new Error(`Installation failed: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.status === 'success') {
            alert(`Package installed successfully: ${result.message}`);
            button.textContent = "✓ Installed";
            button.style.background = "#4CAF50";
        } else {
            throw new Error(result.message);
        }
        
    } catch (error) {
        console.error("Comfy config installation error:", error);
        alert(`Failed to install package: ${error.message}`);
        button.disabled = false;
        button.textContent = originalText;
    }
}

// Dynamic comfy config button loader
export async function loadComfyConfigButtons(container) {
    console.log('Nitra: loadComfyConfigButtons called with container:', container);
    
    if (!container) {
        console.error('Nitra: No container provided to loadComfyConfigButtons');
        return;
    }
    
    try {
        console.log('Nitra: Starting to load comfy config buttons');
        
        // Show loading state
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'nitra-loading-comfy-configs';
        loadingDiv.innerHTML = `
            <div style="
                text-align: center;
                padding: 20px;
                color: #F0F0F0;
                font-style: italic;
            ">
                Loading optimizer packages...
            </div>
        `;
        container.appendChild(loadingDiv);
        console.log('Nitra: Added loading indicator');
        
        // Fetch comfy configs grouped by category
        console.log('Nitra: Fetching comfy configs by category');
        const configsByCategory = await fetchComfyConfigsByCategory();
        console.log('Nitra: Fetched configs by category:', configsByCategory);
        
        // Remove loading indicator
        if (loadingDiv.parentNode) {
            loadingDiv.parentNode.removeChild(loadingDiv);
        }
        console.log('Nitra: Removed loading indicator');
        
        // Clear existing comfy config buttons (but keep PyTorch and system buttons)
        const existingComfyConfigButtons = container.querySelectorAll('.nitra-comfy-config-btn, .nitra-category-section');
        console.log('Nitra: Found existing buttons to remove:', existingComfyConfigButtons.length);
        existingComfyConfigButtons.forEach(btn => btn.remove());
        
        // Create sections for each category
        const categories = Object.keys(configsByCategory).sort();
        console.log('Nitra: Categories found:', categories);
        console.log('Nitra: Number of unique categories:', categories.length);
        
        // Log each category and its configs
        categories.forEach(category => {
            const configs = configsByCategory[category];
            console.log(`Nitra: Category "${category}" has ${configs.length} configs:`, configs.map(c => c.packageSource));
        });
        
        if (categories.length === 0) {
            const noConfigsDiv = document.createElement('div');
            noConfigsDiv.className = 'nitra-no-configs';
            noConfigsDiv.innerHTML = `
                <div style="
                    text-align: center;
                    padding: 20px;
                    color: #888;
                    font-style: italic;
                ">
                    No optimizer packages available. Check back later!
                </div>
            `;
            container.appendChild(noConfigsDiv);
            return;
        }
        
        // Create one button per unique category with alternating colors
        categories.forEach((category, index) => {
            const configs = configsByCategory[category];
            // Create a single button for this category (use the first config as representative)
            const representativeConfig = configs[0];
            const button = createComfyConfigButton(representativeConfig, index);
            button.setAttribute('data-category', category);
            button.setAttribute('data-category-count', configs.length.toString());
            
            // Update button text to show category name only
            const style = getAlternatingButtonStyle(index);
            button.innerHTML = `${style.icon} ${category}`;
            
            container.appendChild(button);
        });
        
        // Preload package information in background for all categories
        console.log('Nitra: Starting background package preloading...');
        preloadPackageInformation(configsByCategory);
        
        // Add event listeners to all new buttons
        const newButtons = container.querySelectorAll('.nitra-comfy-config-btn');
        newButtons.forEach(button => {
            const category = button.getAttribute('data-category');
            button.addEventListener('click', () => {
                showCategoryPopup(category, button);
            });
        });
        
        console.log(`Loaded ${categories.length} categories with ${Object.values(configsByCategory).flat().length} total packages`);
        
    } catch (error) {
        console.error('Error loading comfy config buttons:', error);
        
        // Remove loading indicator
        const loadingDiv = container.querySelector('.nitra-loading-comfy-configs');
        if (loadingDiv) {
            loadingDiv.remove();
        }
        
        // Show error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'nitra-comfy-config-error';
        errorDiv.innerHTML = `
            <div style="
                text-align: center;
                padding: 20px;
                color: #D14E72;
                font-weight: 600;
            ">
                Failed to load optimizer packages. Please try refreshing the page.
            </div>
        `;
        container.appendChild(errorDiv);
    }
}

async function checkInstalledVersions() {
    try {
        const response = await fetch('/nitra/check-versions', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.currentUser.apiToken}`
            }
        });
        
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error("Failed to check versions:", error);
        return null;
    }
}

function showLinuxTritonMessage(versions) {
    const hasTriton = versions?.triton?.installed;
    const tritonVersion = versions?.triton?.version;
    
    // Build warning message
    const warningSection = Alert({
        type: 'warning',
        title: '⚠️ Linux Operating System Detected',
        children: [
            p(
                {},
                strong({}, 'Windows-Triton should not be installed on Linux operating systems.'),
                ' This package is specifically for Windows and will not work on Linux.'
            )
        ]
    });
    
    // Build version info section
    const versionSection = div(
        {},
        h3({ style: { margin: '0 0 12px 0', color: '#F0F0F0', fontSize: '1.1em' } }, 'Installed Triton Version'),
        div(
            { className: 'nitra-version-group' },
            VersionCheckItem({
                label: 'Triton (Linux)',
                installed: hasTriton,
                version: tritonVersion
            })
        )
    );
    
    // Build button group (only close button)
    const buttonGroup = div(
        { className: 'nitra-button-group' },
        Button({
            text: 'Close',
            onClick: closeModal,
            variant: 'secondary'
        })
    );
    
    // Create and show modal
    const modal = Modal({
        title: 'Windows-Triton Not Supported',
        subtitle: 'This feature is only available on Windows systems',
        onClose: closeModal,
        maxWidth: '600px',
        children: [
            warningSection,
            versionSection,
            buttonGroup
        ]
    });
    
    document.body.appendChild(modal);
    
    function closeModal() {
        if (modal.parentElement) {
            document.body.removeChild(modal);
        }
    }
}

function showWindowsTritonPopup(button, versions) {
    console.log('Nitra: OS detection - versions object:', versions);
    console.log('Nitra: Detected OS:', versions?.os);
    
    const isLinux = versions?.os === 'Linux';
    const isWindows = versions?.os === 'Windows';
    
    console.log('Nitra: isLinux:', isLinux, 'isWindows:', isWindows);
    
    // If Linux, show different UI
    if (isLinux) {
        console.log('Nitra: Showing Linux message');
        showLinuxTritonMessage(versions);
        return;
    }
    
    console.log('Nitra: Showing Windows installation popup');
    
    const hasVSTools = versions?.vs_build_tools?.installed;
    const hasPython = versions?.python?.version;
    const hasTriton = versions?.windows_triton?.installed;
    const installedVersion = versions?.windows_triton?.version;
    const latestVersion = versions?.windows_triton?.latest_version;
    
    const needsInstall = !hasVSTools || !hasTriton;
    const needsUpdate = hasTriton && installedVersion && latestVersion && installedVersion !== latestVersion;
    
    // Determine Windows-Triton display text (without 'v' prefix - component adds it)
    let tritonVersionText = null;
    if (hasTriton && installedVersion) {
        tritonVersionText = installedVersion;
        if (latestVersion && installedVersion !== latestVersion) {
            tritonVersionText = `${installedVersion} → ${latestVersion} available`;
        }
    }
    
    // Build OS detection message
    const osSection = Alert({
        type: 'success',
        children: [
            p({}, `✓ Windows operating system detected`)
        ]
    });
    
    // Build important info section
    const infoSection = Alert({
        type: 'info',
        title: 'ℹ️ Important',
        children: [
            p(
                {},
                'Visual Studio Build Tools may prompt for installation or updates. ',
                strong({}, 'Please walk through all VS Build Tools installation screens'),
                ' that appear to successfully complete the installation.'
            )
        ]
    });
    
    // Build version check section
    const hasTorch = versions?.torch?.installed;
    const torchVersion = versions?.torch?.version;
    
    const versionSection = div(
        {},
        h3({ style: { margin: '0 0 12px 0', color: '#F0F0F0', fontSize: '1.1em' } }, 'Current Versions'),
        VersionCheckGroup({
            children: [
                VersionCheckItem({
                    label: 'Visual Studio Build Tools',
                    installed: hasVSTools,
                    version: null
                }),
                VersionCheckItem({
                    label: 'Python',
                    installed: !!hasPython,
                    version: versions?.python?.version
                }),
                VersionCheckItem({
                    label: 'PyTorch',
                    installed: hasTorch,
                    version: torchVersion
                }),
                VersionCheckItem({
                    label: 'Windows-Triton',
                    installed: hasTriton,
                    version: tritonVersionText
                })
            ]
        })
    );
    
    // Build alert section
    let alertSection;
    if (needsInstall) {
        alertSection = Alert({
            type: 'warning',
            title: '⚠️ Installation Required',
            children: [
                p(
                    {},
                    'Missing components will be installed on your PC. ',
                    strong({}, 'Please accept any system popups'),
                    ' that appear during installation. The process may take several minutes.'
                )
            ]
        });
    } else if (needsUpdate) {
        alertSection = Alert({
            type: 'info',
            title: '🔄 Update Available',
            children: [
                p(
                    {},
                    `A newer version of Windows-Triton is available (v${latestVersion}). `,
                    'Click Update to install the latest version.'
                )
            ]
        });
    } else {
        alertSection = Alert({
            type: 'success',
            children: [
                p({}, '✓ All components are up to date')
            ]
        });
    }
    
    // Determine button text
    let actionButtonText = 'Reinstall';
    if (needsInstall) {
        actionButtonText = 'Install Now';
    } else if (needsUpdate) {
        actionButtonText = 'Update';
    }
    
    // Build button group
    const buttonGroup = div(
        { className: 'nitra-button-group' },
        Button({
            text: 'Cancel',
            onClick: closeModal,
            variant: 'secondary'
        }),
        Button({
            text: actionButtonText,
            onClick: async () => {
                closeModal();
                await runWindowsTritonInstall(button);
            },
            variant: 'primary',
            large: true
        })
    );
    
    // Create and show modal
    const modal = Modal({
        title: 'Windows-Triton Installation',
        subtitle: 'Review the current installation status before proceeding',
        onClose: closeModal,
        maxWidth: '600px',
        children: [
            osSection,
            infoSection,
            versionSection,
            alertSection,
            buttonGroup
        ]
    });
    
    document.body.appendChild(modal);
    
    function closeModal() {
        if (modal.parentElement) {
            document.body.removeChild(modal);
        }
    }
}

async function runWindowsTritonInstall(button) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Installing Windows-Triton...";
    
    try {
        const response = await fetch('/nitra/install/windows-triton', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.currentUser.apiToken}`
            },
            body: JSON.stringify({
                user_id: state.currentUser.id,
                user_email: state.currentUser.email
            })
        });
        
        if (!response.ok) {
            throw new Error(`Installation failed: ${response.status}`);
        }
        
        const result = await response.json();
        alert("Windows-Triton installed successfully!");
        button.textContent = "✓ Installed";
        button.style.background = "#4CAF50";
        
    } catch (error) {
        console.error("Windows-Triton installation error:", error);
        alert("Failed to install Windows-Triton. Please try again.");
        button.disabled = false;
        button.textContent = originalText;
    }
}

export async function installWindowsTriton(button) {
    // Check versions first
    const versions = await checkInstalledVersions();
    
    if (!versions) {
        // Fallback to direct install if version check fails
        if (confirm("Unable to check current versions. Proceed with installation anyway?")) {
            await runWindowsTritonInstall(button);
        }
        return;
    }
    
    // Show popup with version information
    showWindowsTritonPopup(button, versions);
}


export async function installSageattention(button) {
    // Show the new OS-specific SageAttention modal
    await showSageAttentionModal();
}

function showOnnxConfigurationPopup(button, versions) {
    const hasOnnx = versions?.onnx?.installed;
    const onnxVersion = versions?.onnx?.version;
    const onnxLatestVersion = versions?.onnx?.latest_version;
    
    const hasOnnxruntime = versions?.onnxruntime?.installed;
    const onnxruntimeVersion = versions?.onnxruntime?.version;
    
    const hasOnnxruntimeGpu = versions?.onnxruntime_gpu?.installed;
    const onnxruntimeGpuVersion = versions?.onnxruntime_gpu?.version;
    const onnxruntimeGpuLatestVersion = versions?.onnxruntime_gpu?.latest_version;
    
    const hasPython = versions?.python?.version;
    const hasTorch = versions?.torch?.installed;
    const torchVersion = versions?.torch?.version;
    
    const needsConfiguration = !hasOnnx || !hasOnnxruntimeGpu || hasOnnxruntime;
    const needsUpdate = (hasOnnx && onnxVersion && onnxLatestVersion && onnxVersion !== onnxLatestVersion) ||
                        (hasOnnxruntimeGpu && onnxruntimeGpuVersion && onnxruntimeGpuLatestVersion && onnxruntimeGpuVersion !== onnxruntimeGpuLatestVersion);
    
    // Build version display text for onnx
    let onnxVersionText = null;
    if (hasOnnx && onnxVersion) {
        onnxVersionText = onnxVersion;
        if (onnxLatestVersion && onnxVersion !== onnxLatestVersion) {
            onnxVersionText = `${onnxVersion} → ${onnxLatestVersion} available`;
        }
    }
    
    // Build version display text for onnxruntime-gpu
    let onnxruntimeGpuVersionText = null;
    if (hasOnnxruntimeGpu && onnxruntimeGpuVersion) {
        onnxruntimeGpuVersionText = onnxruntimeGpuVersion;
        if (onnxruntimeGpuLatestVersion && onnxruntimeGpuVersion !== onnxruntimeGpuLatestVersion) {
            onnxruntimeGpuVersionText = `${onnxruntimeGpuVersion} → ${onnxruntimeGpuLatestVersion} available`;
        }
    }
    
    // Build info section
    const infoSection = Alert({
        type: 'info',
        title: 'ℹ️ ONNX Configuration',
        children: [
            p(
                {},
                'This configuration optimizes ONNX Runtime for GPU usage, which ',
                strong({}, 'fixes slow pose map and depth map generation'),
                '. The CPU-only version (onnxruntime) will be removed if present, and the GPU version (onnxruntime-gpu) will be installed.'
            )
        ]
    });
    
    // Build version check section
    const versionSection = div(
        {},
        h3({ style: { margin: '0 0 12px 0', color: '#F0F0F0', fontSize: '1.1em' } }, 'Current Versions'),
        VersionCheckGroup({
            children: [
                VersionCheckItem({
                    label: 'Python',
                    installed: !!hasPython,
                    version: hasPython
                }),
                VersionCheckItem({
                    label: 'PyTorch',
                    installed: hasTorch,
                    version: torchVersion
                }),
                VersionCheckItem({
                    label: 'ONNX',
                    installed: hasOnnx,
                    version: onnxVersionText
                }),
                VersionCheckItem({
                    label: 'ONNX Runtime GPU',
                    installed: hasOnnxruntimeGpu,
                    version: onnxruntimeGpuVersionText
                }),
                VersionCheckItem({
                    label: 'ONNX Runtime CPU (should NOT be installed)',
                    installed: true,
                    version: hasOnnxruntime ? `${onnxruntimeVersion} (will be removed)` : 'Not installed ✓',
                    isWarning: hasOnnxruntime
                })
            ]
        })
    );
    
    // Build alert section
    let alertSection;
    if (hasOnnxruntime) {
        alertSection = Alert({
            type: 'warning',
            title: '⚠️ Configuration Required',
            children: [
                p(
                    {},
                    'ONNX Runtime CPU version is installed and will be removed. ',
                    strong({}, 'This is necessary to avoid conflicts'),
                    ' with the GPU-accelerated version.'
                )
            ]
        });
    } else if (needsConfiguration) {
        alertSection = Alert({
            type: 'warning',
            title: '⚠️ Configuration Required',
            children: [
                p(
                    {},
                    'Missing ONNX packages will be installed. ',
                    'This will improve performance for pose maps and depth maps.'
                )
            ]
        });
    } else if (needsUpdate) {
        alertSection = Alert({
            type: 'info',
            title: '🔄 Updates Available',
            children: [
                p(
                    {},
                    'Newer versions of ONNX packages are available. ',
                    'Click Configure to update to the latest versions.'
                )
            ]
        });
    } else {
        alertSection = Alert({
            type: 'success',
            children: [
                p({}, '✓ ONNX packages are correctly configured')
            ]
        });
    }
    
    // Determine button text
    let actionButtonText = 'Reconfigure';
    if (needsConfiguration || hasOnnxruntime) {
        actionButtonText = 'Configure Now';
    } else if (needsUpdate) {
        actionButtonText = 'Update';
    }
    
    // Build button group
    const buttonGroup = div(
        { className: 'nitra-button-group' },
        Button({
            text: 'Cancel',
            onClick: closeModal,
            variant: 'secondary'
        }),
        Button({
            text: actionButtonText,
            onClick: async () => {
                closeModal();
                await runOnnxConfiguration(button);
            },
            variant: 'primary',
            large: true
        })
    );
    
    // Create and show modal
    const modal = Modal({
        title: 'ONNX Configuration',
        subtitle: 'Fixes slow pose map and depth map generation',
        onClose: closeModal,
        maxWidth: '600px',
        children: [
            infoSection,
            versionSection,
            alertSection,
            buttonGroup
        ]
    });
    
    document.body.appendChild(modal);
    
    function closeModal() {
        if (modal.parentElement) {
            document.body.removeChild(modal);
        }
    }
}

async function runOnnxConfiguration(button) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Configuring ONNX...";
    
    try {
        const response = await fetch('/nitra/install/onnx', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.currentUser.apiToken}`
            },
            body: JSON.stringify({
                user_id: state.currentUser.id,
                user_email: state.currentUser.email
            })
        });
        
        if (!response.ok) {
            throw new Error(`Configuration failed: ${response.status}`);
        }
        
        const result = await response.json();
        alert("ONNX packages configured successfully!");
        button.textContent = "✓ Configured";
        button.style.background = "#4CAF50";
        
    } catch (error) {
        console.error("ONNX configuration error:", error);
        alert("Failed to configure ONNX packages. Please try again.");
        button.disabled = false;
        button.textContent = originalText;
    }
}

export async function installOnnx(button) {
    // Check versions first
    const versions = await checkInstalledVersions();
    
    if (!versions) {
        // Fallback to direct configuration if version check fails
        if (confirm("Unable to check current versions. Proceed with configuration anyway?")) {
            await runOnnxConfiguration(button);
        }
        return;
    }
    
    // Show popup with version information
    showOnnxConfigurationPopup(button, versions);
}

async function fetchAvailableTorchVersions() {
    try {
        const response = await fetch('/nitra/torch/available-versions', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.currentUser.apiToken}`
            }
        });
        
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error("Failed to fetch torch versions:", error);
        return null;
    }
}

function createDropdown(options, selectedValue = null) {
    const select = document.createElement('select');
    select.style.cssText = `
        width: 100%;
        padding: 12px;
        background: #2A2A2A;
        color: #F0F0F0;
        border: 1px solid rgba(160, 187, 196, 0.2);
        border-radius: 8px;
        font-size: 1em;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
    `;
    
    options.forEach((option, index) => {
        const optionElement = document.createElement('option');
        optionElement.value = option;
        optionElement.textContent = option;
        if (selectedValue && option === selectedValue) {
            optionElement.selected = true;
        } else if (!selectedValue && index === 0) {
            optionElement.selected = true;
        }
        select.appendChild(optionElement);
    });
    
    return select;
}

function showTorchUpdatePopup(button, versions) {
    const cudaVersions = versions?.cuda_versions;
    const torchVersions = versions?.torch_versions;
    
    if (!cudaVersions || !torchVersions || cudaVersions.length === 0 || torchVersions.length === 0) {
        alert("Failed to load available versions. Please try again.");
        return;
    }
    
    // Build warning section
    const warningSection = Alert({
        type: 'warning',
        title: '⚠️ Important',
        children: [
            p(
                {},
                strong({}, 'This will uninstall your current PyTorch and reinstall the selected version.'),
                ' Custom nodes will have their requirements reinstalled to ensure compatibility with the new PyTorch version. This process may take several minutes.'
            )
        ]
    });
    
    // Build version selection section
    const torchLabel = div(
        { style: { marginBottom: '8px', color: '#F0F0F0', fontWeight: '600' } },
        'PyTorch Version:'
    );
    const torchDropdown = createDropdown(torchVersions);
    
    const cudaLabel = div(
        { style: { marginTop: '16px', marginBottom: '8px', color: '#F0F0F0', fontWeight: '600' } },
        'CUDA Version:'
    );
    const cudaDropdown = createDropdown(cudaVersions);
    
    const selectionSection = div(
        { style: { marginTop: '20px' } },
        h3({ style: { margin: '0 0 16px 0', color: '#F0F0F0', fontSize: '1.1em' } }, 'Select Versions'),
        torchLabel,
        torchDropdown,
        cudaLabel,
        cudaDropdown
    );
    
    // Build info section
    const infoSection = Alert({
        type: 'info',
        children: [
            p(
                {},
                'After updating PyTorch, all custom node requirements will be automatically reinstalled to ensure they work with the new version.'
            )
        ]
    });
    
    // Build button group
    const buttonGroup = div(
        { className: 'nitra-button-group' },
        Button({
            text: 'Cancel',
            onClick: closeModal,
            variant: 'secondary'
        }),
        Button({
            text: 'Update PyTorch',
            onClick: async () => {
                const selectedTorchVersion = torchDropdown.value;
                const selectedCudaVersion = cudaDropdown.value;
                closeModal();
                await runTorchUpdate(button, selectedTorchVersion, selectedCudaVersion);
            },
            variant: 'primary',
            large: true
        })
    );
    
    // Create and show modal
    const modal = Modal({
        title: 'Update PyTorch',
        subtitle: 'Select PyTorch and CUDA versions to install',
        onClose: closeModal,
        maxWidth: '600px',
        children: [
            warningSection,
            selectionSection,
            infoSection,
            buttonGroup
        ]
    });
    
    document.body.appendChild(modal);
    
    function closeModal() {
        if (modal.parentElement) {
            document.body.removeChild(modal);
        }
    }
}

async function runTorchUpdate(button, torchVersion, cudaVersion) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = `Updating PyTorch to ${torchVersion}...`;
    
    try {
        const response = await fetch('/nitra/install/torch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.currentUser.apiToken}`
            },
            body: JSON.stringify({
                user_id: state.currentUser.id,
                user_email: state.currentUser.email,
                torch_version: torchVersion,
                cuda_version: cudaVersion
            })
        });
        
        if (!response.ok) {
            throw new Error(`Update failed: ${response.status}`);
        }
        
        const result = await response.json();
        alert(`PyTorch ${torchVersion} with ${cudaVersion} installed successfully! Custom node requirements have been reinstalled.`);
        button.textContent = "✓ Updated";
        button.style.background = "#4CAF50";
        
    } catch (error) {
        console.error("PyTorch update error:", error);
        alert("Failed to update PyTorch. Please try again.");
        button.disabled = false;
        button.textContent = originalText;
    }
}

export async function updateTorch(button) {
    // Show loading state
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Loading versions...";
    
    try {
        // Fetch available versions
        const versions = await fetchAvailableTorchVersions();
        
        if (!versions) {
            alert("Unable to fetch available versions. Please check your internet connection and try again.");
            button.disabled = false;
            button.textContent = originalText;
            return;
        }
        
        // Restore button state
        button.disabled = false;
        button.textContent = originalText;
        
        // Show popup with version selection
        showTorchUpdatePopup(button, versions);
        
    } catch (error) {
        console.error("Error in updateTorch:", error);
        alert("Failed to load PyTorch versions. Please try again.");
        button.disabled = false;
        button.textContent = originalText;
    }
}

export async function handleOptimizerUpdate(button) {
    if (confirm("Are you sure you want to update ComfyUI? This will run 'git pull' and update related Python packages.")) {
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = "Updating ComfyUI...";
        
        try {
            const response = await fetch('/nitra/update-comfyui', { method: 'POST' });
            const result = await response.json();
            
            if (result.success) {
                showRestartPrompt({
                    message: 'Restart ComfyUI to finish applying the update.',
                    statusMessage: 'Restart ComfyUI when you are ready. We will prompt you to refresh once it is back online.',
                    onRestartSuccess: () => state.setPendingRefreshAfterRestart(true),
                });
            } else if (result.errors) {
                alert(`Update completed with errors:\n${result.errors.join('\n')}\n\nPlease check the logs for details.`);
            } else {
                alert(`Update failed: ${result.error || 'Unknown error'}`);
            }
            
            button.disabled = false;
            button.textContent = originalText;
        } catch (error) {
            console.error("Nitra: Update error", error);
            alert(`Failed to update ComfyUI: ${error.message}`);
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

export async function handleOptimizerUpdateNitra(button) {
    if (confirm("Are you sure you want to update Nitra? This will run 'git pull' in the ComfyUI-Nitra directory.")) {
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = "Updating Nitra...";
        
        try {
            const response = await fetch('/nitra/update-nitra', { method: 'POST' });
            const result = await response.json();
            
            if (result.success) {
                showRestartPrompt({
                    message: 'Restart ComfyUI to finish applying the Nitra update.',
                    statusMessage: 'Restart ComfyUI when you are ready. We will prompt you to refresh once it reconnects.',
                    onRestartSuccess: () => state.setPendingRefreshAfterRestart(true),
                });
            } else {
                alert(`Update failed: ${result.error || 'Unknown error'}`);
            }
            
            button.disabled = false;
            button.textContent = originalText;
        } catch (error) {
            console.error("Nitra: Update Nitra error", error);
            alert(`Failed to update Nitra: ${error.message}`);
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

export async function handleOptimizerRestart(button) {
    const confirmed = await showConfirmRestart();
    if (confirmed) {
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = "Restarting ComfyUI...";
        
        try {
            const response = await fetch('/nitra/restart', { method: 'GET' });
            let result = null;
            try {
                result = await response.json();
            } catch (parseError) {
                // response might close before JSON is returned; that's fine
                console.log("Nitra: Restart response closed before JSON parsed", parseError);
            }

            console.log("Nitra: Restart response received", {
                status: response.status,
                ok: response.ok,
                payload: result
            });

            if (response.ok) {
                if (result && result.success === false) {
                    const message = result?.error || "Restart failed.";
                    console.error("Nitra: Restart failed:", message);
                    button.disabled = false;
                    button.textContent = originalText;
                    return;
                }

                console.log("Nitra: Restart accepted by server (response ok)");
                button.textContent = "Restarting...";
                setTimeout(() => {
                    button.disabled = false;
                    button.textContent = originalText;
                }, 4000);
                return;
            }

            const message = result?.error || `Restart failed (${response.status})`;
            console.error("Nitra: Restart failed:", message);
            button.disabled = false;
            button.textContent = originalText;
        } catch (error) {
            // Connection error is expected when server restarts
            console.log("Nitra: Restart initiated (connection closed as expected)", error);
            button.disabled = false;
            button.textContent = originalText;
            // Don't show error alert - this is expected behavior
        }
    }
}

export async function handleOptimizerRefresh() {
    const confirmed = await showConfirmRefresh();
    if (confirmed) {
        // Set a flag to show splash screen after refresh
        localStorage.setItem('nitra_show_splash_after_refresh', 'true');
        window.location.reload();
    }
}


async function installPyTorchConfig(button, config) {
    const originalText = button.textContent;
    button.disabled = true;
    
    // Handle DynamoDB format - extract version for display
    const version = config.version?.S || config.version || 'Latest';
    button.textContent = `Installing PyTorch ${version}...`;
    
    try {
        // Handle DynamoDB format - extract config ID
        const configId = config.id?.S || config.id;
        
        const response = await fetch('/nitra/install/comfy-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.currentUser.apiToken}`
            },
            body: JSON.stringify({
                user_id: state.currentUser.id,
                user_email: state.currentUser.email,
                config_id: configId
            })
        });
        
        if (!response.ok) {
            throw new Error(`Installation failed: ${response.status}`);
        }
        
        const result = await response.json();
        alert(`PyTorch ${version} installed successfully! Custom node requirements have been reinstalled.`);
        button.textContent = "✓ Installed";
        button.style.background = "#4CAF50";
        
    } catch (error) {
        console.error("PyTorch installation error:", error);
        alert("Failed to install PyTorch. Please try again.");
        button.disabled = false;
        button.textContent = originalText;
    }
}

// Simple system versions getter for PyTorch (no complex caching)
async function getSystemVersionsSimple() {
    try {
        const response = await fetch('/nitra/check-versions');
        if (response.ok) {
            const data = await response.json();
            return {
                python: data.python?.version || 'Not detected',
                torch: data.torch?.version || 'Not installed',
                cuda: data.cuda?.version || 'Not detected'
            };
        }
    } catch (error) {
        console.error('Error getting simple system versions:', error);
    }
    return {
        python: 'Not detected',
        torch: 'Not installed', 
        cuda: 'Not detected'
    };
}

// Show PyTorch category popup with intuitive interface
async function showPyTorchCategoryPopup(category, button) {
    try {
        // For PyTorch, we don't need complex version checking - just get basic info quickly
        const systemVersions = await getSystemVersionsSimple();
        
        // Get all available PyTorch configs for dropdown
        const configsByCategory = await fetchComfyConfigsByCategory();
        const pytorchConfigs = configsByCategory[category] || [];
        
        // Build current system info section
        const systemInfoSection = Alert({
            type: 'info',
            title: 'Current System Information',
            children: [
                p({}, `Python: ${systemVersions.python || 'Not detected'}`),
                p({}, `PyTorch: ${systemVersions.torch || 'Not installed'}`),
                p({}, `CUDA: ${systemVersions.cuda || 'Not detected'}`)
            ]
        });
        
        // Build available PyTorch versions section
        const availableVersions = pytorchConfigs.map(pytorchConfig => {
            // Handle DynamoDB format - extract values from nested objects
            const version = pytorchConfig.version?.S || pytorchConfig.version || 'Latest';
            const cudaVersion = pytorchConfig.cudaVersion?.S || pytorchConfig.cudaVersion;
            const configId = pytorchConfig.id?.S || pytorchConfig.id;
            
            // Format CUDA version (e.g., "==12.8" -> "cu128")
            let cuda = '';
            if (cudaVersion) {
                const cudaMatch = cudaVersion.match(/==?(\d+)\.(\d+)/);
                if (cudaMatch) {
                    const major = cudaMatch[1];
                    const minor = cudaMatch[2];
                    cuda = `+cu${major}${minor}`;
                }
            }
            
            return {
                value: configId,
                label: `${version}${cuda}`,
                config: pytorchConfig
            };
        });
        
        if (availableVersions.length === 0) {
            const noVersionsSection = Alert({
                type: 'warning',
                children: [
                    p({}, 'No PyTorch configurations available. Please check your connection and try again.')
                ]
            });
            
            const modal = Modal({
                title: 'PyTorch Setup',
                subtitle: 'Configure PyTorch installation',
                onClose: closeModal,
                maxWidth: '600px',
                children: [
                    systemInfoSection,
                    noVersionsSection,
                    div(
                        { className: 'nitra-button-group' },
                        Button({
                            text: 'Close',
                            onClick: closeModal,
                            variant: 'secondary'
                        })
                    )
                ]
            });
            
            document.body.appendChild(modal);
            return;
        }
        
        const versionLabel = div(
            { style: { marginBottom: '8px', color: '#F0F0F0', fontWeight: '600' } },
            'Available PyTorch Versions:'
        );
        
        const versionDropdown = createDropdown(
            availableVersions.map(v => v.label),
            availableVersions[0]?.label
        );
        
        const selectionSection = div(
            { style: { marginTop: '20px' } },
            h3({ style: { margin: '0 0 16px 0', color: '#F0F0F0', fontSize: '1.1em' } }, 'Select PyTorch Version'),
            versionLabel,
            versionDropdown
        );
        
        // Build warning section
        const warningSection = Alert({
            type: 'warning',
            title: 'Important',
            children: [
                p(
                    {},
                    strong({}, 'This will update your PyTorch installation.'),
                    ' Custom nodes will have their requirements reinstalled to ensure compatibility with the new PyTorch version. This process may take several minutes.'
                )
            ]
        });
        
        // Build button group
        const buttonGroup = div(
            { className: 'nitra-button-group' },
            Button({
                text: 'Cancel',
                onClick: closeModal,
                variant: 'secondary'
            }),
            Button({
                text: 'Install PyTorch',
                onClick: async () => {
                    const selectedIndex = versionDropdown.selectedIndex;
                    const selectedConfig = availableVersions[selectedIndex];
                    closeModal();
                    await installPyTorchConfig(button, selectedConfig.config);
                },
                variant: 'primary',
                large: true
            })
        );
        
        // Create and show modal
        const modal = Modal({
            title: 'PyTorch Setup',
            subtitle: 'Configure PyTorch installation with current system info',
            onClose: closeModal,
            maxWidth: '600px',
            children: [
                systemInfoSection,
                selectionSection,
                warningSection,
                buttonGroup
            ]
        });
        
        document.body.appendChild(modal);
        
        function closeModal() {
            if (modal.parentElement) {
                document.body.removeChild(modal);
            }
        }
        
    } catch (error) {
        console.error("Error in showPyTorchCategoryPopup:", error);
        alert("Failed to load PyTorch information. Please try again.");
    }
}

// Show PyTorch config popup with intuitive interface
async function showPyTorchConfigPopup(config, button) {
    try {
        // For PyTorch, we don't need complex version checking - just get basic info quickly
        const systemVersions = await getSystemVersionsSimple();
        
        // Get all available PyTorch configs for dropdown
        const configsByCategory = await fetchComfyConfigsByCategory();
        const pytorchConfigs = configsByCategory['pytorch'] || configsByCategory['PyTorch'] || [];
        
        // Build current system info section
        const systemInfoSection = Alert({
            type: 'info',
            title: 'Current System Information',
            children: [
                p({}, `Python: ${systemVersions.python || 'Not detected'}`),
                p({}, `PyTorch: ${systemVersions.torch || 'Not installed'}`),
                p({}, `CUDA: ${systemVersions.cuda || 'Not detected'}`)
            ]
        });
        
        // Build available PyTorch versions section
        const availableVersions = pytorchConfigs.map(pytorchConfig => {
            // Handle DynamoDB format - extract values from nested objects
            const version = pytorchConfig.version?.S || pytorchConfig.version || 'Latest';
            const cudaVersion = pytorchConfig.cudaVersion?.S || pytorchConfig.cudaVersion;
            const configId = pytorchConfig.id?.S || pytorchConfig.id;
            
            // Format CUDA version (e.g., "==12.8" -> "cu128")
            let cuda = '';
            if (cudaVersion) {
                const cudaMatch = cudaVersion.match(/==?(\d+)\.(\d+)/);
                if (cudaMatch) {
                    const major = cudaMatch[1];
                    const minor = cudaMatch[2];
                    cuda = `+cu${major}${minor}`;
                }
            }
            
            return {
                value: configId,
                label: `${version}${cuda}`,
                config: pytorchConfig
            };
        });
        
        if (availableVersions.length === 0) {
            const noVersionsSection = Alert({
                type: 'warning',
                children: [
                    p({}, 'No PyTorch configurations available. Please check your connection and try again.')
                ]
            });
            
            const modal = Modal({
                title: 'PyTorch Setup',
                subtitle: 'Configure PyTorch installation',
                onClose: closeModal,
                maxWidth: '600px',
                children: [
                    systemInfoSection,
                    noVersionsSection,
                    div(
                        { className: 'nitra-button-group' },
                        Button({
                            text: 'Close',
                            onClick: closeModal,
                            variant: 'secondary'
                        })
                    )
                ]
            });
            
            document.body.appendChild(modal);
            return;
        }
        
        const versionLabel = div(
            { style: { marginBottom: '8px', color: '#F0F0F0', fontWeight: '600' } },
            'Available PyTorch Versions:'
        );
        
        const versionDropdown = createDropdown(
            availableVersions.map(v => v.label),
            availableVersions[0]?.label
        );
        
        const selectionSection = div(
            { style: { marginTop: '20px' } },
            h3({ style: { margin: '0 0 16px 0', color: '#F0F0F0', fontSize: '1.1em' } }, 'Select PyTorch Version'),
            versionLabel,
            versionDropdown
        );
        
        // Build warning section
        const warningSection = Alert({
            type: 'warning',
            title: 'Important',
            children: [
                p(
                    {},
                    strong({}, 'This will update your PyTorch installation.'),
                    ' Custom nodes will have their requirements reinstalled to ensure compatibility with the new PyTorch version. This process may take several minutes.'
                )
            ]
        });
        
        // Build button group
        const buttonGroup = div(
            { className: 'nitra-button-group' },
            Button({
                text: 'Cancel',
                onClick: closeModal,
                variant: 'secondary'
            }),
            Button({
                text: 'Install PyTorch',
                onClick: async () => {
                    const selectedIndex = versionDropdown.selectedIndex;
                    const selectedConfig = availableVersions[selectedIndex];
                    closeModal();
                    await installPyTorchConfig(button, selectedConfig.config);
                },
                variant: 'primary',
                large: true
            })
        );
        
        // Create and show modal
        const modal = Modal({
            title: 'PyTorch Setup',
            subtitle: 'Configure PyTorch installation with current system info',
            onClose: closeModal,
            maxWidth: '600px',
            children: [
                systemInfoSection,
                selectionSection,
                warningSection,
                buttonGroup
            ]
        });
        
        document.body.appendChild(modal);
        
        function closeModal() {
            if (modal.parentElement) {
                document.body.removeChild(modal);
            }
        }
        
    } catch (error) {
        console.error("Error in showPyTorchConfigPopup:", error);
        alert("Failed to load PyTorch information. Please try again.");
    }
}


