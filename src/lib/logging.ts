const verboseLoggingEnabled = process.env.MUSIC_BRIDGE_VERBOSE_LOGS === 'true';

export function workflowLog(...args: unknown[]) {
    console.log(...args);
}

export function workflowWarn(...args: unknown[]) {
    console.warn(...args);
}

export function debugLog(...args: unknown[]) {
    if (verboseLoggingEnabled) {
        console.log(...args);
    }
}

export function debugWarn(...args: unknown[]) {
    if (verboseLoggingEnabled) {
        console.warn(...args);
    }
}

export function isVerboseLoggingEnabled() {
    return verboseLoggingEnabled;
}
