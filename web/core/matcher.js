/**
 * Normalizes a string for comparison (trim + lowercase)
 */
const normalize = (value) => value.trim().toLowerCase();

/**
 * Helper to get the repo URL from a node object, checking common fields
 */
function getRepoUrl(node) {
    return node.gitRepo || node.git_url || node.url || node.reference || '';
}

/**
 * Derive aux_id from repo URL (logic from ComfyUI-Manager)
 */
function deriveAuxId(repoUrl) {
    if (!repoUrl) return null;
    repoUrl = repoUrl.replace(/\.git$/, '').replace(/\/$/, ''); // Normalize
    if (repoUrl.includes('github.com')) {
        return repoUrl.split('/').slice(-2).join('/');
    }
    // Fallback for other URLs or partials
    const parts = repoUrl.split('/');
    return parts[parts.length - 1];
}

/**
 * Calculates similarity between two strings (0.0 to 1.0)
 */
function calculateSimilarity(str1, str2) {
    const s1 = normalize(str1);
    const s2 = normalize(str2);
    
    if (s1 === s2) return 1.0;
    if (s1.length < 2 || s2.length < 2) return 0.0;

    const bigrams1 = new Set();
    for (let i = 0; i < s1.length - 1; i++) {
        bigrams1.add(s1.substring(i, i + 2));
    }

    let intersection = 0;
    for (let i = 0; i < s2.length - 1; i++) {
        const bigram = s2.substring(i, i + 2);
        if (bigrams1.has(bigram)) {
            intersection++;
        }
    }

    return (2.0 * intersection) / (s1.length + s2.length - 2);
}

/**
 * Check if a custom node package is installed by matching folder names
 * installedFolders is a Set of lowercase folder names from custom_nodes directory
 */
function isPackageInstalled(packageName, repoUrl, installedFolders) {
    if (!installedFolders || installedFolders.size === 0) return false;
    
    // Try matching package name directly
    if (packageName) {
        const nameLower = packageName.toLowerCase();
        if (installedFolders.has(nameLower)) return true;
        // Try with common prefixes/suffixes removed
        const variants = [
            nameLower,
            nameLower.replace(/^comfyui[-_]?/i, ''),
            nameLower.replace(/[-_]?comfyui$/i, ''),
        ];
        for (const v of variants) {
            if (installedFolders.has(v)) return true;
            // Check if any installed folder contains this name
            for (const folder of installedFolders) {
                if (folder.includes(v) || v.includes(folder)) {
                    // Only match if they share significant overlap
                    if (v.length > 5 && folder.length > 5) return true;
                }
            }
        }
    }
    
    // Try matching based on repo URL
    if (repoUrl) {
        const repoName = deriveAuxId(repoUrl);
        if (repoName) {
            const repoLower = repoName.toLowerCase();
            if (installedFolders.has(repoLower)) return true;
            // Check partial matches
            for (const folder of installedFolders) {
                if (folder === repoLower || folder.includes(repoLower) || repoLower.includes(folder)) {
                    if (Math.min(folder.length, repoLower.length) > 5) return true;
                }
            }
        }
    }
    
    return false;
}

export function matchCustomNodes(detectedIds, detectedCnrIds = [], detectedAuxIds = [], availableNodes, installedNodeTypes = new Set(), nodeMappings = {}, installedFolders = new Set()) {
    const matches = [];
    const missing = [];
    const seenPacks = new Set(); // Deduplicate packs

    // 1. Process explicit CNR IDs (most reliable)
    detectedCnrIds.forEach(cnrId => {
        const normalizedCnr = normalize(cnrId);
        
        const match = availableNodes.find(node => {
            if (node.id && normalize(node.id) === normalizedCnr) return true;
            if (node.name && normalize(node.name) === normalizedCnr) return true;
            return false;
        });

        if (match) {
            const nodeUrl = getRepoUrl(match);
            const packId = match.id || nodeUrl;

            if (!seenPacks.has(packId)) {
                seenPacks.add(packId);
                const isInstalled = isPackageInstalled(match.name, nodeUrl, installedFolders);
                matches.push({ 
                    ...match, 
                    gitRepo: nodeUrl, 
                    detectedName: cnrId,
                    isInstalled: isInstalled,
                    matchSource: 'cnr_id'
                });
            }
        }
    });

    // 2. Process Aux IDs (Secondary method, common for GitHub repos)
    // Build map of derived aux_id -> node for fast lookup
    const auxIdToNodeMap = new Map();
    availableNodes.forEach(node => {
        const repoUrl = getRepoUrl(node);
        if (repoUrl) {
            const auxId = deriveAuxId(repoUrl);
            if (auxId) {
                // We use normalized keys for safer matching
                auxIdToNodeMap.set(normalize(auxId), node);
            }
        }
    });

    detectedAuxIds.forEach(auxId => {
        const normAuxId = normalize(auxId);
        if (auxIdToNodeMap.has(normAuxId)) {
            const match = auxIdToNodeMap.get(normAuxId);
            const nodeUrl = getRepoUrl(match);
            const packId = match.id || nodeUrl;

            if (!seenPacks.has(packId)) {
                seenPacks.add(packId);
                const isInstalled = isPackageInstalled(match.name, nodeUrl, installedFolders);
                matches.push({
                    ...match,
                    gitRepo: nodeUrl,
                    detectedName: auxId,
                    isInstalled: isInstalled,
                    matchSource: 'aux_id'
                });
            }
        }
    });

    // 3. Process Node Types (Legacy/Standard method)
    // Pre-build a map of NodeType -> Set(PackURLs) for faster lookup
    const nodeTypeToPackUrls = new Map();
    Object.entries(nodeMappings).forEach(([url, nodeTypes]) => {
        if (Array.isArray(nodeTypes)) {
            nodeTypes.forEach(type => {
                if (typeof type === 'string') {
                    const normType = normalize(type);
                    if (!nodeTypeToPackUrls.has(normType)) {
                        nodeTypeToPackUrls.set(normType, new Set());
                    }
                    nodeTypeToPackUrls.get(normType).add(url);
                }
            });
        }
    });

    detectedIds.forEach(id => {
        const normalizedId = normalize(id);
        const isInstalled = installedNodeTypes.has(id);
        
        let matchedPackUrl = null;
        if (nodeTypeToPackUrls.has(normalizedId)) {
            const packs = nodeTypeToPackUrls.get(normalizedId);
            if (packs.size > 0) {
                for (const pUrl of packs) {
                    matchedPackUrl = pUrl;
                    break; 
                }
            }
        }

        const match = availableNodes.find(node => {
            if (!node) return false;
            const nodeUrl = getRepoUrl(node);
            
            if (matchedPackUrl && nodeUrl) {
                const repoA = nodeUrl.replace(/\.git$/, '').replace(/^https?:\/\//, '').toLowerCase();
                const repoB = matchedPackUrl.replace(/\.git$/, '').replace(/^https?:\/\//, '').toLowerCase();
                if (repoA === repoB || repoA.endsWith(repoB) || repoB.endsWith(repoA)) {
                    return true;
                }
            }

            if (node.name && normalize(node.name) === normalizedId) return true;
            
            if (nodeUrl) {
                const repo = nodeUrl.replace(/\.git$/, '').replace(/^https?:\/\//, '');
                const parts = repo.split('/').filter(Boolean);
                return normalize(parts[parts.length - 1]) === normalizedId;
            }
            return false;
        });

        if (match) {
            const nodeUrl = getRepoUrl(match);
            const packId = match.id || nodeUrl;
            
            // Check if installed via node type registration OR folder existence
            const nodeTypeInstalled = isInstalled;
            const folderInstalled = isPackageInstalled(match.name, nodeUrl, installedFolders);
            const packageIsInstalled = nodeTypeInstalled || folderInstalled;
            
            if (seenPacks.has(packId)) {
                if (packageIsInstalled) {
                    const existing = matches.find(m => (m.id || getRepoUrl(m)) === packId);
                    if (existing) existing.isInstalled = true;
                }
            } else {
                seenPacks.add(packId);
                matches.push({ 
                    ...match, 
                    gitRepo: nodeUrl, 
                    detectedName: id,
                    isInstalled: packageIsInstalled,
                    matchSource: 'node_type'
                });
            }
        } else {
            if (!isInstalled) {
                if (!nodeTypeToPackUrls.has(normalizedId)) {
                     missing.push({ name: id });
                }
            }
        }
    });

    return { matches, missing };
}

/**
 * Strips file extension from a filename
 */
function stripExtension(filename) {
    return filename.replace(/\.(safetensors|ckpt|pt|bin|pth|gguf)$/i, '');
}

/**
 * Check if a model is installed by comparing filenames (case-insensitive, without extension)
 * installedModels is a Set of basenames (without extensions) from the filesystem
 */
function isModelInstalled(filename, modelName, installedModels) {
    // Create lowercase Set for case-insensitive matching
    const installedLower = new Set([...installedModels].map(m => m.toLowerCase()));
    
    // Check detected filename (without extension)
    const detectedNoExt = stripExtension(filename).toLowerCase();
    if (installedLower.has(detectedNoExt)) {
        return true;
    }
    
    // Check matched model name (without extension)
    if (modelName) {
        const matchedNoExt = stripExtension(modelName).toLowerCase();
        if (installedLower.has(matchedNoExt)) {
            return true;
        }
    }
    
    return false;
}

export function matchModels(detectedFiles, availableModels, installedModelNames = new Set(), threshold = 0.5) {
    const matches = [];
    const missing = [];

    // Handle both old format (array of strings) and new format (array of {filename, originalPath})
    detectedFiles.forEach(fileEntry => {
        // Support both formats: string or {filename, originalPath} object
        const filename = typeof fileEntry === 'string' ? fileEntry : fileEntry.filename;
        const originalPath = typeof fileEntry === 'string' ? fileEntry : fileEntry.originalPath;
        
        const filenameLower = filename.toLowerCase();
        const filenameNoExt = stripExtension(filename).toLowerCase();

        // 1. Try exact match first (case-insensitive) - return immediately if found
        const exactMatch = availableModels.find(m => 
            m.modelName && m.modelName.toLowerCase() === filenameLower
        );
        if (exactMatch) {
            matches.push({ 
                ...exactMatch, 
                matchType: 'Exact', 
                score: 1.0, 
                detectedName: filename,
                originalPath: originalPath,
                isInstalled: isModelInstalled(filename, exactMatch.modelName, installedModelNames),
                hfTokenRequired: exactMatch.hfTokenRequired,
                url: exactMatch.url || exactMatch.modelUrl || exactMatch.fileUrl || exactMatch.downloadUrl || exactMatch.href || ''
            });
            return;
        }

        // 2. Try exact match without extension - return immediately if found
        const exactNoExtMatch = availableModels.find(m => 
            m.modelName && stripExtension(m.modelName).toLowerCase() === filenameNoExt
        );
        if (exactNoExtMatch) {
            matches.push({ 
                ...exactNoExtMatch, 
                matchType: 'Exact', 
                score: 1.0, 
                detectedName: filename,
                originalPath: originalPath,
                isInstalled: isModelInstalled(filename, exactNoExtMatch.modelName, installedModelNames),
                hfTokenRequired: exactNoExtMatch.hfTokenRequired,
                url: exactNoExtMatch.url || exactNoExtMatch.modelUrl || exactNoExtMatch.fileUrl || exactNoExtMatch.downloadUrl || exactNoExtMatch.href || ''
            });
            return;
        }

        // 3. No exact match found - iterate through ALL models to find best fuzzy match
        let bestMatch = null;
        let bestScore = 0;

        availableModels.forEach(model => {
            if (!model.modelName) return;
            
            const modelNameLower = model.modelName.toLowerCase();
            const modelNameNoExt = stripExtension(model.modelName).toLowerCase();
            
            // Strategy A: Bigram similarity on full names
            let score = calculateSimilarity(filename, model.modelName);
            
            // Strategy B: Bigram similarity without extensions
            const scoreNoExt = calculateSimilarity(filenameNoExt, modelNameNoExt);
            if (scoreNoExt > score) score = scoreNoExt;
            
            // Strategy C: Substring containment bonus
            if (modelNameLower.includes(filenameNoExt) || filenameNoExt.includes(modelNameNoExt)) {
                // If one contains the other, boost score significantly
                const containmentScore = Math.min(filenameNoExt.length, modelNameNoExt.length) / 
                                        Math.max(filenameNoExt.length, modelNameNoExt.length);
                if (containmentScore > score) score = Math.max(score, containmentScore * 0.9);
            }
            
            // Update best match if this score is higher
            if (score > bestScore) {
                bestScore = score;
                bestMatch = model;
            }
        });

        if (bestMatch && bestScore >= threshold) {
            matches.push({ 
                ...bestMatch, 
                matchType: 'Similar', 
                score: bestScore,
                detectedName: filename,
                originalPath: originalPath,
                isInstalled: isModelInstalled(filename, bestMatch.modelName, installedModelNames),
                hfTokenRequired: bestMatch.hfTokenRequired,
                url: bestMatch.url || bestMatch.modelUrl || bestMatch.fileUrl || bestMatch.downloadUrl || bestMatch.href || ''
            });
        } else {
            // Check if the detected file itself is installed (even without a match in our database)
            const detectedIsInstalled = isModelInstalled(filename, null, installedModelNames);
            missing.push({ 
                name: filename, 
                originalPath: originalPath,
                bestScore: bestScore, 
                bestMatchName: bestMatch?.modelName, 
                isInstalled: detectedIsInstalled 
            });
        }
    });

    return { matches, missing };
}
